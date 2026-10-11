"""性能优化回归测试（P1 检索查询计划 / P2 导出桥接进程复用）。

覆盖：

* **P1** ``bank.query.search`` 的 FTS join 必须让 ``questions`` 走**主键点查**
  （``SEARCH q USING INTEGER PRIMARY KEY``），**不得**退化为 ``SCAN q``——
  这是「裸关键词检索 8–15s → <20ms」的性能根因；同时校验优化后**结果集不变**
  （与直接查 ``question_fts`` 的参照集逐条 id 比对）与**分页不重不漏**。
* **P2** ``bank.export.EditorBridge.call`` 必须**进程内 HTTP 直连**（不再 ``subprocess``），
  且桥接不可达时**抛 ``ExportError``（不误报成功）**；同时守护 ``export`` 模块
  **不再引入 ``subprocess``**。

用标准库 unittest，数据库用内存库；P2 用 ``mock`` 替换 ``_mcp_rpc``。
"""
# ---------------------------------------------------------------------------
# title: 性能优化回归测试
# description: P1 检索查询计划（rowid 点查 + 结果集一致 + 分页不重不漏）与 P2 导出桥接进程复用（进程内 HTTP + 失败不误报）。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import re
import unittest
from unittest import mock

#: 匹配「全表扫描 questions 别名 q」的查询计划行。用词边界，避免误伤 ``SCAN question_fts``。
_SCAN_Q_RE = re.compile(r"^SCAN q\b")

from bank import db as bdb
from bank import export as bexport
from bank import query as bq
from bank import textutil as btu


def _seed(conn, n: int, keyword: str = "浮力") -> list[int]:
    """直接写入 ``source_files`` / ``questions`` / ``question_fts``，返回题目 id 列表。

    绕开导入器（避免测试依赖阶段1 产物），但**字段与真实导入一致**：
    ``question_fts.question_id`` 存**字符串**（与 ``bank/importer.py`` 相同）。
    """
    conn.execute(
        "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade,"
        " textbook, chapter, questions_count, formulas_count)"
        " VALUES ('seed.json','seedsha','seed.json','初中','物理','八年级下册',"
        " '苏科版','10.4',?,0)", (n,))
    sid = conn.execute("SELECT id FROM source_files WHERE sha256='seedsha'").fetchone()["id"]
    texts = [f"{i + 1}．物体受到的{keyword}与排开液体体积有关" for i in range(n)]
    for i, text in enumerate(texts):
        conn.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, chapter, qtype,"
            " char_length, content_hash) VALUES (?,?,?,?,?,?,?,?)",
            (sid, str(i + 1), text, text, "10.4", "选择题", len(text),
             hashlib.sha256(text.encode("utf-8")).hexdigest()))
    qids = [r["id"] for r in conn.execute("SELECT id FROM questions ORDER BY id")]
    for qid, text in zip(qids, texts):
        conn.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                     (btu.tokenized_text(text), str(qid)))
    conn.commit()
    return qids


class _Capture:
    """连接代理：记录执行过的 SQL，其余属性透传（用于抓取 ``search`` 生成的 SQL）。"""

    def __init__(self, conn):
        self._conn = conn
        self.sqls: list[str] = []

    def execute(self, sql, params=None):
        self.sqls.append(sql)
        if params is None:
            return self._conn.execute(sql)
        return self._conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


class TestP1SearchPlan(unittest.TestCase):
    """P1：FTS join 查询计划与结果集正确性。"""

    N = 120  # 足以让 SQLite 的成本模型暴露 OLD join 的 SCAN（实测 n≥1 即已分化）

    def setUp(self):
        self.conn = bdb.connect(":memory:")
        self.qids = _seed(self.conn, self.N)

    def tearDown(self):
        self.conn.close()

    def _capture_select(self, **kwargs) -> tuple[str, dict]:
        """跑一次 ``search`` 并抓取带 ``LIMIT`` 的那条 SELECT 与其参数。"""
        cap = _Capture(self.conn)
        bq.search(cap, **kwargs)
        sql = next(s for s in cap.sqls if "LIMIT :limit" in s)
        # 复算参数（search 内部已把 limit/offset 注入）
        where, params, _ = bq._build_where(
            kwargs.get("keyword"), kwargs.get("stage"), kwargs.get("subject"),
            kwargs.get("grade"), kwargs.get("textbook"), kwargs.get("chapter"),
            kwargs.get("qtype"), kwargs.get("difficulty"), kwargs.get("section"),
            kwargs.get("number"), kwargs.get("labels"), kwargs.get("needs_review"))
        params = dict(params)
        params["limit"] = int(kwargs.get("limit", 20))
        params["offset"] = int(kwargs.get("offset", 0))
        return sql, params

    def _plan(self, sql: str, params: dict) -> list[str]:
        rows = self.conn.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
        return [r["detail"] for r in rows]

    def _assert_point_lookup(self, plan: list[str]):
        joined = " | ".join(plan)
        self.assertIn("SEARCH q USING INTEGER PRIMARY KEY", joined, joined)
        self.assertFalse(any(_SCAN_Q_RE.match(d) for d in plan),
                         f"questions 被全表扫描：{joined}")

    def test_plan_uses_rowid_point_lookup(self):
        """优化后：``questions`` 必须走主键点查，绝不能全表扫描。"""
        sql, params = self._capture_select(keyword="浮力")
        self._assert_point_lookup(self._plan(sql, params))

    def test_plan_for_combined_filter(self):
        """带 ``qtype`` 过滤时同样必须走主键点查。"""
        sql, params = self._capture_select(keyword="浮力", qtype="选择题")
        self._assert_point_lookup(self._plan(sql, params))

    def test_old_join_would_scan(self):
        """反证：若把 join 表达式写回 ``question_fts.question_id = CAST(q.id AS TEXT)``，
        计划必然退化为 ``SCAN q``——证明本回归测试**确实能抓到**该退化。"""
        where, params, _ = bq._build_where("浮力", None, None, None, None, None, None,
                                           None, None, None, None, None)
        p = dict(params)
        p.update(limit=20, offset=0)
        old_from = (bq._BASE_FROM
                    + " JOIN question_fts ON question_fts.question_id = CAST(q.id AS TEXT)")
        sql = (f"SELECT {bq._ITEM_COLUMNS} {old_from}{where}"
               " ORDER BY bm25(question_fts) LIMIT :limit OFFSET :offset")
        plan = self._plan(sql, p)
        self.assertTrue(any(_SCAN_Q_RE.match(d) for d in plan), " | ".join(plan))

    def test_result_ids_match_reference(self):
        """结果集一致：``search`` 的命中 id 集合必须与直接查 ``question_fts`` 的参照集完全相同。"""
        for kw in ("浮力", "物体", "排开液体", "不存在的词"):
            where, params, use_fts = bq._build_where(kw, None, None, None, None, None, None,
                                                     None, None, None, None, None)
            got = {r["id"] for r in bq.search(self.conn, keyword=kw, limit=10_000)["items"]}
            if use_fts:
                ref = {int(r["question_id"]) for r in self.conn.execute(
                    "SELECT question_id FROM question_fts WHERE question_fts MATCH :fts",
                    params)}
            else:
                ref = {r["id"] for r in self.conn.execute(
                    "SELECT id FROM questions WHERE plain_text LIKE :kw_like", params)}
            self.assertEqual(got, ref, f"关键词 {kw!r} 结果集不一致")

    def test_pagination_no_dup_no_gap(self):
        """分页不重不漏：逐页拼接后与一次性结果完全相同，且无重复 id。"""
        full = [r["id"] for r in bq.search(self.conn, keyword="浮力", limit=10_000)["items"]]
        self.assertEqual(len(full), len(set(full)), "全量结果存在重复 id")
        paged: list[int] = []
        for off in range(0, len(full), 25):
            page = bq.search(self.conn, keyword="浮力", limit=25, offset=off)
            paged.extend(r["id"] for r in page["items"])
        self.assertEqual(paged, full, "分页结果与全量不一致（重/漏）")


class TestP2BridgeInProcess(unittest.TestCase):
    """P2：``EditorBridge`` 进程内 HTTP 直连与失败语义。"""

    def setUp(self):
        self.bridge = bexport.EditorBridge()

    def test_module_has_no_subprocess(self):
        """守护：``bank.export`` 不再引入 ``subprocess``（回退即失败）。"""
        self.assertFalse(hasattr(bexport, "subprocess"),
                         "bank.export 又引入了 subprocess，导出会退化为逐段起进程")

    def test_call_uses_tools_call_and_parses_json(self):
        """``call`` 应发 ``tools/call`` 并把 ``content[].text`` 解析为 JSON。"""
        fake = {"content": [{"type": "text", "text": '{"file_id": "abc", "ok": true}'}]}
        with mock.patch.object(bexport, "_mcp_rpc", return_value=fake) as m:
            out = self.bridge.call("create_doc")
        m.assert_called_once_with("tools/call", {"name": "create_doc", "arguments": {}})
        self.assertEqual(out, {"file_id": "abc", "ok": True})

    def test_call_returns_raw_text_when_not_json(self):
        """非 JSON 文本内容原样返回（与旧子进程实现语义一致）。"""
        fake = {"content": [{"type": "text", "text": "hello world"}]}
        with mock.patch.object(bexport, "_mcp_rpc", return_value=fake):
            self.assertEqual(self.bridge.call("some_tool"), "hello world")

    def test_call_joins_multiple_text_blocks(self):
        """多个 text 块按换行拼接后再解析。"""
        fake = {"content": [{"type": "text", "text": "1"},
                            {"type": "text", "text": "2"}]}
        with mock.patch.object(bexport, "_mcp_rpc", return_value=fake):
            self.assertEqual(self.bridge.call("t"), "1\n2")

    def test_call_bridge_unreachable_raises_export_error(self):
        """桥接不可达 -> ``ExportError``（绝不静默返回、不误报成功）。"""
        with mock.patch.object(bexport, "_mcp_rpc",
                               side_effect=bexport.BridgeUnreachable("端口探测失败")):
            with self.assertRaises(bexport.ExportError) as ctx:
                self.bridge.call("create_doc")
        self.assertIn("create_doc", str(ctx.exception))

    def test_call_tool_error_propagates_as_export_error(self):
        """具体工具报错（JSON-RPC error）同样抛 ``ExportError``。"""
        with mock.patch.object(bexport, "_mcp_rpc",
                               side_effect=bexport.ExportError("editor_sdk JSON-RPC 错误 -32603")):
            with self.assertRaises(bexport.ExportError):
                self.bridge.call("doc_insert_math")

    def test_endpoint_discovery_caches(self):
        """端点发现只探测一次，后续复用模块级缓存。"""
        saved = bexport._MCP_ENDPOINT_CACHE
        bexport._MCP_ENDPOINT_CACHE = None
        try:
            calls = []

            def fake_post(endpoint, method, params, *, timeout=60.0):
                calls.append((endpoint, method))
                return {"result": {"tools": []}}

            with mock.patch.object(bexport, "_mcp_post", side_effect=fake_post):
                e1 = bexport._mcp_endpoint()
                e2 = bexport._mcp_endpoint()
            self.assertEqual(e1, e2)
            self.assertEqual(len(calls), 1, "端点探测未被缓存")
        finally:
            bexport._MCP_ENDPOINT_CACHE = saved

    def test_endpoint_unreachable_raises(self):
        """所有端口都探测失败 -> ``BridgeUnreachable``。"""
        saved = bexport._MCP_ENDPOINT_CACHE
        bexport._MCP_ENDPOINT_CACHE = None
        try:
            with mock.patch.object(bexport, "_mcp_post", side_effect=OSError("refused")):
                with self.assertRaises(bexport.BridgeUnreachable):
                    bexport._mcp_endpoint()
        finally:
            bexport._MCP_ENDPOINT_CACHE = saved


if __name__ == "__main__":
    unittest.main()
