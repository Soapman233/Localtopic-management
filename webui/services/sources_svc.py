"""来源文件服务。

复用 ``bank.query.list_sources`` / ``source_detail`` 与 ``bank.edit.update_file_metadata``。
文件级年级/教材编辑需二次确认（未确认抛 40903，附影响题数）。
"""
# ---------------------------------------------------------------------------
# title: webui 来源文件服务
# description: 来源列表/详情/影响题数预检/文件级元数据编辑；调用 bank.query 与 bank.edit。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from bank import edit as _edit
from bank import query as _q

from .. import errors


def list_sources(conn, *, limit: int = 0) -> list[dict]:
    """列出来源文件（按题目数倒序）。"""
    return _q.list_sources(conn, limit=limit)


def detail(conn, source_id: int) -> dict:
    """来源文件详情；不存在抛 40408。"""
    d = _q.source_detail(conn, source_id)
    if d is None:
        raise errors.not_found(errors.CODE_SOURCE_NOT_FOUND, f"来源文件不存在：{source_id}")
    return d


def impact(conn, source_id: int, *, field: str) -> dict:
    """预检文件级字段编辑的影响题数（``field`` ∈ {grade, textbook}）。"""
    if field not in ("grade", "textbook"):
        raise errors.bad_request(40000, "field 必须是 grade 或 textbook")
    if conn.execute("SELECT 1 FROM source_files WHERE id = ?", (source_id,)).fetchone() is None:
        raise errors.not_found(errors.CODE_SOURCE_NOT_FOUND, f"来源文件不存在：{source_id}")
    affected = conn.execute("SELECT COUNT(*) FROM questions WHERE source_id = ?",
                            (source_id,)).fetchone()[0]
    return {"field": field, "affected_questions": affected}


def update_metadata(conn, source_id: int, patch: dict, *, confirm: bool = False) -> dict:
    """编辑文件级年级/教材（未确认抛 40903；不存在抛 40408）。"""
    if conn.execute("SELECT 1 FROM source_files WHERE id = ?", (source_id,)).fetchone() is None:
        raise errors.not_found(errors.CODE_SOURCE_NOT_FOUND, f"来源文件不存在：{source_id}")
    payload = {}
    if patch.get("grade") is not None:
        payload["grade"] = patch["grade"]
    if patch.get("textbook") is not None:
        payload["textbook"] = patch["textbook"]
    if not payload:
        raise errors.bad_request(40000, "未提供 grade 或 textbook")
    try:
        return _edit.update_file_metadata(conn, source_id, payload, confirm=confirm)
    except _edit.ConfirmationRequired as exc:
        raise errors.conflict(errors.CODE_NEED_CONFIRM, str(exc),
                              {"affected_questions": getattr(exc, "affected", 0)})
    except ValueError as exc:
        raise errors.map_value_error(exc)


__all__ = ["list_sources", "detail", "impact", "update_metadata"]
