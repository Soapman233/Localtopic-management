"""统计路由：``/api/stats``、``/api/meta/coverage``。"""
# ---------------------------------------------------------------------------
# title: webui 统计路由
# description: GET /api/stats 与 /api/meta/coverage；调用 webui.services.stats_svc。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..errors import ok
from ..services import stats_svc as svc

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/meta/coverage")
def api_meta_coverage() -> dict:
    """覆盖率（P0-13 数据状态可见性）。"""
    with db.read_conn() as conn:
        return ok(svc.coverage(conn))


@router.get("/stats")
def api_stats() -> dict:
    """题库统计总览。"""
    with db.read_conn() as conn:
        return ok(svc.stats(conn))


__all__ = ["router"]
