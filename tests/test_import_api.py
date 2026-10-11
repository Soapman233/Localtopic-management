"""DOCX 导入 API（Phase 2.2）单元测试。

覆盖：
* 参数边界：空文件 40010 / 非 docx 40011 / 超大 40011 / 功能关闭 40011
* ``/api/import/status`` 契约
* 真实导入（需交付库 + 测试 DOCX，缺失则跳过）：
  入库成功、**库内题目数确实增加**、重复导入幂等

⚠️ **导入会写库**，故全程在 ``bank.db`` 的**副本**上操作。
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from webui.services import import_svc as svc

_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
_DOCX = [
    Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/2026年10月1日初中物理作业.docx"),
    Path("C:/Users/SOAP/Desktop/物理/初中/2026学科网教案/10.3 探索更小的微粒 同步练习-2025-2026学年苏科版物理八年级下学期.docx"),
]


class TestValidateUpload(unittest.TestCase):
    def test_missing_file_raises_40010(self):
        from webui import errors
        for name, size in ((None, 10), ("", 10), ("a.docx", 0)):
            with self.subTest(name=name, size=size), self.assertRaises(errors.ApiError) as ctx:
                svc.validate_upload(name, size)
            self.assertEqual(ctx.exception.code, errors.CODE_MISSING_UPLOAD)

    def test_bad_suffix_raises_40011(self):
        from webui import errors
        for name in ("a.txt", "a.pdf", "a", "a.docx.exe"):
            with self.subTest(name=name), self.assertRaises(errors.ApiError) as ctx:
                svc.validate_upload(name, 100)
            self.assertEqual(ctx.exception.code, errors.CODE_INVALID_UPLOAD)

    def test_too_large_raises_40011(self):
        from webui import errors
        with self.assertRaises(errors.ApiError) as ctx:
            svc.validate_upload("a.docx", svc.MAX_UPLOAD_BYTES + 1)
        self.assertEqual(ctx.exception.code, errors.CODE_INVALID_UPLOAD)

    def test_ok(self):
        svc.validate_upload("试卷.docx", 1024)      # 不抛即通过

    def test_disabled_feature_raises_40011(self):
        from webui import errors
        with mock.patch.dict(os.environ, {svc.FEATURE_ENV: "0"}):
            self.assertFalse(svc.import_enabled())
            with self.assertRaises(errors.ApiError) as ctx:
                svc.validate_upload("a.docx", 100)
            self.assertEqual(ctx.exception.code, errors.CODE_INVALID_UPLOAD)


class TestImportStatusEndpoint(unittest.TestCase):
    def test_status_contract(self):
        from fastapi.testclient import TestClient
        from webui.app import app
        r = TestClient(app).get("/api/import/status")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertIn("enabled", data)
        self.assertEqual(data["allowed_suffixes"], [".docx"])
        self.assertGreater(data["max_bytes"], 0)

    def test_empty_upload_returns_40010(self):
        from fastapi.testclient import TestClient
        from webui.app import app
        r = TestClient(app).post("/api/import/docx",
                                 files={"file": ("e.docx", b"", "application/octet-stream")})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], 40010)

    def test_wrong_suffix_returns_40011(self):
        from fastapi.testclient import TestClient
        from webui.app import app
        r = TestClient(app).post("/api/import/docx",
                                 files={"file": ("a.txt", b"x", "text/plain")})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], 40011)


class TestRealImport(unittest.TestCase):
    """真实导入（库或 DOCX 缺失则跳过）。"""

    @classmethod
    def setUpClass(cls):
        if not _DB.is_file():
            raise unittest.SkipTest(f"交付库不存在：{_DB}")
        cls.docx = next((p for p in _DOCX if p.is_file()), None)
        if cls.docx is None:
            raise unittest.SkipTest("未找到测试 DOCX")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_copy = Path(cls.tmp.name) / "copy.db"
        shutil.copyfile(_DB, cls.db_copy)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _count(self) -> int:
        con = sqlite3.connect(f"file:{self.db_copy.as_posix()}?mode=ro", uri=True)
        try:
            return con.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        finally:
            con.close()

    def test_import_increases_question_count_and_is_idempotent(self):
        os.environ["QB_DB_PATH"] = str(self.db_copy)
        from fastapi.testclient import TestClient
        from webui.app import app
        client = TestClient(app)

        before = self._count()
        payload = self.docx.read_bytes()

        def submit():
            return client.post(
                "/api/import/docx",
                files={"file": (self.docx.name, payload,
                                "application/vnd.openxmlformats-officedocument"
                                ".wordprocessingml.document")})

        r = submit()
        self.assertEqual(r.status_code, 200)
        job_id = r.json()["data"]["job_id"]
        import time
        job = None
        for _ in range(120):
            job = client.get(f"/api/jobs/{job_id}").json()["data"]
            if job.get("status") in ("done", "error", "failed"):
                break
            time.sleep(1.0)
        self.assertEqual(job.get("status"), "done", f"导入失败：{job.get('error')}")
        res = job["result"]
        self.assertEqual(res["status"], "OK")
        self.assertGreater(res["imported"], 0, "报告的新增数应大于 0")
        after = self._count()
        self.assertGreater(after, before, "库内题目数应增加")

        # 幂等：重复导入不应再增加
        r2 = submit()
        jid2 = r2.json()["data"]["job_id"]
        job2 = None
        for _ in range(120):
            job2 = client.get(f"/api/jobs/{jid2}").json()["data"]
            if job2.get("status") in ("done", "error", "failed"):
                break
            time.sleep(1.0)
        self.assertEqual(job2.get("status"), "done")
        self.assertEqual(job2["result"]["inserted"], 0, "重复导入不应新增")
        self.assertEqual(self._count(), after, "重复导入后题目数应不变")


if __name__ == "__main__":
    unittest.main()
