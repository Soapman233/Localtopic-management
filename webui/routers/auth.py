"""鉴权与用户管理路由：登录 / 登出 / 当前用户 / 用户管理。

* ``POST /api/auth/login``  —— 用户名+密码 → 会话 token（匿名可访问）
* ``POST /api/auth/logout`` —— 注销当前会话
* ``GET  /api/auth/me``     —— 当前用户与角色（含 ``auth_mode``）
* 用户管理（**仅 admin**，由中间件强制）：
  ``GET/POST /api/auth/users``、``PATCH /api/auth/users/{id}``、
  ``POST /api/auth/users/{id}/password``

会话传递：**优先** ``Authorization: Bearer <token>``，**同时接受** Cookie ``qb_session``。
默认仅在响应体返回 token；若设置 ``QB_AUTH_COOKIE=1``，登录会额外下发 ``HttpOnly`` Cookie
（便于切换到 Cookie 模式）。
"""
# ---------------------------------------------------------------------------
# title: webui 鉴权 / 用户管理路由
# description: 登录登出、当前用户、用户 CRUD 与改密；会话 token 走 Bearer 或 Cookie。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import auth
from ..errors import ok
from ..schemas import (LoginRequest, UserCreateRequest, UserPasswordRequest,
                       UserUpdateRequest)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_enabled() -> bool:
    """是否在登录时下发会话 Cookie（``QB_AUTH_COOKIE`` 开关）。"""
    return os.environ.get("QB_AUTH_COOKIE", "").strip().lower() in ("1", "true", "yes", "on")


def _cookie_secure() -> bool:
    """Cookie 是否带 ``Secure``（HTTPS 下应开启，``QB_COOKIE_SECURE`` 开关）。"""
    return os.environ.get("QB_COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes", "on")


def _set_session_cookie(response: JSONResponse, token: str, max_age: int) -> None:
    response.set_cookie(
        auth.COOKIE_NAME, token, max_age=max_age, httponly=True, samesite="lax",
        secure=_cookie_secure(), path="/",
    )


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #
@router.post("/login")
def api_login(body: LoginRequest, request: Request) -> JSONResponse:
    """校验凭据并创建会话，返回 token 与用户信息。"""
    if not auth.users_exist():
        # 未启用用户体系：明确报错，而不是静默成功（避免「以为登录了」）。
        raise auth.AuthNotEnabled(
            "当前未启用用户体系（鉴权库中无用户）。请先用 CLI 创建首个管理员："
            "python -m webui.auth user add <用户名> --role admin")
    conn = auth.connect_auth(create=True)
    try:
        result = auth.login(conn, body.username, body.password,
                            user_agent=request.headers.get("user-agent"))
    finally:
        conn.close()
    response = JSONResponse(content=ok(result, message="登录成功"))
    if _cookie_enabled():
        _set_session_cookie(response, result["token"], auth.session_ttl_seconds())
    return response


@router.post("/logout")
def api_logout(request: Request) -> JSONResponse:
    """注销当前会话（幂等：无有效会话也返回成功）。"""
    token = auth.extract_token(request)
    if token:
        try:
            conn = auth.connect_auth()
        except Exception:  # noqa: BLE001 - 库不可用时不阻塞登出
            conn = None
        if conn is not None:
            try:
                auth.delete_session(conn, token)
            finally:
                conn.close()
    response = JSONResponse(content=ok(None, message="已登出"))
    if _cookie_enabled():
        response.delete_cookie(auth.COOKIE_NAME, path="/")
    return response


@router.get("/me")
def api_me(request: Request) -> dict:
    """当前身份与鉴权模式；未启用鉴权（``off``）时 ``user`` 为 ``null``。

    ``auth_enabled`` 是给**前端**用的布尔开关（契约字段），由 ``auth_mode`` 派生：

    * ``off``（本地版 / 无用户）→ ``False``：前端**透传**，不拦任何路由、不显示登录入口；
    * ``session`` / ``token+session``（存在用户体系）→ ``True``：前端需登录；
    * ``token``（**仅**共享令牌、无用户）→ ``False``：浏览器端**无法登录**（没有账号可输），
      该模式只适用于 API / 自动化。线上版请使用用户体系（见 ``editions/online/README.md``）。
    """
    identity = getattr(request.state, "identity", None)
    mode = getattr(request.state, "auth_mode", "off")
    return ok({
        "auth_mode": mode,
        "auth_enabled": mode in ("session", "token+session"),
        "user": identity.to_dict() if identity is not None else None,
        "roles": {role: sorted(perms) for role, perms in auth.ROLE_PERMISSIONS.items()},
    })


# --------------------------------------------------------------------------- #
# 用户管理（仅 admin；权限由中间件按 /api/auth/users* 强制）
# --------------------------------------------------------------------------- #
@router.get("/users")
def api_list_users() -> dict:
    """列出全部用户。"""
    conn = auth.connect_auth(create=True)
    try:
        return ok(auth.list_users(conn))
    finally:
        conn.close()


@router.post("/users")
def api_create_user(body: UserCreateRequest) -> dict:
    """新增用户（同名默认报错，不覆盖）。"""
    conn = auth.connect_auth(create=True)
    try:
        return ok(auth.create_user(conn, body.username, body.password, role=body.role,
                                   display_name=body.display_name))
    finally:
        conn.close()


@router.patch("/users/{user_id}")
def api_update_user(user_id: int, body: UserUpdateRequest) -> dict:
    """修改角色 / 禁用状态 / 显示名。"""
    conn = auth.connect_auth(create=True)
    try:
        return ok(auth.update_user(conn, user_id, role=body.role, disabled=body.disabled,
                                   display_name=body.display_name))
    finally:
        conn.close()


@router.post("/users/{user_id}/password")
def api_set_user_password(user_id: int, body: UserPasswordRequest) -> dict:
    """重设某用户密码（同时吊销其既有会话）。"""
    conn = auth.connect_auth(create=True)
    try:
        return ok(auth.set_password(conn, user_id, body.password))
    finally:
        conn.close()


__all__ = ["router"]
