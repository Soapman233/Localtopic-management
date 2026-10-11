"""导出引擎选择（native / bridge / auto）单元测试。

背景：原导出链路依赖 ``editor_sdk``（WorkBuddy 宿主服务，**不可分发**）。
「便携 + 轻量」路线新增自研 ``bank.docx_writer`` 作为默认引擎，桥接保留为后备。
"""
from __future__ import annotations

import os
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from bank import export as E

_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")


class TestResolveEngine(unittest.TestCase):
    def test_default_is_native(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QB_EXPORT_ENGINE", None)
            self.assertEqual(E.resolve_export_engine(), "native")
            self.assertEqual(E.DEFAULT_EXPORT_ENGINE, "native")

    def test_explicit_wins_over_env(self):
        with mock.patch.dict(os.environ, {"QB_EXPORT_ENGINE": "bridge"}):
            self.assertEqual(E.resolve_export_engine("native"), "native")

    def test_env_used_when_no_explicit(self):
        with mock.patch.dict(os.environ, {"QB_EXPORT_ENGINE": "bridge"}):
            self.assertEqual(E.resolve_export_engine(), "bridge")
            self.assertEqual(E.resolve_export_engine(None), "bridge")

    def test_invalid_falls_back_to_default(self):
        with mock.patch.dict(os.environ, {"QB_EXPORT_ENGINE": "nonsense"}):
            self.assertEqual(E.resolve_export_engine(), "native")
        self.assertEqual(E.resolve_export_engine("nonsense"), "native")

    def test_case_insensitive(self):
        self.assertEqual(E.resolve_export_engine("BRIDGE"), "bridge")
        with mock.patch.dict(os.environ, {"QB_EXPORT_ENGINE": " AUTO "}):
            self.assertEqual(E.resolve_export_engine(), "auto")


class TestExportEndToEnd(unittest.TestCase):
    """真实导出（库不可用时跳过）。"""

    @classmethod
    def setUpClass(cls):
        if not _DB.is_file():
            raise unittest.SkipTest(f"交付库不存在，跳过：{_DB}")
        cls.conn = sqlite3.connect(f"file:{_DB.as_posix()}?mode=ro", uri=True)
        cls.conn.row_factory = sqlite3.Row
        row = cls.conn.execute("SELECT id FROM papers ORDER BY id LIMIT 1").fetchone()
        if row is None:
            raise unittest.SkipTest("库中没有试卷")
        cls.pid = row["id"]

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_native_engine_produces_file(self):
        with TemporaryDirectory() as td:
            out = Path(td) / "n.docx"
            rep = E.export_paper_docx(self.conn, self.pid, out, answer_mode="学生版")
            self.assertEqual(rep["engine"], "native")
            self.assertTrue(out.is_file())
            self.assertGreater(rep["formulas_written"], 0)
            self.assertGreater(rep["size_bytes"], 0)
            # 自研引擎不产生桥接警告
            self.assertEqual(rep["bridge_errors"], [])

    def test_native_output_is_valid_package(self):
        import zipfile
        with TemporaryDirectory() as td:
            out = Path(td) / "n.docx"
            E.export_paper_docx(self.conn, self.pid, out, answer_mode="学生版")
            with zipfile.ZipFile(out) as z:
                names = z.namelist()
                doc = z.read("word/document.xml").decode("utf-8")
            self.assertIn("word/document.xml", names)
            self.assertGreater(doc.count("<m:oMath>"), 0, "公式应为原生 OMML")
            self.assertNotIn("\ue000", doc, "不得有哨兵残留")

    def test_raw_temp_file_cleaned_up(self):
        with TemporaryDirectory() as td:
            out = Path(td) / "n.docx"
            E.export_paper_docx(self.conn, self.pid, out, answer_mode="学生版")
            leftovers = list(Path(td).glob("*.__raw__.docx"))
            self.assertEqual(leftovers, [], "临时文件未清理")

    def test_auto_reports_native_when_it_succeeds(self):
        with TemporaryDirectory() as td:
            out = Path(td) / "a.docx"
            rep = E.export_paper_docx(self.conn, self.pid, out,
                                      answer_mode="学生版", engine="auto")
            self.assertEqual(rep["engine"], "native", "auto 成功时应报告实际引擎 native")

    def test_auto_falls_back_to_bridge_on_native_failure(self):
        """native 抛异常时，auto 必须回退 bridge 并如实记录。"""
        with TemporaryDirectory() as td:
            out = Path(td) / "a.docx"
            with mock.patch("bank.docx_writer.write_plan",
                            side_effect=RuntimeError("模拟 native 失败")):
                try:
                    rep = E.export_paper_docx(self.conn, self.pid, out,
                                              answer_mode="学生版", engine="auto")
                except Exception as exc:      # noqa: BLE001
                    self.skipTest(f"bridge 不可用（{type(exc).__name__}），跳过回退验证")
            self.assertEqual(rep["engine"], "bridge")
            self.assertTrue(any("回退 bridge" in w for w in rep["warnings"]))


if __name__ == "__main__":
    unittest.main()
