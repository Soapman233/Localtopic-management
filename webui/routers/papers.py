"""试卷路由：CRUD / 组卷 / 分值 / 大题 / 快照 / 导出数据。"""
# ---------------------------------------------------------------------------
# title: webui 试卷路由
# description: /api/papers* —— 试卷 CRUD、题目条目、分值、大题、快照刷新与导出数据。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from .. import db
from ..errors import ok
from ..schemas import (AddQuestionsRequest, MoveRequest, PaperCreate, PaperUpdate, PaperRevisionRequest,
                       ScoreRequest, ScoresRequest, SectionCreate, SectionRename)
from ..services import papers as svc

router = APIRouter(prefix="/api", tags=["papers"])


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #
@router.get("/papers")
def api_list_papers(status: Optional[str] = None, subject: Optional[str] = None) -> dict:
    """列出试卷（含题目数/总分/未设分题数）。"""
    with db.read_conn() as conn:
        return ok(svc.list_papers(conn, status=status, subject=subject))


@router.post("/papers")
def api_create_paper(body: PaperCreate) -> dict:
    """新建试卷。"""
    with db.write_txn() as conn:
        return ok(svc.create_paper(conn, body.dict()))


@router.get("/papers/{paper_id}")
def api_get_paper(paper_id: int) -> dict:
    """试卷完整信息（元数据 + 大题 + 条目 + 概览）。"""
    with db.read_conn() as conn:
        return ok(svc.get_paper(conn, paper_id))


@router.patch("/papers/{paper_id}")
def api_update_paper(paper_id: int, body: PaperUpdate) -> dict:
    """部分更新试卷元数据。"""
    with db.write_txn() as conn:
        return ok(svc.update_paper(conn, paper_id, body.dict(exclude_unset=True)))


@router.delete("/papers/{paper_id}")
def api_delete_paper(paper_id: int, force: bool = False) -> dict:
    """删除试卷（非空需 force）。"""
    with db.write_txn() as conn:
        return ok(svc.delete_paper(conn, paper_id, force=force))


# --------------------------------------------------------------------------- #
# 题目条目
# --------------------------------------------------------------------------- #
@router.post("/papers/{paper_id}/questions")
def api_add_questions(paper_id: int, body: AddQuestionsRequest) -> dict:
    """把题目加入试卷（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.add_questions(conn, paper_id, body.dict()))


@router.delete("/papers/{paper_id}/questions/{item_id}")
def api_remove_question(paper_id: int, item_id: int) -> dict:
    """移除一条题目条目（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.remove_question(conn, paper_id, item_id))


@router.post("/papers/{paper_id}/questions/{item_id}/move")
def api_move_question(paper_id: int, item_id: int, body: MoveRequest) -> dict:
    """移动题目条目（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.move_question(conn, paper_id, item_id, body.position))


@router.post("/papers/{paper_id}/questions/{item_id}/score")
def api_set_score(paper_id: int, item_id: int, body: ScoreRequest) -> dict:
    """设置某条目分值（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.set_score(conn, paper_id, item_id, body.score))


@router.post("/papers/{paper_id}/scores")
def api_set_scores(paper_id: int, body: ScoresRequest) -> dict:
    """批量设置分值。"""
    with db.write_txn() as conn:
        return ok(svc.set_scores(conn, paper_id, body.mapping))


# --------------------------------------------------------------------------- #
# 大题
# --------------------------------------------------------------------------- #
@router.post("/papers/{paper_id}/sections")
def api_add_section(paper_id: int, body: SectionCreate) -> dict:
    """新增大题（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.add_section(conn, paper_id, body.dict()))


@router.patch("/papers/{paper_id}/sections/{section_id}")
def api_rename_section(paper_id: int, section_id: int, body: SectionRename) -> dict:
    """重命名大题（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.rename_section(conn, paper_id, section_id, body.name))


@router.post("/papers/{paper_id}/sections/{section_id}/move")
def api_move_section(paper_id: int, section_id: int, body: MoveRequest) -> dict:
    """移动大题（返回整卷）。"""
    with db.write_txn() as conn:
        return ok(svc.move_section(conn, paper_id, section_id, body.position))


@router.delete("/papers/{paper_id}/sections/{section_id}")
def api_delete_section(paper_id: int, section_id: int, force: bool = False) -> dict:
    """删除大题（大题非空需 force）。"""
    with db.write_txn() as conn:
        return ok(svc.delete_section(conn, paper_id, section_id, force=force))


# --------------------------------------------------------------------------- #
# 快照 / 导出数据
# --------------------------------------------------------------------------- #
@router.post("/papers/{paper_id}/refresh-snapshots")
def api_refresh_snapshots(paper_id: int) -> dict:
    """按卷刷新快照（仅版本未变的题）。"""
    with db.write_txn() as conn:
        return ok(svc.refresh_snapshots(conn, paper_id))


@router.get("/papers/{paper_id}/export-data")
def api_export_data(paper_id: int, answer_mode: Optional[str] = Query(None), template: Optional[str] = Query(None)) -> dict:
    """产出导出数据（``build_export_payload``，只读）。"""
    with db.read_conn() as conn:
        return ok(svc.export_data(conn, paper_id, answer_mode=answer_mode, template=template))


@router.post('/papers/{paper_id}/revisions')
def api_create_revision(paper_id: int, body: PaperRevisionRequest) -> dict:
    with db.write_txn() as conn:
        return ok(svc.create_revision(conn,paper_id,body.dict(exclude_unset=True)))


__all__ = ["router"]
