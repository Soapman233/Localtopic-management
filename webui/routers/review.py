"""待复核公式队列路由。"""
# ---------------------------------------------------------------------------
# title: webui 待复核队列路由
# description: /api/review* —— 队列列表、汇总、标记已处理、源公式预览 PNG。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from .. import db
from ..errors import ok
from ..schemas import ReviewResolveRequest
from ..services import review_svc as svc

router = APIRouter(prefix="/api", tags=["review"])


@router.get("/review")
def api_list_review(resolved: bool = False, status: Optional[str] = None,
                    limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)) -> dict:
    """待复核队列列表。"""
    with db.read_conn() as conn:
        return ok(svc.list_review(conn, resolved=resolved, status=status,
                                  limit=limit, offset=offset))


@router.get("/review/summary")
def api_review_queue_summary() -> dict:
    """队列汇总（``open`` / ``resolved`` / ``by_status``）。"""
    with db.read_conn() as conn:
        return ok(svc.summary(conn))


@router.get("/review/{rq_id}/preview")
def api_review_preview(rq_id: int) -> FileResponse:
    """源公式预览图（含 WMF/EMF 转 PNG），只读题库。"""
    with db.read_conn() as conn:
        path = svc.get_preview(conn, rq_id)
    return FileResponse(str(path), media_type="image/png")


@router.post("/review/{rq_id}/resolve")
def api_resolve_review(rq_id: int, body: ReviewResolveRequest) -> dict:
    """标记复核项已处理 / 恢复。"""
    with db.write_txn() as conn:
        return ok(svc.resolve(conn, rq_id, resolved=body.resolved))


__all__ = ["router"]
