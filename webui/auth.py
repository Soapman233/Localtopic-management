"""用户与权限体系（阶段4）：账号、角色、会话、鉴权判定与 CLI。

设计要点
--------
* **独立鉴权库**：账号与会话存放在**独立的 SQLite 库**（默认 ``outputs/webui/auth.db``，
  可用环境变量 ``QB_AUTH_DB`` 覆盖），**绝不写入 ``bank.db``**。后者是**交付数据**，
  必须保持零污染（我们一直用 sha256 证明「导出不改库」）；把 ``users`` 表塞进交付库会
  同时破坏「零污染」与「可搬运」两条保证。
* **纯标准库**：密码用 ``hashlib.pbkdf2_hmac('sha256', pw, salt, iterations)`` 派生，
  校验用 ``hmac.compare_digest``（**常量时间**，防时序侧信道）；不引入 passlib/bcrypt。
* **本地版零影响（硬保证）**：仅当 ``QB_EDITION=online`` **且** 鉴权库中存在 ≥1 个用户时，
  才启用「用户会话」鉴权；否则视为**单机全权**，既有接口无需任何凭据。等价于需求里的
  「``QB_EDITION=local`` 或无用户 ⇒ 不需要凭据」。
* **服务端强制**：权限判定走**声明式表**（HTTP 方法 + 路径白名单 → 所需权限），
  不在前端藏按钮；未授权统一返回 ``{code, data, message}`` 错误信封。

鉴权模式（见 :func:`resolve_mode`）
----------------------------------
1. ``off``      —— 未启用（本地版）：单机全权。
2. ``token``    —— 共享令牌模式（设置了 ``QB_AUTH_TOKEN`` 且库中无用户）：**保持历史行为**。
3. ``session``  —— 用户会话模式（线上版且库中有用户）：按角色鉴权。
4. ``token+session`` —— 两者同时配置：**用户体系优先**，共享令牌退化为「服务账号令牌」
   （携带正确 ``QB_AUTH_TOKEN`` 的请求放行，视为管理员，供自动化脚本使用）。
5. ``uninitialized`` —— **仅线上版**：鉴权库不存在 / 尚无 ``users`` 表（全新部署，未建号）。
   此时**拒绝**所有非豁免请求（``503``），提示运维用 CLI 建首个管理员——而不是 fail-open。
6. ``error``    —— **仅线上版**：鉴权库存在但**读取失败**（损坏 / 权限不足 / 缺表）。
   此时同样**拒绝**非豁免请求（``503``），提示运维检查库文件。

.. note::
   ``uninitialized`` 与 ``error`` 是**安全审计 F1/F2** 的修复：线上版「鉴权不可用」必须
   **fail-closed**，且要让运维能区分「去建号」还是「去修库」，绝不能静默退化为单机全权。

CLI（``python -m webui.auth ...``）
----------------------------------
* ``user add <username> [--role ...] [--display-name ...] [--password-env VAR]``
* ``user list``
* ``user set-password <username> [--password-env VAR]``
* ``user set-role <username> --role {viewer,editor,admin}``
* ``user disable <username>`` / ``user enable <username>``

密码来源：``--password-env`` 指定的环境变量 → ``QB_AUTH_PASSWORD`` / ``QB_ADMIN_PASSWORD``
→ 交互式 ``getpass``（输入两次）。**绝不把明文密码放进命令行参数**（会进 shell 历史）。
"""
# ---------------------------------------------------------------------------
# title: webui 用户与权限体系
# description: 独立 auth.db 的账号/角色/会话；pbkdf2 密码哈希；声明式权限矩阵；模式解析；CLI。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import argparse
import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from . import config

#: 模块日志器（把库损坏 / 读取失败等**内部细节**写进服务端日志，而非回显给客户端）。
_log = logging.getLogger("webui.auth")

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 密码派生迭代次数（≥20 万；存进表，便于将来提高强度时老用户仍可校验）。
DEFAULT_ITERATIONS = 200_000
#: 盐长度（字节）。
SALT_BYTES = 16
#: 会话 token 随机字节数（``secrets.token_urlsafe``）。
SESSION_TOKEN_BYTES = 32
#: 会话默认有效期（秒）：12 小时。可用 ``QB_SESSION_TTL`` 覆盖。
DEFAULT_SESSION_TTL = 12 * 3600
#: 会话 Cookie 名（后端同时接受 Cookie 与 ``Authorization: Bearer``）。
COOKIE_NAME = "qb_session"

#: 凭据错误**统一文案**（账号不存在 / 密码错误 / 账号禁用共用，避免账号枚举）。
CREDENTIALS_ERROR_MESSAGE = "用户名或密码错误"

#: 合法角色。
ROLE_VIEWER = "viewer"
ROLE_EDITOR = "editor"
ROLE_ADMIN = "admin"
ROLES: tuple[str, ...] = (ROLE_VIEWER, ROLE_EDITOR, ROLE_ADMIN)

#: 权限档位。
PERM_READ = "read"
PERM_WRITE = "write"
PERM_ADMIN = "admin"

#: 角色 → 权限集合（**权限矩阵的唯一事实来源**）。
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    ROLE_VIEWER: frozenset({PERM_READ}),
    ROLE_EDITOR: frozenset({PERM_READ, PERM_WRITE}),
    ROLE_ADMIN: frozenset({PERM_READ, PERM_WRITE, PERM_ADMIN}),
}

#: 免鉴权路径（健康检查供容器探针；登录/登出端点本身可匿名访问——登出幂等，
#: 无有效会话时也返回成功，故不要求先认证；``/api/auth/me`` **只回显身份与模式、
#: 不泄露任何其它数据**，必须匿名可访问——否则前端拿不到响应就无法区分「未登录」与
#: 「未启用鉴权」，线上版会退化成「没有登录入口」（安全审计 F3））。
EXEMPT_PATHS: frozenset[str] = frozenset({"/api/health", "/api/auth/login",
                                          "/api/auth/logout", "/api/auth/me"})

#: 用户管理路径 → 需 ``admin`` 权限。
_ADMIN_PATH_RE = re.compile(r"^/api/auth/users(?:/.*)?$")
#: 系统设置路径：读=``read``；**写=``admin``**（与前端 ``permissions.ts`` 的
#: ``settings.edit`` 对齐，修正前后端权限漂移——安全审计 F4）。
_SETTINGS_PATH_RE = re.compile(r"^/api/settings$")
#: 「写方法但语义为读」的白名单（导出/预览不落库、仅产出文件；登出对任何已登录用户开放）。
_READ_POST_RES: tuple[re.Pattern[str], ...] = (
    re.compile(r"^/api/papers/\d+/preview$"),
    re.compile(r"^/api/papers/\d+/export$"),
    re.compile(r"^/api/auth/logout$"),
)


# --------------------------------------------------------------------------- #
# 领域异常（由 router / errors.to_api_error 映射为统一错误码）
# --------------------------------------------------------------------------- #
class AuthError(Exception):
    """鉴权 / 账号领域错误基类。"""


class UserExistsError(AuthError):
    """用户名已存在（409）。"""

    def __init__(self, username: str):
        super().__init__(f"用户已存在：{username}")
        self.username = username


class UserNotFoundError(AuthError):
    """用户不存在（404）。"""


class InvalidCredentials(AuthError):
    """用户名或密码错误（401）。

    **也用于「账号已禁用」**：对外不区分「账号不存在 / 密码错 / 账号被禁用」，避免账号枚举
    （见 :func:`login`）。故**不**单独定义「账号已禁用」异常——否则它一旦被 ``raise``，
    就会把「账号存在且被禁用」这一事实泄露给未认证的请求方。
    """


class AuthNotEnabled(AuthError):
    """当前未启用用户体系（400）。"""


class InvalidRole(AuthError):
    """非法角色（400）。"""


class PasswordInvalid(AuthError):
    """密码不合法（400）。"""


# --------------------------------------------------------------------------- #
# 路径 / 连接
# --------------------------------------------------------------------------- #
def auth_db_path() -> Path:
    """鉴权库路径：``QB_AUTH_DB`` 优先，否则 ``<WEBUI_DIR>/auth.db``。

    默认与 ``settings.json`` 同目录（``outputs/webui/``），属**运维数据**，
    与题库交付数据 ``bank.db`` **分开备份**。
    """
    override = os.environ.get("QB_AUTH_DB", "").strip()
    if override:
        return Path(override)
    return Path(config.WEBUI_DIR) / "auth.db"


def session_ttl_seconds() -> int:
    """会话有效期（秒）：``QB_SESSION_TTL`` 优先，非法回落 :data:`DEFAULT_SESSION_TTL`。"""
    raw = os.environ.get("QB_SESSION_TTL", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return DEFAULT_SESSION_TTL


# 表 / 索引 DDL（幂等：``CREATE ... IF NOT EXISTS`` + 名称探测，便于报告本次变更）。
_TABLE_DDL: tuple[tuple[str, str], ...] = (
    ("users", """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,          -- 登录名（唯一）
            display_name  TEXT,                          -- 显示名（如「张三」）
            role          TEXT NOT NULL DEFAULT 'viewer',-- viewer/editor/admin
            password_hash TEXT NOT NULL,                 -- pbkdf2 派生值（hex）
            password_salt TEXT NOT NULL,                 -- 盐（hex）
            iterations    INTEGER NOT NULL,              -- 派生迭代次数（存表以便日后升级）
            created_at    TEXT,
            updated_at    TEXT,
            disabled      INTEGER NOT NULL DEFAULT 0,    -- 1=禁用
            last_login_at TEXT
        )
    """),
    ("sessions", """
        CREATE TABLE IF NOT EXISTS sessions (
            token        TEXT PRIMARY KEY,               -- 会话 token（secrets 随机）
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at   TEXT,
            expires_at   TEXT,
            last_seen_at TEXT,
            user_agent   TEXT
        )
    """),
)
_INDEX_DDL: tuple[tuple[str, str], ...] = (
    ("idx_sessions_user", "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"),
    ("idx_sessions_exp", "CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)"),
)


def ensure_auth_schema(conn: sqlite3.Connection) -> list[str]:
    """**幂等**创建鉴权表与索引；返回本次实际新建的对象名（重复执行返回 ``[]``）。

    与项目既有 ``ensure_*`` 迁移风格一致：只增不改，重复执行无副作用。
    """
    changed: list[str] = []
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    for name, ddl in _TABLE_DDL:
        if name not in tables:
            conn.execute(ddl)
            changed.append(name)
    indexes = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'")}
    for name, ddl in _INDEX_DDL:
        if name not in indexes:
            conn.execute(ddl)
            changed.append(name)
    conn.commit()
    return changed


def connect_auth(*, create: bool = False) -> sqlite3.Connection:
    """打开鉴权库连接。

    参数
    ----
    create 为 True 时（建用户等写场景）自动建目录、建表；为 False 时（鉴权热路径）
    只连不建，库不存在则抛 :class:`sqlite3.OperationalError`。
    """
    path = auth_db_path()
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    if create:
        ensure_auth_schema(conn)
    return conn


# --------------------------------------------------------------------------- #
# 密码哈希 / 校验
# --------------------------------------------------------------------------- #
def hash_password(password: str, *, iterations: int = DEFAULT_ITERATIONS,
                  salt: bytes | None = None) -> tuple[str, str, int]:
    """派生密码哈希，返回 ``(hash_hex, salt_hex, iterations)``。

    空串、超长、Unicode 均可处理（``encode('utf-8')``）。是否允许空密码由上层校验。
    """
    if not isinstance(password, str):
        raise PasswordInvalid("密码必须是字符串")
    if salt is None:
        salt = os.urandom(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    return digest.hex(), salt.hex(), int(iterations)


def verify_password(password: str, password_hash: str, password_salt: str,
                    iterations: int) -> bool:
    """**常量时间**校验密码；任何异常（空/非法 hex/非法迭代数）一律返回 ``False``。"""
    if not isinstance(password, str) or not password_hash or not password_salt:
        return False
    try:
        salt = bytes.fromhex(password_salt)
        expected = password_hash.strip().lower()
        it = int(iterations)
    except (ValueError, TypeError):
        return False
    if it <= 0:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, it)
    return hmac.compare_digest(digest.hex(), expected)


#: 用户不存在时用于**抹平时序差**的固定假盐（公开、非机密）。
_DUMMY_SALT = b"\x00" * SALT_BYTES


def _dummy_password_check(password: str) -> None:
    """对**不存在的用户**执行一次等价的 pbkdf2 派生，抹平「用户是否存在」的时序差。

    若用户不存在就提前返回，会与「用户存在但密码错误」产生可测量的时间差，攻击者可据此
    枚举有效用户名（安全审计 F5）。此处用固定假盐跑满一轮派生，使两条路径耗时相当。
    返回值无意义（丢弃），仅用于消耗时间。
    """
    hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"),
                        _DUMMY_SALT, DEFAULT_ITERATIONS)


# --------------------------------------------------------------------------- #
# 时间辅助
# --------------------------------------------------------------------------- #
def _now() -> str:
    """当前时间（本地、秒级 ISO），与项目其余时间字段风格一致。"""
    return datetime.now().isoformat(timespec="seconds")


def _expires_at(ttl: int) -> str:
    return (datetime.now() + timedelta(seconds=ttl)).isoformat(timespec="seconds")


def _is_expired(expires_at: str | None) -> bool:
    """会话是否已过期；无法解析时视为未过期（保守放行由 token 唯一性兜底）。"""
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at) <= datetime.now()
    except ValueError:
        return False


# --------------------------------------------------------------------------- #
# 用户 CRUD
# --------------------------------------------------------------------------- #
def public_user(row: sqlite3.Row | dict) -> dict:
    """把用户行转成**不含密码字段**的公开字典。"""
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "disabled": bool(row["disabled"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_login_at": row["last_login_at"],
    }


def _validate_username(username: str) -> str:
    name = (username or "").strip()
    if not name:
        raise AuthError("用户名不能为空")
    if len(name) > 64:
        raise AuthError("用户名过长（≤64 字符）")
    return name


def _validate_password(password: str) -> str:
    if not isinstance(password, str) or not password:
        raise PasswordInvalid("密码不能为空")
    if len(password) > 1024:
        raise PasswordInvalid("密码过长（≤1024 字符）")
    return password


def get_user_by_username(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    """按用户名查用户行（含密码字段，仅供校验/管理使用）。"""
    return conn.execute("SELECT * FROM users WHERE username = ?",
                        ((username or "").strip(),)).fetchone()


def get_user(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    """按 id 查用户行。"""
    return conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()


def list_users(conn: sqlite3.Connection) -> list[dict]:
    """列出全部用户（公开字段）。"""
    rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    return [public_user(r) for r in rows]


def create_user(conn: sqlite3.Connection, username: str, password: str, *,
                role: str = ROLE_VIEWER, display_name: str | None = None,
                iterations: int = DEFAULT_ITERATIONS) -> dict:
    """新增用户；用户名已存在时抛 :class:`UserExistsError`（**默认不覆盖**，避免误改）。"""
    name = _validate_username(username)
    if role not in ROLE_PERMISSIONS:
        raise InvalidRole(f"非法角色：{role}（应为 {'/'.join(ROLES)}）")
    pw = _validate_password(password)
    if get_user_by_username(conn, name) is not None:
        raise UserExistsError(name)
    pw_hash, salt, iters = hash_password(pw, iterations=iterations)
    now = _now()
    cur = conn.execute(
        "INSERT INTO users(username, display_name, role, password_hash, password_salt,"
        " iterations, created_at, updated_at, disabled, last_login_at)"
        " VALUES (?,?,?,?,?,?,?,?,0,NULL)",
        (name, (display_name or name), role, pw_hash, salt, iters, now, now))
    conn.commit()
    return public_user(get_user(conn, int(cur.lastrowid)))


def set_password(conn: sqlite3.Connection, user_id: int, password: str, *,
                 iterations: int = DEFAULT_ITERATIONS) -> dict:
    """重设某用户密码；用户不存在抛 :class:`UserNotFoundError`。"""
    pw = _validate_password(password)
    row = get_user(conn, user_id)
    if row is None:
        raise UserNotFoundError(f"用户不存在：id={user_id}")
    pw_hash, salt, iters = hash_password(pw, iterations=iterations)
    conn.execute("UPDATE users SET password_hash=?, password_salt=?, iterations=?,"
                 " updated_at=? WHERE id=?", (pw_hash, salt, iters, _now(), int(user_id)))
    # 改密后**吊销该用户全部会话**（旧会话不应继续有效）。
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (int(user_id),))
    conn.commit()
    return public_user(get_user(conn, int(user_id)))


def update_user(conn: sqlite3.Connection, user_id: int, *, role: str | None = None,
                disabled: bool | None = None, display_name: str | None = None) -> dict:
    """更新角色 / 禁用状态 / 显示名；禁用时同时吊销其会话。

    安全护栏：不允许把**最后一个启用的管理员**降级或禁用（否则无人能再登录管理）。
    """
    row = get_user(conn, user_id)
    if row is None:
        raise UserNotFoundError(f"用户不存在：id={user_id}")
    if role is not None and role not in ROLE_PERMISSIONS:
        raise InvalidRole(f"非法角色：{role}（应为 {'/'.join(ROLES)}）")
    ensure_not_last_admin(conn, user_id, new_role=role, new_disabled=disabled)
    sets: list[str] = []
    params: list = []
    if role is not None:
        sets.append("role = ?")
        params.append(role)
    if display_name is not None:
        sets.append("display_name = ?")
        params.append(display_name)
    if disabled is not None:
        sets.append("disabled = ?")
        params.append(1 if disabled else 0)
    if sets:
        sets.append("updated_at = ?")
        params.append(_now())
        params.append(int(user_id))
        conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
        if disabled:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (int(user_id),))
        conn.commit()
    return public_user(get_user(conn, int(user_id)))


def count_enabled_admins(conn: sqlite3.Connection, *, exclude_id: int | None = None) -> int:
    """统计「启用的管理员」数量（可排除某用户），用于防锁死。"""
    sql = "SELECT COUNT(*) FROM users WHERE role = ? AND disabled = 0"
    params: list = [ROLE_ADMIN]
    if exclude_id is not None:
        sql += " AND id <> ?"
        params.append(int(exclude_id))
    return int(conn.execute(sql, params).fetchone()[0])


def ensure_not_last_admin(conn: sqlite3.Connection, user_id: int, *, new_role: str | None = None,
                          new_disabled: bool | None = None) -> None:
    """若本次变更会使**最后一个启用的管理员**消失，则抛 :class:`AuthError`。"""
    row = get_user(conn, user_id)
    if row is None:
        return
    currently_admin = row["role"] == ROLE_ADMIN and not row["disabled"]
    if not currently_admin:
        return
    next_role = new_role if new_role is not None else row["role"]
    next_disabled = new_disabled if new_disabled is not None else bool(row["disabled"])
    will_be_admin = next_role == ROLE_ADMIN and not next_disabled
    if not will_be_admin and count_enabled_admins(conn, exclude_id=user_id) == 0:
        raise AuthError("不能移除最后一个启用的管理员（请先另建一名管理员）")


def users_exist() -> bool:
    """鉴权库中是否存在**任一**用户（含已禁用；库不存在 / 读失败 → False）。

    注意：用「存在任一用户」而非「存在启用用户」作为开关，避免把最后一个用户禁用后
    系统自动退化为「单机全权」（那会是安全漏洞）。若所有用户都被禁用导致无法登录，
    用 CLI ``user enable`` 恢复。
    """
    path = auth_db_path()
    if not Path(path).is_file():
        return False
    try:
        conn = connect_auth()
    except sqlite3.Error:
        return False
    try:
        return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def _short_reason(exc: sqlite3.Error) -> str:
    """把底层 sqlite 错误归类成**不泄漏内部细节**的简短原因（供运维提示）。"""
    low = str(exc).lower()
    if "not a database" in low or "encrypted" in low or "malformed" in low:
        return "文件不是有效的数据库（可能已损坏）"
    if "unable to open" in low or "readonly" in low or "permission" in low:
        return "无法打开文件（权限不足或路径不可用）"
    if "no such table" in low:
        return "缺少必要的数据表"
    return "读取失败"


def _auth_store_probe() -> tuple[str, str]:
    """探测鉴权库可用性，返回 ``(status, detail)``。

    * ``('ok', '')``        —— 可正常查询；
    * ``('missing', 说明)`` —— 库文件不存在 / 尚无 ``users`` 表（全新部署，待初始化）；
    * ``('error', 说明)``   —— 库存在但读取失败（损坏 / 权限不足）；说明为**简短**原因。

    这是 F1 修复的关键：把「没有用户」拆成「待初始化」与「读取失败」两种状态，线上版据此
    fail-closed 并给出**可执行**指引（去建号 / 去修库），而不是静默放行。
    """
    path = Path(auth_db_path())
    if not path.is_file():
        return "missing", "鉴权库不存在（尚未初始化）"
    try:
        conn = connect_auth()
    except sqlite3.Error as exc:  # pragma: no cover - 罕见：连不上（权限等）
        _log.warning("鉴权库无法打开：%s", exc)
        return "error", _short_reason(exc)
    try:
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if "users" not in tables:
            return "missing", "鉴权库中尚无 users 表（尚未初始化）"
        conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        return "ok", ""
    except sqlite3.Error as exc:
        _log.warning("鉴权库读取失败：%s", exc)
        return "error", _short_reason(exc)
    finally:
        conn.close()


def auth_store_status() -> str:
    """鉴权库可用状态：``'ok'`` / ``'missing'`` / ``'error'``（详见 :func:`_auth_store_probe`）。"""
    return _auth_store_probe()[0]


def auth_store_error_detail() -> str:
    """鉴权库不可用时的**简短**原因（用于给运维的可执行提示）；可用时返回空串。"""
    return _auth_store_probe()[1]


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #
def create_session(conn: sqlite3.Connection, user_id: int, *, ttl: int | None = None,
                   user_agent: str | None = None) -> dict:
    """为用户创建会话，返回 ``{token, expires_at}``。"""
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    now = _now()
    expires = _expires_at(ttl if ttl is not None else session_ttl_seconds())
    conn.execute("INSERT INTO sessions(token, user_id, created_at, expires_at,"
                 " last_seen_at, user_agent) VALUES (?,?,?,?,?,?)",
                 (token, int(user_id), now, expires, now, user_agent))
    conn.commit()
    return {"token": token, "expires_at": expires}


def delete_session(conn: sqlite3.Connection, token: str) -> bool:
    """删除会话（登出）；返回是否删除了记录。"""
    cur = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    return cur.rowcount > 0


def purge_expired_sessions(conn: sqlite3.Connection) -> int:
    """清理已过期会话，返回删除条数。"""
    now = _now()
    cur = conn.execute("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= ?",
                       (now,))
    conn.commit()
    return cur.rowcount


def authenticate(conn: sqlite3.Connection, token: str) -> dict | None:
    """用会话 token 解析用户：过期则删除并返回 ``None``；用户被禁用同样返回 ``None``。"""
    if not token:
        return None
    row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    if row is None:
        return None
    if _is_expired(row["expires_at"]):
        delete_session(conn, token)
        return None
    user = get_user(conn, row["user_id"])
    if user is None or user["disabled"]:
        delete_session(conn, token)
        return None
    conn.execute("UPDATE sessions SET last_seen_at = ? WHERE token = ?", (_now(), token))
    conn.commit()
    return public_user(user)


def login(conn: sqlite3.Connection, username: str, password: str, *,
          user_agent: str | None = None) -> dict:
    """校验凭据并创建会话，返回 ``{token, expires_at, user}``。

    安全（F5）：**账号不存在 / 密码错误 / 账号已禁用**对外一律返回**同一错误码与同一文案**
    （:class:`InvalidCredentials`），且都执行一次等价的 pbkdf2 派生，避免通过错误码或响应
    时间枚举用户名。禁用状态仅对管理员在用户列表中可见。
    """
    row = get_user_by_username(conn, username)
    if row is None:
        # 用户不存在：也跑一次等价派生，抹平时序差（否则会被时序侧信道枚举用户名）。
        _dummy_password_check(password)
        raise InvalidCredentials(CREDENTIALS_ERROR_MESSAGE)
    # 无论密码对错、账号是否禁用，都执行一次**真实校验**（常量时间 + 等价工作量），再统一拒绝。
    # 注意：**禁用账号与凭据错误返回同一错误码与文案**（``40103``）——未认证的请求方不应能
    # 区分「账号不存在 / 密码错 / 账号被禁用」（否则可枚举有效账号、探测账号状态）。
    # 管理员的用户列表里可以看到禁用状态；**切勿**为「已禁用」单独 ``raise`` 另一个异常或错误码。
    ok = verify_password(password, row["password_hash"], row["password_salt"],
                         row["iterations"])
    if row["disabled"] or not ok:
        raise InvalidCredentials(CREDENTIALS_ERROR_MESSAGE)
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), row["id"]))
    conn.commit()
    session = create_session(conn, row["id"], user_agent=user_agent)
    return {"token": session["token"], "expires_at": session["expires_at"],
            "user": public_user(get_user(conn, row["id"]))}


# --------------------------------------------------------------------------- #
# 权限判定（声明式表）
# --------------------------------------------------------------------------- #
def required_permission(method: str, path: str) -> str:
    """返回访问 ``method path`` 所需的最小权限。

    规则（**唯一事实来源**，新增端点时必须在此显式归类）：
    1. ``/api/auth/users*`` → ``admin``（用户管理）；
    2. ``/api/settings`` 的**写方法** → ``admin``（系统设置；与前端 ``settings.edit`` 对齐，F4）；
    3. ``GET/HEAD/OPTIONS`` → ``read``；
    4. ``POST`` 且命中「写方法但语义为读」白名单（预览 / 导出 / 登出）→ ``read``；
    5. 其余 → ``write``。
    """
    if _ADMIN_PATH_RE.match(path):
        return PERM_ADMIN
    verb = (method or "").upper()
    is_read = verb in ("GET", "HEAD", "OPTIONS")
    if not is_read and _SETTINGS_PATH_RE.match(path):
        return PERM_ADMIN
    if is_read:
        return PERM_READ
    if verb == "POST" and any(r.match(path) for r in _READ_POST_RES):
        return PERM_READ
    return PERM_WRITE


def role_allows(role: str, permission: str) -> bool:
    """该角色是否具备某权限。"""
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


@dataclass(frozen=True)
class Identity:
    """已认证身份。"""

    id: int
    username: str
    role: str
    display_name: str | None = None
    via: str = "session"  # session / token

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "role": self.role,
                "display_name": self.display_name, "via": self.via,
                "permissions": sorted(ROLE_PERMISSIONS.get(self.role, frozenset()))}


#: 共享令牌（服务账号）身份：视为管理员。
SERVICE_IDENTITY = Identity(id=0, username="<shared-token>", role=ROLE_ADMIN,
                            display_name="共享令牌", via="token")


def bearer_token(request) -> str | None:
    """从 ``Authorization: Bearer`` 头取令牌。"""
    header = request.headers.get("authorization", "") or ""
    if header[:7].lower() == "bearer ":
        return header[7:].strip() or None
    return None


def cookie_token(request) -> str | None:
    """从 Cookie（``qb_session``）取令牌。"""
    return request.cookies.get(COOKIE_NAME)


def extract_token(request) -> str | None:
    """取请求携带的会话令牌：优先 ``Authorization: Bearer``，其次 Cookie。"""
    return bearer_token(request) or cookie_token(request)


def authenticate_request(request) -> Identity | None:
    """解析请求身份：无令牌 / 库不可用 / 会话无效一律返回 ``None``。"""
    token = extract_token(request)
    if not token:
        return None
    try:
        conn = connect_auth()
    except sqlite3.Error:
        return None
    try:
        user = authenticate(conn, token)
    finally:
        conn.close()
    if user is None:
        return None
    return Identity(id=user["id"], username=user["username"], role=user["role"],
                    display_name=user["display_name"], via="session")


def resolve_mode(*, online: bool, token: str | None) -> str:
    """解析当前鉴权模式。

    返回 ``off`` / ``token`` / ``session`` / ``token+session`` / ``uninitialized`` / ``error``。

    * 本地版（``online=False``）**恒不触碰鉴权库**，直接 ``off``（或共享令牌的 ``token``），
      保证「本地版零影响」；
    * 线上版按鉴权库状态决定：库损坏 → ``error``；库不存在 / 无 ``users`` 表 → ``uninitialized``
      （两者都由中间件 **fail-closed** 返回 503，而不是放行）；库正常再按是否有用户区分
      ``session`` / ``token+session``，或（配了共享令牌但无用户时）``token``。

    ``online`` 与 ``token`` 由调用方在 **app 构建时**捕获（保证测试中环境变量回退后行为稳定），
    鉴权库状态与用户存在性则**每次请求动态查询**（建号后无需重启即可生效）。
    """
    if not online:
        return "token" if token else "off"
    status = auth_store_status()
    if status == "error":
        return "error"
    if status == "missing":
        # 尚未初始化：若配置了共享令牌，令牌模式仍可用（令牌本身即凭据）；否则需先建号。
        return "token" if token else "uninitialized"
    has_users = users_exist()
    if token:
        return "token+session" if has_users else "token"
    return "session" if has_users else "uninitialized"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _read_password(password_env: str | None = None) -> str:
    """获取密码：``--password-env`` → ``QB_AUTH_PASSWORD`` / ``QB_ADMIN_PASSWORD`` → 交互式。"""
    for env_name in (password_env, "QB_AUTH_PASSWORD", "QB_ADMIN_PASSWORD"):
        if env_name:
            value = os.environ.get(env_name, "")
            if value:
                return value
    import getpass
    first = getpass.getpass("请输入密码：")
    if not first:
        raise PasswordInvalid("密码不能为空")
    second = getpass.getpass("请再次输入密码：")
    if first != second:
        raise PasswordInvalid("两次输入的密码不一致")
    return first


def _open_for_write() -> sqlite3.Connection:
    return connect_auth(create=True)


def cmd_user_add(args: argparse.Namespace) -> int:
    """新增用户。"""
    password = _read_password(args.password_env)
    conn = _open_for_write()
    try:
        user = create_user(conn, args.username, password, role=args.role,
                           display_name=args.display_name)
    finally:
        conn.close()
    print(f"已创建用户：{user['username']}（角色 {user['role']}，显示名 {user['display_name']}）")
    print(f"鉴权库：{auth_db_path()}")
    return 0


def cmd_user_list(_args: argparse.Namespace) -> int:
    """列出用户。"""
    if not Path(auth_db_path()).is_file():
        print(f"鉴权库不存在：{auth_db_path()}（尚未创建任何用户）")
        return 0
    conn = connect_auth()
    try:
        users = list_users(conn)
    finally:
        conn.close()
    if not users:
        print("暂无用户。")
        return 0
    print(f"{'id':>4}  {'用户名':<16} {'角色':<8} {'状态':<6} {'显示名':<12} 最近登录")
    for u in users:
        state = "已禁用" if u["disabled"] else "启用"
        print(f"{u['id']:>4}  {u['username']:<16} {u['role']:<8} {state:<6}"
              f" {str(u['display_name'] or ''):<12} {u['last_login_at'] or '-'}")
    return 0


def cmd_user_set_password(args: argparse.Namespace) -> int:
    """重设密码。"""
    password = _read_password(args.password_env)
    conn = _open_for_write()
    try:
        row = get_user_by_username(conn, args.username)
        if row is None:
            raise UserNotFoundError(f"用户不存在：{args.username}")
        set_password(conn, row["id"], password)
    finally:
        conn.close()
    print(f"已重设密码：{args.username}（该用户既有会话已吊销）")
    return 0


def cmd_user_set_role(args: argparse.Namespace) -> int:
    """修改角色。"""
    conn = _open_for_write()
    try:
        row = get_user_by_username(conn, args.username)
        if row is None:
            raise UserNotFoundError(f"用户不存在：{args.username}")
        user = update_user(conn, row["id"], role=args.role)
    finally:
        conn.close()
    print(f"已更新角色：{user['username']} → {user['role']}")
    return 0


def _cmd_user_toggle(username: str, disabled: bool) -> int:
    conn = _open_for_write()
    try:
        row = get_user_by_username(conn, username)
        if row is None:
            raise UserNotFoundError(f"用户不存在：{username}")
        user = update_user(conn, row["id"], disabled=disabled)
    finally:
        conn.close()
    print(f"已{'禁用' if disabled else '启用'}用户：{user['username']}")
    return 0


def cmd_user_disable(args: argparse.Namespace) -> int:
    """禁用用户（并吊销其会话）。"""
    return _cmd_user_toggle(args.username, True)


def cmd_user_enable(args: argparse.Namespace) -> int:
    """启用用户。"""
    return _cmd_user_toggle(args.username, False)


def build_parser() -> argparse.ArgumentParser:
    """构建 CLI 解析器。"""
    ap = argparse.ArgumentParser(prog="python -m webui.auth",
                                 description="题库用户与权限管理（账号存于独立 auth.db）")
    sub = ap.add_subparsers(dest="group", required=True)

    user = sub.add_parser("user", help="用户管理")
    usub = user.add_subparsers(dest="action", required=True)

    pa = usub.add_parser("add", help="新增用户（同名默认报错，不覆盖）")
    pa.add_argument("username", help="登录名")
    pa.add_argument("--role", choices=list(ROLES), default=ROLE_VIEWER, help="角色")
    pa.add_argument("--display-name", default=None, help="显示名")
    pa.add_argument("--password-env", default=None, help="从该环境变量读取密码")
    pa.set_defaults(func=cmd_user_add)

    pl = usub.add_parser("list", help="列出用户")
    pl.set_defaults(func=cmd_user_list)

    pp = usub.add_parser("set-password", help="重设密码")
    pp.add_argument("username")
    pp.add_argument("--password-env", default=None)
    pp.set_defaults(func=cmd_user_set_password)

    pr = usub.add_parser("set-role", help="修改角色")
    pr.add_argument("username")
    pr.add_argument("--role", required=True, choices=list(ROLES))
    pr.set_defaults(func=cmd_user_set_role)

    pd = usub.add_parser("disable", help="禁用用户")
    pd.add_argument("username")
    pd.set_defaults(func=cmd_user_disable)

    pe = usub.add_parser("enable", help="启用用户")
    pe.add_argument("username")
    pe.set_defaults(func=cmd_user_enable)
    return ap


def main(argv: list[str] | None = None) -> int:
    """CLI 入口；返回进程退出码。"""
    args = build_parser().parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        return int(args.func(args))
    except AuthError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


__all__ = [
    "DEFAULT_ITERATIONS", "SALT_BYTES", "SESSION_TOKEN_BYTES", "DEFAULT_SESSION_TTL",
    "COOKIE_NAME", "ROLES", "ROLE_VIEWER", "ROLE_EDITOR", "ROLE_ADMIN",
    "PERM_READ", "PERM_WRITE", "PERM_ADMIN", "ROLE_PERMISSIONS", "EXEMPT_PATHS",
    "CREDENTIALS_ERROR_MESSAGE",
    "AuthError", "UserExistsError", "UserNotFoundError", "InvalidCredentials",
    "AuthNotEnabled", "InvalidRole", "PasswordInvalid",
    "auth_db_path", "session_ttl_seconds", "ensure_auth_schema", "connect_auth",
    "hash_password", "verify_password",
    "public_user", "get_user_by_username", "get_user", "list_users", "create_user",
    "set_password", "update_user", "count_enabled_admins", "ensure_not_last_admin",
    "users_exist", "auth_store_status", "auth_store_error_detail",
    "create_session", "delete_session", "purge_expired_sessions", "authenticate", "login",
    "required_permission", "role_allows", "Identity", "SERVICE_IDENTITY",
    "bearer_token", "cookie_token", "extract_token", "authenticate_request", "resolve_mode",
    "build_parser", "main",
]


if __name__ == "__main__":  # pragma: no cover - CLI 入口
    raise SystemExit(main())
