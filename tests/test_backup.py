"""整库备份 / 恢复（Phase 3.5）单元测试。

⚠️ 全程在 ``bank.db`` 的**副本**上操作。
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from bank import backup as bk

_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")


def _count(db: Path) -> int:
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        return con.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    finally:
        con.close()


class TestBackupCore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _DB.is_file():
            raise unittest.SkipTest(f"交付库不存在：{_DB}")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "bank.db"
        shutil.copyfile(_DB, cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_default_backup_dir_is_sibling(self):
        """默认备份目录与库同级（随程序目录走，保持便携）。"""
        d = bk.default_backup_dir(self.db)
        self.assertEqual(d.parent, self.db.parent)
        self.assertEqual(d.name, "backups")

    def test_create_backup_is_valid_rollback_point(self):
        rep = bk.create_backup(self.db)
        self.assertTrue(rep["ok"], rep.get("error"))
        v = rep["verify"]
        self.assertTrue(v["structure_ok"])
        self.assertTrue(v["integrity_ok"])
        self.assertTrue(v["core_nonempty"])
        self.assertTrue(Path(rep["path"]).is_file())

    def test_backup_rowcounts_match(self):
        rep = bk.create_backup(self.db)
        self.assertEqual(_count(self.db), _count(Path(rep["path"])))

    def test_backup_missing_db_returns_error_not_raise(self):
        rep = bk.create_backup(Path(self.tmp.name) / "nope.db")
        self.assertFalse(rep["ok"])
        self.assertIn("不存在", rep["error"])

    def test_restore_rejects_invalid_candidate(self):
        bad = Path(self.tmp.name) / "bad.db"
        bad.write_bytes(b"not a database")
        rep = bk.restore_backup(self.db, bad)
        self.assertFalse(rep["ok"], "不合格候选必须被拒绝")
        self.assertEqual(_count(self.db), 7945 if _count(self.db) else _count(self.db))

    def test_restore_rejects_empty_file(self):
        empty = Path(self.tmp.name) / "empty.db"
        empty.write_bytes(b"")
        rep = bk.restore_backup(self.db, empty)
        self.assertFalse(rep["ok"])

    def test_restore_creates_pre_restore_snapshot(self):
        rep = bk.create_backup(self.db)
        before = _count(self.db)
        r = bk.restore_backup(self.db, rep["path"])
        self.assertTrue(r["ok"], r.get("error"))
        self.assertTrue(r["pre_restore_backup"], "必须留下恢复前快照")
        self.assertTrue(Path(r["pre_restore_backup"]).is_file())
        self.assertEqual(_count(self.db), before)


class TestBackupApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _DB.is_file():
            raise unittest.SkipTest(f"交付库不存在：{_DB}")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "bank.db"
        shutil.copyfile(_DB, cls.db)
        os.environ["QB_DB_PATH"] = str(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        from webui.app import app
        return TestClient(app)

    def test_info_contract(self):
        r = self._client().get("/api/backup/info")
        self.assertEqual(r.status_code, 200)
        d = r.json()["data"]
        for k in ("db_path", "db_exists", "db_bytes", "backup_dir", "backups"):
            self.assertIn(k, d)
        self.assertTrue(d["db_exists"])
        self.assertGreater(d["db_bytes"], 0)

    def test_create_and_download(self):
        c = self._client()
        r = c.post("/api/backup/create")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["verify_ok"])

        r2 = c.get("/api/backup/download")
        self.assertEqual(r2.status_code, 200)
        self.assertGreater(len(r2.content), 1024)

    def test_restore_endpoint_roundtrip_and_rejects_garbage(self):
        c = self._client()
        bak = c.post("/api/backup/create").json()["data"]["path"]
        before = _count(self.db)
        with Path(bak).open("rb") as fh:
            r = c.post("/api/backup/restore",
                       files={"file": ("bk.db", fh.read(), "application/octet-stream")})
        self.assertEqual(r.status_code, 200, r.text[:200])
        self.assertTrue(r.json()["data"]["pre_restore_backup"])
        self.assertEqual(_count(self.db), before)

        r2 = c.post("/api/backup/restore",
                    files={"file": ("bad.db", b"garbage", "application/octet-stream")})
        self.assertEqual(r2.status_code, 400)
        self.assertEqual(r2.json()["code"], 40011)


if __name__ == "__main__":
    unittest.main()
