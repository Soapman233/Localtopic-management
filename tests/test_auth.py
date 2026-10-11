"""用户与权限体系（阶段4）测试。

覆盖（对照任务要求）：
* 密码哈希/校验：正确、错误、空、超长、Unicode；
* 登录：成功、密码错误、不存在用户、禁用用户；
* 会话：过期失效、登出后失效；
* 权限矩阵：viewer/editor/admin × 读/写/用户管理，**逐格断言**；
* 本地版零影响：``QB_EDITION=local`` 或「无用户」时，既有接口无需任何凭据；
* 幂等迁移：``ensure_auth_schema`` 重复执行无副作用；``migrate_database`` 重复执行不报错，
  且 **``bank.db`` 不被写入 users/sessions 表**（交付数据零污染）。

所有写入使用**临时库**，绝不触碰 ``outputs/bank.db`` 与 ``outputs/webui/auth.db``。
"""
# ---------------------------------------------------------------------------
# title: 用户与权限体系测试
# description: 密码哈希、登录、会话、权限矩阵逐格、本地零影响、幂等迁移与交付库零污染。
# author: 待补充
# version: 0.1.0
# category: 测试、Web界面
# ---------------------------------------------------------------------------

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from bank import answers as b_answers
from bank import db as bdb
from bank import edit as b_edit
from bank import enrich as b_enrich
from bank import labels as b_labels
from bank import paper as b_paper
from webui import auth
from webui import config
from webui.app import create_app
from webui.__main__ import migrate_database


# --------------------------------------------------------------------------- #
# 纯函数：密码哈希 / 权限表
# --------------------------------------------------------------------------- #
class TestPasswordHashing(unittest.TestCase):
    """密码派生与常量时间校验。"""

    def test_correct_password_verifies(self):
        h, s, it = auth.hash_password("correct horse")
        self.assertTrue(auth.verify_password("correct horse", h, s, it))

    def test_wrong_password_rejected(self):
        h, s, it = auth.hash_password("correct horse")
        self.assertFalse(auth.verify_password("wrong horse", h, s, it))

    def test_empty_password(self):
        h, s, it = auth.hash_password("")
        self.assertTrue(auth.verify_password("", h, s, it))
        self.assertFalse(auth.verify_password("x", h, s, it))

    def test_overlong_password(self):
        pw = "a" * 5000
        h, s, it = auth.hash_password(pw)
        self.assertTrue(auth.verify_password(pw, h, s, it))
        self.assertFalse(auth.verify_password("a" * 4999, h, s, it))

    def test_unicode_password(self):
        pw = "物理🔬密码π≈3.14"
        h, s, it = auth.hash_password(pw)
        self.assertTrue(auth.verify_password(pw, h, s, it))
        self.assertFalse(auth.verify_password("物理密码", h, s, it))

    def test_hash_is_salted_and_uses_stored_iterations(self):
        h1, s1, _ = auth.hash_password("same", iterations=1000)
        h2, s2, _ = auth.hash_password("same", iterations=1000)
        self.assertNotEqual(s1, s2, "盐应每次随机")
        self.assertNotEqual(h1, h2, "同密码不同盐应得不同哈希")
        # 迭代次数存表：用表内次数即可校验。
        self.assertTrue(auth.verify_password("same", h1, s1, 1000))
        self.assertFalse(auth.verify_password("same", h1, s1, 999))

    def test_verify_tolerates_bad_stored_fields(self):
        self.assertFalse(auth.verify_password("x", "", "", 1000))
        self.assertFalse(auth.verify_password("x", "zz", "zz", 1000))
        self.assertFalse(auth.verify_password("x", "aa", "bb", 0))
        self.assertFalse(auth.verify_password("x", "aa", "bb", -1))


class TestPermissionTable(unittest.TestCase):
    """声明式权限表：逐条断言「方法+路径 → 所需权限」。"""

    def test_read_endpoints(self):
        for method, path in [
            ("GET", "/api/search"), ("GET", "/api/papers"),
            ("GET", "/api/papers/1"), ("GET", "/api/stats"),
            ("GET", "/api/questions/1"), ("GET", "/api/settings"),
            ("GET", "/api/meta/coverage"), ("GET", "/api/review"),
        ]:
            self.assertEqual(auth.required_permission(method, path), auth.PERM_READ, path)

    def test_read_semantics_post_whitelist(self):
        """白名单内的 POST（预览 / 导出 / 登出）算「读」——逐条断言，防止新增端点误归类。"""
        for path in ["/api/papers/7/preview", "/api/papers/7/export", "/api/auth/logout"]:
            self.assertEqual(auth.required_permission("POST", path), auth.PERM_READ, path)

    def test_write_endpoints(self):
        for method, path in [
            ("POST", "/api/papers"), ("DELETE", "/api/papers/1"),
            ("PATCH", "/api/papers/1"), ("PUT", "/api/questions/1"),
            ("POST", "/api/questions/1/difficulty"),
            ("POST", "/api/questions/difficulty/batch"),
            ("POST", "/api/papers/1/questions"),
            ("POST", "/api/papers/1/sections"),
            ("POST", "/api/review/1/resolve"),
        ]:
            self.assertEqual(auth.required_permission(method, path), auth.PERM_WRITE, path)

    def test_settings_write_is_admin_read_is_read(self):
        """F4：``/api/settings`` **读**归 read，**写**归 admin（与前端 ``settings.edit`` 对齐）。"""
        self.assertEqual(auth.required_permission("GET", "/api/settings"), auth.PERM_READ)
        for method in ("PUT", "POST", "PATCH", "DELETE"):
            self.assertEqual(auth.required_permission(method, "/api/settings"),
                             auth.PERM_ADMIN, method)

    def test_user_management_is_admin(self):
        for method, path in [
            ("GET", "/api/auth/users"), ("POST", "/api/auth/users"),
            ("PATCH", "/api/auth/users/2"), ("POST", "/api/auth/users/2/password"),
        ]:
            self.assertEqual(auth.required_permission(method, path), auth.PERM_ADMIN, path)

    def test_role_matrix_cells(self):
        """角色 × 权限 的逐格断言（矩阵唯一事实来源）。"""
        matrix = {
            "viewer": {auth.PERM_READ: True, auth.PERM_WRITE: False, auth.PERM_ADMIN: False},
            "editor": {auth.PERM_READ: True, auth.PERM_WRITE: True, auth.PERM_ADMIN: False},
            "admin": {auth.PERM_READ: True, auth.PERM_WRITE: True, auth.PERM_ADMIN: True},
        }
        for role, perms in matrix.items():
            for perm, expected in perms.items():
                self.assertEqual(auth.role_allows(role, perm), expected,
                                 f"role={role} perm={perm}")

    def test_unknown_role_has_no_permission(self):
        for perm in (auth.PERM_READ, auth.PERM_WRITE, auth.PERM_ADMIN):
            self.assertFalse(auth.role_allows("ghost", perm))


# --------------------------------------------------------------------------- #
# 端到端：真实 app + TestClient（临时 bank.db + 临时 auth.db）
# --------------------------------------------------------------------------- #
class AuthApiBase(unittest.TestCase):
    """准备临时库与「线上版 + 有用户」的运行环境。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.db_path = self.dir / "bank.db"
        self.auth_path = self.dir / "auth.db"

        # 题库库（临时）：建表 + 幂等迁移（与既有测试一致）。
        conn = bdb.connect(self.db_path)
        b_paper.ensure_paper_schema(conn)
        b_labels.ensure_review_status_column(conn)
        b_answers.ensure_answer_columns(conn)
        b_edit.ensure_version_snapshot_columns(conn)
        b_enrich.ensure_provenance_columns(conn)
        conn.commit()
        conn.close()

        # 环境：线上版 + 指向临时鉴权库/题库库；清空共享令牌。
        self._env = mock.patch.dict(os.environ, {
            "QB_EDITION": "online",
            "QB_AUTH_DB": str(self.auth_path),
            "QB_DB_PATH": str(self.db_path),
            "QB_AUTH_TOKEN": "",
            "QB_AUTH_COOKIE": "",
        }, clear=False)
        self._env.start()
        self.addCleanup(self._env.stop)

        self.client = TestClient(create_app())

    def tearDown(self):
        self._tmp.cleanup()

    # -- 工具 -------------------------------------------------------------- #
    def _make_user(self, username: str, password: str, role: str = "viewer") -> dict:
        conn = auth.connect_auth(create=True)
        try:
            return auth.create_user(conn, username, password, role=role)
        finally:
            conn.close()

    def _login(self, username: str, password: str):
        return self.client.post("/api/auth/login",
                                json={"username": username, "password": password})

    def _hdr(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    def _token_for(self, username: str, password: str, role: str) -> str:
        self._make_user(username, password, role)
        resp = self._login(username, password)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["data"]["token"]

    def _app_for_edition(self, edition_value: str) -> TestClient:
        """在指定版本下构建 app（``_online`` 在构建时捕获，故需重建）。"""
        with mock.patch.dict(os.environ, {"QB_EDITION": edition_value}, clear=False):
            return TestClient(create_app())


class TestLoginAndSession(AuthApiBase):
    """登录 / 会话生命周期。"""

    def test_login_success_returns_token_and_user(self):
        self._make_user("alice", "pw-alice", "editor")
        resp = self._login("alice", "pw-alice")
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(set(body.keys()), {"code", "data", "message"})
        self.assertEqual(body["code"], 0)
        self.assertTrue(body["data"]["token"])
        self.assertEqual(body["data"]["user"]["username"], "alice")
        self.assertEqual(body["data"]["user"]["role"], "editor")
        self.assertNotIn("password_hash", body["data"]["user"])
        self.assertNotIn("password_salt", body["data"]["user"])

    def test_login_wrong_password(self):
        self._make_user("bob", "pw-bob")
        resp = self._login("bob", "nope")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40103)

    def test_login_nonexistent_user(self):
        self._make_user("carol", "pw")
        resp = self._login("ghost", "pw")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40103)

    def test_login_disabled_user_uses_same_code_and_message(self):
        """F5：账号禁用与凭据错误**同码同文案**（禁用状态不暴露给未认证请求方）。"""
        user = self._make_user("dave", "pw-dave")
        conn = auth.connect_auth()
        try:
            auth.update_user(conn, user["id"], disabled=True)
        finally:
            conn.close()
        disabled = self._login("dave", "pw-dave")   # 密码正确但账号禁用
        wrong = self._login("dave", "nope")         # 密码错误
        self.assertEqual(disabled.status_code, 401)
        self.assertEqual(disabled.json()["code"], 40103)
        self.assertEqual(disabled.json()["message"], wrong.json()["message"],
                         "禁用与凭据错误必须同文案，避免枚举账号状态")
        self.assertNotIn("禁用", disabled.json()["message"])

    def test_login_nonexistent_user_runs_dummy_hash(self):
        """F5：用户不存在时也执行一次等价 pbkdf2（抹平时序差）。"""
        self._make_user("real", "pw")
        with mock.patch.object(auth, "_dummy_password_check",
                               wraps=auth._dummy_password_check) as spy:
            resp = self._login("ghost", "pw")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40103)
        self.assertTrue(spy.called, "用户不存在时必须执行一次等价 pbkdf2 以抹平时序差")

    def test_login_when_no_users_reports_disabled(self):
        resp = self._login("anyone", "whatever")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["code"], 40008)

    def test_me_returns_identity_and_mode(self):
        token = self._token_for("erin", "pw", "admin")
        resp = self.client.get("/api/auth/me", headers=self._hdr(token))
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()["data"]
        self.assertEqual(data["auth_mode"], "session")
        # `auth_enabled` 是**前端契约字段**（由 auth_mode 派生）：前端靠它决定
        # 「要不要显示登录页 / 拦路由」。它缺失或恒真都会让本地版被误要求登录。
        self.assertIs(data["auth_enabled"], True)
        self.assertIs(data["needs_setup"], False)
        self.assertEqual(data["user"]["role"], "admin")

    def test_session_expiry_invalidates(self):
        token = self._token_for("frank", "pw", "viewer")
        self.assertEqual(self.client.get("/api/papers",
                                         headers=self._hdr(token)).status_code, 200)
        # 手动把会话置为已过期。
        conn = auth.connect_auth()
        try:
            conn.execute("UPDATE sessions SET expires_at = ? WHERE token = ?",
                         ("2000-01-01T00:00:00", token))
            conn.commit()
        finally:
            conn.close()
        resp = self.client.get("/api/papers", headers=self._hdr(token))
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40102)

    def test_logout_invalidates_session(self):
        token = self._token_for("gina", "pw", "viewer")
        self.assertEqual(self.client.get("/api/papers",
                                         headers=self._hdr(token)).status_code, 200)
        out = self.client.post("/api/auth/logout", headers=self._hdr(token))
        self.assertEqual(out.status_code, 200)
        resp = self.client.get("/api/papers", headers=self._hdr(token))
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], 40102)

    def test_missing_and_bogus_token_rejected(self):
        self._make_user("hank", "pw", "viewer")
        self.assertEqual(self.client.get("/api/papers").status_code, 401)
        self.assertEqual(self.client.get("/api/papers",
                                         headers=self._hdr("bogus")).status_code, 401)


class TestPermissionMatrixE2E(AuthApiBase):
    """角色 × 读/写/用户管理 的端到端逐格断言。"""

    def setUp(self):
        super().setUp()
        self.tokens = {
            "viewer": self._token_for("v1", "pw", "viewer"),
            "editor": self._token_for("e1", "pw", "editor"),
            "admin": self._token_for("a1", "pw", "admin"),
        }

    def _status(self, role: str, method: str, path: str, **kw):
        return self.client.request(method, path, headers=self._hdr(self.tokens[role]), **kw)

    def test_read_allowed_for_every_role(self):
        for role in ("viewer", "editor", "admin"):
            resp = self._status(role, "GET", "/api/papers")
            self.assertEqual(resp.status_code, 200, f"{role} 应可读：{resp.text}")

    def test_write_matrix(self):
        # viewer 写 → 403；editor/admin 写 → 200。
        resp = self._status("viewer", "POST", "/api/papers", json={"title": "v卷"})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], 40301)
        for role in ("editor", "admin"):
            resp = self._status(role, "POST", "/api/papers", json={"title": f"{role}卷"})
            self.assertEqual(resp.status_code, 200, f"{role} 应可写：{resp.text}")

    def test_user_management_matrix(self):
        # 仅 admin 可管理用户。
        for role in ("viewer", "editor"):
            resp = self._status(role, "GET", "/api/auth/users")
            self.assertEqual(resp.status_code, 403, f"{role} 不应可管理用户")
            self.assertEqual(resp.json()["code"], 40301)
        resp = self._status("admin", "GET", "/api/auth/users")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertGreaterEqual(len(resp.json()["data"]), 3)

    def test_admin_can_create_user_via_api(self):
        resp = self._status("admin", "POST", "/api/auth/users",
                            json={"username": "newbie", "password": "pw", "role": "editor"})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["data"]["role"], "editor")
        # 新账号立即可登录（动态生效，无需重启）。
        self.assertEqual(self._login("newbie", "pw").status_code, 200)

    def test_duplicate_username_conflicts(self):
        resp = self._status("admin", "POST", "/api/auth/users",
                            json={"username": "v1", "password": "pw", "role": "viewer"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["code"], 40906)

    def test_last_admin_cannot_be_demoted(self):
        users = self._status("admin", "GET", "/api/auth/users").json()["data"]
        admin_id = next(u["id"] for u in users if u["username"] == "a1")
        resp = self._status("admin", "PATCH", f"/api/auth/users/{admin_id}",
                            json={"role": "viewer"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("最后一个", resp.json()["message"])


class TestLocalZeroImpact(AuthApiBase):
    """本地版 / 无用户 → 单机全权，既有接口无需任何凭据。"""

    def test_local_edition_ignores_existing_users(self):
        # 即便鉴权库中已有用户，本地版仍不启用鉴权。
        self._make_user("admin", "pw", "admin")
        client = self._app_for_edition("local")
        self.assertEqual(client.get("/api/papers").status_code, 200)
        self.assertEqual(client.get("/api/stats").status_code, 200)
        me = client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["data"]["auth_mode"], "off")
        # 本地版必须 `auth_enabled: False`——这是「本地版零感知」的关键开关：
        # 前端据此**透传**所有路由，不显示登录入口。
        self.assertIs(me.json()["data"]["auth_enabled"], False)
        self.assertIsNone(me.json()["data"]["user"])

    def test_online_without_users_is_fail_closed(self):
        """F1/F2：线上版且库中无用户 → **拒绝**（503），绝不静默退化为单机全权。"""
        client = self._app_for_edition("online")
        resp = client.get("/api/papers")
        self.assertEqual(resp.status_code, 503, resp.text)
        self.assertEqual(resp.json()["code"], 50301)
        self.assertEqual(client.post("/api/papers", json={"title": "x"}).status_code, 503)

    def test_health_always_exempt(self):
        self._make_user("admin", "pw", "admin")
        self.assertEqual(self.client.get("/api/health").status_code, 200)


class TestAuthFailClosed(AuthApiBase):
    """F1/F2/F3：线上版鉴权不可用 → fail-closed，并区分「未初始化」与「库损坏」。"""

    def _assert_message_has_no_path(self, message: str) -> None:
        """客户端可见文案**不得**包含服务器路径 / 内部细节（F6）。"""
        self.assertNotIn("\\", message, "文案不应含反斜杠路径分隔符")
        self.assertNotIn("/", message, "文案不应含斜杠路径")
        self.assertNotIn("c:", message.lower(), "文案不应含盘符（C:）")
        for token in ("traceback", "sqlite", "not a database", "file is not"):
            self.assertNotIn(token, message.lower(), f"文案不应含内部细节：{token}")

    def test_online_uninitialized_returns_503_with_guidance(self):
        # auth.db 不存在（全新部署）→ uninitialized → 503，且给出**可执行**指引。
        client = self._app_for_edition("online")
        resp = client.get("/api/papers")
        self.assertEqual(resp.status_code, 503)
        body = resp.json()
        self.assertEqual(set(body.keys()), {"code", "data", "message"})
        self.assertEqual(body["code"], 50301)
        self.assertIn("python -m webui.auth user add", body["message"])
        # 含命令但**不含路径**，可保留；同时确保没有路径分隔符。
        self._assert_message_has_no_path(body["message"])

    def test_online_corrupt_db_returns_503_without_leaking(self):
        # 故意破坏**临时目录**里的 auth.db（绝不碰 outputs/webui/auth.db）。
        self._make_user("admin", "pw", "admin")
        self.auth_path.write_text("this is not a sqlite database", encoding="utf-8")
        client = self._app_for_edition("online")
        resp = client.get("/api/papers")
        self.assertEqual(resp.status_code, 503, resp.text)
        body = resp.json()
        self.assertEqual(body["code"], 50302)
        self.assertIn("鉴权数据库不可用", body["message"])
        # **关键**：文案不回显服务器绝对路径，也不回显 sqlite 细节 / 堆栈（F6）。
        self._assert_message_has_no_path(body["message"])
        self.assertNotIn(str(self.auth_path), resp.text)
        self.assertNotIn("traceback", resp.text.lower())

    def test_online_no_users_cannot_bootstrap_admin_via_api(self):
        # F2：无用户时无凭据 POST /api/auth/users 必须被拒（不是 200），且确实没建号。
        client = self._app_for_edition("online")
        resp = client.post("/api/auth/users",
                           json={"username": "attacker", "password": "pw", "role": "admin"})
        self.assertEqual(resp.status_code, 503, resp.text)
        self.assertFalse(auth.users_exist(), "首个管理员只能经 CLI 创建，API 不得自建")

    def test_health_hides_db_path_in_online(self):
        # 线上版 health 豁免鉴权：未认证客户端不得拿到 DB 绝对路径（F6 同类）。
        client = self._app_for_edition("online")
        resp = client.get("/api/health")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()["data"]
        self.assertNotIn("db", data, "线上版 health 不应回显 DB 绝对路径")
        self.assertIn("db_exists", data)
        self.assertNotIn(str(self.db_path), resp.text)

    def test_health_keeps_db_path_in_local(self):
        # 本地版仅回环、单机使用：保留绝对路径（前端可视化写路径安全闸门依赖它）。
        client = self._app_for_edition("local")
        resp = client.get("/api/health")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertIn("db", resp.json()["data"])

    def test_me_exempt_reports_uninitialized(self):
        # F3：me 免鉴权可访问，并表达 needs_setup，供前端给指引而非显示登录表单。
        client = self._app_for_edition("online")
        resp = client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()["data"]
        self.assertEqual(data["auth_mode"], "uninitialized")
        self.assertIs(data["auth_enabled"], False)
        self.assertIs(data["needs_setup"], True)
        self.assertIsNone(data["user"])

    def test_me_exempt_without_credentials_in_session_mode(self):
        # F3：session 模式下无凭据 GET /api/auth/me 不再是 401（前端据此显示登录页）。
        self._make_user("admin", "pw", "admin")
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()["data"]
        self.assertEqual(data["auth_mode"], "session")
        self.assertIs(data["auth_enabled"], True)
        self.assertIs(data["needs_setup"], False)
        self.assertIsNone(data["user"])

    def test_me_exempt_with_valid_credentials_returns_user(self):
        # 免鉴权但**仍尽力解析身份**：带有效会话时 me 应回显用户。
        token = self._token_for("erin", "pw", "editor")
        resp = self.client.get("/api/auth/me", headers=self._hdr(token))
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["data"]["user"]["username"], "erin")


class TestSettingsAdminOnly(AuthApiBase):
    """F4：``/api/settings`` 写操作仅 admin（后端为准，前端已一致）。"""

    def setUp(self):
        super().setUp()
        # 把设置文件重定向到临时目录，避免写入仓库真实的 outputs/webui/settings.json。
        self._settings = [
            mock.patch.object(config, "WEBUI_DIR", self.dir / "webui"),
            mock.patch.object(config, "SETTINGS_PATH", self.dir / "webui" / "settings.json"),
        ]
        for p in self._settings:
            p.start()
            self.addCleanup(p.stop)
        self.tokens = {
            "viewer": self._token_for("v1", "pw", "viewer"),
            "editor": self._token_for("e1", "pw", "editor"),
            "admin": self._token_for("a1", "pw", "admin"),
        }

    def test_settings_read_allowed_for_every_role(self):
        for role in ("viewer", "editor", "admin"):
            resp = self.client.get("/api/settings", headers=self._hdr(self.tokens[role]))
            self.assertEqual(resp.status_code, 200, f"{role} 应可读设置：{resp.text}")

    def test_settings_write_admin_only(self):
        theme = {"primary": "#123abc", "dark": True}
        for role in ("viewer", "editor"):
            resp = self.client.put("/api/settings", headers=self._hdr(self.tokens[role]),
                                   json={"theme": theme})
            self.assertEqual(resp.status_code, 403, f"{role} 不应可改设置：{resp.text}")
            self.assertEqual(resp.json()["code"], 40301)
        resp = self.client.put("/api/settings", headers=self._hdr(self.tokens["admin"]),
                               json={"theme": theme})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["data"]["theme"], theme)


class TestSharedTokenConstantTime(AuthApiBase):
    """F7：共享令牌用常量时间比较；错误令牌一律 401。"""

    def test_wrong_shared_token_rejected(self):
        with mock.patch.dict(os.environ, {"QB_AUTH_TOKEN": "s3cret-token"}, clear=False):
            client = TestClient(create_app())
            for bogus in ("s3cret-tokeX", "s3cret", "", "x"):
                resp = client.get("/api/papers",
                                  headers={"Authorization": f"Bearer {bogus}"})
                self.assertEqual(resp.status_code, 401, bogus)
            ok_resp = client.get("/api/papers",
                                 headers={"Authorization": "Bearer s3cret-token"})
            self.assertEqual(ok_resp.status_code, 200)


class TestTokenPriority(AuthApiBase):
    """共享令牌与用户体系共存时的优先级规则。"""

    def test_shared_token_acts_as_service_admin(self):
        self._make_user("admin", "pw", "admin")
        with mock.patch.dict(os.environ, {"QB_AUTH_TOKEN": "s3cret"}, clear=False):
            client = TestClient(create_app())
            # 无会话 → 401（用户体系优先，要求登录）。
            self.assertEqual(client.get("/api/papers").status_code, 401)
            # 携带共享令牌 → 视为管理员，放行（含用户管理）。
            self.assertEqual(client.get("/api/papers",
                                        headers={"Authorization": "Bearer s3cret"}).status_code, 200)
            self.assertEqual(client.get("/api/auth/users",
                                        headers={"Authorization": "Bearer s3cret"}).status_code, 200)

    def test_token_only_mode_without_users(self):
        with mock.patch.dict(os.environ, {"QB_AUTH_TOKEN": "s3cret"}, clear=False):
            client = TestClient(create_app())
            self.assertEqual(client.get("/api/papers").status_code, 401)
            self.assertEqual(client.get("/api/papers").json()["code"], 40101)
            self.assertEqual(client.get("/api/papers",
                                        headers={"Authorization": "Bearer s3cret"}).status_code, 200)


class TestMigrationIdempotent(unittest.TestCase):
    """幂等迁移 + 交付库零污染。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.db_path = self.dir / "bank.db"
        self.auth_path = self.dir / "auth.db"

    def tearDown(self):
        self._tmp.cleanup()

    def test_ensure_auth_schema_idempotent(self):
        conn = auth.connect_auth(create=True)
        try:
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("users", tables)
            self.assertIn("sessions", tables)
            # 已建表后再调用 → 不应再建任何对象。
            self.assertEqual(auth.ensure_auth_schema(conn), [], "重复执行不应再建表")
        finally:
            conn.close()

    def test_migrate_database_repeatable_and_does_not_touch_auth(self):
        bdb.connect(self.db_path).close()
        first = migrate_database(self.db_path)
        second = migrate_database(self.db_path)
        self.assertIsInstance(first, list)
        self.assertEqual(second, [], "重复执行 migrate_database 应无变更")

    def test_bank_db_not_polluted_with_auth_tables(self):
        """**关键保证**：鉴权表只进 auth.db，绝不进交付库 bank.db。"""
        bdb.connect(self.db_path).close()
        migrate_database(self.db_path)
        conn = bdb.connect(self.db_path)
        try:
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()
        self.assertNotIn("users", tables)
        self.assertNotIn("sessions", tables)
        # auth 库则确实含这两张表。
        aconn = auth.connect_auth(create=True)
        try:
            atables = {r[0] for r in aconn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            aconn.close()
        self.assertIn("users", atables)
        self.assertIn("sessions", atables)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
