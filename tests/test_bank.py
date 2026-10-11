"""bank 包测试：导入幂等 / 章节筛选 / 中文关键词 / 待复核队列 / 题目版本 / 元数据。

用标准库 unittest，数据库用临时文件（不用内存库，方便模拟真实路径）。
"""
# ---------------------------------------------------------------------------
# title: 题库测试
# description: 覆盖导入幂等、章节筛选、中文关键词、待复核队列、题目版本与元数据提取；含 LIKE 通配符转义回归（%/_ 按字面匹配，不再命中全表）。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import importer as bimp
from bank import query as bq
from bank import textutil as btu


def q(number, text, *, section=None, formula_ids=None, images=None,
      start=0, end=1, label="编号"):
    """构造一条阶段1 风格的题目字典。"""
    return {
        "number": number, "label": label, "start_paragraph": start, "end_paragraph": end,
        "text": text, "formula_ids": formula_ids or [], "images": images or [],
        "section": section, "sub_question_count": 0,
    }


def write_fixture(dir_path: Path, name: str, questions: list, *,
                  head=None, formulas=None, source_path=None) -> Path:
    """写出 ``<name>.questions.json`` 与 ``<name>.scan.json``，返回 questions.json 路径。"""
    formulas = formulas or {}
    qj = {
        "path": source_path or "",
        "stats": {},
        "questions": questions,
        "unassigned_before_first": head or [],
        "formula_index": {
            fid: {k: f.get(k) for k in ("kind", "status", "latex", "progid")}
            for fid, f in formulas.items()
        },
    }
    scan = {"path": source_path or "", "stats": {}, "paragraphs": [],
            "formulas": formulas, "images": {}}
    qf = dir_path / f"{name}.questions.json"
    qf.write_text(json.dumps(qj, ensure_ascii=False), encoding="utf-8")
    (dir_path / f"{name}.scan.json").write_text(
        json.dumps(scan, ensure_ascii=False), encoding="utf-8")
    return qf


class BankTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def count(self, table: str) -> int:
        return self.conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]


class TestImportIdempotent(BankTestBase):
    def test_import_twice_no_duplicates(self):
        write_fixture(self.dir, "a", [
            q("1", "1．物体受到的浮力与排开液体体积有关", start=0),
            q("2", "2．测量小石块的密度", start=1),
        ])
        st1 = bimp.import_path(self.conn, self.dir / "a.questions.json", verbose=False)
        self.assertEqual(st1.questions_new, 2)
        n1 = self.count("questions")

        st2 = bimp.import_path(self.conn, self.dir / "a.questions.json", verbose=False)
        self.assertEqual(st2.questions_new, 0)
        self.assertEqual(st2.questions_skipped, 2)
        self.assertEqual(st2.files_skipped, 1)
        self.assertEqual(self.count("questions"), n1)

    def test_numeric_junk_skipped(self):
        write_fixture(self.dir, "j", [
            q("1", "1．真题题干", start=0),
            q("0", "0.30", start=1),            # 表格数值被误切
        ])
        st = bimp.import_path(self.conn, self.dir / "j.questions.json", verbose=False)
        self.assertEqual(st.questions_new, 1)
        self.assertEqual(st.questions_junk, 1)
        self.assertEqual(self.count("questions"), 1)

    def test_table_data_block_skipped(self):
        """实验数据表格块（小数开头 + 汉字极少）在导入层被过滤。"""
        write_fixture(self.dir, "d", [
            q("1", "1．真题题干", start=0),
            q("2", "2.5\n3\n温度/℃\n99\n99", start=1),
            q("1", "1.5格\n2\n较强", start=2),
            q("3", "0.30\n正常发光\n3", start=3),
        ])
        st = bimp.import_path(self.conn, self.dir / "d.questions.json", verbose=False)
        self.assertEqual(st.questions_new, 1)
        self.assertEqual(st.questions_junk, 3)
        self.assertEqual(self.count("questions"), 1)


class TestTextutilJunk(unittest.TestCase):
    def test_numeric_junk_positive(self):
        for t in ("0.30", "66.7%", "0.6A×5Ω=3V", "2.0×105Pa",
                  "2.5\n3\n温度/℃\n99\n99", "1.5格\n2\n较强", "0.30\n正常发光\n3"):
            self.assertTrue(btu.is_numeric_junk(t), t)

    def test_numeric_junk_negative(self):
        """真题不能被判为垃圾。"""
        for t in ("27.2018年5月13日，中国首艘国产航母001A型离港海试",
                  "1．物体受到的浮力与排开液体体积有关",
                  "1.一个质量分布均匀的正方体静止在水平地面上",
                  "10.3探索更小的微粒"):
            self.assertFalse(btu.is_numeric_junk(t), t)

    def test_title_artifact(self):
        self.assertTrue(btu.is_title_artifact("10", "10.3探索更小的微粒\n学校:___"))
        self.assertFalse(btu.is_title_artifact("10", "10．探索更小的微粒"))      # 全角句点
        self.assertFalse(btu.is_title_artifact("27", "27.2018年5月13日…"))      # 年份正文

    def test_bigram_tokens(self):
        self.assertEqual(btu.bigram_tokens("浮力"), ["浮力"])
        self.assertIn("探索", btu.bigram_tokens("探索更小的微粒"))
        self.assertIn("abc", btu.bigram_tokens("ABC 123"))


class TestMetadataAndFilter(BankTestBase):
    def test_metadata_extracted_from_filename(self):
        write_fixture(self.dir, "10.3 探索更小的微粒 同步练习-苏科版物理八年级下册", [
            q("1", "1．题干", section="一、单选题", start=0),
        ])
        bimp.import_path(self.conn, self.dir, verbose=False)
        row = self.conn.execute("SELECT * FROM source_files").fetchone()
        self.assertEqual(row["stage"], "初中")
        self.assertEqual(row["grade"], "八年级下册")
        self.assertEqual(row["subject"], "物理")
        self.assertEqual(row["textbook"], "苏科版")
        self.assertEqual(row["chapter"], "10.3")

    def test_filter_by_chapter(self):
        write_fixture(self.dir, "10.3 探索更小的微粒 苏科版物理八年级下册",
                      [q("1", "1．甲题", start=0)])
        write_fixture(self.dir, "9.4浮力课后练习 苏科版物理八年级下册",
                      [q("1", "1．乙题", start=0)])
        bimp.import_path(self.conn, self.dir, verbose=False)
        res = bq.search(self.conn, chapter="10.3")
        self.assertEqual(res["total"], 1)
        self.assertIn("甲题", res["items"][0]["plain_text"])
        res2 = bq.search(self.conn, chapter="9.4")
        self.assertEqual(res2["total"], 1)

    def test_filter_by_qtype(self):
        write_fixture(self.dir, "卷A 物理八年级下册", [
            q("1", "1．选择", section="一、单选题", start=0),
            q("2", "2．填空", section="二、填空题", start=1),
        ])
        bimp.import_path(self.conn, self.dir, verbose=False)
        self.assertEqual(bq.search(self.conn, qtype="选择题")["total"], 1)
        self.assertEqual(bq.search(self.conn, qtype="填空题")["total"], 1)

    def test_labels_attached(self):
        write_fixture(self.dir, "10.3 探索更小的微粒 苏科版物理八年级下册", [
            q("1", "1．题干", section="一、单选题", start=0),
        ])
        bimp.import_path(self.conn, self.dir, verbose=False)
        names = {(l["namespace"], l["name"]) for l in bq.list_labels(self.conn)}
        self.assertIn(("chapter", "10.3"), names)
        self.assertIn(("section", "一、单选题"), names)


class TestChineseSearch(BankTestBase):
    def setUp(self):
        super().setUp()
        write_fixture(self.dir, "卷 物理八年级下册", [
            q("1", "1．物体受到的浮力与排开液体体积有关", start=0),
            q("2", "2．用天平测量小石块的密度", start=1),
            q("3", "3．阿基米德原理的内容是什么", start=2),
        ])
        bimp.import_path(self.conn, self.dir, verbose=False)

    def test_bigram_hit_two_char(self):
        res = bq.search(self.conn, keyword="浮力")
        self.assertEqual(res["total"], 1)
        self.assertIn("浮力", res["items"][0]["plain_text"])

    def test_bigram_hit_phrase(self):
        # 连续子串「小石块」应命中（bigram: 小石/石块）
        res = bq.search(self.conn, keyword="小石块")
        self.assertEqual(res["total"], 1)
        self.assertIn("小石块", res["items"][0]["plain_text"])

    def test_keyword_miss(self):
        self.assertEqual(bq.search(self.conn, keyword="电磁感应")["total"], 0)

    def test_keyword_plus_filter(self):
        # 给「浮力」那题补上大题标题，便于按题型过滤
        qf = write_fixture(self.dir, "卷2 物理八年级下册", [
            q("1", "1．物体受到的浮力与排开液体体积有关", section="一、单选题", start=0),
        ])
        bimp.import_path(self.conn, qf, verbose=False)
        res = bq.search(self.conn, keyword="浮力", qtype="选择题")
        self.assertEqual(res["total"], 1)

    def test_pagination(self):
        page1 = bq.search(self.conn, limit=2, offset=0)
        page2 = bq.search(self.conn, limit=2, offset=2)
        self.assertEqual(len(page1["items"]), 2)
        self.assertEqual(len(page2["items"]), 1)
        self.assertEqual(page1["total"], 3)

    def test_like_wildcard_percent_not_glob(self):
        # F2 回归：未转义时 "%" 被当通配符 -> 命中全部 3 题；
        # 转义（ESCAPE '\'）后按字面匹配 -> 0 题。
        self.assertEqual(bq.search(self.conn, keyword="%")["total"], 0)

    def test_like_wildcard_underscore_not_glob(self):
        # F2 回归："_" 同样不能当通配符（否则命中全部）。
        self.assertEqual(bq.search(self.conn, keyword="_")["total"], 0)

    def test_like_wildcard_escaped_matches_literal(self):
        # 含字面 % / _ 的题，转义后仍应按字面命中（而非命中全表）。
        qf = write_fixture(self.dir, "卷3 物理八年级下册", [
            q("1", "1．该物质质量分数为 50% ，记作 a_b", start=0),
        ])
        bimp.import_path(self.conn, qf, verbose=False)
        self.assertEqual(bq.search(self.conn, keyword="50%")["total"], 1)
        self.assertEqual(bq.search(self.conn, keyword="a_b")["total"], 1)
        # 反斜杠转义符本身也按字面处理，不报错、不误命中。
        self.assertEqual(bq.search(self.conn, keyword="\\")["total"], 0)

    def test_escape_like_helper(self):
        # 纯函数单测：转义顺序（先转义符本身，再 % / _）。
        self.assertEqual(btu.escape_like("50%"), "50\\%")
        self.assertEqual(btu.escape_like("a_b"), "a\\_b")
        self.assertEqual(btu.escape_like("C:\\tmp"), "C:\\\\tmp")
        self.assertEqual(btu.escape_like("力"), "力")
        self.assertEqual(btu.escape_like(None), "")


class TestReviewQueue(BankTestBase):
    def test_review_queue_populated(self):
        formulas = {
            "F1": {"id": "F1", "kind": "mathtype", "status": "FAIL", "latex": None,
                   "progid": "Equation.KSEE3", "part": "embeddings/oleObject1.bin",
                   "preview": "media/image1.wmf"},
            "F2": {"id": "F2", "kind": "omml", "status": "OK",
                   "latex": "\\alpha", "progid": None, "part": None, "preview": None},
        }
        write_fixture(self.dir, "r", [
            q("1", "1．含失败公式 ⟦F1⟧ 与正常公式 ⟦F2⟧", formula_ids=["F1", "F2"], start=0),
        ], formulas=formulas)
        bimp.import_path(self.conn, self.dir / "r.questions.json", verbose=False)

        self.assertEqual(self.count("formulas"), 2)
        self.assertEqual(self.count("review_queue"), 1)
        res = bq.list_review(self.conn)
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["items"][0]["status"], "FAIL")

        # 按状态过滤
        self.assertEqual(bq.list_review(self.conn, status="FAIL")["total"], 1)
        self.assertEqual(bq.list_review(self.conn, status="TIMEOUT")["total"], 0)

        # 含待复核公式的题目筛选
        self.assertEqual(bq.search(self.conn, needs_review=True)["total"], 1)


class TestVersioning(BankTestBase):
    def test_version_bump_and_history(self):
        # 真实源文件保持不变（sha 不变），只改 JSON 内容 -> 触发「更新 + 版本 +1」
        src = self.dir / "paper.docx"
        src.write_bytes(b"fake-docx-content-v1")

        write_fixture(self.dir, "paper", [q("1", "1．原始题干", start=0)],
                      source_path=str(src))
        st1 = bimp.import_path(self.conn, self.dir / "paper.questions.json", verbose=False)
        self.assertEqual(st1.questions_new, 1)

        write_fixture(self.dir, "paper", [q("1", "1．修改后的题干内容", start=0)],
                      source_path=str(src))
        st2 = bimp.import_path(self.conn, self.dir / "paper.questions.json", verbose=False)
        self.assertEqual(st2.questions_updated, 1)

        self.assertEqual(self.count("questions"), 1)          # 仍是同一道题
        row = self.conn.execute("SELECT version FROM questions").fetchone()
        self.assertEqual(row["version"], 2)
        versions = self.conn.execute(
            "SELECT version FROM question_versions ORDER BY version").fetchall()
        self.assertEqual([v["version"] for v in versions], [1, 2])

    def test_paper_snapshot_locks_version(self):
        """组卷快照：paper_questions 记录题目版本，可锁定历史版本。"""
        src = self.dir / "paper.docx"
        src.write_bytes(b"fake-docx-content-v1")
        write_fixture(self.dir, "paper", [q("1", "1．题干 v1", start=0)],
                      source_path=str(src))
        bimp.import_path(self.conn, self.dir / "paper.questions.json", verbose=False)
        qid = self.conn.execute("SELECT id FROM questions").fetchone()["id"]

        self.conn.execute("INSERT INTO papers(title, created_at) VALUES ('测试卷', '2026-01-01')")
        pid = self.conn.execute("SELECT id FROM papers").fetchone()["id"]
        # 出卷时锁定 v1（阶段3 起题序列为 seq）
        self.conn.execute(
            "INSERT INTO paper_questions(paper_id, question_id, question_version, seq,"
            " score) VALUES (?,?,?,?,?)", (pid, qid, 1, 1, 5.0))
        self.conn.commit()

        # 题目随后被修改到 v2
        write_fixture(self.dir, "paper", [q("1", "1．题干 v2（已修改）", start=0)],
                      source_path=str(src))
        bimp.import_path(self.conn, self.dir / "paper.questions.json", verbose=False)
        self.assertEqual(
            self.conn.execute("SELECT version FROM questions").fetchone()["version"], 2)

        # 试卷快照仍指向 v1，且能取回 v1 的原文
        snap = self.conn.execute(
            "SELECT pq.question_version, qv.plain_text FROM paper_questions pq"
            " JOIN question_versions qv ON qv.question_id = pq.question_id"
            " AND qv.version = pq.question_version").fetchone()
        self.assertEqual(snap["question_version"], 1)
        self.assertIn("v1", snap["plain_text"])

    def test_foreign_key_enforced(self):
        """外键约束必须开启：插入不存在的 source_id 应失败。"""
        with self.assertRaises(Exception):
            self.conn.execute(
                "INSERT INTO questions(source_id, number, text, plain_text, content_hash,"
                " created_at, updated_at) VALUES (99999,'1','x','x','h','t','t')")
            self.conn.commit()


class TestGetQuestion(BankTestBase):
    def test_get_question_full(self):
        formulas = {"F1": {"id": "F1", "kind": "omml", "status": "OK",
                           "latex": "\\alpha", "progid": None, "part": None, "preview": None}}
        write_fixture(self.dir, "10.3 探索 苏科版物理八年级下册", [
            q("1", "1．含图与公式 ⟦F1⟧", formula_ids=["F1"],
              images=["media/image1.png"], section="一、单选题", start=0),
        ], formulas=formulas)
        bimp.import_path(self.conn, self.dir, verbose=False)
        qid = self.conn.execute("SELECT id FROM questions").fetchone()["id"]
        detail = bq.get_question(self.conn, qid)
        self.assertIsNotNone(detail)
        self.assertEqual(len(detail["formulas"]), 1)
        self.assertEqual(len(detail["images"]), 1)
        self.assertEqual(len(detail["versions"]), 1)
        self.assertEqual(detail["chapter"], "10.3")
        self.assertIsNone(bq.get_question(self.conn, 999999))


class TestStats(BankTestBase):
    def test_stats_counts(self):
        write_fixture(self.dir, "10.3 探索 苏科版物理八年级下册", [
            q("1", "1．选择", section="一、单选题", start=0),
            q("2", "2．填空", section="二、填空题", start=1),
        ])
        bimp.import_path(self.conn, self.dir, verbose=False)
        st = bq.stats(self.conn)
        self.assertEqual(st["sources"], 1)
        self.assertEqual(st["questions"], 2)
        self.assertEqual(st["by_stage"][0]["key"], "初中")
        self.assertTrue(any(x["key"] == "10.3" for x in st["top_chapters"]))


if __name__ == "__main__":
    unittest.main()
