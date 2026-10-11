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

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, config
from . import db as _db
from .errors import ok, register_exception_handlers

#: 允许的本地来源（dev 时 Vite 在 5173；生产同源）。
_ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:8720", "http://localhost:8720",
]


def _health_payload() -> dict:
    """构造 ``/api/health`` 数据（DB 状态 + schema 版本 + 环境降级）。"""
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
    return {
        "ok": True,
        "db": str(db_path),
        "db_exists": exists,
        "schema_version": schema_version,
        "degraded": env["degraded"],
        "messages": env["messages"],
    }


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

    @app.get("/api/health")
    def health() -> JSONResponse:
        """健康检查：返回 DB 状态、schema 版本与环境降级说明。"""
        return JSONResponse(content=ok(_health_payload()))

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
