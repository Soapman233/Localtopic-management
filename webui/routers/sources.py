"""来源文件路由。"""
# ---------------------------------------------------------------------------
# title: webui 来源文件路由
# description: /api/sources* —— 列表、详情、影响题数预检、文件级元数据编辑。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import db
from ..errors import ok
from ..schemas import SourceMetadataRequest
from ..services import sources_svc as svc

router = APIRouter(prefix="/api", tags=["sources"])


@router.get("/sources")
def api_list_sources(limit: int = Query(0, ge=0)) -> dict:
    """列出来源文件。"""
    with db.read_conn() as conn:
        return ok(svc.list_sources(conn, limit=limit))


@router.get("/sources/{source_id}")
def api_source_detail(source_id: int) -> dict:
    """来源文件详情（含覆盖率与题目预览）。"""
    with db.read_conn() as conn:
        return ok(svc.detail(conn, source_id))


@router.get("/sources/{source_id}/impact")
def api_source_impact(source_id: int, field: str = Query("grade")) -> dict:
    """预检文件级字段编辑的影响题数。"""
    with db.read_conn() as conn:
        return ok(svc.impact(conn, source_id, field=field))


@router.post("/sources/{source_id}/metadata")
def api_source_metadata(source_id: int, body: SourceMetadataRequest) -> dict:
    """编辑文件级年级/教材（需 ``confirm=true``）。"""
    with db.write_txn() as conn:
        return ok(svc.update_metadata(conn, source_id, body.dict(), confirm=body.confirm))


__all__ = ["router"]
