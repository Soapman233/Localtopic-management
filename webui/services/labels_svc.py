"""知识点复核服务。

复用 ``bank.labels``：按标签汇总、逐条清单、决策影响预检、确认/否决、CSV 导出/导入。
批量决策与文件级操作在未确认时抛 40903；标签不存在抛 40406。
"""
# ---------------------------------------------------------------------------
# title: webui 知识点复核服务
# description: 按标签汇总/逐条复核/决策预检/确认否决/复核 CSV 导出导入；调用 bank.labels。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from pathlib import Path

from bank import labels as _labels

from .. import config, errors

#: 复核状态取值。
REVIEW_PENDING = "待复核"
REVIEW_CONFIRMED = "已确认"
REVIEW_REJECTED = "已否决"

#: decision 可接受写法（大小写不敏感），兼容前端「确认/否决」与规范「已确认/已否决」。
_CONFIRM_WORDS = frozenset({"确认", "已确认", "confirm", "confirmed", "1", "y", "yes", "true"})
_REJECT_WORDS = frozenset({"否决", "已否决", "reject", "rejected", "0", "n", "no", "false"})


def normalize_decision(decision: str) -> str:
    """把 ``decision`` 归一化为 ``已确认`` / ``已否决``；无法识别抛 40000。"""
    raw = str(decision).strip()
    low = raw.lower()
    if raw in _CONFIRM_WORDS or low in _CONFIRM_WORDS:
        return REVIEW_CONFIRMED
    if raw in _REJECT_WORDS or low in _REJECT_WORDS:
        return REVIEW_REJECTED
    raise errors.bad_request(40000, f"decision 必须是「确认」或「否决」，收到 {decision!r}")


def review_summary(conn, *, namespace: str = _labels.KNOWLEDGE_NAMESPACE,
                   status: str | None = REVIEW_PENDING,
                   limit: int | None = None) -> dict:
    """按标签汇总 + 状态计数，返回 ``{summary[], counts{待复核,已确认,已否决}}``。"""
    try:
        summary = _labels.review_summary(conn, namespace=namespace, status=status, limit=limit)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return {"summary": summary, "counts": _labels.status_counts(conn, namespace=namespace),
            "namespace": namespace, "status": status}


def review_items(conn, *, label_name: str, status: str | None = REVIEW_PENDING,
                 namespace: str = _labels.KNOWLEDGE_NAMESPACE,
                 limit: int = 50, offset: int = 0) -> dict:
    """某标签的逐条复核清单。"""
    try:
        return _labels.review_items(conn, label_name=label_name, status=status,
                                    namespace=namespace, limit=limit, offset=offset)
    except ValueError as exc:
        raise errors.not_found(errors.CODE_LABEL_NOT_FOUND, str(exc))


def decision_preview(conn, *, label_name: str, decision: str,
                     question_id: int | None = None,
                     namespace: str = _labels.KNOWLEDGE_NAMESPACE) -> dict:
    """**只读**预检一次决策的影响条数（供前端二次确认）。"""
    decision = normalize_decision(decision)
    try:
        res = _labels.preview_decision(conn, label_name=label_name, decision=decision,
                                       question_id=question_id, namespace=namespace)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    if not res.get("found"):
        raise errors.not_found(errors.CODE_LABEL_NOT_FOUND,
                               f"标签不存在：{label_name}（namespace={namespace}）")
    return res


def decision(conn, *, label_name: str, decision: str, question_id: int | None = None,
             confirm: bool = False, force: bool = False,
             namespace: str = _labels.KNOWLEDGE_NAMESPACE) -> dict:
    """确认 / 否决某标签的关联。

    * 批量（``question_id`` 为空）且未 ``confirm`` → 抛 40903（附影响条数）；
    * 标签不存在 → 40406。
    """
    decision = normalize_decision(decision)
    if question_id is None and not confirm:
        preview = _labels.preview_decision(conn, label_name=label_name, decision=decision,
                                           namespace=namespace)
        if not preview.get("found"):
            raise errors.not_found(errors.CODE_LABEL_NOT_FOUND,
                                   f"标签不存在：{label_name}（namespace={namespace}）")
        raise errors.conflict(errors.CODE_NEED_CONFIRM,
                              f"批量决策将影响 {preview['will_update']} 条关联，请确认后重试",
                              {"will_update": preview["will_update"],
                               "matched": preview["matched"]})
    try:
        res = _labels.set_review_status(conn, label_name=label_name, decision=decision,
                                        question_id=question_id, namespace=namespace,
                                        force=force)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    if not res.get("found"):
        raise errors.not_found(errors.CODE_LABEL_NOT_FOUND,
                               f"标签不存在：{label_name}（namespace={namespace}）")
    return {"label_id": res.get("label_id"), "label_name": label_name, "decision": decision,
            "updated": res.get("updated", 0), "matched": res.get("matched", 0),
            "already_decided": res.get("already_decided", 0)}


def export_review_csv(conn, *, status: str | None = REVIEW_PENDING,
                      namespace: str = _labels.KNOWLEDGE_NAMESPACE) -> Path:
    """导出复核清单 CSV（写到 ``outputs/webui/csv/``），返回文件路径。"""
    out_dir = config.WEBUI_DIR / "csv"
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"review_{status or 'all'}.csv"
    try:
        res = _labels.export_review(conn, out_dir / name, namespace=namespace, status=status)
    except ValueError as exc:
        raise errors.map_value_error(exc)
    return Path(res["path"])


def import_review_csv(conn, csv_path: str | Path, *, force: bool = False) -> dict:
    """读回复核 CSV，返回 ``{total, applied, skipped, errors}``；CSV 非法抛 40005。"""
    try:
        return _labels.import_review(conn, csv_path, force=force)
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise errors.bad_request(errors.CODE_INVALID_CSV, f"CSV 读取失败：{exc}")


__all__ = [
    "REVIEW_PENDING", "REVIEW_CONFIRMED", "REVIEW_REJECTED", "normalize_decision",
    "review_summary", "review_items", "decision_preview", "decision",
    "export_review_csv", "import_review_csv",
]
