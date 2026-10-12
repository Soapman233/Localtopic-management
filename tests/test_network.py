"""局域网访问（方案 A）单元测试。

覆盖：
* **安全不变量**（`edition.exposure_safety`）——非回环监听必须有鉴权，否则拒绝启动；
* `network_svc` 的开关 / 令牌轮换 / 链接 / 二维码；
* API 端点契约（status 不含令牌；link 含令牌与二维码）。

⚠️ 测试用 ``mock`` 替换设置的读写，避免污染真实 ``settings.json``。
"""
from __future__ import annotations

import unittest
from unittest import mock

from webui import edition
from webui.services import network_svc as svc

_SETTINGS: dict = {}


def _fake_get_settings() -> dict:
    return dict(_SETTINGS)


def _fake_update_settings(patch: dict) -> dict:
    _SETTINGS.update(patch)
    return dict(_SETTINGS)


class TestExposureSafety(unittest.TestCase):
    """🔴 安全不变量：监听非回环却无鉴权 → **必须**判定为不安全（fail-closed）。"""

    def _check(self, env: dict) -> dict:
        with mock.patch.dict("os.environ", env, clear=False):
            for k in ("QB_HOST", "QB_AUTH_TOKEN", "QB_EDITION"):
                if k not in env:
                    with mock.patch.dict("os.environ", {}, clear=False):
                        pass
            return edition.exposure_safety()

    def test_loopback_is_safe(self):
        with mock.patch.dict("os.environ", {"QB_HOST": "127.0.0.1"}, clear=False):
            r = edition.exposure_safety()
        self.assertTrue(r["ok"])
        self.assertEqual(r["exposure"], "local")

    def test_lan_without_token_is_UNSAFE(self):
        env = {"QB_HOST": "0.0.0.0", "QB_EDITION": "local"}
        with mock.patch.dict("os.environ", env, clear=False):
            with mock.patch.dict("os.environ", {"QB_AUTH_TOKEN": ""}, clear=False):
                import os
                os.environ.pop("QB_AUTH_TOKEN", None)
                r = edition.exposure_safety()
        self.assertFalse(r["ok"], "0.0.0.0 且无令牌必须判为不安全")
        self.assertEqual(r["exposure"], "lan")
        self.assertIn("未启用任何鉴权", r["reason"])

    def test_lan_with_token_is_safe(self):
        with mock.patch.dict("os.environ",
                             {"QB_HOST": "0.0.0.0", "QB_AUTH_TOKEN": "t", "QB_EDITION": "local"},
                             clear=False):
            r = edition.exposure_safety()
        self.assertTrue(r["ok"])
        self.assertEqual(r["exposure"], "lan")

    def test_online_is_public(self):
        with mock.patch.dict("os.environ",
                             {"QB_HOST": "0.0.0.0", "QB_EDITION": "online", "QB_AUTH_TOKEN": "t"},
                             clear=False):
            r = edition.exposure_safety()
        self.assertEqual(r["exposure"], "public")

    def test_is_loopback(self):
        for h in ("127.0.0.1", "::1", "localhost"):
            self.assertTrue(edition.is_loopback(h), h)
        for h in ("0.0.0.0", "192.168.0.103", "10.0.0.5"):
            self.assertFalse(edition.is_loopback(h), h)


class TestNetworkService(unittest.TestCase):
    def setUp(self):
        _SETTINGS.clear()
        self._p1 = mock.patch("webui.config.get_settings", _fake_get_settings)
        self._p2 = mock.patch("webui.config.update_settings", _fake_update_settings)
        self._p1.start()
        self._p2.start()

    def tearDown(self):
        self._p1.stop()
        self._p2.stop()
        _SETTINGS.clear()

    def test_default_is_off(self):
        cfg = svc.get_lan_config()
        self.assertFalse(cfg["enabled"])
        self.assertIsNone(cfg["token"])

    def test_enable_generates_token_and_requires_restart(self):
        res = svc.set_lan_enabled(True)
        self.assertTrue(res["enabled"])
        self.assertTrue(res["token"])
        self.assertGreaterEqual(len(res["token"]), 24)
        self.assertTrue(res["restart_required"])

    def test_enable_is_idempotent_for_token(self):
        """重复开启不应换掉令牌（否则手机上的链接会莫名失效）。"""
        t1 = svc.set_lan_enabled(True)["token"]
        t2 = svc.set_lan_enabled(True)["token"]
        self.assertEqual(t1, t2)

    def test_disable_keeps_token(self):
        t = svc.set_lan_enabled(True)["token"]
        svc.set_lan_enabled(False)
        cfg = svc.get_lan_config()
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["token"], t, "关闭时保留令牌，便于下次直接开启")

    def test_rotate_changes_token(self):
        t1 = svc.set_lan_enabled(True)["token"]
        t2 = svc.rotate_token()["token"]
        self.assertNotEqual(t1, t2)

    def test_mask_token_hides_middle(self):
        self.assertIsNone(svc.mask_token(None))
        masked = svc.mask_token("abcdefghijklmnop")
        self.assertNotIn("efghijkl", masked or "")

    def test_build_lan_url_contains_token(self):
        url = svc.build_lan_url("tok123", host="192.168.0.9", port=8720)
        self.assertEqual(url, "http://192.168.0.9:8720/?t=tok123")

    def test_build_lan_url_none_without_token(self):
        """无令牌就没有可用的手机链接（避免给出打不开的地址）。"""
        self.assertIsNone(svc.build_lan_url(None, host="192.168.0.9"))

    def test_qr_svg_is_svg(self):
        svg = svc.qr_svg("http://192.168.0.9:8720/?t=tok")
        self.assertIsNotNone(svg)
        self.assertIn("<svg", svg or "")

    def test_status_hides_token_by_default(self):
        svc.set_lan_enabled(True)
        st = svc.network_status()
        self.assertTrue(st["token_set"])
        self.assertNotIn("lan_url", st)
        self.assertNotIn("qr_svg", st)
        # 掩码里不能出现完整令牌
        raw = svc.get_lan_config()["token"]
        self.assertNotIn(raw, str(st["token_masked"]))

    def test_status_include_link_exposes_url_and_qr(self):
        svc.set_lan_enabled(True)
        st = svc.network_status(include_link=True)
        raw = svc.get_lan_config()["token"]
        if st["lan_url"] is None:
            self.skipTest("本机无局域网地址")
        self.assertIn(raw, st["lan_url"])
        self.assertIn("<svg", st["qr_svg"] or "")

    def test_apply_to_environment_sets_host_and_token(self):
        svc.set_lan_enabled(True)
        token = svc.get_lan_config()["token"]
        with mock.patch.dict("os.environ", {}, clear=True):
            svc.apply_to_environment()
            self.assertEqual(edition.resolve_host(), "0.0.0.0")
            self.assertEqual(edition.auth_token(), token)

    def test_apply_to_environment_respects_explicit_env(self):
        """显式传入的 QB_HOST/QB_AUTH_TOKEN 必须**优先**（便于排障与线上覆盖）。"""
        svc.set_lan_enabled(True)
        with mock.patch.dict("os.environ",
                             {"QB_HOST": "127.0.0.1", "QB_AUTH_TOKEN": "explicit"}, clear=True):
            svc.apply_to_environment()
            self.assertEqual(edition.resolve_host(), "127.0.0.1")
            self.assertEqual(edition.auth_token(), "explicit")

    def test_disabled_leaves_host_alone(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            svc.apply_to_environment()
            self.assertEqual(edition.resolve_host(), "127.0.0.1")


class TestNetworkApi(unittest.TestCase):
    def setUp(self):
        _SETTINGS.clear()
        self._p1 = mock.patch("webui.config.get_settings", _fake_get_settings)
        self._p2 = mock.patch("webui.config.update_settings", _fake_update_settings)
        self._p1.start()
        self._p2.start()

    def tearDown(self):
        self._p1.stop()
        self._p2.stop()
        _SETTINGS.clear()

    def _client(self):
        from fastapi.testclient import TestClient
        from webui.app import app
        return TestClient(app)

    def test_status_contract(self):
        r = self._client().get("/api/network/status")
        self.assertEqual(r.status_code, 200)
        d = r.json()["data"]
        for k in ("lan_enabled", "lan_ip", "port", "exposure", "token_set",
                  "token_masked", "restart_required"):
            self.assertIn(k, d)
        self.assertFalse(d["lan_enabled"])
        # 常规状态**不得**带令牌或链接
        self.assertNotIn("lan_url", d)
        self.assertNotIn("qr_svg", d)

    def test_enable_then_status(self):
        c = self._client()
        d = c.post("/api/network/enable").json()["data"]
        self.assertTrue(d["lan_enabled"])
        self.assertTrue(d["token_set"])
        self.assertTrue(d["restart_required"])
        self.assertTrue(c.get("/api/network/status").json()["data"]["lan_enabled"])

    def test_link_endpoint_exposes_url_and_qr(self):
        c = self._client()
        c.post("/api/network/enable")
        d = c.get("/api/network/link").json()["data"]
        if d["lan_url"] is None:
            self.skipTest("本机无局域网地址")
        self.assertIn("?t=", d["lan_url"])
        self.assertIn("<svg", d["qr_svg"] or "")

    def test_rotate_invalidates_old_link(self):
        c = self._client()
        c.post("/api/network/enable")
        old = c.get("/api/network/link").json()["data"]["lan_url"]
        c.post("/api/network/rotate")
        new = c.get("/api/network/link").json()["data"]["lan_url"]
        if old is None or new is None:
            self.skipTest("本机无局域网地址")
        self.assertNotEqual(old, new)

    def test_disable(self):
        c = self._client()
        c.post("/api/network/enable")
        d = c.post("/api/network/disable").json()["data"]
        self.assertFalse(d["lan_enabled"])
        self.assertTrue(d["restart_required"])


if __name__ == "__main__":
    unittest.main()
