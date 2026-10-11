"""知识点标签人工复核工作流。

背景
----
知识点标签当前是**「提及」口径**（``term in text``）：只要题干里出现词典中的
知识词就打标，**不代表这道题在考查该知识点**。实测 7,945 题平均 4.26 个标签/题，
泛词命中量很大（``压强`` 命中 2,378 题）。因此**知识点标签必须交由人工复核确认**。

本模块提供复核工作流所需的最小能力：

* ``question_labels.review_status`` 列的**幂等迁移**（默认全部 ``待复核``）；
* 按**标签**汇总的复核清单（183 个标签远比 32,936 条关联可复核）；
* **确认 / 否决**（批量作用于某标签的全部待复核关联，或只作用于某题某标签）；
* **导出 / 导入** 复核 CSV（供老师离线填写，再读回）。

取值
----
* ``待复核``   —— 默认；未复核的标签**仍可用于检索**（否则功能不可用）；
* ``已确认``   —— 老师确认该题确实涉及该知识点；
* ``已否决``   —— 老师认为该题与该知识点无关。

原则
----
* **不覆盖已确认的关联**：批量与导入默认只处理 ``待复核`` 的行；确需改动用 ``force=True``。
* **不把「待复核」当「无效」**：未复核标签照常参与检索，仅严格模式（``label_review='已确认'``）
  才只命中已确认标签。
"""
# ---------------------------------------------------------------------------
# title: 知识点复核工作流
# description: question_labels.review_status 幂等迁移、按标签汇总、确认/否决、复核 CSV 导出导入。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import csv
import re
import sqlite3
from pathlib import Path

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 知识点命名空间。
KNOWLEDGE_NAMESPACE = "知识点"

#: 复核状态取值。
REVIEW_PENDING = "待复核"
REVIEW_CONFIRMED = "已确认"
REVIEW_REJECTED = "已否决"
REVIEW_STATUSES: tuple[str, ...] = (REVIEW_PENDING, REVIEW_CONFIRMED, REVIEW_REJECTED)

#: 状态 -> 汇总列名（用于 ``review_summary`` 的 HAVING 过滤）。
_STATUS_COLUMN = {
    REVIEW_PENDING: "pending",
    REVIEW_CONFIRMED: "confirmed",
    REVIEW_REJECTED: "rejected",
}

#: 老师填写 decision 的可接受写法（大小写不敏感）。
_CONFIRM_WORDS = frozenset({"确认", "已确认", "confirm", "confirmed", "1", "y", "yes", "true"})
_REJECT_WORDS = frozenset({"否决", "已否决", "reject", "rejected", "0", "n", "no", "false"})

#: 复核 CSV 的列名（导出用；导入按列名读取，顺序无关）。
CSV_COLUMNS = ("label_id", "label_name", "question_id", "source", "snippet")

_WS_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------- #
# 迁移（幂等）
# --------------------------------------------------------------------------- #
def ensure_review_status_column(conn: sqlite3.Connection) -> list[str]:
    """幂等地为 ``question_labels`` 增加 ``review_status`` 列（默认 ``待复核``）。

    用 ``PRAGMA table_info`` 判断列是否已存在；已存在则跳过。
    ``ALTER TABLE ... ADD COLUMN review_status TEXT NOT NULL DEFAULT '待复核'`` 会把
    **既有行**一并置为默认值 ``待复核``，因此历史关联全部进入待复核队列，无需逐行回填。

    返回本次实际新增的列（``表.列`` 列表）；重复执行返回 ``[]``。
    """
    existing = {row[1] for row in conn.execute("PRAGMA table_info(question_labels)")}
    added: list[str] = []
    if "review_status" not in existing:
        conn.execute(
            "ALTER TABLE question_labels ADD COLUMN review_status TEXT NOT NULL"
            f" DEFAULT '{REVIEW_PENDING}'")
        added.append("question_labels.review_status")
        conn.commit()
    return added


def has_review_status_column(conn: sqlite3.Connection) -> bool:
    """判断 ``question_labels`` 是否已有 ``review_status`` 列（只读 PRAGMA）。"""
    return "review_status" in {row[1] for row in conn.execute("PRAGMA table_info(question_labels)")}


# --------------------------------------------------------------------------- #
# 汇总
# --------------------------------------------------------------------------- #
def review_summary(conn: sqlite3.Connection, *, namespace: str = KNOWLEDGE_NAMESPACE,
                   status: str | None = REVIEW_PENDING,
                   limit: int | None = None) -> list[dict]:
    """**按标签**汇总复核情况。

    返回 ``[{"label_id","label_name","total","pending","confirmed","rejected"}]``，
    按「待复核数」倒序。``status`` 非空时只保留该状态计数 ``> 0`` 的标签
    （默认 ``待复核``，即只列还有待复核项的标签；传 ``None`` 列出全部标签）。
    """
    sql = [
        "SELECT l.id AS label_id, l.name AS label_name,",
        " COUNT(ql.question_id) AS total,",
        f" SUM(CASE WHEN ql.review_status='{REVIEW_PENDING}' THEN 1 ELSE 0 END) AS pending,",
        f" SUM(CASE WHEN ql.review_status='{REVIEW_CONFIRMED}' THEN 1 ELSE 0 END) AS confirmed,",
        f" SUM(CASE WHEN ql.review_status='{REVIEW_REJECTED}' THEN 1 ELSE 0 END) AS rejected",
        " FROM labels l JOIN question_labels ql ON ql.label_id = l.id",
        " WHERE l.namespace = :ns",
        " GROUP BY l.id",
    ]
    params: dict = {"ns": namespace}
    if status:
        col = _STATUS_COLUMN.get(status)
        if col is None:
            raise ValueError(f"未知复核状态：{status!r}（应为 {REVIEW_STATUSES}）")
        sql.append(f" HAVING {col} > 0")
    sql.append(" ORDER BY pending DESC, total DESC, l.name")
    if limit:
        sql.append(" LIMIT :lim")
        params["lim"] = int(limit)

    rows = conn.execute("".join(sql), params).fetchall()
    return [{
        "label_id": r[0], "label_name": r[1], "total": r[2],
        "pending": r[3] or 0, "confirmed": r[4] or 0, "rejected": r[5] or 0,
    } for r in rows]


def status_counts(conn: sqlite3.Connection, *, namespace: str = KNOWLEDGE_NAMESPACE) -> dict:
    """按复核状态统计关联条数（``{状态: 条数}``，含所有取值）。"""
    out = {s: 0 for s in REVIEW_STATUSES}
    rows = conn.execute(
        "SELECT ql.review_status AS st, COUNT(*) AS c FROM question_labels ql"
        " JOIN labels l ON l.id = ql.label_id WHERE l.namespace = ?"
        " GROUP BY ql.review_status", (namespace,)).fetchall()
    for r in rows:
        out[r[0] if r[0] is not None else REVIEW_PENDING] = r[1]
    return out


# --------------------------------------------------------------------------- #
# 确认 / 否决
# --------------------------------------------------------------------------- #
def set_review_status(conn: sqlite3.Connection, *, label_name: str, decision: str,
                      question_id: int | None = None,
                      namespace: str = KNOWLEDGE_NAMESPACE,
                      force: bool = False) -> dict:
    """把某标签的关联设为 ``已确认`` / ``已否决``。

    参数
    ----
    label_name  标签名（在 ``namespace`` 内唯一）。
    decision    :data:`REVIEW_CONFIRMED` 或 :data:`REVIEW_REJECTED`。
    question_id 为空 -> **批量**作用于该标签的**全部待复核关联**；
                给定时 -> 只作用于**该题该标签**这一条关联。
    force       为 False（默认）时**只处理 ``待复核`` 的行，绝不覆盖已确认/已否决**；
                为 True 时才允许改写已有决定。

    返回 ``{"found","label_id","label_name","updated","matched","already_decided"}``。
    标签不存在时 ``found=False``、``updated=0``（不抛异常，便于 CLI 友好提示）。
    """
    if decision not in (REVIEW_CONFIRMED, REVIEW_REJECTED):
        raise ValueError(f"decision 必须是 {REVIEW_CONFIRMED!r} 或 {REVIEW_REJECTED!r}，"
                         f"收到 {decision!r}")

    row = conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                       (namespace, label_name)).fetchone()
    if row is None:
        return {"found": False, "label_id": None, "label_name": label_name,
                "updated": 0, "matched": 0, "already_decided": 0}
    label_id = row[0]

    if question_id is None:
        matched = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ?", (label_id,)).fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND review_status = ?",
            (label_id, REVIEW_PENDING)).fetchone()[0]
        if force:
            cur = conn.execute("UPDATE question_labels SET review_status = ? WHERE label_id = ?",
                               (decision, label_id))
        else:
            cur = conn.execute(
                "UPDATE question_labels SET review_status = ? WHERE label_id = ?"
                " AND review_status = ?", (decision, label_id, REVIEW_PENDING))
        updated = cur.rowcount
        already = matched - pending if not force else 0
    else:
        qid = int(question_id)
        matched = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND question_id = ?",
            (label_id, qid)).fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND question_id = ?"
            " AND review_status = ?", (label_id, qid, REVIEW_PENDING)).fetchone()[0]
        if force:
            cur = conn.execute(
                "UPDATE question_labels SET review_status = ? WHERE label_id = ?"
                " AND question_id = ?", (decision, label_id, qid))
        else:
            cur = conn.execute(
                "UPDATE question_labels SET review_status = ? WHERE label_id = ?"
                " AND question_id = ? AND review_status = ?",
                (decision, label_id, qid, REVIEW_PENDING))
        updated = cur.rowcount
        already = matched - pending if not force else 0

    conn.commit()
    return {"found": True, "label_id": label_id, "label_name": label_name,
            "updated": updated, "matched": matched, "already_decided": already}


# --------------------------------------------------------------------------- #
# 导出 / 导入
# --------------------------------------------------------------------------- #
def make_snippet(text: str | None, max_len: int = 60) -> str:
    """把题干压成单行片段（便于老师在 CSV 里快速判断）。"""
    t = _WS_RE.sub(" ", (text or "")).strip()
    return t[:max_len]


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """判断某表是否有某列（只读 PRAGMA，不写库）。"""
    return column in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def export_review(conn: sqlite3.Connection, out_path: str | Path, *,
                  namespace: str = KNOWLEDGE_NAMESPACE,
                  status: str | None = REVIEW_PENDING,
                  limit: int | None = None) -> dict:
    """导出复核清单 CSV（列：``label_id, label_name, question_id, source, snippet``）。

    ``status`` 默认 ``待复核``（只导出待复核项）。返回 ``{"path","rows"}``。
    CSV 用 ``utf-8-sig`` 编码，Excel/WPS 直接打开不乱码。

    ``question_labels.source`` 列由 ``enrich`` 的迁移添加；若库中尚无该列（如未跑过
    enrich 的新库），退化为空值，**不报错**。
    """
    source_expr = "ql.source" if _has_column(conn, "question_labels", "source") else "NULL"
    sql = [
        f"SELECT l.id, l.name, ql.question_id, {source_expr} AS source, q.plain_text",
        " FROM question_labels ql",
        " JOIN labels l ON l.id = ql.label_id",
        " JOIN questions q ON q.id = ql.question_id",
        " WHERE l.namespace = :ns",
    ]
    params: dict = {"ns": namespace}
    if status:
        sql.append(" AND ql.review_status = :st")
        params["st"] = status
    sql.append(" ORDER BY l.name, ql.question_id")
    if limit:
        sql.append(" LIMIT :lim")
        params["lim"] = int(limit)
    rows = conn.execute("".join(sql), params).fetchall()

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_COLUMNS)
        for r in rows:
            writer.writerow([r[0], r[1], r[2], r[3] or "", make_snippet(r[4])])
    return {"path": str(out), "rows": len(rows)}


def import_review(conn: sqlite3.Connection, csv_path: str | Path, *,
                  force: bool = False) -> dict:
    """读回老师填写的决定，写回 ``review_status``。

    CSV 需含 ``label_id`` / ``question_id`` / ``decision`` 三列（其余列忽略）。
    ``decision`` 取值 ``确认`` / ``否决``（兼容 ``已确认``/``已否决``/``confirm``/``reject``
    /``1``/``0``/``y``/``n`` 等写法，大小写不敏感）。

    **容错**：空行、未知 ``label_id``、未知关联、非法 ``decision``、非数字 id
    都会被**跳过并计数**，不影响其余行；返回
    ``{"total","applied","skipped","errors"}``（``errors`` 为可读原因列表，最多保留 50 条）。
    """
    ensure_review_status_column(conn)
    total = applied = skipped = 0
    errors: list[str] = []

    def _skip(lineno: int, reason: str) -> None:
        nonlocal skipped
        skipped += 1
        if len(errors) < 50:
            errors.append(f"第 {lineno} 行：{reason}")

    path = Path(csv_path)
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for lineno, row in enumerate(reader, start=2):
            values = [(v or "").strip() for v in row.values()]
            if not any(values):                       # 空行
                _skip(lineno, "空行")
                continue
            total += 1

            raw = (row.get("decision") or "").strip()
            low = raw.lower()
            if raw in _CONFIRM_WORDS or low in _CONFIRM_WORDS:
                decision = REVIEW_CONFIRMED
            elif raw in _REJECT_WORDS or low in _REJECT_WORDS:
                decision = REVIEW_REJECTED
            else:
                _skip(lineno, f"非法 decision {raw!r}（应为 确认/否决）")
                continue

            lid = (row.get("label_id") or "").strip()
            qid = (row.get("question_id") or "").strip()
            if not lid.lstrip("-").isdigit() or not qid.lstrip("-").isdigit():
                _skip(lineno, f"label_id/question_id 非整数（{lid!r}/{qid!r}）")
                continue
            lid, qid = int(lid), int(qid)

            if conn.execute("SELECT 1 FROM labels WHERE id = ?", (lid,)).fetchone() is None:
                _skip(lineno, f"未知 label_id={lid}")
                continue
            exists = conn.execute(
                "SELECT review_status FROM question_labels WHERE label_id = ? AND question_id = ?",
                (lid, qid)).fetchone()
            if exists is None:
                _skip(lineno, f"未知关联 label_id={lid}, question_id={qid}")
                continue

            sql = ("UPDATE question_labels SET review_status = ?"
                   " WHERE label_id = ? AND question_id = ?")
            params = [decision, lid, qid]
            if not force:
                sql += " AND review_status = ?"
                params.append(REVIEW_PENDING)
            cur = conn.execute(sql, params)
            if cur.rowcount:
                applied += 1
            else:
                _skip(lineno, f"关联 label_id={lid}, question_id={qid} 已是终态，未覆盖")

    conn.commit()
    return {"total": total, "applied": applied, "skipped": skipped, "errors": errors}


# --------------------------------------------------------------------------- #
# 新增（Web 界面）：逐条复核清单 / 决策影响预检
# --------------------------------------------------------------------------- #
def review_items(conn: sqlite3.Connection, *, label_name: str,
                 status: str | None = REVIEW_PENDING,
                 namespace: str = KNOWLEDGE_NAMESPACE,
                 limit: int = 50, offset: int = 0) -> dict:
    """按标签列出**逐条**复核项（供 Web 界面逐条确认/否决）。

    返回 ``{"total", "items": [{question_id, number, snippet, source, review_status}],
    "limit", "offset", "label_id", "label_name", "status"}``。
    标签不存在抛 :class:`ValueError`（webui 映射为 404）。
    """
    row = conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                       (namespace, label_name)).fetchone()
    if row is None:
        raise ValueError(f"标签不存在：{label_name}（namespace={namespace}）")
    label_id = row[0]

    clauses = ["ql.label_id = :lid"]
    params: dict = {"lid": label_id}
    if status:
        clauses.append("ql.review_status = :st")
        params["st"] = status
    where = " WHERE " + " AND ".join(clauses)

    total = conn.execute(
        f"SELECT COUNT(*) AS c FROM question_labels ql{where}", params).fetchone()[0]

    src_expr = "ql.source" if _has_column(conn, "question_labels", "source") else "NULL"
    params["lim"] = int(limit)
    params["off"] = int(offset)
    rows = conn.execute(
        f"SELECT ql.question_id, q.number, q.plain_text, {src_expr} AS source,"
        " ql.review_status"
        " FROM question_labels ql JOIN questions q ON q.id = ql.question_id"
        f"{where} ORDER BY ql.question_id LIMIT :lim OFFSET :off", params).fetchall()

    items = [{
        "question_id": r[0], "number": r[1], "snippet": make_snippet(r[2]),
        "source": r[3], "review_status": r[4],
    } for r in rows]
    return {"total": total, "items": items, "limit": limit, "offset": offset,
            "label_id": label_id, "label_name": label_name, "status": status}


def preview_decision(conn: sqlite3.Connection, *, label_name: str, decision: str,
                     question_id: int | None = None,
                     namespace: str = KNOWLEDGE_NAMESPACE) -> dict:
    """**只读**预检一次决策的影响条数（供前端二次确认）。

    返回 ``{"found", "label_id", "label_name", "decision", "matched", "pending",
    "will_update", "question_id"}``。

    * ``question_id`` 为空 → 统计该标签**全部待复核**关联；
    * 给定时 → 只统计**该题该标签**一条关联；
    * ``will_update`` 为实际会被改动的条数（= ``pending``）；
    * 标签不存在时 ``found=False`` 且各计数为 0（不抛异常）。
    """
    if decision not in (REVIEW_CONFIRMED, REVIEW_REJECTED):
        raise ValueError(f"decision 必须是 {REVIEW_CONFIRMED!r} 或 {REVIEW_REJECTED!r}，"
                         f"收到 {decision!r}")

    row = conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                       (namespace, label_name)).fetchone()
    if row is None:
        return {"found": False, "label_id": None, "label_name": label_name,
                "decision": decision, "matched": 0, "pending": 0, "will_update": 0,
                "question_id": question_id}
    label_id = row[0]

    if question_id is None:
        matched = conn.execute("SELECT COUNT(*) FROM question_labels WHERE label_id = ?",
                               (label_id,)).fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND review_status = ?",
            (label_id, REVIEW_PENDING)).fetchone()[0]
    else:
        qid = int(question_id)
        matched = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND question_id = ?",
            (label_id, qid)).fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM question_labels WHERE label_id = ? AND question_id = ?"
            " AND review_status = ?", (label_id, qid, REVIEW_PENDING)).fetchone()[0]

    return {"found": True, "label_id": label_id, "label_name": label_name,
            "decision": decision, "matched": matched, "pending": pending,
            "will_update": pending, "question_id": question_id}


__all__ = [
    "KNOWLEDGE_NAMESPACE", "REVIEW_PENDING", "REVIEW_CONFIRMED", "REVIEW_REJECTED",
    "REVIEW_STATUSES", "CSV_COLUMNS",
    "ensure_review_status_column", "has_review_status_column",
    "review_summary", "status_counts", "set_review_status",
    "make_snippet", "export_review", "import_review",
    "review_items", "preview_decision",
]
