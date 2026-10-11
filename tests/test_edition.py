"""版本（edition）配置与鉴权中间件的回归测试。

覆盖：
* 默认（无环境变量）= 本地运行版：回环地址、无鉴权；
* ``QB_EDITION=online`` → 监听 ``0.0.0.0``；
* ``QB_AUTH_TOKEN`` 设置后 ``/api/*`` 需 Bearer 令牌，``/api/health`` 豁免；
* **不设置令牌时行为与历史完全一致**（这是不破坏既有 373 项测试的关键保证）。
"""

from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from webui import edition


class TestEditionConfig(unittest.TestCase):
    """纯配置逻辑（不建 app，速度快）。"""

    def test_default_is_local_loopback_no_auth(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(edition.current_edition(), "local")
            self.assertEqual(edition.resolve_host(), "127.0.0.1")
            self.assertEqual(edition.resolve_port(), 8720)
            self.assertFalse(edition.auth_enabled())
            self.assertIsNone(edition.auth_token())

    def test_online_binds_all_interfaces(self):
        with mock.patch.dict("os.environ", {"QB_EDITION": "online"}, clear=True):
            self.assertEqual(edition.current_edition(), "online")
            self.assertTrue(edition.is_online())
            self.assertEqual(edition.resolve_host(), "0.0.0.0")

    def test_invalid_edition_falls_back_to_local(self):
        with mock.patch.dict("os.environ", {"QB_EDITION": "not-an-edition"}, clear=True):
            self.assertEqual(edition.current_edition(), "local")

    def test_host_port_override(self):
        env = {"QB_EDITION": "online", "QB_HOST": "192.168.1.10", "QB_PORT": "9000"}
        with mock.patch.dict("os.environ", env, clear=True):
            self.assertEqual(edition.resolve_host(), "192.168.1.10")
            self.assertEqual(edition.resolve_port(), 9000)

    def test_invalid_port_falls_back(self):
        for bad in ("abc", "0", "70000", ""):
            with mock.patch.dict("os.environ", {"QB_PORT": bad}, clear=True):
                self.assertEqual(edition.resolve_port(), 8720, msg=f"port={bad!r}")

    def test_token_enables_auth(self):
        with mock.patch.dict("os.environ", {"QB_AUTH_TOKEN": "s3cret"}, clear=True):
            self.assertTrue(edition.auth_enabled())
            self.assertEqual(edition.auth_token(), "s3cret")

    def test_blank_token_does_not_enable_auth(self):
        with mock.patch.dict("os.environ", {"QB_AUTH_TOKEN": "   "}, clear=True):
            self.assertFalse(edition.auth_enabled())

    def test_health_is_exempt(self):
        self.assertTrue(edition.is_auth_exempt("/api/health"))
        self.assertFalse(edition.is_auth_exempt("/api/search"))

    def test_summary_never_leaks_token(self):
        with mock.patch.dict("os.environ",
                             {"QB_EDITION": "online", "QB_AUTH_TOKEN": "s3cret"},
                             clear=True):
            summary = edition.edition_summary()
            self.assertTrue(summary["auth_enabled"])
            self.assertNotIn("s3cret", repr(summary))


class TestAuthMiddleware(unittest.TestCase):
    """鉴权中间件的端到端行为（走真实 app + TestClient）。"""

    @staticmethod
    def _client(env: dict) -> TestClient:
        from webui.app import create_app
        with mock.patch.dict("os.environ", env, clear=True):
            # create_app 在**调用时**读取环境变量，故此处构建即为目标版本。
            return TestClient(create_app())

    def test_local_edition_unaffected(self):
        """不设令牌 → 与历史行为一致：health 与 search 均 200。"""
        client = self._client({"QB_EDITION": "local"})
        self.assertEqual(client.get("/api/health").status_code, 200)
        resp = client.get("/api/search", params={"keyword": "浮力", "page_size": 1})
        self.assertEqual(resp.status_code, 200)

    def test_health_exempt_even_with_token(self):
        client = self._client({"QB_EDITION": "online", "QB_AUTH_TOKEN": "s3cret"})
        self.assertEqual(client.get("/api/health").status_code, 200)

    def test_missing_token_rejected(self):
        client = self._client({"QB_EDITION": "online", "QB_AUTH_TOKEN": "s3cret"})
        resp = client.get("/api/search", params={"keyword": "浮力"})
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40101)

    def test_wrong_token_rejected(self):
        client = self._client({"QB_EDITION": "online", "QB_AUTH_TOKEN": "s3cret"})
        resp = client.get("/api/search", params={"keyword": "浮力"},
                          headers={"Authorization": "Bearer wrong"})
        self.assertEqual(resp.status_code, 401)

    def test_correct_token_allowed(self):
        client = self._client({"QB_EDITION": "online", "QB_AUTH_TOKEN": "s3cret"})
        resp = client.get("/api/search", params={"keyword": "浮力", "page_size": 1},
                          headers={"Authorization": "Bearer s3cret"})
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
