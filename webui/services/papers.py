"""试卷服务：CRUD / 组卷 / 分值 / 大题 / 快照刷新 / 导出数据准备。

复用 ``bank.paper`` 的既有函数；仅 PATCH 更新（``update_paper``）因 ``bank.paper``
未提供而对 ``papers`` 表做受控字段更新（模板/答案模式/状态取值校验）。
"""
# ---------------------------------------------------------------------------
# title: webui 试卷服务
# description: 试卷 CRUD、组卷、分值、大题、快照刷新与导出数据；调用 bank.paper/media；详情附 stale 标志，导出数据补快照匹配图片直链及尺寸。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import time

from bank import paper as _paper
from bank import media as _media

from .. import errors


def _now() -> str:
    """当前时间（ISO 8601，秒精度，与 bank 一致）。"""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def require_paper(conn, paper_id: int) -> None:
    """试卷不存在时抛 40402。"""
    if conn.execute("SELECT 1 FROM papers WHERE id = ?", (paper_id,)).fetchone() is None:
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷不存在：{paper_id}")


def get_paper_row(conn, paper_id: int):
    """取试卷原始行（``sqlite3.Row``），不存在返回 ``None``。"""
    return conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #
def list_papers(conn, *, status: str | None = None, subject: str | None = None) -> list[dict]:
    """列出试卷（含题目数、大题数、总分、未设分题数）。"""
    return _paper.list_papers(conn, status=status, subject=subject)


def create_paper(conn, body: dict) -> dict:
    """新建试卷。"""
    title = body.get("title")
    if not title or not str(title).strip():
        raise errors.bad_request(40000, "试卷标题不能为空")
    try:
        return _paper.create_paper(
            conn, title, subject=body.get("subject"), stage=body.get("stage"),
            grade=body.get("grade"),
            template=body.get("template") or _paper.DEFAULT_TEMPLATE,
            answer_mode=body.get("answer_mode") or _paper.DEFAULT_ANSWER_MODE,
            status=body.get("status") or _paper.DEFAULT_STATUS,
            meta=body.get("meta"))
    except ValueError as exc:
        raise errors.map_value_error(exc)


def get_paper(conn, paper_id: int) -> dict:
    """试卷完整信息（元数据 + 大题 + 条目 + 概览）。

    每条 item 附带 ``stale``（布尔）：该题**当前 version ≠ 快照锁定的 question_version**
    时为 ``True``，表示题库已更新、快照落后（前端据此点亮「题库已更新」提示，B3）。
    """
    p = _paper.get_paper(conn, paper_id)
    if p is None:
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷不存在：{paper_id}")
    _mark_stale(conn, p)
    return p


def _mark_stale(conn, paper: dict) -> None:
    """为试卷的每个 item 计算 ``stale``（当前 version ≠ 快照 question_version）。

    一次性批量取当前版本（单条 ``IN`` 查询），避免逐条查询；题目已不存在时视为 ``stale``。
    """
    items = paper.get("items") or []
    qids = [it["question_id"] for it in items if it.get("question_id") is not None]
    current: dict[int, int] = {}
    if qids:
        placeholders = ", ".join("?" for _ in qids)
        for r in conn.execute(
                f"SELECT id, version FROM questions WHERE id IN ({placeholders})", qids):
            current[int(r["id"])] = int(r["version"])
    for it in items:
        snap_v = it.get("question_version")
        cur_v = current.get(it.get("question_id"))
        it["stale"] = bool(
            snap_v is None or cur_v is None or int(cur_v) != int(snap_v))


def update_paper(conn, paper_id: int, patch: dict) -> dict:
    """部分更新试卷元数据（标题/模板/答案模式/状态/学科/学段/年级）。"""
    require_paper(conn, paper_id)
    sets: list[str] = []
    vals: list = []

    if patch.get("title") is not None:
        title = str(patch["title"]).strip()
        if not title:
            raise errors.bad_request(40000, "试卷标题不能为空")
        sets.append("title = ?")
        vals.append(title)
    if patch.get("template") is not None:
        if patch["template"] not in _paper.TEMPLATES:
            raise errors.bad_request(errors.CODE_INVALID_TEMPLATE,
                                     f"template 取值必须是 {_paper.TEMPLATES}")
        sets.append("template = ?")
        vals.append(patch["template"])
    if patch.get("answer_mode") is not None:
        if patch["answer_mode"] not in _paper.ANSWER_MODES:
            raise errors.bad_request(errors.CODE_INVALID_TEMPLATE,
                                     f"answer_mode 取值必须是 {_paper.ANSWER_MODES}")
        sets.append("answer_mode = ?")
        vals.append(patch["answer_mode"])
    if patch.get("status") is not None:
        if patch["status"] not in _paper.PAPER_STATUSES:
            raise errors.bad_request(errors.CODE_INVALID_TEMPLATE,
                                     f"status 取值必须是 {_paper.PAPER_STATUSES}")
        sets.append("status = ?")
        vals.append(patch["status"])
    for field in ("subject", "stage", "grade"):
        if field in patch and patch[field] is not None:
            sets.append(f"{field} = ?")
            vals.append(patch[field])

    if not sets:
        return get_paper(conn, paper_id)
    sets.append("updated_at = ?")
    vals.append(_now())
    vals.append(paper_id)
    conn.execute(f"UPDATE papers SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    return get_paper(conn, paper_id)


def delete_paper(conn, paper_id: int, *, force: bool = False) -> dict:
    """删除试卷；非空且未 ``force`` 时抛 40902。"""
    require_paper(conn, paper_id)
    res = _paper.delete_paper(conn, paper_id, force=force)
    if not res.get("deleted"):
        raise errors.conflict(errors.CODE_NEED_FORCE,
                              res.get("reason") or "试卷非空，需 force=true 确认")
    return {"deleted": True, "paper_id": paper_id,
            "removed_items": res.get("removed_items", 0)}


# --------------------------------------------------------------------------- #
# 题目条目
# --------------------------------------------------------------------------- #
def add_questions(conn, paper_id: int, body: dict) -> dict:
    """把题目加入试卷（返回整卷）。"""
    require_paper(conn, paper_id)
    raw_ids = body.get("question_ids") or []
    try:
        ids = [int(x) for x in raw_ids]
    except (TypeError, ValueError):
        raise errors.bad_request(40000, "question_ids 必须是整数列表")
    if not ids:
        raise errors.bad_request(40000, "question_ids 不能为空")
    missing = [q for q in ids
               if conn.execute("SELECT 1 FROM questions WHERE id = ?", (q,)).fetchone() is None]
    if missing:
        raise errors.not_found(errors.CODE_ITEM_NOT_FOUND, f"题目不存在：{missing}",
                               {"missing": missing})
    try:
        _paper.add_questions(
            conn, paper_id, ids, section_id=body.get("section_id"),
            section=body.get("section"), position=body.get("position"),
            score=body.get("score"), keep_material_together=bool(body.get("group")))
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return get_paper(conn, paper_id)


def remove_question(conn, paper_id: int, item_id: int) -> dict:
    """移除一条题目条目（返回整卷）。"""
    require_paper(conn, paper_id)
    res = _paper.remove_question(conn, paper_id, item_id)
    if not res.get("removed"):
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷条目不存在：{item_id}")
    return get_paper(conn, paper_id)


def move_question(conn, paper_id: int, item_id: int, position: int) -> dict:
    """移动一条题目条目到指定题序（返回整卷）。"""
    require_paper(conn, paper_id)
    res = _paper.move_question(conn, paper_id, item_id, position)
    if not res.get("moved"):
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷条目不存在：{item_id}")
    return get_paper(conn, paper_id)


def set_score(conn, paper_id: int, item_id: int, score) -> dict:
    """设置某条目分值（返回整卷）。"""
    require_paper(conn, paper_id)
    try:
        res = _paper.set_score(conn, paper_id, item_id, score)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    if not res.get("updated"):
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷条目不存在：{item_id}")
    return get_paper(conn, paper_id)


def set_scores(conn, paper_id: int, mapping: dict) -> dict:
    """批量设置分值，返回 ``{"updated","missing"}``。"""
    require_paper(conn, paper_id)
    try:
        return _paper.set_scores(conn, paper_id, mapping)
    except ValueError as exc:
        raise errors.map_value_error(exc)


# --------------------------------------------------------------------------- #
# 大题
# --------------------------------------------------------------------------- #
def add_section(conn, paper_id: int, body: dict) -> dict:
    """新增大题（返回整卷）。"""
    require_paper(conn, paper_id)
    try:
        _paper.add_section(conn, paper_id, body.get("name"),
                           description=body.get("description"),
                           position=body.get("position"))
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return get_paper(conn, paper_id)


def rename_section(conn, paper_id: int, section_id: int, name: str) -> dict:
    """重命名大题（返回整卷）。"""
    require_paper(conn, paper_id)
    try:
        _paper.rename_section(conn, paper_id, section_id, name)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return get_paper(conn, paper_id)


def move_section(conn, paper_id: int, section_id: int, position: int) -> dict:
    """移动大题（返回整卷）。"""
    require_paper(conn, paper_id)
    try:
        _paper.move_section(conn, paper_id, section_id, position)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return get_paper(conn, paper_id)


def delete_section(conn, paper_id: int, section_id: int, *, force: bool = False) -> dict:
    """删除大题；大题非空且未 ``force`` 时抛 40902。"""
    require_paper(conn, paper_id)
    try:
        res = _paper.delete_section(conn, paper_id, section_id, force=force)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    if not res.get("deleted"):
        raise errors.conflict(errors.CODE_NEED_FORCE,
                              res.get("reason") or "大题非空，需 force=true 确认")
    return {"deleted": True, "section_id": section_id,
            "ungrouped": res.get("ungrouped", 0)}


# --------------------------------------------------------------------------- #
# 快照 / 导出数据
# --------------------------------------------------------------------------- #
def refresh_snapshots(conn, paper_id: int) -> dict:
    """按卷刷新快照（仅版本未变的题），返回刷新/跳过计数。"""
    require_paper(conn, paper_id)
    return _paper.refresh_snapshots(conn, paper_id=paper_id)


def export_data(conn, paper_id: int, *, answer_mode: str | None = None, template: str | None = None) -> dict:
    """产出 ``build_export_payload``（只读，用于导出数据预览）。"""
    require_paper(conn, paper_id)
    try:
        payload = _paper.build_export_payload(conn, paper_id, answer_mode=answer_mode, template=template)
        return _media.enrich_export_images(conn, payload)
    except ValueError as exc:
        raise errors.map_value_error(exc)


def create_revision(conn, paper_id: int, data: dict) -> dict:
    """显式复制新卷，领域层不提交，write_txn负责提交。"""
    require_paper(conn,paper_id)
    if data.get('confirm') is not True:
        raise errors.conflict(errors.CODE_NEED_CONFIRM,'创建修订卷需明确确认')
    try:
        return _paper.create_revision(conn,paper_id,title=data.get('title'),exclude_item_ids=data.get('exclude_item_ids'),diagnostic_digest=data.get('diagnostic_digest'))
    except ValueError as exc:
        raise errors.bad_request(errors.CODE_INVALID_REVISION,str(exc))


__all__ = [
    "require_paper", "get_paper_row",
    "list_papers", "create_paper", "get_paper", "update_paper", "delete_paper",
    "add_questions", "remove_question", "move_question", "set_score", "set_scores",
    "add_section", "rename_section", "move_section", "delete_section",
    "refresh_snapshots", "export_data",
]
