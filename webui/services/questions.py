"""单题服务：详情 / 编辑保存 / 版本历史 / 媒体 / 难度标注。

复用 ``bank.query``（读）与 ``bank.edit``（写）。编辑保存经 ``bank.edit.save_question``：
留版、冲突检测、FTS 同事务同步、公式复核状态（M1）均在领域层完成。
"""
# ---------------------------------------------------------------------------
# title: webui 单题服务
# description: 单题详情/编辑/版本/媒体/难度；调用 bank.query 与 bank.edit，映射 40001/40401/40901 等错误码。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from pathlib import Path

from bank import edit as _edit
from bank import export as _export
from bank import query as _q

from .. import errors


def _require_question(conn, question_id: int) -> None:
    """题目不存在时抛 40401。"""
    if conn.execute("SELECT 1 FROM questions WHERE id = ?", (question_id,)).fetchone() is None:
        raise errors.not_found(errors.CODE_QUESTION_NOT_FOUND, f"题目不存在：{question_id}")


def get_detail(conn, question_id: int) -> dict:
    """单题完整详情（题干/公式/图片/标签三态/答案/解析/来源/版本列表）。"""
    q = _q.get_question(conn, question_id)
    if q is None:
        raise errors.not_found(errors.CODE_QUESTION_NOT_FOUND, f"题目不存在：{question_id}")
    # 补齐标签的复核状态（详情页三态：待复核/已确认/已否决）。
    q["labels"] = _q.question_labels(conn, question_id)
    return q


def save(conn, question_id: int, patch: dict, *, force: bool = False) -> dict:
    """保存编辑（留版 + 重算 + FTS 同步 + 冲突处理）。"""
    try:
        return _edit.save_question(conn, question_id, patch or {}, force=force)
    except _edit.ContentConflict as exc:
        raise errors.conflict(errors.CODE_CONTENT_CONFLICT, str(exc),
                              getattr(exc, "conflict", None))
    except ValueError as exc:
        raise errors.map_value_error(exc)


def list_versions(conn, question_id: int) -> list[dict]:
    """版本历史（只读）。"""
    _require_question(conn, question_id)
    return _edit.list_versions(conn, question_id)


def get_version(conn, question_id: int, version: int) -> dict:
    """某版本的完整快照（只读）。"""
    _require_question(conn, question_id)
    v = _edit.get_version(conn, question_id, version)
    if v is None:
        raise errors.not_found(errors.CODE_QUESTION_NOT_FOUND,
                               f"版本不存在：题目 {question_id} 的版本 {version}")
    return v


def get_media(conn, question_id: int, image_id: int) -> Path:
    """从源 DOCX 包内按 sha256 取出图片，返回本地路径（只读）。"""
    row = conn.execute(
        "SELECT source_id, media_path, sha256 FROM images WHERE id = ? AND question_id = ?",
        (image_id, question_id)).fetchone()
    if row is None:
        raise errors.not_found(errors.CODE_IMAGE_NOT_FOUND,
                               f"图片不存在：题目 {question_id} 的图片 {image_id}")
    path, reason = _export.resolve_media(conn, row["source_id"], row["media_path"], row["sha256"])
    if path is None:
        raise errors.not_found(errors.CODE_IMAGE_NOT_FOUND, f"图片缺失（{reason}）")
    return path


def set_difficulty(conn, question_id: int, level: str) -> dict:
    """设置单题难度（仅 易/中/难）。"""
    try:
        return _edit.set_difficulty(conn, question_id, level)
    except ValueError as exc:
        raise errors.map_value_error(exc)


def batch_set_difficulty(conn, ids: list, level: str) -> dict:
    """批量设置难度。"""
    try:
        return _edit.batch_set_difficulty(conn, ids, level)
    except ValueError as exc:
        raise errors.map_value_error(exc)


__all__ = [
    "get_detail", "save", "list_versions", "get_version", "get_media",
    "set_difficulty", "batch_set_difficulty",
]
