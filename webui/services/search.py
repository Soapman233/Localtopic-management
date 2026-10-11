"""检索服务：关键词检索与筛选栏计数。

复用 ``bank.query``：``search_with_grade_gap``（支持上下文漏题计数、has_answer / has_analysis 内容过滤 +
``*_missing`` 「待补充」缺失过滤）与 ``facets``（各维度计数 + 「待补充」桶 + 覆盖率）。
本层只做参数编排，并把 facets 的「待补充」桶改为**哨兵感知**（见 :func:`_fold_missing`）。
"""
# ---------------------------------------------------------------------------
# title: webui 检索服务
# description: 检索与筛选栏编排；严格模式、缺失桶、当前页内容标志和当前条件下的年级漏题计数。
# author: 待补充
# version: 0.1.0
# category: Web界面
# ---------------------------------------------------------------------------




from __future__ import annotations

from typing import Any, Optional

from bank import query as _q

#: 知识点命名空间（严格模式限定）。
KNOWLEDGE_NAMESPACE = "知识点"

#: 「待补充」各维度哨兵值（与 ``bank.query`` 同源，供本层折叠 facets 桶复用）。
MISSING_SENTINELS = _q.MISSING_SENTINELS


def _strict_kwargs(kp_confirmed_only: bool) -> dict:
    """把「仅看已确认知识点」开关翻译为 ``bank.query`` 的标签过滤参数（M7 默认关闭）。"""
    if kp_confirmed_only:
        return {"label_review": "已确认", "label_namespace": KNOWLEDGE_NAMESPACE}
    return {}


def _missing_kwargs(*, grade_missing: Optional[bool], textbook_missing: Optional[bool],
                    chapter_missing: Optional[bool], qtype_missing: Optional[bool],
                    difficulty_missing: Optional[bool]) -> dict:
    """把 5 个 ``*_missing`` 开关打包为 ``bank.query`` 的关键字参数。"""
    return {
        "grade_missing": grade_missing,
        "textbook_missing": textbook_missing,
        "chapter_missing": chapter_missing,
        "qtype_missing": qtype_missing,
        "difficulty_missing": difficulty_missing,
    }


def search(conn, *, keyword: Optional[str] = None, stage: Optional[str] = None,
           subject: Optional[str] = None, grade: Optional[str] = None,
           textbook: Optional[str] = None, chapter: Optional[str] = None,
           qtype: Optional[str] = None, difficulty: Optional[str] = None,
           section: Optional[str] = None, has_answer: Optional[bool] = None,
           has_analysis: Optional[bool] = None, needs_review: Optional[bool] = None,
           grade_missing: Optional[bool] = None, textbook_missing: Optional[bool] = None,
           chapter_missing: Optional[bool] = None, qtype_missing: Optional[bool] = None,
           difficulty_missing: Optional[bool] = None,
           kp_confirmed_only: bool = False, limit: int = 20, offset: int = 0) -> dict:
    """检索题目，返回 ``{"total","items","limit","offset","grade_gap"}``。

    额外支持 5 个 ``*_missing`` 开关（P0-13「待补充」桶筛选）：取 ``True`` 时命中该维度
    **缺失元数据**（``NULL`` / 空串 / 哨兵值）的题；``False`` / ``None`` 表示**不过滤**，
    多个维度可 AND 叠加。

    每个 item 会附带内容标志 ``has_answer`` / ``has_analysis``（**JSON 布尔**，供结果卡渲染
    答案/解析徽章，B2）。二者为 SQL 内联计算列；答案/解析原文仅通过详情接口读取。
    ``needs_review`` 通过当前页批量查询下发，
    不额外请求整题详情，不改变检索分页与排序。
    """
    data = _q.search_with_grade_gap(
        conn, keyword=keyword, stage=stage, subject=subject, grade=grade,
        textbook=textbook, chapter=chapter, qtype=qtype, difficulty=difficulty,
        section=section, has_answer=has_answer, has_analysis=has_analysis,
        needs_review=needs_review,
        limit=limit, offset=offset,
        **_missing_kwargs(grade_missing=grade_missing, textbook_missing=textbook_missing,
                          chapter_missing=chapter_missing, qtype_missing=qtype_missing,
                          difficulty_missing=difficulty_missing),
        **_strict_kwargs(kp_confirmed_only))
    flags = _q.question_review_flags(conn, [item["id"] for item in data.get("items", [])])
    # SQLite 无布尔类型：把 0/1 计算列归一化为真正的 JSON 布尔。
    for item in data.get("items", []):
        item["needs_review"] = flags[item["id"]]
        for key in ("has_answer", "has_analysis"):
            if key in item:
                item[key] = bool(item[key])
    return data


def _fold_missing(result: dict) -> dict:
    """把 facets 各维度里的「待补充」哨兵项折叠进 ``missing`` 桶（哨兵感知）。

    ``bank.query.facets`` 仅把 ``NULL`` / 空串计入 ``missing``；但真实库中缺失元数据以
    **字面串**落库（``待补充`` / ``未分类`` / ``未标注``），会作为普通取值出现在 ``items``。
    这里把它们从 ``items`` 移除并累加进 ``missing``，使 UI 的「待补充 (n)」桶计数正确，
    字段名保持 ``dimensions.<维度>.missing`` 不变。
    """
    dims = result.get("dimensions") or {}
    for dim, sentinels in MISSING_SENTINELS.items():
        bucket = dims.get(dim)
        if not bucket:
            continue
        extra = 0
        kept: list = []
        for item in bucket.get("items", []):
            key = item.get("key")
            if key is not None and str(key).strip() in sentinels:
                extra += int(item.get("count", 0))
            else:
                kept.append(item)
        bucket["items"] = kept
        bucket["missing"] = int(bucket.get("missing", 0)) + extra
    return result


def facets(conn, *, keyword: Optional[str] = None, stage: Optional[str] = None,
           subject: Optional[str] = None, grade: Optional[str] = None,
           textbook: Optional[str] = None, chapter: Optional[str] = None,
           qtype: Optional[str] = None, difficulty: Optional[str] = None,
           section: Optional[str] = None, has_answer: Optional[bool] = None,
           has_analysis: Optional[bool] = None, needs_review: Optional[bool] = None,
           kp_confirmed_only: bool = False) -> dict:
    """筛选栏计数（各维度 + 待补充桶）+ 覆盖率。

    「待补充」桶为**哨兵感知**：``dimensions.<维度>.missing`` 同时统计 ``NULL`` / 空串与
    哨兵值（``待补充`` / ``未分类`` / ``未标注``），供前端筛选栏的「待补充 (n)」按钮使用。
    """
    kwargs: dict[str, Any] = {
        "keyword": keyword, "stage": stage, "subject": subject, "grade": grade,
        "textbook": textbook, "chapter": chapter, "qtype": qtype,
        "difficulty": difficulty, "section": section, "has_answer": has_answer,
        "has_analysis": has_analysis, "needs_review": needs_review,
    }
    kwargs.update(_strict_kwargs(kp_confirmed_only))
    return _fold_missing(_q.facets(conn, **kwargs))


__all__ = ["search", "facets", "KNOWLEDGE_NAMESPACE", "MISSING_SENTINELS"]
