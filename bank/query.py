"""查询接口：筛选 / 中文关键词检索 / 分页 / 单题详情 / 待复核队列 / 统计。

阶段3（组卷）与阶段4（导出）都通过本模块访问题库，不直接写 SQL。

中文检索方案见 ``bank/textutil.py``：题干在导入时已被切成双字词元存入 FTS5
（``question_fts``），这里把查询串做同样的切分后 ``MATCH``。单字查询退化为 ``LIKE``。
"""
# ---------------------------------------------------------------------------
# title: 查询接口
# description: 题目筛选、中文检索、详情及统计；新增 search_with_grade_gap 复用原检索语义计算同上下文年级缺失题量，保留原结果及分页。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------




from __future__ import annotations

from . import textutil as _txt

# 可筛选的字段 -> (SQL 表达式, 参数名)
_SOURCE_FILTERS = {
    "stage": "s.stage",
    "subject": "s.subject",
    "grade": "s.grade",
    "textbook": "s.textbook",
}
_QUESTION_FILTERS = {
    "chapter": "q.chapter",
    "qtype": "q.qtype",
    "difficulty": "q.difficulty",
    "section": "q.section",
    "number": "q.number",
}

_BASE_FROM = "FROM questions q JOIN source_files s ON s.id = q.source_id"

_ITEM_COLUMNS = (
    "q.id, q.source_id, q.number, q.label, q.section, q.chapter, q.qtype, q.difficulty,"
    " q.char_length, q.version, q.sub_question_count, q.plain_text,"
    " s.stage, s.subject, s.grade, s.textbook, s.file_name"
)


def _build_where(keyword, stage, subject, grade, textbook, chapter, qtype,
                 difficulty, section, number, labels, needs_review,
                 label_review=None, label_namespace=None):
    """组装 WHERE 子句与参数。返回 (where_sql, params, use_fts)。"""
    clauses: list[str] = []
    params: dict = {}
    use_fts = False

    for name, col in _SOURCE_FILTERS.items():
        val = {"stage": stage, "subject": subject, "grade": grade,
               "textbook": textbook}[name]
        if val:
            clauses.append(f"{col} = :{name}")
            params[name] = val
    for name, col in _QUESTION_FILTERS.items():
        val = {"chapter": chapter, "qtype": qtype, "difficulty": difficulty,
               "section": section, "number": number}[name]
        if val:
            clauses.append(f"{col} = :{name}")
            params[name] = val

    if labels or label_review or label_namespace:
        # 标签命中：题目需存在一条满足全部约束的「题目×标签」关联。
        sub = ["ql.question_id = q.id"]
        if labels:
            names = list(labels)
            ph = ", ".join(f":lbl{i}" for i in range(len(names)))
            sub.append(f"l.name IN ({ph})")
            for i, n in enumerate(names):
                params[f"lbl{i}"] = n
        if label_namespace:
            sub.append("l.namespace = :lbl_ns")
            params["lbl_ns"] = label_namespace
        if label_review:
            # 按人工复核状态过滤（如只命中「已确认」的知识点标签）。
            sub.append("ql.review_status = :lbl_rev")
            params["lbl_rev"] = label_review
        clauses.append(
            "EXISTS (SELECT 1 FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
            " WHERE " + " AND ".join(sub) + ")")

    if needs_review is True:
        clauses.append("EXISTS (SELECT 1 FROM formulas f WHERE f.question_id = q.id"
                       " AND f.needs_review = 1)")
    elif needs_review is False:
        clauses.append("NOT EXISTS (SELECT 1 FROM formulas f WHERE f.question_id = q.id"
                       " AND f.needs_review = 1)")

    if keyword and keyword.strip():
        expr, tokens = _txt.build_match_query(keyword)
        if expr and not (len(tokens) == 1 and len(tokens[0]) == 1):
            clauses.append("question_fts MATCH :fts")
            params["fts"] = expr
            use_fts = True
        else:
            # 单字或无可切分字符 -> LIKE 兜底。
            # 转义 % / _ / \ 并按字面匹配（ESCAPE '\'），否则用户搜「50%」「a_b」
            # 会被当成通配符模式、命中全表。FTS5 主路径（MATCH）不受影响。
            clauses.append("q.plain_text LIKE :kw_like ESCAPE '\\'")
            params["kw_like"] = f"%{_txt.escape_like(keyword.strip())}%"

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params, use_fts


def search(conn, *, keyword: str | None = None, stage: str | None = None,
           subject: str | None = None, grade: str | None = None,
           textbook: str | None = None, chapter: str | None = None,
           qtype: str | None = None, difficulty: str | None = None,
           section: str | None = None, number: str | None = None,
           labels: list[str] | None = None, needs_review: bool | None = None,
           label_review: str | None = None, label_namespace: str | None = None,
           limit: int = 20, offset: int = 0) -> dict:
    """按条件检索题目，返回 ``{"total","items","limit","offset"}``。

    * ``keyword`` 为中文关键词（做双字切分后走 FTS5，按 BM25 相关度排序）。
    * 其余参数为精确筛选；可任意组合。
    * ``labels`` 为标签名列表（任一命中即可）。
    * ``needs_review`` 为 True 时只返回含待复核公式的题目。
    * ``label_review`` 按知识点**人工复核状态**过滤（``待复核``/``已确认``/``已否决``）。
      **默认 None 表示不过滤——未复核的标签照常参与检索**（否则功能不可用）；
      传 ``已确认`` 即严格模式，只命中已被人工确认的知识点标签。
    * ``label_namespace`` 限定标签命名空间（如 ``知识点``），可与 ``label_review`` 组合。
    """
    where, params, use_fts = _build_where(
        keyword, stage, subject, grade, textbook, chapter, qtype, difficulty,
        section, number, labels, needs_review,
        label_review=label_review, label_namespace=label_namespace)

    from_sql = _BASE_FROM
    if use_fts:
        # 关键：join 表达式必须是 ``q.id = CAST(question_fts.question_id AS INTEGER)``，
        # **不能**写成 ``question_fts.question_id = CAST(q.id AS TEXT)``。
        #
        # 原因（P1 性能根因）：``question_fts.question_id`` 是 FTS5 的 **UNINDEXED** 列，
        # 把 ``CAST`` 施加在**外层 questions 侧**（``CAST(q.id AS TEXT)``）会让 SQLite 无法
        # 用 ``questions`` 的主键索引——查询计划劣化为
        # ``SCAN question_fts`` × ``SCAN q USING COVERING INDEX idx_q_source``，
        # 即对每个命中行全扫一遍题目表（O(命中数 × 题数)，818 命中 ≈ 6.9s、1753 命中 ≈ 14.7s）。
        #
        # 反过来把 ``CAST`` 施加在**内层 FTS 侧**（``CAST(question_fts.question_id AS INTEGER)``），
        # ``q.id`` 便与一个整数值做等值比较，SQLite 会用主键索引：
        # ``SEARCH q USING INTEGER PRIMARY KEY (rowid=?)``——只按命中数做点查（≈6ms / 12ms）。
        from_sql += " JOIN question_fts ON q.id = CAST(question_fts.question_id AS INTEGER)"

    total = conn.execute(f"SELECT COUNT(*) AS c {from_sql}{where}", params).fetchone()["c"]

    order = "ORDER BY bm25(question_fts)" if use_fts else "ORDER BY q.id"
    params = dict(params)
    params["limit"] = int(limit)
    params["offset"] = int(offset)
    rows = conn.execute(
        f"SELECT {_ITEM_COLUMNS} {from_sql}{where} {order} LIMIT :limit OFFSET :offset",
        params).fetchall()

    return {"total": total, "items": [dict(r) for r in rows],
            "limit": limit, "offset": offset}


def get_question(conn, question_id: int) -> dict | None:
    """取某题的完整信息：题干 + 公式 + 图片 + 标签 + 版本历史。"""
    q = conn.execute(
        "SELECT q.*, s.stage AS src_stage, s.subject AS src_subject, s.grade AS src_grade,"
        " s.textbook AS src_textbook, s.file_name AS src_file, s.path AS src_path,"
        " s.sha256 AS src_sha256"
        " FROM questions q JOIN source_files s ON s.id = q.source_id WHERE q.id = ?",
        (question_id,)).fetchone()
    if q is None:
        return None

    formulas = conn.execute(
        "SELECT id, fid, seq, kind, status, latex, progid, part, preview, needs_review"
        " FROM formulas WHERE question_id = ? ORDER BY seq", (question_id,)).fetchall()
    images = conn.execute(
        "SELECT id, media_path, sha256 FROM images WHERE question_id = ? ORDER BY id",
        (question_id,)).fetchall()
    labels = conn.execute(
        "SELECT l.namespace, l.name FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
        " WHERE ql.question_id = ? ORDER BY l.namespace, l.name", (question_id,)).fetchall()
    versions = conn.execute(
        "SELECT version, content_hash, char_length, created_at FROM question_versions"
        " WHERE question_id = ? ORDER BY version", (question_id,)).fetchall()

    out = dict(q)
    out["formulas"] = [dict(r) for r in formulas]
    out["images"] = [dict(r) for r in images]
    out["labels"] = [dict(r) for r in labels]
    out["versions"] = [dict(r) for r in versions]
    return out


def list_review(conn, *, resolved: bool = False, status: str | None = None,
                limit: int = 50, offset: int = 0) -> dict:
    """待复核队列（非 OK 的公式）。"""
    clauses = ["rq.resolved = :resolved"]
    params: dict = {"resolved": 1 if resolved else 0}
    if status:
        clauses.append("rq.status = :status")
        params["status"] = status
    where = " WHERE " + " AND ".join(clauses)
    total = conn.execute(f"SELECT COUNT(*) AS c FROM review_queue rq{where}",
                         params).fetchone()["c"]
    params["limit"] = int(limit)
    params["offset"] = int(offset)
    rows = conn.execute(
        "SELECT rq.id, rq.formula_id, rq.question_id, rq.status, rq.kind, rq.progid,"
        " rq.part, rq.preview, rq.reason, rq.resolved,"
        " q.number, q.section, q.chapter, s.file_name"
        " FROM review_queue rq"
        " LEFT JOIN questions q ON q.id = rq.question_id"
        " LEFT JOIN source_files s ON s.id = q.source_id"
        f"{where} ORDER BY rq.id LIMIT :limit OFFSET :offset", params).fetchall()
    return {"total": total, "items": [dict(r) for r in rows],
            "limit": limit, "offset": offset}


def _count_by(conn, expr: str, *, where: str = "", limit: int = 0) -> list[dict]:
    sql = (f"SELECT {expr} AS k, COUNT(*) AS c FROM questions q"
           f" JOIN source_files s ON s.id = q.source_id {where}"
           f" GROUP BY k ORDER BY c DESC")
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [{"key": r["k"], "count": r["c"]} for r in conn.execute(sql).fetchall()]


def stats(conn) -> dict:
    """题库总览与分布统计。"""
    def one(sql: str, params: tuple = ()):
        return conn.execute(sql, params).fetchone()[0]

    formula_status = [
        {"status": r["status"], "count": r["c"]}
        for r in conn.execute(
            "SELECT status, COUNT(*) AS c FROM formulas GROUP BY status ORDER BY c DESC")
    ]
    return {
        "sources": one("SELECT COUNT(*) FROM source_files"),
        "questions": one("SELECT COUNT(*) FROM questions"),
        "formulas": one("SELECT COUNT(*) FROM formulas"),
        "formulas_ok": one("SELECT COUNT(*) FROM formulas WHERE status = 'OK'"),
        "images": one("SELECT COUNT(*) FROM images"),
        "labels": one("SELECT COUNT(*) FROM labels"),
        "review_open": one("SELECT COUNT(*) FROM review_queue WHERE resolved = 0"),
        "review_resolved": one("SELECT COUNT(*) FROM review_queue WHERE resolved = 1"),
        "formula_status": formula_status,
        "by_stage": _count_by(conn, "s.stage"),
        "by_subject": _count_by(conn, "s.subject"),
        "by_grade": _count_by(conn, "s.grade"),
        "by_textbook": _count_by(conn, "s.textbook"),
        "by_qtype": _count_by(conn, "q.qtype"),
        "top_chapters": _count_by(conn, "q.chapter", where="WHERE q.chapter IS NOT NULL",
                                  limit=20),
    }


def list_labels(conn, namespace: str | None = None) -> list[dict]:
    """列出标签（可按命名空间过滤），带题目数。"""
    if namespace:
        rows = conn.execute(
            "SELECT l.namespace, l.name, COUNT(ql.question_id) AS c FROM labels l"
            " LEFT JOIN question_labels ql ON ql.label_id = l.id WHERE l.namespace = ?"
            " GROUP BY l.id ORDER BY c DESC, l.name", (namespace,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT l.namespace, l.name, COUNT(ql.question_id) AS c FROM labels l"
            " LEFT JOIN question_labels ql ON ql.label_id = l.id"
            " GROUP BY l.id ORDER BY l.namespace, c DESC, l.name").fetchall()
    return [dict(r) for r in rows]


def list_sources(conn, *, limit: int = 0) -> list[dict]:
    """列出来源文件（按题目数倒序）。"""
    sql = ("SELECT id, file_name, stage, grade, subject, textbook, chapter,"
           " questions_count, formulas_count FROM source_files"
           " ORDER BY questions_count DESC")
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [dict(r) for r in conn.execute(sql).fetchall()]


# --------------------------------------------------------------------------- #
# 新增（Web 界面）：筛选栏计数 / 覆盖率 / 来源详情
# --------------------------------------------------------------------------- #
#: 可作为筛选栏维度的字段 -> SQL 表达式。
_FACET_DIMENSIONS = {
    "stage": "s.stage",
    "subject": "s.subject",
    "grade": "s.grade",
    "textbook": "s.textbook",
    "chapter": "q.chapter",
    "qtype": "q.qtype",
    "difficulty": "q.difficulty",
    "section": "q.section",
}


def _where_for(filters: dict) -> tuple[str, dict, bool]:
    """由筛选字典组装 ``(where_sql, params, use_fts)``（薄封装 :func:`_build_where`）。"""
    return _build_where(
        filters.get("keyword"), filters.get("stage"), filters.get("subject"),
        filters.get("grade"), filters.get("textbook"), filters.get("chapter"),
        filters.get("qtype"), filters.get("difficulty"), filters.get("section"),
        filters.get("number"), filters.get("labels"), filters.get("needs_review"),
        label_review=filters.get("label_review"),
        label_namespace=filters.get("label_namespace"))


def _from_with_fts(use_fts: bool) -> str:
    """组装 FROM 子句（命中 FTS 时附带 ``question_fts`` join，走主键点查）。"""
    if use_fts:
        return _BASE_FROM + " JOIN question_fts ON q.id = CAST(question_fts.question_id AS INTEGER)"
    return _BASE_FROM


def facets(conn, *, keyword: str | None = None, stage: str | None = None,
           subject: str | None = None, grade: str | None = None,
           textbook: str | None = None, chapter: str | None = None,
           qtype: str | None = None, difficulty: str | None = None,
           section: str | None = None, number: str | None = None,
           labels: list[str] | None = None, needs_review: bool | None = None,
           label_review: str | None = None, label_namespace: str | None = None,
           has_answer: bool | None = None, has_analysis: bool | None = None) -> dict:
    """筛选栏计数 + 「待补充」桶 + 覆盖率。

    对每个维度（stage/subject/grade/textbook/chapter/qtype/difficulty/section）
    在**排除该维度自身筛选**的前提下统计取值分布，缺失值（``NULL``/空串）单列
    ``missing`` 桶（对应 UI 的「待补充 (n)」）。另给出 has_answer/has_analysis/
    needs_review 计数与 :func:`coverage_summary`。

    返回 ``{"dimensions": {维度: {"items": [{key,count}...], "missing": n}}, ...,
    "coverage": {...}}``。
    """
    filters = {
        "keyword": keyword, "stage": stage, "subject": subject, "grade": grade,
        "textbook": textbook, "chapter": chapter, "qtype": qtype, "difficulty": difficulty,
        "section": section, "number": number, "labels": labels,
        "needs_review": needs_review, "label_review": label_review,
        "label_namespace": label_namespace,
    }

    dimensions: dict = {}
    for name, col in _FACET_DIMENSIONS.items():
        sub = dict(filters)
        sub[name] = None  # 排除自身维度筛选（标准 faceting 语义）
        where, params, use_fts = _where_for(sub)
        from_sql = _from_with_fts(use_fts)
        rows = conn.execute(
            f"SELECT {col} AS k, COUNT(*) AS c {from_sql}{where}"
            " GROUP BY k ORDER BY c DESC", params).fetchall()
        items: list[dict] = []
        missing = 0
        for r in rows:
            key = r["k"]
            if key is None or str(key).strip() == "":
                missing += r["c"]
            else:
                items.append({"key": key, "count": r["c"]})
        dimensions[name] = {"items": items, "missing": missing}

    # 全量筛选下的计数（has_answer / has_analysis / needs_review）
    where, params, use_fts = _where_for(filters)
    from_sql = _from_with_fts(use_fts)

    def _scalar(cond: str) -> int:
        clause = (" AND " if where else " WHERE ") + cond
        return conn.execute(f"SELECT COUNT(*) AS c {from_sql}{where}{clause}",
                            params).fetchone()["c"]

    q_cols = {r[1] for r in conn.execute("PRAGMA table_info(questions)")}
    has_answer_counts = None
    has_analysis_counts = None
    if {"answer", "analysis"} <= q_cols:
        has_answer_counts = {
            "有答案": _scalar("q.answer IS NOT NULL AND q.answer != ''"),
            "无答案": _scalar("(q.answer IS NULL OR q.answer = '')"),
        }
        has_analysis_counts = {
            "有解析": _scalar("q.analysis IS NOT NULL AND q.analysis != ''"),
            "无解析": _scalar("(q.analysis IS NULL OR q.analysis = '')"),
        }
    needs_review_counts = {
        "待复核": _scalar("EXISTS (SELECT 1 FROM formulas f WHERE f.question_id = q.id"
                          " AND f.needs_review = 1)"),
    }

    return {
        "dimensions": dimensions,
        "has_answer": has_answer_counts,
        "has_analysis": has_analysis_counts,
        "needs_review": needs_review_counts,
        "coverage": coverage_summary(conn),
    }


def coverage_summary(conn) -> dict:
    """P0-13 数据状态可见性：各字段覆盖率 + 待复核公式数 + 知识点复核状态计数。"""
    from . import answers as _answers
    from . import enrich as _enrich
    from . import labels as _labels

    env = _enrich.coverage(conn)
    ans = _answers.coverage(conn)
    total_q = env["questions_total"]

    def pct(n: int, d: int) -> float:
        return round(100.0 * n / d, 1) if d else 0.0

    review_open = conn.execute(
        "SELECT COUNT(*) FROM review_queue WHERE resolved = 0").fetchone()[0]
    return {
        "source_files_total": env["source_files_total"],
        "questions_total": total_q,
        "grade": env["grade"],
        "textbook": env["textbook"],
        "chapter": env["chapter"],
        "qtype": env["qtype"],
        "difficulty": env["difficulty"],
        "knowledge": env["knowledge"],
        "answer": {"n": ans["with_answer"], "total": total_q,
                   "pct": pct(ans["with_answer"], total_q)},
        "analysis": {"n": ans["with_analysis"], "total": total_q,
                     "pct": pct(ans["with_analysis"], total_q)},
        "review_open": review_open,
        "label_status": _labels.status_counts(conn),
    }


def source_detail(conn, source_id: int) -> dict | None:
    """来源文件详情：文件信息 + 题量/公式数 + 该来源内的覆盖率 + 题目 id 预览。

    来源不存在返回 ``None``。
    """
    src = conn.execute("SELECT * FROM source_files WHERE id = ?", (source_id,)).fetchone()
    if src is None:
        return None

    q_count = conn.execute("SELECT COUNT(*) FROM questions WHERE source_id = ?",
                           (source_id,)).fetchone()[0]
    f_count = conn.execute("SELECT COUNT(*) FROM formulas WHERE source_id = ?",
                           (source_id,)).fetchone()[0]

    q_cols = {r[1] for r in conn.execute("PRAGMA table_info(questions)")}
    chapter_ok = conn.execute(
        "SELECT COUNT(*) FROM questions WHERE source_id = ? AND chapter IS NOT NULL"
        " AND chapter != ''", (source_id,)).fetchone()[0]
    qtype_ok = conn.execute(
        "SELECT COUNT(*) FROM questions WHERE source_id = ? AND qtype IS NOT NULL"
        " AND qtype != ''", (source_id,)).fetchone()[0]
    answer_ok = 0
    if "answer" in q_cols:
        answer_ok = conn.execute(
            "SELECT COUNT(*) FROM questions WHERE source_id = ? AND answer IS NOT NULL"
            " AND answer != ''", (source_id,)).fetchone()[0]

    def pct(n: int, d: int) -> float:
        return round(100.0 * n / d, 1) if d else 0.0

    preview = [r[0] for r in conn.execute(
        "SELECT id FROM questions WHERE source_id = ? ORDER BY id LIMIT 20", (source_id,))]

    return {
        "source": dict(src),
        "questions_count": q_count,
        "formulas_count": f_count,
        "coverage": {
            "chapter": {"n": chapter_ok, "total": q_count, "pct": pct(chapter_ok, q_count)},
            "qtype": {"n": qtype_ok, "total": q_count, "pct": pct(qtype_ok, q_count)},
            "answer": {"n": answer_ok, "total": q_count, "pct": pct(answer_ok, q_count)},
        },
        "question_ids_preview": preview,
    }


# --------------------------------------------------------------------------- #
# 新增（Web 界面）：「待补充」缺失值判定（哨兵感知）
# --------------------------------------------------------------------------- #
#: 各维度「待补充」哨兵值。导入 / 富化阶段把「无依据」的字段以**字面串**落库
#: （而非 ``NULL`` / 空串），因此「缺失元数据」的判定必须同时覆盖 ``NULL``、空串与这些哨兵。
MISSING_SENTINELS: dict[str, tuple[str, ...]] = {
    "grade": ("待补充",),
    "textbook": ("待补充",),
    "chapter": ("待补充",),
    "qtype": ("未分类",),
    "difficulty": ("未标注",),
}

#: 「待补充」维度 -> SQL 列（来源表字段用 ``s.``，题目表字段用 ``q.``）。
_MISSING_COLUMNS: dict[str, str] = {
    "grade": "s.grade",
    "textbook": "s.textbook",
    "chapter": "q.chapter",
    "qtype": "q.qtype",
    "difficulty": "q.difficulty",
}


def _missing_clauses(missing: dict) -> tuple[list[str], dict]:
    """把 ``{维度: bool}`` 翻译为「待补充」判定 SQL 片段与命名参数。

    仅当取值为 ``True`` 时生成条件；``False`` / ``None`` 一律**不过滤**（语义与
    ``has_answer`` / ``has_analysis`` 一致）。缺失 = ``NULL`` 或空串或命中该维度哨兵值。
    多个维度可任意 AND 叠加。

    返回 ``(clauses, params)``，``clauses`` 为可直接以 ``AND`` 连接的布尔表达式。
    """
    clauses: list[str] = []
    params: dict = {}
    for dim, sentinels in MISSING_SENTINELS.items():
        if missing.get(dim) is not True:
            continue
        col = _MISSING_COLUMNS[dim]
        parts = [f"{col} IS NULL", f"TRIM({col}) = ''"]
        for i, sentinel in enumerate(sentinels):
            key = f"miss_{dim}_{i}"
            parts.append(f"{col} = :{key}")
            params[key] = sentinel
        clauses.append("(" + " OR ".join(parts) + ")")
    return clauses, params


# --------------------------------------------------------------------------- #
# 新增（Web 界面）：带内容标志过滤的检索 / 单题标签（含复核状态）
# --------------------------------------------------------------------------- #
def search_full(conn, *, keyword: str | None = None, stage: str | None = None,
                subject: str | None = None, grade: str | None = None,
                textbook: str | None = None, chapter: str | None = None,
                qtype: str | None = None, difficulty: str | None = None,
                section: str | None = None, number: str | None = None,
                labels: list[str] | None = None, needs_review: bool | None = None,
                label_review: str | None = None, label_namespace: str | None = None,
                has_answer: bool | None = None, has_analysis: bool | None = None,
                grade_missing: bool | None = None, textbook_missing: bool | None = None,
                chapter_missing: bool | None = None, qtype_missing: bool | None = None,
                difficulty_missing: bool | None = None,
                limit: int = 20, offset: int = 0) -> dict:
    """与 :func:`search` 同义，**额外支持**内容标志与「待补充」缺失过滤。

    为什么需要它：Web 检索页的「有/无答案」「有/无解析」以及各维度「待补充 (n)」桶的
    筛选需参与 ``total`` 计数与分页，不能在应用层做后置过滤（否则分页总数不准）。
    本函数复用 :func:`_build_where` 与 :func:`_from_with_fts`，仅在 WHERE 末尾追加：

    * ``has_answer`` / ``has_analysis``：答案 / 解析的有无判定；
    * ``grade_missing`` / ``textbook_missing`` / ``chapter_missing`` / ``qtype_missing`` /
      ``difficulty_missing``：该维度**缺失元数据**（``NULL`` / 空串 / 哨兵值）的判定，
      见 :data:`MISSING_SENTINELS`。取 ``True`` 才过滤，``False`` / ``None`` 不过滤，
      多个维度可 AND 叠加。

    **不改既有函数**。返回结构与 :func:`search` 一致：``{"total","items","limit","offset"}``。
    """
    where, params, use_fts = _build_where(
        keyword, stage, subject, grade, textbook, chapter, qtype, difficulty,
        section, number, labels, needs_review,
        label_review=label_review, label_namespace=label_namespace)

    q_cols = {r[1] for r in conn.execute("PRAGMA table_info(questions)")}
    extra: list[str] = []
    if "answer" in q_cols:
        if has_answer is True:
            extra.append("q.answer IS NOT NULL AND q.answer != ''")
        elif has_answer is False:
            extra.append("(q.answer IS NULL OR q.answer = '')")
    if "analysis" in q_cols:
        if has_analysis is True:
            extra.append("q.analysis IS NOT NULL AND q.analysis != ''")
        elif has_analysis is False:
            extra.append("(q.analysis IS NULL OR q.analysis = '')")
    # 「待补充」缺失过滤（哨兵感知；仅 True 生效，可 AND 叠加）。
    miss_clauses, miss_params = _missing_clauses({
        "grade": grade_missing, "textbook": textbook_missing, "chapter": chapter_missing,
        "qtype": qtype_missing, "difficulty": difficulty_missing,
    })
    extra.extend(miss_clauses)
    params.update(miss_params)
    if extra:
        cond = " AND ".join(extra)
        where = (where + " AND " + cond) if where else (" WHERE " + cond)

    # 结果列：基础列 + 内容标志（B2：检索结果卡渲染答案/解析徽章所需）。
    # 均为**内联计算列**（不额外查询，实测 ≈0 成本），按列存在性决定是否下发，兼容未迁移的旧库。
    # 注：``needs_review`` 需查 ``formulas`` 表（相关子查询，实测 +1.0~1.4ms/次），
    # 因检索为高频路径且 B2 未要求，故**不下发**；如前端需「待复核」徽章再评估。
    select_parts: list[str] = [_ITEM_COLUMNS]
    if "answer" in q_cols:
        select_parts.append("(q.answer IS NOT NULL AND q.answer != '') AS has_answer")
    if "analysis" in q_cols:
        select_parts.append("(q.analysis IS NOT NULL AND q.analysis != '') AS has_analysis")
    select_sql = ", ".join(select_parts)

    from_sql = _from_with_fts(use_fts)
    total = conn.execute(f"SELECT COUNT(*) AS c {from_sql}{where}", params).fetchone()["c"]
    order = "ORDER BY bm25(question_fts)" if use_fts else "ORDER BY q.id"
    params = dict(params)
    params["limit"] = int(limit)
    params["offset"] = int(offset)
    rows = conn.execute(
        f"SELECT {select_sql} {from_sql}{where} {order} LIMIT :limit OFFSET :offset",
        params).fetchall()
    return {"total": total, "items": [dict(r) for r in rows],
            "limit": limit, "offset": offset}


def question_review_flags(conn, question_ids: list[int]) -> dict[int, bool]:
    """批量读取当前页公式复核标志，不改变检索排序、分页与过滤语义。"""
    ids = list(dict.fromkeys(question_ids))
    if not ids:
        return {}
    slots = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT DISTINCT question_id FROM formulas WHERE question_id IN ({slots})"
        " AND needs_review = 1", ids).fetchall()
    flagged = {r[0] for r in rows}
    return {qid: qid in flagged for qid in ids}


def review_context(conn, review_ids: list[int]) -> dict[int, dict]:
    """批量取复核项题干、当前公式和源文件信息；不额外读取整题详情。"""
    if not review_ids:
        return {}
    slots = ",".join("?" for _ in review_ids)
    rows = conn.execute(
        "SELECT rq.id, q.text AS question_text, f.fid, f.latex, s.path AS source_path"
        " FROM review_queue rq LEFT JOIN questions q ON q.id = rq.question_id"
        " LEFT JOIN formulas f ON f.id = rq.formula_id"
        " LEFT JOIN source_files s ON s.id = q.source_id"
        f" WHERE rq.id IN ({slots})", review_ids).fetchall()
    return {r["id"]: dict(r) for r in rows}


def review_preview_source(conn, review_id: int) -> dict | None:
    """只按数据库记录定位复核预览，客户端不能指定文件路径。"""
    row = conn.execute(
        "SELECT rq.preview, s.path FROM review_queue rq"
        " LEFT JOIN questions q ON q.id = rq.question_id"
        " LEFT JOIN source_files s ON s.id = q.source_id WHERE rq.id = ?",
        (review_id,)).fetchone()
    return dict(row) if row else None


def question_labels(conn, question_id: int) -> list[dict]:
    """取某题的全部标签关联（含 ``review_status`` 与 ``source``），供详情页三态展示。

    ``question_labels.source`` 列由 ``enrich`` 的迁移添加；若库中尚无该列则退化为空值，
    **不报错**。
    """
    has_src = "source" in {r[1] for r in conn.execute("PRAGMA table_info(question_labels)")}
    src_expr = "ql.source" if has_src else "NULL"
    rows = conn.execute(
        f"SELECT l.namespace, l.name, ql.review_status, {src_expr} AS source"
        " FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
        " WHERE ql.question_id = ? ORDER BY l.namespace, l.name", (question_id,)).fetchall()
    return [dict(r) for r in rows]


def search_with_grade_gap(conn, **filters) -> dict:
    """保留原检索结果，另计符合其他全部条件但年级未标注的题量。

    缺失题不意味着属于所选年级，不混入原结果。复用 search_full 的全部筛选语义，
    包括内容标志、知识点严格模式及其他 missing 桶，计数不受当前分页影响。
    """
    data = search_full(conn, **filters)
    data['grade_gap'] = None
    grade = filters.get('grade')
    if not grade or filters.get('grade_missing') or grade.strip() in MISSING_SENTINELS['grade']:
        return data
    alternative = dict(filters)
    alternative.update(grade=None, grade_missing=True, limit=0, offset=0)
    count = search_full(conn, **alternative)['total']
    data['grade_gap'] = {'selected_grade': grade, 'count': count}
    return data


__all__ = ["search", "get_question", "list_review", "stats", "list_labels", "list_sources",
           "facets", "coverage_summary", "source_detail",
           "search_full", "question_labels", "MISSING_SENTINELS"]
