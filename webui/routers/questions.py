"""单题路由：详情 / 编辑 / 版本 / 媒体 / 难度。"""
# ---------------------------------------------------------------------------
# title: webui 单题路由
# description: /api/questions* —— 详情、编辑保存、版本历史、媒体、难度标注。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import mimetypes

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .. import db
from ..errors import ok
from ..schemas import (BatchDifficultyRequest, DifficultyRequest, QuestionUpdateRequest)
from ..services import questions as svc

router = APIRouter(prefix="/api", tags=["questions"])


@router.get("/questions/{question_id}")
def api_question_detail(question_id: int) -> dict:
    """单题详情（含标签三态、版本列表）。"""
    with db.read_conn() as conn:
        return ok(svc.get_detail(conn, question_id))


@router.put("/questions/{question_id}")
def api_question_update(question_id: int, body: QuestionUpdateRequest) -> dict:
    """保存题目编辑（留版 + 冲突处理）。"""
    patch = body.patch.dict(exclude_unset=True)
    # formulas 需转成纯 dict 列表（bank.edit 期望 [{fid, latex}]）。
    if patch.get("formulas") is not None:
        patch["formulas"] = [f.dict() if hasattr(f, "dict") else dict(f)
                             for f in patch["formulas"]]
    with db.write_txn() as conn:
        return ok(svc.save(conn, question_id, patch, force=body.force))


@router.get("/questions/{question_id}/versions")
def api_question_versions(question_id: int) -> dict:
    """版本历史（只读）。"""
    with db.read_conn() as conn:
        return ok(svc.list_versions(conn, question_id))


@router.get("/questions/{question_id}/versions/{version}")
def api_question_version(question_id: int, version: int) -> dict:
    """某版本完整快照（只读）。"""
    with db.read_conn() as conn:
        return ok(svc.get_version(conn, question_id, version))


@router.get("/questions/{question_id}/media/{image_id}")
def api_question_media(question_id: int, image_id: int) -> FileResponse:
    """题目图片二进制（从源 DOCX 包内按 sha256 取出）。"""
    with db.read_conn() as conn:
        path = svc.get_media(conn, question_id, image_id)
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(str(path), media_type=media_type)


@router.post("/questions/difficulty/batch")
def api_question_difficulty_batch(body: BatchDifficultyRequest) -> dict:
    """批量设置难度。"""
    with db.write_txn() as conn:
        return ok(svc.batch_set_difficulty(conn, body.ids, body.level))


@router.post("/questions/{question_id}/difficulty")
def api_question_difficulty(question_id: int, body: DifficultyRequest) -> dict:
    """设置单题难度（仅 易/中/难）。"""
    with db.write_txn() as conn:
        return ok(svc.set_difficulty(conn, question_id, body.level))


__all__ = ["router"]
