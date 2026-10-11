"""组卷：试卷数据模型 + 组卷操作 + 导出数据准备（阶段3）。

职责
----
* **数据模型**：扩展 ``papers``（试卷元数据）、新增 ``paper_sections``（大题分组）、
  重建 ``paper_questions``（题目条目，含题序 ``seq`` 与内容快照 ``snapshot_json``）。
  迁移**幂等**（重复执行不报错）。
* **组卷操作**：建卷 / 加题 / 移除 / 重排 / 设分 / 大题分组管理 / 试卷概览。
* **导出数据准备**：:func:`build_export_payload` 产出结构化数据（JSON）供阶段4 渲染，
  本模块**不生成** DOCX / PDF。

关键设计
--------
1. **快照锁定版本**：加题时记录 ``question_version``，并把该题的题干、公式、图片、
   来源定位一并写入 ``paper_questions.snapshot_json``。**之后题库里该题被修改，
   已建试卷的内容不会改变**（导出只读快照）。
2. **允许题目重复**：同一道题在同一份试卷里可出现多次（例如不同大题各用一次），
   因此 ``paper_questions`` 对 ``(paper_id, question_id)`` **不加唯一约束**。
3. **题序连续**：``seq`` 为全卷 1..n 连续无空洞；删除 / 移动后自动重排。
4. **分值合计**：总分 = 各题分值之和；未设分值的题 ``score`` 为 ``NULL``，
   单独统计，**不当作 0**。
5. **跨题共用材料**：以 ``(来源文件, 大题 section)`` 为「材料/大题」组；
   ``add_questions(..., keep_material_together=True)`` 会把同组题目**整体加入且保持相邻**。
   注意：阶段1 产出**没有**段落级「共用材料」标识，故这里只能按「来源 + 大题」聚合，
   **真正的段落级材料识别未实现**（详见 ``bank/README.md``）。

术语
----
* **item**：试卷里的一条题目条目（``paper_questions`` 行），由 ``item_id`` 标识；
  与「题库里的题」（``question_id``）区分开——同一 ``question_id`` 可有多个 item。
"""

# ---------------------------------------------------------------------------
# title: 组卷
# description: 试卷/大题/条目数据模型、组卷操作（增删改排、设分、大题分组）与导出数据准备；含幂等迁移、题目版本锁定与内容快照。
# author: 待补充
# version: 0.1.0
# category: 阶段3-组卷
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import math
import re
import sqlite3
import time

from . import answers as _answers
from . import db as _db

# --------------------------------------------------------------------------- #
# 常量 / 取值约束
# --------------------------------------------------------------------------- #
#: 试卷模板（对应学科网三种常见模板思路）。
TEMPLATES: tuple[str, ...] = ("考试", "测验", "作业")
DEFAULT_TEMPLATE = "考试"

#: 答案显示方式（供阶段4 导出使用）。
ANSWER_MODES: tuple[str, ...] = ("学生版", "答案解析版", "仅答案")
DEFAULT_ANSWER_MODE = "学生版"

#: 试卷状态。
PAPER_STATUSES: tuple[str, ...] = ("草稿", "定稿", "已导出")
DEFAULT_STATUS = "草稿"

#: 作者类字段默认值（用户要求「待补充」）。
DEFAULT_AUTHOR = "待补充"

#: 无大题归属时的展示名。
UNGROUPED = "未分组"

#: 分值合法范围（F5）：允许 **0**（占位）与**小数**（中国考试 0.5 分很常见），
#: 拒绝**负数**（负分无意义）与**明显手滑的超大值**（> :data:`MAX_SCORE`）。
MIN_SCORE: float = 0.0
MAX_SCORE: float = 1000.0


def _now() -> str:
    """当前时间戳（ISO 8601，秒级）。"""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


# --------------------------------------------------------------------------- #
# 迁移（幂等）
# --------------------------------------------------------------------------- #
#: ``papers`` 需要补的列 -> 列定义（含默认值，保证 ADD COLUMN 可作用于既有行）。
_PAPER_COLUMNS: tuple[tuple[str, str], ...] = (
    ("subject", "TEXT"),
    ("stage", "TEXT"),
    ("grade", "TEXT"),
    ("template", f"TEXT NOT NULL DEFAULT '{DEFAULT_TEMPLATE}'"),
    ("answer_mode", f"TEXT NOT NULL DEFAULT '{DEFAULT_ANSWER_MODE}'"),
    ("created_by", f"TEXT NOT NULL DEFAULT '{DEFAULT_AUTHOR}'"),
    ("status", f"TEXT NOT NULL DEFAULT '{DEFAULT_STATUS}'"),
    ("updated_at", "TEXT"),
)

#: ``paper_sections`` 建表（幂等）。
_PAPER_SECTIONS_DDL = """
CREATE TABLE IF NOT EXISTS paper_sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    description TEXT
);
CREATE INDEX IF NOT EXISTS idx_ps_paper ON paper_sections(paper_id);
"""

#: ``paper_questions`` 目标建表语句（重建迁移用；不含索引）。
_PAPER_QUESTIONS_CREATE = """
CREATE TABLE paper_questions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id         INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    section_id       INTEGER REFERENCES paper_sections(id) ON DELETE SET NULL,
    question_id      INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    question_version INTEGER NOT NULL,
    seq              INTEGER NOT NULL,
    score            REAL,
    snapshot_json    TEXT,
    added_at         TEXT,
    FOREIGN KEY (question_id, question_version)
        REFERENCES question_versions(question_id, version)
);
"""

#: ``paper_questions`` 索引（幂等）。
_PAPER_QUESTIONS_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_pq_paper ON paper_questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_pq_section ON paper_questions(section_id);
CREATE INDEX IF NOT EXISTS idx_pq_q ON paper_questions(question_id);
"""


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """返回某表的列名集合（只读 PRAGMA）。"""
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _rebuild_paper_questions(conn: sqlite3.Connection) -> None:
    """把旧版 ``paper_questions``（``position`` 列、无 ``section_id``/``snapshot_json``）
    重建为目标结构，**保留既有数据**（``position`` -> ``seq``）。

    步骤遵循 SQLite 官方「修改表结构」12 步法：关外键 -> 事务内 建新表/搬数据/换名。
    """
    cols = _columns(conn, "paper_questions")
    seq_expr = "seq" if "seq" in cols else ("position" if "position" in cols else "rowid")
    section_expr = "section_id" if "section_id" in cols else "NULL"
    snap_expr = "snapshot_json" if "snapshot_json" in cols else "NULL"
    added_expr = "added_at" if "added_at" in cols else "NULL"

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            "BEGIN;\n"
            "ALTER TABLE paper_questions RENAME TO paper_questions_legacy;\n"
            f"{_PAPER_QUESTIONS_CREATE}\n"
            "INSERT INTO paper_questions"
            " (id, paper_id, section_id, question_id, question_version, seq, score,"
            " snapshot_json, added_at)\n"
            " SELECT id, paper_id, {sec}, question_id, question_version, {seq}, score,"
            " {snap}, {added}\n"
            " FROM paper_questions_legacy;\n"
            "DROP TABLE paper_questions_legacy;\n"
            "COMMIT;\n".format(sec=section_expr, seq=seq_expr, snap=snap_expr, added=added_expr)
        )
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def ensure_paper_schema(conn: sqlite3.Connection) -> list[str]:
    """幂等地把库迁移到阶段3 的组卷 schema。返回本次实际变更项（重复执行返回 ``[]``）。

    变更项：
    * ``papers`` 补齐元数据列（subject/stage/grade/template/answer_mode/created_by/status/updated_at）；
    * 新建 ``paper_sections``；
    * 若 ``paper_questions`` 缺 ``seq``/``section_id``/``snapshot_json`` 则**重建**该表；
    * 把 ``meta.schema_version`` 更新为当前 :data:`bank.db.SCHEMA_VERSION`。

    **只读友好**：若 :func:`schema_ready` 为真，直接返回 ``[]`` 且**不做任何写操作**
    （不 ALTER、不写 ``meta``）——这样导出等只读流程（只读连接）也不会改动 ``bank.db``。
    """
    if schema_ready(conn):
        return []

    changed: list[str] = []

    existing = _columns(conn, "papers")
    for col, decl in _PAPER_COLUMNS:
        if col not in existing:
            conn.execute(f"ALTER TABLE papers ADD COLUMN {col} {decl}")
            changed.append(f"papers.{col}")
    conn.commit()

    before_sections = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_sections'").fetchone()
    conn.executescript(_PAPER_SECTIONS_DDL)
    if before_sections is None:
        changed.append("paper_sections(新建)")

    pq_cols = _columns(conn, "paper_questions")
    if not {"seq", "section_id", "snapshot_json"} <= pq_cols:
        _rebuild_paper_questions(conn)
        changed.append("paper_questions(重建)")

    conn.executescript(_PAPER_QUESTIONS_INDEXES)

    # 答案字段（阶段2 补充能力）：确保 questions 有 answer/analysis/answer_source 列，
    # 组卷快照才能把答案一并锁定。
    changed.extend(_answers.ensure_answer_columns(conn))

    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
                 (str(_db.SCHEMA_VERSION),))
    conn.commit()
    return changed


def schema_ready(conn: sqlite3.Connection) -> bool:
    """判断库是否已是阶段3 的组卷 schema（只读）。

    同时要求答案列（``questions.answer`` / ``analysis`` / ``answer_source``）已存在——
    这样 :func:`ensure_paper_schema` 在其为真时可**安全地不做任何写操作**。
    """
    try:
        pcols = _columns(conn, "papers")
        qcols = _columns(conn, "paper_questions")
        q_cols = _columns(conn, "questions")
        has_sections = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_sections'"
        ).fetchone() is not None
    except sqlite3.OperationalError:
        return False
    return ({"template", "answer_mode", "created_by", "status"} <= pcols
            and {"seq", "section_id", "snapshot_json"} <= qcols
            and has_sections
            and {"answer", "analysis", "answer_source"} <= q_cols)


# --------------------------------------------------------------------------- #
# 行 -> 字典
# --------------------------------------------------------------------------- #
def _paper_dict(row: sqlite3.Row) -> dict:
    """把 ``papers`` 行转成字典（解析 ``meta`` JSON）。"""
    d = dict(row)
    raw = d.get("meta")
    if raw:
        try:
            d["meta"] = json.loads(raw)
        except (ValueError, TypeError):
            d["meta"] = {"_raw": raw}
    return d


def _item_dict(row: sqlite3.Row) -> dict:
    """把 ``paper_questions`` 行转成字典，并展开快照里的展示字段。"""
    snap: dict = {}
    if row["snapshot_json"]:
        try:
            snap = json.loads(row["snapshot_json"])
        except (ValueError, TypeError):
            snap = {}
    src = snap.get("source") or {}
    return {
        "id": row["id"],
        "paper_id": row["paper_id"],
        "section_id": row["section_id"],
        "question_id": row["question_id"],
        "question_version": row["question_version"],
        "seq": row["seq"],
        "score": row["score"],
        "snapshot": snap,
        "number": snap.get("number"),
        "qtype": snap.get("qtype"),
        "difficulty": snap.get("difficulty"),
        "chapter": snap.get("chapter"),
        "source_section": snap.get("section"),
        "source_file": src.get("file_name"),
        "stage": src.get("stage"),
        "subject": src.get("subject"),
        "grade": src.get("grade"),
        "textbook": src.get("textbook"),
        "char_length": snap.get("char_length"),
        "formula_count": len(snap.get("formulas") or []),
        "image_count": len(snap.get("images") or []),
        "has_answer": bool(snap.get("answer")),
        "has_analysis": bool(snap.get("analysis")),
        "answer_source": snap.get("answer_source"),
    }


# --------------------------------------------------------------------------- #
# 内部校验 / 读取
# --------------------------------------------------------------------------- #
def _require_paper(conn: sqlite3.Connection, paper_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        raise ValueError(f"试卷不存在：{paper_id}")
    return row


def _require_section(conn: sqlite3.Connection, paper_id: int, section_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM paper_sections WHERE id = ? AND paper_id = ?",
                       (section_id, paper_id)).fetchone()
    if row is None:
        raise ValueError(f"大题不存在或不属于该试卷：section_id={section_id}, paper_id={paper_id}")
    return row


def _validate_score(score) -> float | None:
    """校验并归一化分值（F5）。

    * ``None`` → 返回 ``None``（表示「未设分值」，与「0 分」区分）；
    * 合法范围 ``[MIN_SCORE, MAX_SCORE]``：**允许 0**（占位）、**允许小数**（如 0.5）；
    * **拒绝负数**、**拒绝超大值**（> :data:`MAX_SCORE`，疑似手滑）、
      **拒绝非数字 / 非有限值**（``NaN`` / ``inf``）。

    非法值一律抛 :class:`ValueError`（明确报错），**不静默 clamp、不忽略**。
    """
    if score is None:
        return None
    if isinstance(score, bool):  # bool 是 int 的子类，需显式排除
        raise ValueError(f"分值不能是布尔值：{score!r}")
    try:
        val = float(score)
    except (TypeError, ValueError):
        raise ValueError(f"分值必须是数字，收到 {score!r}")
    if math.isnan(val) or math.isinf(val):
        raise ValueError(f"分值必须是有限数字，收到 {score!r}")
    if val < MIN_SCORE:
        raise ValueError(f"分值不能为负（收到 {val:g}）；合法范围 {MIN_SCORE:g}~{MAX_SCORE:g}")
    if val > MAX_SCORE:
        raise ValueError(f"分值过大（收到 {val:g}，上限 {MAX_SCORE:g}），疑似输入错误")
    return val


def _section_rows(conn: sqlite3.Connection, paper_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, paper_id, name, seq, description FROM paper_sections"
        " WHERE paper_id = ? ORDER BY seq, id", (paper_id,)).fetchall()


def _section_dict(conn: sqlite3.Connection, section_id: int) -> dict:
    """单个大题字典（含题目数、小计、未设分题数）。"""
    r = conn.execute("SELECT id, paper_id, name, seq, description FROM paper_sections"
                     " WHERE id = ?", (section_id,)).fetchone()
    if r is None:
        return {}
    stats = conn.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(score), 0) AS s,"
        " SUM(CASE WHEN score IS NULL THEN 1 ELSE 0 END) AS u"
        " FROM paper_questions WHERE section_id = ?", (section_id,)).fetchone()
    return {
        "id": r["id"], "paper_id": r["paper_id"], "name": r["name"],
        "seq": r["seq"], "description": r["description"],
        "item_count": stats["c"], "subtotal": round(stats["s"] or 0.0, 4),
        "unscored_count": stats["u"] or 0,
    }


def _list_sections(conn: sqlite3.Connection, paper_id: int) -> list[dict]:
    """列出试卷的大题（含小计）。"""
    out = []
    for r in _section_rows(conn, paper_id):
        stats = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(score), 0) AS s,"
            " SUM(CASE WHEN score IS NULL THEN 1 ELSE 0 END) AS u"
            " FROM paper_questions WHERE paper_id = ? AND section_id = ?",
            (paper_id, r["id"])).fetchone()
        out.append({
            "id": r["id"], "paper_id": r["paper_id"], "name": r["name"],
            "seq": r["seq"], "description": r["description"],
            "item_count": stats["c"], "subtotal": round(stats["s"] or 0.0, 4),
            "unscored_count": stats["u"] or 0,
        })
    return out


def list_items(conn: sqlite3.Connection, paper_id: int) -> list[dict]:
    """按题序列出试卷的全部条目（含展开的快照展示字段）。"""
    rows = conn.execute(
        "SELECT * FROM paper_questions WHERE paper_id = ? ORDER BY seq, id",
        (paper_id,)).fetchall()
    return [_item_dict(r) for r in rows]


def _item_ids_in_order(conn: sqlite3.Connection, paper_id: int) -> list[int]:
    return [r["id"] for r in conn.execute(
        "SELECT id FROM paper_questions WHERE paper_id = ? ORDER BY seq, id", (paper_id,))]


def _resequence(conn: sqlite3.Connection, paper_id: int) -> None:
    """把全卷 ``seq`` 重排为 1..n 连续（不提交）。"""
    for i, oid in enumerate(_item_ids_in_order(conn, paper_id), start=1):
        conn.execute("UPDATE paper_questions SET seq = ? WHERE id = ?", (i, oid))


def _resequence_sections(conn: sqlite3.Connection, paper_id: int) -> None:
    """把大题 ``seq`` 重排为 1..n 连续（不提交）。"""
    rows = conn.execute("SELECT id FROM paper_sections WHERE paper_id = ? ORDER BY seq, id",
                        (paper_id,)).fetchall()
    for i, r in enumerate(rows, start=1):
        conn.execute("UPDATE paper_sections SET seq = ? WHERE id = ?", (i, r["id"]))


def _touch(conn: sqlite3.Connection, paper_id: int) -> None:
    """更新试卷 ``updated_at``（不提交）。"""
    conn.execute("UPDATE papers SET updated_at = ? WHERE id = ?", (_now(), paper_id))


# --------------------------------------------------------------------------- #
# 题目快照
# --------------------------------------------------------------------------- #
def _snapshot_question(conn: sqlite3.Connection, question_id: int, *, readonly: bool = False) -> dict:
    """为一道题生成**内容快照**（题干取自锁定版本，公式/图片/来源取自当前）。

    加题时 ``question.version`` 即当前版本，因此此刻的公式/图片与该版本一致；
    快照落库后不再随题库变化，从而锁定试卷内容。
    """
    q = conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    if q is None:
        raise ValueError(f"题目不存在：{question_id}")
    version = int(q["version"])

    vrow = conn.execute(
        "SELECT text, plain_text, char_length, content_hash FROM question_versions"
        " WHERE question_id = ? AND version = ?", (question_id, version)).fetchone()
    if vrow is None and not readonly:
        # 兼容历史库：缺少版本行时补写当前版本，保证复合外键可用。
        conn.execute(
            "INSERT OR IGNORE INTO question_versions(question_id, version, content_hash, text,"
            " plain_text, char_length, created_at) VALUES (?,?,?,?,?,?,?)",
            (question_id, version, q["content_hash"], q["text"], q["plain_text"],
             q["char_length"], _now()))
        vrow = conn.execute(
            "SELECT text, plain_text, char_length, content_hash FROM question_versions"
            " WHERE question_id = ? AND version = ?", (question_id, version)).fetchone()
    if vrow is None:
        vrow = q

    src = conn.execute("SELECT * FROM source_files WHERE id = ?", (q["source_id"],)).fetchone()
    formulas = conn.execute(
        "SELECT fid, seq, kind, status, latex, progid, part, preview, needs_review"
        " FROM formulas WHERE question_id = ? ORDER BY seq, id", (question_id,)).fetchall()
    images = conn.execute(
        "SELECT media_path, sha256 FROM images WHERE question_id = ? ORDER BY id",
        (question_id,)).fetchall()

    # 答案/解析随题目一并锁定进快照：出卷后题库改题（含改答案）不影响已出卷。
    qkeys = set(q.keys())
    answer = q["answer"] if "answer" in qkeys else None
    analysis = q["analysis"] if "analysis" in qkeys else None
    answer_source = q["answer_source"] if "answer_source" in qkeys else None

    return {
        "question_id": int(question_id),
        "version": version,
        "number": q["number"],
        "label": q["label"],
        "qtype": q["qtype"],
        "difficulty": q["difficulty"],
        "section": q["section"],
        "chapter": q["chapter"],
        "content_hash": vrow["content_hash"],
        "char_length": vrow["char_length"],
        "text": vrow["text"],
        "plain_text": vrow["plain_text"],
        "answer": answer,
        "analysis": analysis,
        "answer_source": answer_source,
        "formulas": [dict(f) for f in formulas],
        "images": [dict(im) for im in images],
        "source": {
            "source_id": q["source_id"],
            "file_name": src["file_name"] if src else None,
            "sha256": src["sha256"] if src else None,
            "stage": src["stage"] if src else None,
            "subject": src["subject"] if src else None,
            "grade": src["grade"] if src else None,
            "textbook": src["textbook"] if src else None,
            "chapter": q["chapter"],
            "start_paragraph": q["start_paragraph"],
            "end_paragraph": q["end_paragraph"],
        },
    }


def question_group(conn: sqlite3.Connection, question_id: int) -> list[int]:
    """返回与 ``question_id`` 同属一个「材料/大题」组的题目 id（含自身），按段落顺序。

    组定义：**同一来源文件 + 同一非空 ``section``（大题）**下的题目。``section`` 为空时
    返回 ``[question_id]``（单题）。这是阶段1 产出所能支持的最细粒度——**真正的
    段落级「共用材料」识别未实现**（阶段1 未输出材料标识）。
    """
    row = conn.execute("SELECT source_id, section FROM questions WHERE id = ?",
                       (question_id,)).fetchone()
    if row is None:
        return []
    if not row["section"]:
        return [int(question_id)]
    rows = conn.execute(
        "SELECT id FROM questions WHERE source_id = ? AND IFNULL(section, '') = ?"
        " ORDER BY start_paragraph, id", (row["source_id"], row["section"])).fetchall()
    return [r["id"] for r in rows]


def _expand_material_groups(conn: sqlite3.Connection, question_ids: list[int]) -> list[int]:
    """把题目列表扩展为「整组」并去重保序。"""
    out: list[int] = []
    seen: set[int] = set()
    for qid in question_ids:
        for gid in question_group(conn, qid):
            if gid not in seen:
                seen.add(gid)
                out.append(gid)
    return out


# --------------------------------------------------------------------------- #
# 试卷 CRUD
# --------------------------------------------------------------------------- #
def create_paper(conn: sqlite3.Connection, title: str, *, subject: str | None = None,
                 stage: str | None = None, grade: str | None = None,
                 template: str = DEFAULT_TEMPLATE, answer_mode: str = DEFAULT_ANSWER_MODE,
                 created_by: str = DEFAULT_AUTHOR, status: str = DEFAULT_STATUS,
                 meta: dict | None = None) -> dict:
    """新建试卷，返回试卷字典（含大题/条目/概览）。"""
    ensure_paper_schema(conn)
    if not title or not str(title).strip():
        raise ValueError("试卷标题不能为空")
    if template not in TEMPLATES:
        raise ValueError(f"template 取值必须是 {TEMPLATES}，收到 {template!r}")
    if answer_mode not in ANSWER_MODES:
        raise ValueError(f"answer_mode 取值必须是 {ANSWER_MODES}，收到 {answer_mode!r}")
    if status not in PAPER_STATUSES:
        raise ValueError(f"status 取值必须是 {PAPER_STATUSES}，收到 {status!r}")

    now = _now()
    cur = conn.execute(
        "INSERT INTO papers(title, subject, stage, grade, template, answer_mode, created_by,"
        " status, created_at, updated_at, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (str(title).strip(), subject, stage, grade, template, answer_mode, created_by,
         status, now, now, json.dumps(meta, ensure_ascii=False) if meta else None))
    conn.commit()
    return get_paper(conn, cur.lastrowid)


def list_papers(conn: sqlite3.Connection, *, status: str | None = None,
                subject: str | None = None) -> list[dict]:
    """列出试卷（含题目数、大题数、总分、未设分题数），按 id 倒序。"""
    ensure_paper_schema(conn)
    clauses: list[str] = []
    params: dict = {}
    if status:
        clauses.append("p.status = :status")
        params["status"] = status
    if subject:
        clauses.append("p.subject = :subject")
        params["subject"] = subject
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        "SELECT p.*,"
        " (SELECT COUNT(*) FROM paper_questions pq WHERE pq.paper_id = p.id) AS item_count,"
        " (SELECT COUNT(*) FROM paper_sections ps WHERE ps.paper_id = p.id) AS section_count,"
        " (SELECT COALESCE(SUM(pq.score), 0) FROM paper_questions pq"
        "  WHERE pq.paper_id = p.id) AS total_score,"
        " (SELECT COUNT(*) FROM paper_questions pq"
        "  WHERE pq.paper_id = p.id AND pq.score IS NULL) AS unscored_count"
        f" FROM papers p{where} ORDER BY p.id DESC", params).fetchall()
    out = []
    for r in rows:
        d = _paper_dict(r)
        d["total_score"] = round(d.get("total_score") or 0.0, 4)
        out.append(d)
    return out


def get_paper(conn: sqlite3.Connection, paper_id: int) -> dict | None:
    """取试卷完整信息（元数据 + 大题 + 条目 + 概览）；不存在返回 ``None``。"""
    ensure_paper_schema(conn)
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        return None
    paper = _paper_dict(row)
    paper["sections"] = _list_sections(conn, paper_id)
    paper["items"] = list_items(conn, paper_id)
    paper["summary"] = paper_summary(conn, paper_id)
    return paper


def delete_paper(conn: sqlite3.Connection, paper_id: int, *, force: bool = False) -> dict:
    """删除试卷。非空且 ``force=False`` 时拒绝；``force=True`` 时级联清理大题与条目。"""
    ensure_paper_schema(conn)
    row = conn.execute("SELECT id FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        return {"deleted": False, "paper_id": paper_id, "reason": "试卷不存在"}
    cnt = conn.execute("SELECT COUNT(*) FROM paper_questions WHERE paper_id = ?",
                       (paper_id,)).fetchone()[0]
    if cnt and not force:
        return {"deleted": False, "paper_id": paper_id,
                "reason": f"试卷含 {cnt} 道题，需 force=True 确认"}
    conn.execute("DELETE FROM paper_questions WHERE paper_id = ?", (paper_id,))
    conn.execute("DELETE FROM paper_sections WHERE paper_id = ?", (paper_id,))
    conn.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
    conn.commit()
    return {"deleted": True, "paper_id": paper_id, "removed_items": cnt}


def orphans(conn: sqlite3.Connection) -> dict:
    """统计孤儿行（用于测试级联清理）：引用不存在试卷的条目/大题。"""
    pq = conn.execute(
        "SELECT COUNT(*) FROM paper_questions pq"
        " WHERE NOT EXISTS (SELECT 1 FROM papers p WHERE p.id = pq.paper_id)").fetchone()[0]
    ps = conn.execute(
        "SELECT COUNT(*) FROM paper_sections ps"
        " WHERE NOT EXISTS (SELECT 1 FROM papers p WHERE p.id = ps.paper_id)").fetchone()[0]
    return {"paper_questions": pq, "paper_sections": ps}


# --------------------------------------------------------------------------- #
# 大题分组
# --------------------------------------------------------------------------- #
def add_section(conn: sqlite3.Connection, paper_id: int, name: str, *,
                description: str | None = None, position: int | None = None) -> dict:
    """新增大题。``position`` 省略则追加到末尾；返回大题字典。"""
    ensure_paper_schema(conn)
    _require_paper(conn, paper_id)
    if not name or not str(name).strip():
        raise ValueError("大题名称不能为空")
    rows = _section_rows(conn, paper_id)
    n = len(rows)
    seq = n + 1 if position is None else max(1, min(int(position), n + 1))
    for r in rows:
        if r["seq"] >= seq:
            conn.execute("UPDATE paper_sections SET seq = seq + 1 WHERE id = ?", (r["id"],))
    cur = conn.execute(
        "INSERT INTO paper_sections(paper_id, name, seq, description) VALUES (?,?,?,?)",
        (paper_id, str(name).strip(), seq, description))
    _touch(conn, paper_id)
    conn.commit()
    return _section_dict(conn, cur.lastrowid)


def rename_section(conn: sqlite3.Connection, paper_id: int, section_id: int,
                   new_name: str) -> dict:
    """重命名大题。"""
    ensure_paper_schema(conn)
    _require_section(conn, paper_id, section_id)
    if not new_name or not str(new_name).strip():
        raise ValueError("大题名称不能为空")
    conn.execute("UPDATE paper_sections SET name = ? WHERE id = ?",
                 (str(new_name).strip(), section_id))
    _touch(conn, paper_id)
    conn.commit()
    return _section_dict(conn, section_id)


def move_section(conn: sqlite3.Connection, paper_id: int, section_id: int,
                 new_position: int) -> dict:
    """移动大题到指定位置，并**按大题顺序重排题目块**（题序保持连续）。"""
    ensure_paper_schema(conn)
    _require_section(conn, paper_id, section_id)
    ids = [r["id"] for r in _section_rows(conn, paper_id)]
    ids.remove(section_id)
    pos = max(1, min(int(new_position), len(ids) + 1))
    ids.insert(pos - 1, section_id)
    for i, sid in enumerate(ids, start=1):
        conn.execute("UPDATE paper_sections SET seq = ? WHERE id = ?", (i, sid))
    _regroup_items(conn, paper_id)
    _touch(conn, paper_id)
    conn.commit()
    return {"moved": True, "section_id": section_id, "position": pos}


def delete_section(conn: sqlite3.Connection, paper_id: int, section_id: int,
                   *, force: bool = False) -> dict:
    """删除大题。大题下仍有题目且 ``force=False`` 时拒绝；``force=True`` 时其题目变为
    「未分组」（``section_id`` 置空），题序保持不变。"""
    ensure_paper_schema(conn)
    _require_section(conn, paper_id, section_id)
    cnt = conn.execute("SELECT COUNT(*) FROM paper_questions WHERE section_id = ?",
                       (section_id,)).fetchone()[0]
    if cnt and not force:
        return {"deleted": False, "section_id": section_id,
                "reason": f"大题下仍有 {cnt} 道题，需 force=True 确认"}
    conn.execute("UPDATE paper_questions SET section_id = NULL WHERE section_id = ?",
                 (section_id,))
    conn.execute("DELETE FROM paper_sections WHERE id = ?", (section_id,))
    _resequence_sections(conn, paper_id)
    _resequence(conn, paper_id)
    _touch(conn, paper_id)
    conn.commit()
    return {"deleted": True, "section_id": section_id, "ungrouped": cnt}


def _regroup_items(conn: sqlite3.Connection, paper_id: int) -> None:
    """按大题顺序重排题目块；无大题归属的题目排在最后。题序重排为 1..n（不提交）。"""
    order: list[int] = []
    for s in _section_rows(conn, paper_id):
        order.extend(r["id"] for r in conn.execute(
            "SELECT id FROM paper_questions WHERE paper_id = ? AND section_id = ?"
            " ORDER BY seq, id", (paper_id, s["id"])))
    order.extend(r["id"] for r in conn.execute(
        "SELECT id FROM paper_questions WHERE paper_id = ? AND section_id IS NULL"
        " ORDER BY seq, id", (paper_id,)))
    for i, oid in enumerate(order, start=1):
        conn.execute("UPDATE paper_questions SET seq = ? WHERE id = ?", (i, oid))


# --------------------------------------------------------------------------- #
# 题目条目操作
# --------------------------------------------------------------------------- #
def _resolve_section(conn: sqlite3.Connection, paper_id: int, section) -> int | None:
    """把 section 参数（id / 名称）解析为 section_id；名称为新名时自动创建。"""
    if section is None:
        return None
    if isinstance(section, int) or (isinstance(section, str) and section.isdigit()):
        sid = int(section)
        _require_section(conn, paper_id, sid)
        return sid
    name = str(section).strip()
    row = conn.execute("SELECT id FROM paper_sections WHERE paper_id = ? AND name = ?",
                       (paper_id, name)).fetchone()
    if row is not None:
        return row["id"]
    return add_section(conn, paper_id, name)["id"]


def add_questions(conn: sqlite3.Connection, paper_id: int, question_ids,
                  *, section_id: int | None = None, section=None, position: int | None = None,
                  score: float | None = None,
                  keep_material_together: bool = False) -> dict:
    """把题目加入试卷。

    参数
    ----
    question_ids         题库中的题目 id 列表（顺序即加入顺序）。
    section_id/section   归入的大题；``section`` 可传 id 或名称（新名自动创建）。
    position             插入的**全卷题序**（1 起）；省略则追加。
    score                统一分值；省略则 ``NULL``（未设分值）。
    keep_material_together  为 True 时，把每个题目扩展为「材料/大题」整组一并加入。

    返回 ``{"added":[{item_id, question_id, question_version, seq}], "count", "expanded"}``。
    """
    ensure_paper_schema(conn)
    _require_paper(conn, paper_id)

    score = _validate_score(score)   # F5：统一分值也需校验

    ids = [int(q) for q in question_ids]
    expanded = False
    if keep_material_together:
        new_ids = _expand_material_groups(conn, ids)
        expanded = new_ids != ids
        ids = new_ids

    from . import export_content as content
    candidates = [_snapshot_question(conn, qid, readonly=True) for qid in ids]
    candidate_issues = []
    cache = {}
    for index, snap in enumerate(candidates, start=1):
        candidate_issues.extend(content._inspect_snapshot(conn, snap, paper_id=paper_id, seq=index, _source_cache=cache)['issues'])
    candidate_diagnostics = {'issues': candidate_issues, 'export_allowed': not any(i['severity']=='blocker' for i in candidate_issues), 'blocker_count': sum(i['severity']=='blocker' for i in candidate_issues), 'warning_count': sum(i['severity']=='warning' for i in candidate_issues), 'duplicate_groups': [], 'revision_proposal': {'exclude_item_ids': [], 'keep_item_ids': [], 'unresolved_item_ids': [], 'message': '新选题内容预检'}, 'diagnostic_digest': content.digest(candidate_issues)}
    content.require_export_allowed(candidate_diagnostics, '答案解析版')
    if section_id is None and section is not None:
        section_id = _resolve_section(conn, paper_id, section)
    if section_id is not None:
        _require_section(conn, paper_id, section_id)
    snapshots = [_snapshot_question(conn, qid) for qid in ids]

    order = _item_ids_in_order(conn, paper_id)
    n = len(order)
    if position is not None:
        insert_at = max(0, min(int(position) - 1, n))
    elif section_id is not None:
        idxs = [i for i, r in enumerate(conn.execute(
            "SELECT id, section_id FROM paper_questions WHERE paper_id = ? ORDER BY seq, id",
            (paper_id,)).fetchall()) if r["section_id"] == section_id]
        insert_at = (max(idxs) + 1) if idxs else n
    else:
        insert_at = n

    final: list[int | None] = order[:insert_at] + [None] * len(snapshots) + order[insert_at:]
    now = _now()
    snap_iter = iter(snapshots)
    added: list[dict] = []
    for idx, oid in enumerate(final, start=1):
        if oid is None:
            snap = next(snap_iter)
            cur = conn.execute(
                "INSERT INTO paper_questions(paper_id, section_id, question_id,"
                " question_version, seq, score, snapshot_json, added_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (paper_id, section_id, snap["question_id"], snap["version"], idx, score,
                 json.dumps(snap, ensure_ascii=False), now))
            added.append({"item_id": cur.lastrowid, "question_id": snap["question_id"],
                          "question_version": snap["version"], "seq": idx})
        else:
            conn.execute("UPDATE paper_questions SET seq = ? WHERE id = ?", (idx, oid))
    _touch(conn, paper_id)
    conn.commit()
    diagnostics = content.inspect_paper(conn, paper_id)['diagnostics']
    return {"added": added, "count": len(added), "expanded": expanded,
            'warnings': diagnostics['issues'], 'duplicate_groups': diagnostics['duplicate_groups']}


def remove_question(conn: sqlite3.Connection, paper_id: int, item_id: int) -> dict:
    """移除试卷中的一条题目条目，并重排题序。"""
    ensure_paper_schema(conn)
    row = conn.execute("SELECT id FROM paper_questions WHERE id = ? AND paper_id = ?",
                       (item_id, paper_id)).fetchone()
    if row is None:
        return {"removed": False, "item_id": item_id, "reason": "条目不存在"}
    conn.execute("DELETE FROM paper_questions WHERE id = ?", (item_id,))
    _resequence(conn, paper_id)
    _touch(conn, paper_id)
    conn.commit()
    return {"removed": True, "item_id": item_id}


def move_question(conn: sqlite3.Connection, paper_id: int, item_id: int,
                  new_position: int) -> dict:
    """把一条题目条目移动到指定的全卷题序（1 起），重排题序保持连续。"""
    ensure_paper_schema(conn)
    order = _item_ids_in_order(conn, paper_id)
    if item_id not in order:
        return {"moved": False, "item_id": item_id, "reason": "条目不存在"}
    order.remove(item_id)
    pos = max(1, min(int(new_position), len(order) + 1))
    order.insert(pos - 1, item_id)
    for i, oid in enumerate(order, start=1):
        conn.execute("UPDATE paper_questions SET seq = ? WHERE id = ?", (i, oid))
    _touch(conn, paper_id)
    conn.commit()
    return {"moved": True, "item_id": item_id, "position": pos, "count": len(order)}


def set_score(conn: sqlite3.Connection, paper_id: int, item_id: int,
              score: float | None) -> dict:
    """设置某条目的分值；``score=None`` 表示清除（未设分值）。

    分值经 :func:`_validate_score` 校验（F5）：允许 0 与小数，拒绝负数 / 超大值 /
    非数字；非法值抛 :class:`ValueError`。合法范围见 :data:`MIN_SCORE` / :data:`MAX_SCORE`。
    """
    ensure_paper_schema(conn)
    val = _validate_score(score)
    row = conn.execute("SELECT id FROM paper_questions WHERE id = ? AND paper_id = ?",
                       (item_id, paper_id)).fetchone()
    if row is None:
        return {"updated": False, "item_id": item_id, "reason": "条目不存在"}
    conn.execute("UPDATE paper_questions SET score = ? WHERE id = ?", (val, item_id))
    _touch(conn, paper_id)
    conn.commit()
    return {"updated": True, "item_id": item_id, "score": val}


def set_scores(conn: sqlite3.Connection, paper_id: int, mapping) -> dict:
    """批量设置分值。``mapping`` 可为 ``{item_id: score}`` 或 ``[(item_id, score), ...]``。

    **先整体校验再逐条写入**：任一分值非法即抛 :class:`ValueError`，避免「改了一半才失败」。
    """
    ensure_paper_schema(conn)
    items = list(mapping.items() if isinstance(mapping, dict) else mapping)
    for _, score in items:   # F5：先全部校验，保证批量语义（要么都合法、要么直接报错）
        _validate_score(score)
    updated = 0
    missing: list[int] = []
    for item_id, score in items:
        res = set_score(conn, paper_id, item_id, score)
        if res["updated"]:
            updated += 1
        else:
            missing.append(item_id)
    return {"updated": updated, "missing": missing}


# --------------------------------------------------------------------------- #
# 概览
# --------------------------------------------------------------------------- #
def paper_summary(conn: sqlite3.Connection, paper_id: int) -> dict:
    """试卷概览：题目数、总分、各大题小计、题型分布、未设分统计。"""
    ensure_paper_schema(conn)
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        return {}
    items = list_items(conn, paper_id)
    sections = _list_sections(conn, paper_id)
    scored = [it for it in items if it["score"] is not None]
    unscored = [it for it in items if it["score"] is None]
    total = sum(it["score"] for it in scored)

    dist: dict[str, int] = {}
    for it in items:
        key = it["qtype"] or "未分类"
        dist[key] = dist.get(key, 0) + 1

    ungrouped = [it for it in items if it["section_id"] is None]
    ungrouped_info = None
    if ungrouped:
        ungrouped_info = {
            "name": UNGROUPED,
            "item_count": len(ungrouped),
            "subtotal": round(sum(it["score"] for it in ungrouped if it["score"] is not None), 4),
            "unscored_count": sum(1 for it in ungrouped if it["score"] is None),
        }

    return {
        "paper_id": int(paper_id),
        "title": row["title"],
        "subject": row["subject"],
        "stage": row["stage"],
        "grade": row["grade"],
        "template": row["template"],
        "answer_mode": row["answer_mode"],
        "status": row["status"],
        "item_count": len(items),
        "section_count": len(sections),
        "total_score": round(total, 4),
        "scored_count": len(scored),
        "unscored_count": len(unscored),
        "score_complete": len(unscored) == 0,
        "sections": sections,
        "ungrouped": ungrouped_info,
        "qtype_distribution": dist,
    }


# --------------------------------------------------------------------------- #
# 导出数据准备（阶段4 消费）
# --------------------------------------------------------------------------- #
def _export_question(item: dict, mode: str) -> dict:
    """把一条条目转成导出用结构（**基于快照**）。

    答案/解析取自**快照**（出卷时锁定），并按 ``answer_mode`` 决定是否输出：

    * ``学生版``：``answer`` / ``analysis`` 一律置 ``None``，``show_*`` 为 ``False``；
    * ``仅答案``：输出 ``answer``，``analysis`` 置 ``None``；
    * ``答案解析版``：``answer`` / ``analysis`` 均输出。

    **选择**：既给出 ``show_answer`` / ``show_analysis`` 布尔标志（供阶段4 渲染决定版式），
    **又**在不需要时把内容置 ``None``——双保险，避免下游误用把答案泄进学生版。
    """
    snap = item["snapshot"]
    show_answer = mode in ("答案解析版", "仅答案")
    show_analysis = mode == "答案解析版"
    formulas = snap.get("formulas") or []
    images = snap.get("images") or []
    answer = snap.get("answer") if show_answer else None
    analysis = snap.get("analysis") if show_analysis else None
    return {
        "item_id": item["id"],
        "seq": item["seq"],
        "question_id": item["question_id"],
        "question_version": item["question_version"],
        "number": snap.get("number"),
        "qtype": snap.get("qtype"),
        "difficulty": snap.get("difficulty"),
        "score": item["score"],
        "text": snap.get("text"),                       # 含 ⟦Fn⟧ 占位符
        "plain_text": snap.get("plain_text"),           # 去占位符
        "formulas": formulas,                           # 含 latex/kind/status
        "latex_list": [f.get("latex") for f in formulas],
        "images": images,
        "image_paths": [im.get("media_path") for im in images],
        "answer": answer,                               # 快照答案（学生版为 None）
        "analysis": analysis,                           # 快照解析（非解析版为 None）
        "answer_source": snap.get("answer_source"),
        "show_answer": show_answer,
        "show_analysis": show_analysis,
        "source": snap.get("source") or {},
    }


def build_export_payload(conn: sqlite3.Connection, paper_id: int, *,
                         answer_mode: str | None = None, template: str | None = None) -> dict:
    """产出供阶段4 渲染的结构化数据（JSON 友好，**不生成** DOCX/PDF）。

    * 按大题分组、保持题序；
    * 每题含：题干（``text``，含 ``⟦Fn⟧`` 占位符）、``latex_list``（公式 LaTeX，按顺序）、
      ``image_paths``（图片路径）、分值、来源定位、``answer`` / ``analysis``（取自快照）；
    * **基于快照版本取内容**——题库里题目被改动后，本 payload 不变；
    * ``answer`` / ``analysis`` 是否输出由 ``answer_mode`` 决定（``学生版`` 不含答案；
      ``仅答案`` 只含答案；``答案解析版`` 含答案与解析），见 :func:`_export_question`。

    **只读保证**：本函数只读；仅当 schema 尚未就绪时才调用 :func:`ensure_paper_schema`
    （迁移会写 ``meta``）。对已就绪的库（正常导出场景）**不产生任何写操作**，
    因此可安全地运行在只读连接上（见 :func:`bank.db.connect_readonly`）。
    """
    # 导出是只读流程：schema 已就绪时绝不迁移（迁移会写 meta，改动 bank.db 的 hash/mtime）。
    if not schema_ready(conn):
        ensure_paper_schema(conn)
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        raise ValueError(f"试卷不存在：{paper_id}")
    mode = answer_mode or row["answer_mode"]
    if mode not in ANSWER_MODES:
        raise ValueError(f"answer_mode 取值必须是 {ANSWER_MODES}，收到 {mode!r}")
    tpl = template or row['template']
    if tpl not in TEMPLATES:
        raise ValueError(f'template 取值必须是 {TEMPLATES}')
    from . import export_content as content
    inspected = content.inspect_paper(conn, paper_id)

    paper = _paper_dict(row)
    sections = _list_sections(conn, paper_id)
    items = list_items(conn, paper_id)
    def export_question(item):
        q = _export_question(item, mode)
        q.update(content.project_question(item['snapshot'], inspected['inspections'][item['id']], mode))
        return q
    by_section: dict[int | None, list[dict]] = {}
    for it in items:
        by_section.setdefault(it["section_id"], []).append(it)

    out_sections: list[dict] = []
    for s in sections:
        qs = by_section.get(s["id"], [])
        out_sections.append({
            "section_id": s["id"],
            "name": s["name"],
            "seq": s["seq"],
            "description": s["description"],
            "item_count": len(qs),
            "subtotal": round(sum(x["score"] for x in qs if x["score"] is not None), 4),
            "questions": [export_question(x) for x in qs],
        })
    ungrouped = by_section.get(None, [])
    if ungrouped:
        out_sections.append({
            "section_id": None, "name": UNGROUPED, "seq": None, "description": None,
            "item_count": len(ungrouped),
            "subtotal": round(sum(x["score"] for x in ungrouped if x["score"] is not None), 4),
            "questions": [export_question(x) for x in ungrouped],
        })

    result = {
        "paper": {
            "id": paper["id"], "title": paper["title"], "subject": paper["subject"],
            "stage": paper["stage"], "grade": paper["grade"], "template": tpl,
            "answer_mode": mode, "created_by": paper["created_by"],
            "status": paper["status"], "created_at": paper["created_at"],
        },
        "answer_mode": mode,
        "generated_at": _now(),
        "summary": paper_summary(conn, paper_id),
        "sections": out_sections,
        'content_guard_revision': content.CONTENT_GUARD_REVISION,
        'layout_revision': content.LAYOUT_REVISION,
        'diagnostics': inspected['diagnostics'],
    }
    digest_input={k:v for k,v in result.items() if k not in ('generated_at','summary','diagnostics')}
    digest_input['paper']={k:v for k,v in result['paper'].items() if k not in ('created_at','updated_at')}
    result['content_digest'] = content.digest(digest_input)
    return result


def create_revision(conn: sqlite3.Connection, paper_id: int, *, title: str | None,
                    exclude_item_ids: list[int], diagnostic_digest: str) -> dict:
    """显式复制锁定快照为新卷，不提交事务，不修改原卷。"""
    from . import export_content as content
    original = _require_paper(conn, paper_id)
    original = conn.execute('SELECT * FROM papers WHERE id=?',(paper_id,)).fetchone()
    if title is not None and (not isinstance(title,str) or not title.strip() or len(title)>200):
        raise ValueError('修订标题不能为空且不得超过200字符')
    if not isinstance(exclude_item_ids,list) or any(type(i) is not int for i in exclude_item_ids) or len(set(exclude_item_ids))!=len(exclude_item_ids):
        raise ValueError('排除条目必须为不重复的整数列表')
    if not isinstance(diagnostic_digest,str) or not re.fullmatch('[0-9a-fA-F]{64}',diagnostic_digest):
        raise ValueError('diagnostic_digest必须为64位SHA256')
    rows=conn.execute('SELECT * FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(paper_id,)).fetchall()
    all_ids={r['id'] for r in rows}
    if not rows or not set(exclude_item_ids)<=all_ids or set(exclude_item_ids)==all_ids:
        raise ValueError('排除列表必须属于本卷，且不得排除全部或修订空卷')
    # SQLite最外层SAVEPOINT的RELEASE会提交；先显式开启调用者可回滚的事务。
    if not conn.in_transaction:
        conn.execute('BEGIN')
    inspected=content.inspect_paper(conn,paper_id)
    if inspected['diagnostics']['diagnostic_digest']!=diagnostic_digest:
        raise content.ExportEvidenceStale(inspected['diagnostics'])
    # 保存点保证领域调用者即使捕获异常也不会留下半卷；成功仍由调用者commit。
    conn.execute('SAVEPOINT create_export_revision')
    try:
        now=_now();columns=[k for k in original.keys() if k!='id'];values=[original[k] for k in columns]
        for k,v in {'title':title.strip() if title is not None else original['title']+'（修订）','created_at':now,'updated_at':now,'status':DEFAULT_STATUS}.items():
            if k in columns:values[columns.index(k)]=v
        cur=conn.execute(f'INSERT INTO papers({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})',values);new_id=cur.lastrowid
        sections={}
        for row in conn.execute('SELECT * FROM paper_sections WHERE paper_id=? ORDER BY seq,id',(paper_id,)).fetchall():
            cols=[k for k in row.keys() if k!='id'];vals=[new_id if k=='paper_id' else row[k] for k in cols]
            cur=conn.execute(f'INSERT INTO paper_sections({",".join(cols)}) VALUES ({",".join("?" for _ in cols)})',vals);sections[row['id']]=cur.lastrowid
        mapping=[]
        for row in rows:
            if row['id'] in exclude_item_ids:continue
            seq=len(mapping)+1
            cur=conn.execute('INSERT INTO paper_questions(paper_id,section_id,question_id,question_version,seq,score,snapshot_json,added_at) VALUES (?,?,?,?,?,?,?,?)',(new_id,sections.get(row['section_id']),row['question_id'],row['question_version'],seq,row['score'],row['snapshot_json'],now))
            mapping.append({'source_item_id':row['id'],'item_id':cur.lastrowid,'source_seq':row['seq'],'seq':seq})
        result={'source_paper_id':paper_id,'paper_id':new_id,'excluded_item_ids':exclude_item_ids,'item_mapping':mapping,'paper':get_paper(conn,new_id),'diagnostics':content.inspect_paper(conn,new_id)['diagnostics']}
        conn.execute('RELEASE SAVEPOINT create_export_revision')
        return result
    except Exception:
        conn.execute('ROLLBACK TO SAVEPOINT create_export_revision');conn.execute('RELEASE SAVEPOINT create_export_revision');raise


def refresh_snapshots(conn: sqlite3.Connection, paper_id: int | None = None, *,
                      all_papers: bool = False, force: bool = False) -> dict:
    """为**已建试卷**的条目补全/刷新快照（主要用于把新抽取的答案并入旧快照）。

    **影响范围（重要，F6）**
    ----------------------
    默认**只刷新 ``paper_id`` 指定的这一份试卷**，避免误刷全库、破坏「出卷后锁定」。
    若要**全库刷新**，必须**显式**传 ``all_papers=True``（``paper_id`` 须为 ``None``）；
    两者都不给会抛 :class:`ValueError`——**不存在「默认全库」的隐式行为**。

    **快照语义**：默认**只在题目的当前版本仍等于组卷时锁定的版本**时刷新——此时题目内容
    与快照一致，刷新只是把新加入的 ``answer`` / ``analysis`` 字段补进快照，
    **不改动** ``text`` / ``formulas`` / ``images``（因此不会破坏「出卷后改题不影响已出卷」）。

    若题目在组卷后被修改（``version`` 已前进），默认**跳过**，保持原快照锁定；
    ``force=True`` 时无视版本直接按当前题目重建快照（会放弃对该题的锁定，慎用）。

    返回 ``{"paper_id", "all_papers", "total", "refreshed", "skipped_version_changed"}``。
    """
    ensure_paper_schema(conn)
    if paper_id is None and not all_papers:
        raise ValueError(
            "refresh_snapshots 需显式指定范围：按试卷请传 paper_id=<id>；"
            "若要刷新**全部试卷**请传 all_papers=True（影响全库，慎用）")
    if paper_id is not None:
        _require_paper(conn, paper_id)
        where = " WHERE pq.paper_id = ?"
        params: tuple = (paper_id,)
    else:
        where = ""
        params = ()
    rows = conn.execute(
        "SELECT pq.id, pq.question_id, pq.question_version,"
        " q.version AS current_version FROM paper_questions pq"
        " JOIN questions q ON q.id = pq.question_id" + where, params).fetchall()
    refreshed = skipped = 0
    for r in rows:
        if not force and int(r["current_version"]) != int(r["question_version"]):
            skipped += 1
            continue
        snap = _snapshot_question(conn, r["question_id"])
        # 保持原锁定版本号（force 时也用当前版本，二者一致）
        conn.execute("UPDATE paper_questions SET snapshot_json = ?, question_version = ?"
                     " WHERE id = ?",
                     (json.dumps(snap, ensure_ascii=False), snap["version"], r["id"]))
        refreshed += 1
    conn.commit()
    return {"paper_id": paper_id, "all_papers": bool(all_papers),
            "total": len(rows), "refreshed": refreshed,
            "skipped_version_changed": skipped}


__all__ = [
    "TEMPLATES", "DEFAULT_TEMPLATE", "ANSWER_MODES", "DEFAULT_ANSWER_MODE",
    "PAPER_STATUSES", "DEFAULT_STATUS", "DEFAULT_AUTHOR", "UNGROUPED",
    "MIN_SCORE", "MAX_SCORE",
    "ensure_paper_schema", "schema_ready",
    "create_paper", "list_papers", "get_paper", "delete_paper", "orphans",
    "add_section", "rename_section", "move_section", "delete_section",
    "add_questions", "remove_question", "move_question", "set_score", "set_scores",
    "list_items", "paper_summary", "question_group", "build_export_payload",
    "refresh_snapshots",
]
