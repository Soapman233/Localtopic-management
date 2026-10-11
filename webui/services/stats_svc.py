"""题库统计服务。

汇总 ``bank.query.stats`` + ``bank.answers.coverage`` + ``bank.enrich.coverage`` +
``bank.labels.status_counts`` + 待复核队列计数，供统计页与覆盖率提示条使用。
"""
# ---------------------------------------------------------------------------
# title: webui 统计服务
# description: 题库总览/分布/覆盖率/复核状态；聚合 bank.query/answers/enrich/labels/review。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from bank import answers as _answers
from bank import enrich as _enrich
from bank import labels as _labels
from bank import query as _q
from bank import review as _review


def stats(conn) -> dict:
    """题库统计总览。"""
    base = _q.stats(conn)
    base["answer_coverage"] = _answers.coverage(conn)
    base["enrich_coverage"] = _enrich.coverage(conn)
    base["label_status"] = _labels.status_counts(conn)
    base["review"] = _review.summary(conn)
    return base


def coverage(conn) -> dict:
    """P0-13 覆盖率（``GET /api/meta/coverage``）。"""
    return _q.coverage_summary(conn)


__all__ = ["stats", "coverage"]
