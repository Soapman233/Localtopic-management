"""检索路由：``/api/search``、``/api/search/facets``。"""
# ---------------------------------------------------------------------------
# title: webui 检索路由
# description: GET /api/search（含 *_missing「待补充」桶筛选）与 /api/search/facets；调用 webui.services.search。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from .. import db
from ..errors import ok
from ..services import search as svc

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def api_search(
    keyword: Optional[str] = None, stage: Optional[str] = None, subject: Optional[str] = None,
    grade: Optional[str] = None, textbook: Optional[str] = None, chapter: Optional[str] = None,
    qtype: Optional[str] = None, difficulty: Optional[str] = None, section: Optional[str] = None,
    has_answer: Optional[bool] = None, has_analysis: Optional[bool] = None,
    needs_review: Optional[bool] = None,
    grade_missing: Optional[bool] = None, textbook_missing: Optional[bool] = None,
    chapter_missing: Optional[bool] = None, qtype_missing: Optional[bool] = None,
    difficulty_missing: Optional[bool] = None, kp_confirmed_only: bool = False,
    limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0),
) -> dict:
    """检索题目（关键词 + 多维筛选 + 「待补充」桶筛选）。

    5 个 ``*_missing`` 布尔参数（``grade_missing`` / ``textbook_missing`` /
    ``chapter_missing`` / ``qtype_missing`` / ``difficulty_missing``）：取 ``true`` 时命中
    该维度**缺失元数据**（``NULL`` / 空串 / 哨兵值）的题；``false`` / 缺省表示**不过滤**，
    多个维度可 AND 叠加。
    """
    with db.read_conn() as conn:
        data = svc.search(conn, keyword=keyword, stage=stage, subject=subject, grade=grade,
                          textbook=textbook, chapter=chapter, qtype=qtype, difficulty=difficulty,
                          section=section, has_answer=has_answer, has_analysis=has_analysis,
                          needs_review=needs_review, grade_missing=grade_missing,
                          textbook_missing=textbook_missing, chapter_missing=chapter_missing,
                          qtype_missing=qtype_missing, difficulty_missing=difficulty_missing,
                          kp_confirmed_only=kp_confirmed_only, limit=limit, offset=offset)
    return ok(data)


@router.get("/search/facets")
def api_search_facets(
    keyword: Optional[str] = None, stage: Optional[str] = None, subject: Optional[str] = None,
    grade: Optional[str] = None, textbook: Optional[str] = None, chapter: Optional[str] = None,
    qtype: Optional[str] = None, difficulty: Optional[str] = None, section: Optional[str] = None,
    has_answer: Optional[bool] = None, has_analysis: Optional[bool] = None,
    needs_review: Optional[bool] = None, kp_confirmed_only: bool = False,
) -> dict:
    """筛选栏计数（各维度 + 待补充桶）+ 覆盖率。"""
    with db.read_conn() as conn:
        data = svc.facets(conn, keyword=keyword, stage=stage, subject=subject, grade=grade,
                          textbook=textbook, chapter=chapter, qtype=qtype, difficulty=difficulty,
                          section=section, has_answer=has_answer, has_analysis=has_analysis,
                          needs_review=needs_review, kp_confirmed_only=kp_confirmed_only)
    return ok(data)


__all__ = ["router"]
