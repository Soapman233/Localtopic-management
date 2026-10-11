"""加固回归测试：正确性缺陷修复（F1–F6）。

覆盖：

* F1 ``import_file`` **单文件原子**（失败即回滚，不留半截数据）；
* F2 ``formula_ids`` **类型校验**（字符串/非字符串元素 -> 数据错误）；
* F3 ``import_path`` 路径不存在 -> **明确报错**（不静默空跑）；
* F4 CLI ``export`` 捕获非 ``ExportError`` 异常 -> 友好提示 + 非零退出码；
* F5 ``set_score`` / ``add_questions`` **分值校验**（拒绝负数/超大/非数字，允许 0 与小数）；
* F6 ``refresh_snapshots`` **按试卷刷新**（无显式范围则报错，不误刷全库）。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 加固回归测试
# description: 覆盖 F1–F6 正确性缺陷修复的回归测试（导入原子性、类型校验、路径报错、CLI 异常、分值校验、快照范围）。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bank import cli as bcli
from bank import db as bdb
from bank import importer as bimp
from bank import paper as bp
from bank import textutil as btu
from tests.export_source_fixture import materialize_source


def q(number, text, *, section=None, formula_ids=None, images=None,
      start=0, end=1, label="编号"):
    """构造一条阶段1 风格的题目字典。"""
    return {
        "number": number, "label": label, "start_paragraph": start, "end_paragraph": end,
        "text": text, "formula_ids": formula_ids if formula_ids is not None else [],
        "images": images or [], "section": section, "sub_question_count": 0,
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


def _add_question(conn, sid, number, text, *, section=None, start=0, formulas=()):
    """插入一道题 + 版本行 + 公式，返回 question_id。"""
    plain = btu.strip_placeholders(text)
    chash = btu.content_hash(text)
    cur = conn.execute(
        "INSERT INTO questions(source_id, number, text, plain_text, content_hash, difficulty,"
        " char_length, version, section, start_paragraph, end_paragraph)"
        " VALUES (?,?,?,?,?, '未标注', ?, 1, ?, ?, ?)",
        (sid, number, text, plain, chash, len(plain), section, start, start + 1))
    qid = cur.lastrowid
    conn.execute(
        "INSERT INTO question_versions(question_id, version, content_hash, text, plain_text,"
        " char_length, created_at) VALUES (?,1,?,?,?,?, '2026-01-01T00:00:00')",
        (qid, chash, text, plain, len(plain)))
    for i, latex in enumerate(formulas):
        conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex)"
            " VALUES (?,?,?,?, 'omml', 'OK', ?)", (qid, sid, f"F{qid}_{i}", i + 1, latex))
    materialize_source(conn,sid)
    return qid


class HardeningTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def count(self, table: str) -> int:
        return self.conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]

    def _seed_source(self, sha="sha1") -> int:
        row = self.conn.execute("SELECT id FROM source_files WHERE sha256 = ?", (sha,)).fetchone()
        if row is not None:
            return row["id"]
        self.conn.execute(
            "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
            " VALUES ('p', ?, 'f.docx', '初中', '物理', '八年级下册', '苏科版')", (sha,))
        self.conn.commit()
        return self.conn.execute("SELECT id FROM source_files WHERE sha256 = ?",
                                 (sha,)).fetchone()["id"]


# --------------------------------------------------------------------------- #
# F1 导入事务原子性
# --------------------------------------------------------------------------- #
class TestF1ImportAtomicity(HardeningTestBase):
    def test_failed_file_leaves_no_partial_rows(self):
        """文件 A=[合法题, text=null 题] 导入失败后，A 的合法题**不得落盘**。"""
        write_fixture(self.dir, "A", [
            q("1", "1．A 的合法题甲", start=0),
            q("2", None, start=1),                       # text=null -> NOT NULL 违约 -> 失败
        ])
        write_fixture(self.dir, "B", [q("1", "1．B 的合法题", start=0)])

        st = bimp.import_path(self.conn, self.dir, verbose=False)

        self.assertEqual(st.files_failed, 1)
        self.assertEqual(st.files_imported, 1)
        self.assertEqual(len(st.errors), 1)
        self.assertIn("A.questions.json", st.errors[0]["file"])
        # 关键断言：A 的合法题**没有**落盘（整个文件回滚）
        self.assertEqual(self.count("questions"), 1)
        texts = [r["plain_text"] for r in self.conn.execute("SELECT plain_text FROM questions")]
        self.assertNotIn("1．A 的合法题甲", texts)
        self.assertIn("1．B 的合法题", texts)
        # A 的 source_files 行也应被回滚（只有 B 的来源）
        self.assertEqual(self.count("source_files"), 1)

    def test_valid_file_still_imports_fully(self):
        """回归：原子性修复不得影响正常文件的完整导入。"""
        write_fixture(self.dir, "C", [
            q("1", "1．C 题一", start=0),
            q("2", "2．C 题二", start=1),
        ])
        st = bimp.import_path(self.conn, self.dir / "C.questions.json", verbose=False)
        self.assertEqual(st.files_failed, 0)
        self.assertEqual(st.questions_new, 2)
        self.assertEqual(self.count("questions"), 2)


# --------------------------------------------------------------------------- #
# F2 formula_ids 类型校验
# --------------------------------------------------------------------------- #
class TestF2FormulaIdsType(HardeningTestBase):
    _FORMULAS = {"F1": {"id": "F1", "kind": "omml", "status": "OK", "latex": "F=ma",
                        "progid": None, "part": None, "preview": None}}

    def test_string_formula_ids_rejected_atomically(self):
        """``formula_ids="F1"`` 是数据错误：不得逐字符造出 'F'/'1' 假公式，且整文件回滚。"""
        write_fixture(self.dir, "S", [
            q("1", "1．前题合法", start=0),
            q("2", "2．带公式 ⟦F1⟧", formula_ids="F1", start=1),
        ], formulas=self._FORMULAS)
        st = bimp.import_path(self.conn, self.dir / "S.questions.json", verbose=False)
        self.assertEqual(st.files_failed, 1)
        self.assertIn("formula_ids", st.errors[0]["error"])
        self.assertEqual(self.count("formulas"), 0)      # 无假公式
        self.assertEqual(self.count("questions"), 0)     # 整文件回滚

    def test_non_string_element_rejected(self):
        """``formula_ids=[123]`` 元素非字符串 -> 数据错误。"""
        write_fixture(self.dir, "T", [
            q("1", "1．带公式 ⟦F1⟧", formula_ids=["F1", 2], start=0),
        ], formulas=self._FORMULAS)
        st = bimp.import_path(self.conn, self.dir / "T.questions.json", verbose=False)
        self.assertEqual(st.files_failed, 1)
        self.assertIn("formula_ids", st.errors[0]["error"])
        self.assertEqual(self.count("formulas"), 0)

    def test_none_formula_ids_treated_as_empty(self):
        """``formula_ids=null`` 视同无公式（不报错）。"""
        write_fixture(self.dir, "U", [q("1", "1．无公式题", formula_ids=None, start=0)])
        st = bimp.import_path(self.conn, self.dir / "U.questions.json", verbose=False)
        self.assertEqual(st.files_failed, 0)
        self.assertEqual(st.questions_new, 1)

    def test_valid_list_still_imports(self):
        """回归：合法字符串列表正常导入。"""
        write_fixture(self.dir, "V", [
            q("1", "1．带公式 ⟦F1⟧", formula_ids=["F1"], start=0),
        ], formulas=self._FORMULAS)
        st = bimp.import_path(self.conn, self.dir / "V.questions.json", verbose=False)
        self.assertEqual(st.files_failed, 0)
        self.assertEqual(self.count("formulas"), 1)


# --------------------------------------------------------------------------- #
# F3 路径不存在
# --------------------------------------------------------------------------- #
class TestF3MissingPath(HardeningTestBase):
    def test_missing_directory_raises(self):
        with self.assertRaises(FileNotFoundError):
            bimp.import_path(self.conn, self.dir / "no_such_dir", verbose=False)

    def test_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            bimp.import_path(self.conn, self.dir / "no_such.questions.json", verbose=False)

    def test_empty_dir_is_not_error(self):
        """回归：存在的空目录应正常（0 文件 0 错误），不报错。"""
        empty = self.dir / "empty"
        empty.mkdir()
        st = bimp.import_path(self.conn, empty, verbose=False)
        self.assertEqual(st.files_total, 0)
        self.assertEqual(st.files_failed, 0)


# --------------------------------------------------------------------------- #
# F4 CLI 异常处理
# --------------------------------------------------------------------------- #
class TestF4CliExportErrors(HardeningTestBase):
    def _run_export(self, side_effect):
        out = self.dir / "out.docx"
        with mock.patch.object(bcli._export, "EditorBridge", lambda **k: mock.MagicMock()), \
                mock.patch.object(bcli._export, "export_paper_docx", side_effect=side_effect), \
                contextlib.redirect_stdout(io.StringIO()) as buf:
            rc = bcli.main(["export", "paper", "99999", "--out", str(out),
                            "--db", str(self.dir / "bank.db")])
        return rc, buf.getvalue()

    def test_value_error_friendly_nonzero(self):
        """不存在的试卷 ID（ValueError）-> 友好提示 + 非零退出码，不抛裸 traceback。"""
        rc, out = self._run_export(ValueError("试卷不存在：99999"))
        self.assertNotEqual(rc, 0)
        self.assertIn("导出失败", out)
        self.assertIn("99999", out)

    def test_os_error_friendly_nonzero(self):
        """--out 父目录是文件（FileExistsError/OSError）-> 友好提示 + 非零退出码。"""
        rc, out = self._run_export(FileExistsError("父目录是文件"))
        self.assertNotEqual(rc, 0)
        self.assertIn("导出失败", out)

    def test_export_error_still_handled(self):
        """回归：ExportError 仍走原有分支。"""
        rc, out = self._run_export(bcli._export.ExportError("桥接不可用"))
        self.assertEqual(rc, 1)
        self.assertIn("导出失败", out)


# --------------------------------------------------------------------------- #
# F5 分值校验
# --------------------------------------------------------------------------- #
class TestF5ScoreValidation(HardeningTestBase):
    def _paper_with_item(self):
        sid = self._seed_source()
        qid = _add_question(self.conn, sid, "1", "1．题", start=0)
        self.conn.commit()
        pid = bp.create_paper(self.conn, "卷")["id"]
        item_id = bp.add_questions(self.conn, pid, [qid])["added"][0]["item_id"]
        return pid, item_id

    def test_accepts_zero_and_decimals(self):
        pid, item = self._paper_with_item()
        self.assertEqual(bp.set_score(self.conn, pid, item, 0)["score"], 0.0)
        self.assertEqual(bp.set_score(self.conn, pid, item, 0.5)["score"], 0.5)
        self.assertEqual(bp.set_score(self.conn, pid, item, 2.5)["score"], 2.5)
        self.assertEqual(bp.set_score(self.conn, pid, item, 100)["score"], 100.0)
        # None 表示清除（未设分值）
        self.assertIsNone(bp.set_score(self.conn, pid, item, None)["score"])

    def test_rejects_negative_oversize_and_nonnumeric(self):
        pid, item = self._paper_with_item()
        for bad in (-1, -0.5, 1000.0001, 5000, float("nan"), float("inf"),
                    "abc", True, object()):
            with self.assertRaises(ValueError, msg=f"应拒绝分值 {bad!r}"):
                bp.set_score(self.conn, pid, item, bad)
        # 库中分值未被污染
        row = self.conn.execute("SELECT score FROM paper_questions WHERE id = ?",
                                (item,)).fetchone()
        self.assertIsNone(row["score"])

    def test_total_score_never_negative(self):
        pid, item = self._paper_with_item()
        with self.assertRaises(ValueError):
            bp.set_score(self.conn, pid, item, -5)
        self.assertEqual(bp.paper_summary(self.conn, pid)["total_score"], 0.0)

    def test_add_questions_validates_score(self):
        sid = self._seed_source()
        qid = _add_question(self.conn, sid, "1", "1．题", start=0)
        self.conn.commit()
        pid = bp.create_paper(self.conn, "卷")["id"]
        with self.assertRaises(ValueError):
            bp.add_questions(self.conn, pid, [qid], score=-5)

    def test_set_scores_prevalidates_all(self):
        """批量设分：任一分值非法 -> 直接报错，不留半更新。"""
        sid = self._seed_source()
        qid = _add_question(self.conn, sid, "1", "1．题", start=0)
        self.conn.commit()
        pid = bp.create_paper(self.conn, "卷")["id"]
        item = bp.add_questions(self.conn, pid, [qid])["added"][0]["item_id"]
        with self.assertRaises(ValueError):
            bp.set_scores(self.conn, pid, {item: -1})
        row = self.conn.execute("SELECT score FROM paper_questions WHERE id = ?",
                                (item,)).fetchone()
        self.assertIsNone(row["score"])


# --------------------------------------------------------------------------- #
# F6 refresh_snapshots 按试卷刷新
# --------------------------------------------------------------------------- #
class TestF6RefreshSnapshots(HardeningTestBase):
    def _paper_with_stripped_answer(self, title, sha):
        """建一道带答案的题 + 试卷，并把快照里的 answer 去掉（模拟「旧快照」）。"""
        sid = self._seed_source(sha)
        qid = _add_question(self.conn, sid, "1", f"1．{title}", start=0)
        self.conn.execute("UPDATE questions SET answer='A', analysis='解析',"
                          " answer_source='内联' WHERE id = ?", (qid,))
        self.conn.commit()
        pid = bp.create_paper(self.conn, title)["id"]
        bp.add_questions(self.conn, pid, [qid])
        snap = bp.list_items(self.conn, pid)[0]["snapshot"]
        for k in ("answer", "analysis", "answer_source"):
            snap.pop(k, None)
        self.conn.execute("UPDATE paper_questions SET snapshot_json=? WHERE paper_id=?",
                          (json.dumps(snap, ensure_ascii=False), pid))
        self.conn.commit()
        return pid, qid

    def test_requires_explicit_scope(self):
        """不给 paper_id 又不给 all_papers -> 报错（绝不默认刷全库）。"""
        with self.assertRaises(ValueError):
            bp.refresh_snapshots(self.conn)

    def test_refreshes_only_target_paper(self):
        p1, _ = self._paper_with_stripped_answer("卷一", "sha1")
        p2, _ = self._paper_with_stripped_answer("卷二", "sha2")
        res = bp.refresh_snapshots(self.conn, p1)
        self.assertEqual(res["paper_id"], p1)
        self.assertEqual(res["refreshed"], 1)
        # 卷一答案回填
        a1 = bp.build_export_payload(self.conn, p1, answer_mode="答案解析版")
        self.assertEqual(a1["sections"][-1]["questions"][0]["answer"], "A")
        # 卷二**未受影响**（答案仍缺失）
        a2 = bp.build_export_payload(self.conn, p2, answer_mode="答案解析版")
        self.assertIsNone(a2["sections"][-1]["questions"][0]["answer"])

    def test_all_papers_explicit(self):
        p1, _ = self._paper_with_stripped_answer("卷一", "sha1")
        p2, _ = self._paper_with_stripped_answer("卷二", "sha2")
        res = bp.refresh_snapshots(self.conn, all_papers=True)
        self.assertTrue(res["all_papers"])
        self.assertEqual(res["refreshed"], 2)
        for pid in (p1, p2):
            a = bp.build_export_payload(self.conn, pid, answer_mode="答案解析版")
            self.assertEqual(a["sections"][-1]["questions"][0]["answer"], "A")


if __name__ == "__main__":
    unittest.main()
