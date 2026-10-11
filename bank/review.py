"""待复核公式队列：标记已处理与状态汇总。

背景
----
``review_queue`` 收集非 OK 的公式（``UNSUPPORTED`` / ``EMPTY`` / ``FAIL`` 等）。
老师逐条处理后可「标记已处理」（``resolved=1``）；本模块提供该工作流的最小能力。

与 ``bank.edit`` 的关系
-----------------------
人工在 Web 界面编辑公式后，:func:`bank.edit.save_question` 会清除该公式的
``needs_review`` 并把本队列对应行置 ``resolved=1``（M1 裁定）；本模块负责**手动**
标记与汇总。
"""
# ---------------------------------------------------------------------------
# title: 待复核公式队列
# description: review_queue 的 resolve（标记已处理/恢复）与 summary（按状态计数）。
# author: 待补充
# version: 0.1.0
# category: Web界面-领域层
# ---------------------------------------------------------------------------

from __future__ import annotations

import sqlite3


def resolve(conn: sqlite3.Connection, rq_id: int, *, resolved: bool = True) -> dict:
    """把某条待复核项标记为已处理（``resolved=1``）或恢复（``resolved=0``）。

    返回 ``{"rq_id", "question_id", "resolved"}``；不存在则抛 :class:`ValueError`。
    """
    row = conn.execute("SELECT id, question_id FROM review_queue WHERE id = ?",
                       (rq_id,)).fetchone()
    if row is None:
        raise ValueError(f"复核项不存在：{rq_id}")
    conn.execute("UPDATE review_queue SET resolved = ? WHERE id = ?",
                 (1 if resolved else 0, rq_id))
    conn.commit()
    return {"rq_id": rq_id, "question_id": row[1], "resolved": bool(resolved)}


def summary(conn: sqlite3.Connection) -> dict:
    """汇总待复核队列：``{"open", "resolved", "total", "by_status"}``。

    ``by_status`` 为**未处理**（``resolved=0``）项按 ``status`` 的计数
    （如 ``{"FAIL": 12, "EMPTY": 3, "UNSUPPORTED": 1}``）。
    """
    open_count = conn.execute(
        "SELECT COUNT(*) FROM review_queue WHERE resolved = 0").fetchone()[0]
    resolved_count = conn.execute(
        "SELECT COUNT(*) FROM review_queue WHERE resolved = 1").fetchone()[0]
    by_status = {
        (r[0] if r[0] is not None else "NULL"): r[1]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS c FROM review_queue WHERE resolved = 0"
            " GROUP BY status ORDER BY c DESC")
    }
    return {
        "open": open_count,
        "resolved": resolved_count,
        "total": open_count + resolved_count,
        "by_status": by_status,
    }


__all__ = ["resolve", "summary"]
