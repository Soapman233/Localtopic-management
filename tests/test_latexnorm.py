"""LaTeX 表示规范化回归测试（D1 / D2）。

覆盖：

* :func:`bank.latexnorm.restore_uplus`：``[U+XXXX]`` -> 真字符，**不双重包裹** ``\\text{}``；
* :func:`bank.latexnorm.strip_dollar`：去掉 ``$`` 定界符；
* :func:`bank.latexnorm.normalize_latex`：组合变换，**幂等**；
* :func:`bank.latexnorm.migrate_latex`：一次性迁移 ``formulas.latex``（含试卷快照），**幂等**；
* 导入时即规范化（``bank.importer``）；
* 导出侧 :func:`bank.export.sanitize_latex` 对**已规范化**输入幂等无害；
* 上游 :func:`pipeline.mtef_conv.normalize_latex` 直接规范化。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: LaTeX 规范化测试
# description: 覆盖 D1/D2 的 U+ 还原、$ 去除、幂等迁移、导入规范化与导出侧幂等。
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
from bank import export as bexp
from bank import importer as bimp
from bank import latexnorm as bln
from pipeline import mtef_conv


class TestNormalizeFunctions(unittest.TestCase):
    def test_restore_uplus_inside_text(self):
        raw = r"$ \frac { h_{ 1 } } { h_{ 2 } }\rho _{ {\text{[U+6c34]}} } $"
        out = bln.restore_uplus(raw)
        self.assertIn(r"\text{水}", out)
        self.assertNotIn("[U+", out)
        # 不得双重包裹
        self.assertNotIn(r"\text{\text", out)

    def test_restore_uplus_bare(self):
        self.assertEqual(bln.restore_uplus("F_[U+6d6e]"), r"F_\text{浮}")
        self.assertEqual(bln.restore_uplus("[U+6d6e]"), r"\text{浮}")

    def test_restore_uplus_none(self):
        self.assertIsNone(bln.restore_uplus(None))

    def test_strip_dollar(self):
        self.assertEqual(bln.strip_dollar("$ x = 1 $"), "x = 1")
        self.assertEqual(bln.strip_dollar("$$ y $$"), "y")
        self.assertEqual(bln.strip_dollar("z"), "z")
        self.assertIsNone(bln.strip_dollar(None))

    def test_normalize_combined_and_idempotent(self):
        raw = "$ \\rho _{ {\\text{[U+6c34]}} } $"
        once = bln.normalize_latex(raw)
        self.assertEqual(once, r"\rho _{ {\text{水}} }")
        self.assertNotIn("$", once)
        self.assertNotIn("[U+", once)
        # 幂等
        self.assertEqual(bln.normalize_latex(once), once)

    def test_export_sanitize_idempotent_on_normalized(self):
        """导出侧还原逻辑对**已规范化**输入幂等无害（不再改动）。"""
        normalized = bln.normalize_latex("$ \\rho _{ {\\text{[U+6c34]}} } $")
        once = bexp.sanitize_latex(normalized)
        self.assertEqual(bexp.sanitize_latex(once), once)
        self.assertNotIn("[U+", once)

    def test_mtef_upstream_normalize(self):
        raw = "$ \\rho _{ {\\text{[U+6c34]}} } $"
        self.assertEqual(mtef_conv.normalize_latex(raw), r"\rho _{ {\text{水}} }")
        self.assertIsNone(mtef_conv.normalize_latex(None))
        # 幂等
        once = mtef_conv.normalize_latex(raw)
        self.assertEqual(mtef_conv.normalize_latex(once), once)


class TestMigration(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")
        self.conn.execute(
            "INSERT INTO source_files(path, sha256, file_name) VALUES ('p', 'sha1', 'f.docx')")
        self.conn.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, content_hash,"
            " difficulty, char_length, version) VALUES (1,'1','t','t','h','未标注',1,1)")
        self.conn.execute(
            "INSERT INTO question_versions(question_id, version, content_hash, text, plain_text,"
            " char_length, created_at) VALUES (1,1,'h','t','t',1,'2026-01-01T00:00:00')")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def _insert_formula(self, fid, latex):
        self.conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex)"
            " VALUES (1,1,?,1,'mathtype','OK',?)", (fid, latex))
        self.conn.commit()

    def test_migrate_formulas_and_idempotent(self):
        self._insert_formula("F1", "$ \\rho _{ {\\text{[U+6c34]}} } $")
        self._insert_formula("F2", "E=mc^2")             # 已规范，不应改动
        self._insert_formula("F3", None)                 # None 保持
        res = bln.migrate_latex(self.conn, include_snapshots=False)
        self.assertEqual(res["uplus_before"], 1)
        self.assertEqual(res["uplus_after"], 0)
        self.assertEqual(res["dollar_before"], 1)
        self.assertEqual(res["dollar_after"], 0)
        self.assertEqual(res["formulas_changed"], 1)
        got = {r["fid"]: r["latex"] for r in self.conn.execute(
            "SELECT fid, latex FROM formulas")}
        self.assertEqual(got["F1"], r"\rho _{ {\text{水}} }")
        self.assertEqual(got["F2"], "E=mc^2")
        self.assertIsNone(got["F3"])
        # 幂等：再跑一次 0 改动
        res2 = bln.migrate_latex(self.conn, include_snapshots=False)
        self.assertEqual(res2["formulas_changed"], 0)
        self.assertEqual(res2["uplus_after"], 0)
        self.assertEqual(res2["dollar_after"], 0)

    def test_migrate_includes_snapshots(self):
        self._insert_formula("F1", "$ \\rho _{ {\\text{[U+6c34]}} } $")
        pid = self.conn.execute(
            "INSERT INTO papers(title, created_at) VALUES ('卷','2026-01-01')").lastrowid
        snap = {"question_id": 1, "version": 1, "formulas": [
            {"fid": "F1", "latex": "$ \\rho _{ {\\text{[U+6c34]}} } $", "kind": "mathtype"}]}
        self.conn.execute(
            "INSERT INTO paper_questions(paper_id, question_id, question_version, seq,"
            " snapshot_json) VALUES (?,1,1,1,?)", (pid, json.dumps(snap, ensure_ascii=False)))
        self.conn.commit()
        res = bln.migrate_latex(self.conn, include_snapshots=True)
        self.assertEqual(res["snapshots_scanned"], 1)
        self.assertEqual(res["snapshots_changed"], 1)
        raw = self.conn.execute("SELECT snapshot_json FROM paper_questions").fetchone()[0]
        latex = json.loads(raw)["formulas"][0]["latex"]
        self.assertNotIn("[U+", latex)
        self.assertNotIn("$", latex)

    def test_dry_run_does_not_write(self):
        self._insert_formula("F1", "$ \\rho _{ {\\text{[U+6c34]}} } $")
        res = bln.migrate_latex(self.conn, include_snapshots=False, dry_run=True)
        self.assertEqual(res["formulas_changed"], 1)
        latex = self.conn.execute("SELECT latex FROM formulas").fetchone()[0]
        self.assertIn("[U+", latex)                      # 未被写库


class TestImportNormalizes(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def test_import_stores_normalized_latex(self):
        formulas = {"F1": {"id": "F1", "kind": "mathtype", "status": "OK",
                           "latex": "$ \\rho _{ {\\text{[U+6c34]}} } $",
                           "progid": None, "part": None, "preview": None}}
        qj = {"path": "", "stats": {}, "unassigned_before_first": [],
              "questions": [{"number": "1", "label": "编号", "start_paragraph": 0,
                             "end_paragraph": 1, "text": "1．含公式 ⟦F1⟧",
                             "formula_ids": ["F1"], "images": [], "section": None,
                             "sub_question_count": 0}],
              "formula_index": {fid: {k: f.get(k) for k in
                                      ("kind", "status", "latex", "progid")}
                                for fid, f in formulas.items()}}
        qf = self.dir / "x.questions.json"
        qf.write_text(json.dumps(qj, ensure_ascii=False), encoding="utf-8")
        (self.dir / "x.scan.json").write_text(
            json.dumps({"path": "", "formulas": formulas, "images": {}},
                       ensure_ascii=False), encoding="utf-8")
        st = bimp.import_path(self.conn, qf, verbose=False)
        self.assertEqual(st.files_failed, 0)
        latex = self.conn.execute("SELECT latex FROM formulas").fetchone()[0]
        self.assertNotIn("[U+", latex)
        self.assertNotIn("$", latex)
        self.assertIn("水", latex)


if __name__ == "__main__":
    unittest.main()
