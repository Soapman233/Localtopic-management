"""FastAPI 应用工厂：挂载路由、异常处理器、静态资源与 ``/api/health``。

静态托管
--------
前端 ``npm run build`` 产物输出到 ``webui/static``；若该目录存在 ``index.html``，
则挂载 ``StaticFiles(html=True)`` 到 ``/``（生产：浏览器只访问一个端口）。
SPA 采用 ``HashRouter``，故无需服务端 history fallback。
"""
# ---------------------------------------------------------------------------
# title: webui FastAPI 应用工厂
# description: 创建 FastAPI 应用，注册异常处理器、可选路由与静态资源，暴露 /api/health。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import hmac
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, auth, config, edition
from . import db as _db
from .errors import (CODE_AUTH_STORE_ERROR, CODE_AUTH_UNINITIALIZED, CODE_FORBIDDEN,
                     CODE_UNAUTHORIZED_SESSION, CODE_UNAUTHORIZED_TOKEN,
                     error_body, ok, register_exception_handlers)

#: 模块日志器（鉴权不可用等运维信息写进服务端日志）。
_log = logging.getLogger("webui.app")

#: 允许的本地来源（dev 时 Vite 在 5173；生产同源）。
_ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:8720", "http://localhost:8720",
]


def _health_payload(*, include_db_path: bool) -> dict:
    """构造 ``/api/health`` 数据（DB 状态 + schema 版本 + 环境降级）。

    ``include_db_path=False``（线上版）时**不**回显 DB 绝对路径：health 豁免鉴权，
    未认证客户端不得拿到服务器文件系统布局（路径只进服务端日志，安全审计 F6 同类）。
    """
    db_path = config.get_db_path()
    exists = db_path.is_file()
    schema_version = None
    if exists:
        try:
            from bank import db as bank_db  # noqa: WPS433 - 延迟导入
            conn = bank_db.connect_readonly(db_path)
            try:
                schema_version = bank_db.schema_version(conn)
            finally:
                conn.close()
        except Exception:  # noqa: BLE001 - 健康检查不应因库损坏而 500
            schema_version = None
    env = config.environment_report()
    payload = {
        "ok": True,
        "db_exists": exists,
        "schema_version": schema_version,
        "degraded": env["degraded"],
        "messages": env["messages"],
    }
    # 本地版仅回环、单机使用：保留绝对路径便于排障——前端可视化「写路径安全闸门」
    # （interactions.mjs）也依赖它区分「副本库 vs 真实 bank.db」。
    if include_db_path:
        payload["db"] = str(db_path)
    return payload


def _auth_unavailable_response(mode: str) -> JSONResponse:
    """线上版鉴权不可用时的 **503** 响应（fail-closed，安全审计 F1/F2）。

    * ``uninitialized`` —— 尚未建号：给出**可执行**指引（去建首个管理员）；
    * ``error``         —— 库损坏 / 权限不足：提示运维检查库文件。

    用 503 而非 401：这不是「你没登录」，而是「服务没配好」。

    ⚠️ 客户端可见的 message **不得包含任何服务器路径**（含 ``error`` 模式）：未认证客户端
    不应拿到文件系统布局。**完整路径与原因只写服务端日志**，供运维定位（F6）。
    """
    if mode == "uninitialized":
        return JSONResponse(status_code=503, content=error_body(
            CODE_AUTH_UNINITIALIZED,
            "鉴权未初始化：请先在服务器上运行 "
            "`python -m webui.auth user add <用户名> --role admin` 创建管理员。"))
    # 细节（含**完整路径**）只进服务端日志；客户端只拿到不含路径的可执行指引。
    _log.error("鉴权数据库不可用（%s）：%s", auth.auth_store_error_detail(),
               auth.auth_db_path())
    return JSONResponse(status_code=503, content=error_body(
        CODE_AUTH_STORE_ERROR,
        "鉴权数据库不可用（可能已损坏或权限不足）：请联系管理员检查鉴权库文件。"
        "详细原因已记录在服务端日志。"))


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用。"""
    app = FastAPI(title="题库 Web 界面", version=__version__,
                  description="初中物理题库的本地单机 Web 界面（复用 bank/ 领域层）")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    # ------------------------------------------------------------------ #
    # 鉴权中间件（**默认关闭**：本地版 → 单机全权，无需任何凭据）
    # ------------------------------------------------------------------ #
    # 设计（详见 webui/auth.py）：
    #   * ``online`` 与共享令牌在 **app 构建时**捕获 → 行为稳定（环境变量回退后不变）；
    #   * 鉴权库状态与「是否存在用户」**每次请求动态查询** → 建号后无需重启即生效；
    #   * 模式：off（单机全权）/ token（共享令牌，历史行为）/ session（用户会话）
    #           / token+session（用户体系优先，共享令牌退化为服务账号）
    #           / uninitialized（线上版未建号）/ error（线上版库损坏）——后两者 **fail-closed**。
    #   * 权限在**服务端**强制（不依赖前端隐藏按钮），未授权返回统一错误信封。
    _online = edition.is_online()
    _shared_token = edition.auth_token()

    @app.middleware("http")
    async def _auth_guard(request, call_next):  # noqa: ANN001
        path = request.url.path
        # 非 /api/* 与 CORS 预检（OPTIONS）一律放行。
        if not path.startswith("/api/") or request.method == "OPTIONS":
            return await call_next(request)
        # 免鉴权路径：不强制认证。
        #   * ``/api/auth/me`` 仍**尽力**解析模式与身份，供前端区分「已登录 / 未登录 /
        #     未启用 / 待初始化」——它只回显身份与模式，不泄露其它数据（F3）；
        #   * 其余（health / login / logout）保持零鉴权库访问（与历史一致）。
        if path in auth.EXEMPT_PATHS:
            if path == "/api/auth/me":
                mode = auth.resolve_mode(online=_online, token=_shared_token)
                request.state.auth_mode = mode
                if mode in ("session", "token+session"):
                    identity = auth.authenticate_request(request)
                    if identity is not None:
                        request.state.identity = identity
            return await call_next(request)
        mode = auth.resolve_mode(online=_online, token=_shared_token)
        request.state.auth_mode = mode
        # 线上版鉴权不可用（未初始化 / 库损坏）：**fail-closed**，返回 503 而非放行（F1/F2）。
        if mode in ("uninitialized", "error"):
            return _auth_unavailable_response(mode)
        if mode == "off":
            return await call_next(request)
        # 共享令牌（服务账号）：携带正确令牌即放行，视为管理员（供自动化脚本）。
        # 用常量时间比较，防时序侧信道（安全审计 F7）；比较字节以容忍非 ASCII 头。
        provided = auth.bearer_token(request)
        if (_shared_token and provided is not None
                and hmac.compare_digest(provided.encode("utf-8"),
                                        _shared_token.encode("utf-8"))):
            request.state.identity = auth.SERVICE_IDENTITY
            return await call_next(request)
        if mode in ("session", "token+session"):
            identity = auth.authenticate_request(request)
            if identity is None:
                return JSONResponse(
                    status_code=401,
                    content=error_body(CODE_UNAUTHORIZED_SESSION,
                                       "未授权：会话缺失或已过期，请重新登录"))
            permission = auth.required_permission(request.method, path)
            if not auth.role_allows(identity.role, permission):
                return JSONResponse(
                    status_code=403,
                    content=error_body(
                        CODE_FORBIDDEN,
                        f"权限不足：{identity.role} 角色无权执行该操作（需要 {permission} 权限）"))
            request.state.identity = identity
            return await call_next(request)
        # 纯共享令牌模式：缺令牌 / 令牌错误 → 401（保持历史行为）。
        return JSONResponse(
            status_code=401,
            content=error_body(CODE_UNAUTHORIZED_TOKEN, "未授权：缺少或错误的访问令牌"))

    @app.get("/api/health")
    def health() -> JSONResponse:
        """健康检查：返回 DB 状态、schema 版本、版本信息与环境降级说明。

        线上版**不回显** DB 绝对路径（未认证客户端不应拿到文件系统布局）。
        """
        payload = _health_payload(include_db_path=not _online)
        payload["edition"] = edition.current_edition()
        return JSONResponse(content=ok(payload))

    # 挂载各域路由（T03 提供 47 个端点）。
    from .routers import ROUTERS  # noqa: WPS433
    for router in ROUTERS:
        app.include_router(router)

    # 静态资源（前端构建产物）；仅在已构建时挂载。
    static_dir = Path(config.STATIC_DIR)
    if (static_dir / "index.html").is_file():
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app


#: 模块级应用实例（供 ``uvicorn webui.app:app`` 与 ``python -m webui`` 使用）。
app = create_app()


__all__ = ["create_app", "app"]
