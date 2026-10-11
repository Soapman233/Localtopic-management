"""待复核公式队列服务。

复用 ``bank.query.list_review``（列表）与 ``bank.review``（resolve/summary）。
复核项不存在时抛 40407。
"""
# ---------------------------------------------------------------------------
# title: webui 待复核公式队列服务
# description: 待复核队列列表/汇总/标记已处理；调用 bank.query/review/media，补题干与当前公式、提供源预览 PNG。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from bank import query as _q
from bank import review as _review
from bank import media as _media

from .. import config, errors


def list_review(conn, *, resolved: bool = False, status: str | None = None,
                limit: int = 50, offset: int = 0) -> dict:
    """待复核队列列表。"""
    data = _q.list_review(conn, resolved=resolved, status=status, limit=limit, offset=offset)
    context = _q.review_context(conn, [item["id"] for item in data["items"]])
    for item in data["items"]:
        info = context.get(item["id"], {})
        item.update(question_text=info.get("question_text"), fid=info.get("fid"),
                    latex=info.get("latex"),
                    preview_url=f'/api/review/{item["id"]}/preview' if item.get("preview") else None)
    return data


def get_preview(conn, rq_id: int):
    """源公式预览图；缺失、损坏或不支持转换时明确返回 404。"""
    source = _q.review_preview_source(conn, rq_id)
    if source is None:
        raise errors.not_found(errors.CODE_REVIEW_NOT_FOUND, f"复核项不存在：{rq_id}")
    try:
        return _media.render_review_preview(source["path"], source["preview"],
                                            config.WEBUI_DIR / "review_media")
    except ValueError as exc:
        raise errors.not_found(errors.CODE_IMAGE_NOT_FOUND, str(exc))


def summary(conn) -> dict:
    """队列汇总：``{open, resolved, total, by_status}``。"""
    return _review.summary(conn)


def resolve(conn, rq_id: int, *, resolved: bool = True) -> dict:
    """标记某复核项已处理 / 恢复；不存在抛 40407。"""
    try:
        return _review.resolve(conn, rq_id, resolved=resolved)
    except ValueError as exc:
        raise errors.not_found(errors.CODE_REVIEW_NOT_FOUND, str(exc))


__all__ = ["list_review", "summary", "resolve", "get_preview"]
