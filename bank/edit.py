"""题目编辑与留版（在线编辑的领域逻辑）。

职责
----
* ``ensure_version_snapshot_columns`` —— 给 ``question_versions`` **幂等新增**完整快照列
  （``snapshot_json`` / ``change_source`` / ``note``），风格对齐
  ``bank.answers.ensure_answer_columns``。
* ``save_question`` —— 编辑保存：占位符校验 → 冲突预检 → **留版**（旧版完整快照）→
  更新题目 → **FTS 同事务同步** → 公式写回 + 复核状态处理 → 标签 diff → 写新版本行。
* ``update_file_metadata`` —— 文件级年级/教材编辑（改一题即改该来源全部题，需二次确认）。
* ``set_difficulty`` / ``batch_set_difficulty`` —— 难度人工标注（**仅 易/中/难 三档**）。
* ``list_versions`` / ``get_version`` —— 版本历史（只读，**不提供回滚**）。

关键裁定（team-lead M1 / M2）
-----------------------------
* **M1**：人工编辑公式后**清除该公式的 ``needs_review``**（``=0``），并把 ``review_queue``
  对应行置 ``resolved=1``（人工已看过并修改，重新入队只制造无用功）。LaTeX 结构非法
  （花括号 / ``\\left\\right`` / ``\\begin\\end`` 不匹配）→ **阻止保存**。
* **M2**：``content_hash`` 冲突**拒绝并明确提示、不写库**；**不提供 force 绕过**
  （``force`` 形参保留以对齐设计签名，当前不生效）。

留版机制
--------
编辑前把「当前库状态（=旧版）」生成**完整快照**回填进当前 ``version`` 行
（**仅当 ``snapshot_json IS NULL`` 时**，保证幂等）；保存后写 ``version+1`` 行。
快照格式与 ``bank.paper._snapshot_question`` 对齐并追加 ``labels``，因此**改了公式后
旧版仍能取回旧的 latex / 答案 / 解析**。
"""
# ---------------------------------------------------------------------------
# title: 题目编辑与留版
# description: ensure_version_snapshot_columns 幂等迁移、save_question（留版/冲突/FTS/公式/标签）、文件级元数据、难度标注与版本查询。
# author: 待补充
# version: 0.1.0
# category: Web界面-领域层
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import sqlite3
import time

from . import enrich as _enrich
from . import query as _q
from . import textutil as _txt

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 难度档位（Q5 已裁定：仅 易/中/难 三档；不做任何自动推断）。
DIFFICULTIES: tuple[str, ...] = ("易", "中", "难")
#: 未标注占位值（默认，保护既有难度回归测试）。
DEFAULT_DIFFICULTY = "未标注"
#: 知识点命名空间。
KNOWLEDGE_NAMESPACE = "知识点"
#: 版本快照新增列（列名, 类型）。
VERSION_SNAPSHOT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("snapshot_json", "TEXT"),
    ("change_source", "TEXT"),
    ("note", "TEXT"),
)

#: 缺省哨兵（区分「未提供」与「显式 None」）。
_MISSING = object()


# --------------------------------------------------------------------------- #
# 异常
# --------------------------------------------------------------------------- #
class ContentConflict(ValueError):
    """``content_hash`` 冲突（同来源重复内容）。webui 映射为 40901，**不写库**。"""

    def __init__(self, message: str, *, conflict: dict | None = None):
        super().__init__(message)
        self.conflict = conflict or {}


class ConfirmationRequired(ValueError):
    """需二次确认的批量/文件级操作。webui 映射为 40903。"""

    def __init__(self, message: str, *, affected: int = 0):
        super().__init__(message)
        self.affected = affected


# --------------------------------------------------------------------------- #
# 工具
# --------------------------------------------------------------------------- #
def _now() -> str:
    """当前时间（ISO 8601，秒精度，与 bank 一致）。"""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """判断某表是否有某列（只读 PRAGMA，不写库）。"""
    return column in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _validate_difficulty(level: str) -> None:
    """校验难度档位，非法即抛 :class:`ValueError`。"""
    if level not in DIFFICULTIES:
        raise ValueError(f"难度取值必须是 {DIFFICULTIES}，收到 {level!r}")


def _validate_latex(latex: str | None) -> None:
    """对 LaTeX 做**结构合法性**预检（渲染失败必须阻止保存，M1）。

    检查花括号、``\\left``/``\\right``、``\\begin``/``\\end`` 是否配对。这些是 KaTeX
    渲染最常见的结构性错误；命中即抛 :class:`ValueError`，**不静默写入**。
    """
    if latex is None:
        return
    s = str(latex)
    if s.count("{") != s.count("}"):
        raise ValueError("LaTeX 花括号不匹配，无法渲染，已阻止保存")
    if s.count(r"\left") != s.count(r"\right"):
        raise ValueError(r"LaTeX \left/\right 不匹配，无法渲染，已阻止保存")
    if s.count(r"\begin{") != s.count(r"\end{"):
        raise ValueError(r"LaTeX \begin/\end 不匹配，无法渲染，已阻止保存")


def _get_or_create_label(conn: sqlite3.Connection, namespace: str, name: str) -> int:
    """取或建标签，返回 ``label_id``。"""
    conn.execute("INSERT OR IGNORE INTO labels(namespace, name) VALUES (?, ?)",
                 (namespace, name))
    return conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                        (namespace, name)).fetchone()[0]


# --------------------------------------------------------------------------- #
# 幂等迁移
# --------------------------------------------------------------------------- #
def ensure_version_snapshot_columns(conn: sqlite3.Connection) -> list[str]:
    """幂等地给 ``question_versions`` 增加快照列；返回本次实际新增项。

    用 ``PRAGMA table_info`` 判断列是否存在；已存在则跳过。重复执行返回 ``[]``。
    **无新增时不写库、不提交**（保持只读友好）。
    """
    existing = {row[1] for row in conn.execute("PRAGMA table_info(question_versions)")}
    added: list[str] = []
    for col, decl in VERSION_SNAPSHOT_COLUMNS:
        if col not in existing:
            conn.execute(f"ALTER TABLE question_versions ADD COLUMN {col} {decl}")
            added.append(f"question_versions.{col}")
    if added:
        conn.commit()
    return added


# --------------------------------------------------------------------------- #
# 快照
# --------------------------------------------------------------------------- #
def _build_snapshot(conn: sqlite3.Connection, question_id: int, *, version: int,
                    text: str, plain_text: str, char_length: int, content_hash: str) -> dict:
    """生成一道题的**完整快照**（格式对齐 ``bank.paper._snapshot_question`` + ``labels``）。

    * 文本字段（text / plain_text / char_length / content_hash）由调用方显式传入——
      这样既能生成「旧版快照」（传旧文本），也能生成「新版快照」（传新文本）。
    * 公式 / 图片 / 标签 / 来源 / 答案 / 解析取自**当前库状态**；因此生成旧版快照时
      必须在任何写操作**之前**调用。
    """
    q = conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    if q is None:
        raise ValueError(f"题目不存在：{question_id}")
    src = conn.execute("SELECT * FROM source_files WHERE id = ?", (q["source_id"],)).fetchone()
    formulas = conn.execute(
        "SELECT fid, seq, kind, status, latex, progid, part, preview, needs_review"
        " FROM formulas WHERE question_id = ? ORDER BY seq, id", (question_id,)).fetchall()
    images = conn.execute(
        "SELECT media_path, sha256 FROM images WHERE question_id = ? ORDER BY id",
        (question_id,)).fetchall()
    src_expr = "ql.source" if _has_column(conn, "question_labels", "source") else "NULL"
    labels = conn.execute(
        f"SELECT l.namespace, l.name, ql.review_status, {src_expr} AS source"
        " FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
        " WHERE ql.question_id = ? ORDER BY l.namespace, l.name", (question_id,)).fetchall()

    qkeys = set(q.keys())
    return {
        "question_id": int(question_id),
        "version": int(version),
        "number": q["number"],
        "label": q["label"],
        "qtype": q["qtype"],
        "difficulty": q["difficulty"],
        "section": q["section"],
        "chapter": q["chapter"],
        "content_hash": content_hash,
        "char_length": char_length,
        "text": text,
        "plain_text": plain_text,
        "answer": q["answer"] if "answer" in qkeys else None,
        "analysis": q["analysis"] if "analysis" in qkeys else None,
        "answer_source": q["answer_source"] if "answer_source" in qkeys else None,
        "formulas": [dict(f) for f in formulas],
        "images": [dict(im) for im in images],
        "labels": [dict(r) for r in labels],
        "source": {
            "source_id": q["source_id"],
            "file_name": src["file_name"] if src else None,
            "stage": src["stage"] if src else None,
            "subject": src["subject"] if src else None,
            "grade": src["grade"] if src else None,
            "textbook": src["textbook"] if src else None,
            "chapter": q["chapter"],
            "start_paragraph": q["start_paragraph"],
            "end_paragraph": q["end_paragraph"],
        },
    }


# --------------------------------------------------------------------------- #
# 编辑保存
# --------------------------------------------------------------------------- #
def _collect_formula_updates(conn: sqlite3.Connection, question_id: int,
                             patch_formulas) -> tuple[list[tuple[str, str]], dict]:
    """校验并归集公式补丁，返回 ``(updates, cur_latex)``。

    * ``updates``：``[(fid, latex), ...]``（仅含显式给出 latex 的项）。
    * ``cur_latex``：``{fid: 当前 latex}``。
    公式 fid 必须**已存在**（仅支持编辑现有公式，不支持新增/删除公式行）。
    """
    cur = {r[0]: r[1] for r in conn.execute(
        "SELECT fid, latex FROM formulas WHERE question_id = ?", (question_id,))}
    updates: list[tuple[str, str]] = []
    if patch_formulas is None:
        return updates, cur
    if not isinstance(patch_formulas, list):
        raise ValueError("formulas 必须是列表")
    for item in patch_formulas:
        if not isinstance(item, dict) or not item.get("fid"):
            raise ValueError("formulas 每项需含 fid")
        fid = str(item["fid"])
        if fid not in cur:
            raise ValueError(f"公式 fid 不存在：{fid}（仅支持编辑现有公式）")
        latex = item.get("latex", None)
        if latex is None:
            continue
        _validate_latex(latex)
        updates.append((fid, str(latex)))
    return updates, cur


def _current_knowledge(conn: sqlite3.Connection, question_id: int) -> set[str]:
    """当前题目的知识点标签名集合。"""
    return {r[0] for r in conn.execute(
        "SELECT l.name FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
        " WHERE ql.question_id = ? AND l.namespace = ?", (question_id, KNOWLEDGE_NAMESPACE))}


def save_question(conn: sqlite3.Connection, question_id: int, patch: dict,
                  *, force: bool = False) -> dict:
    """保存题目编辑（留版 + 重算 + FTS 同步 + 冲突处理）。

    参数
    ----
    patch  可含 ``text/answer/analysis/qtype/chapter/difficulty/formulas/labels``。
    force  保留以对齐设计签名；**M2 裁定：不提供 force 绕过 content_hash 冲突**。

    返回
    ----
    ``{"question": <详情>, "version": <新版本号>, "warnings": [...]}``。

    异常
    ----
    * :class:`ValueError` —— 题目不存在 / 占位符缺失 / 非法难度 / LaTeX 非法 / fid 不存在；
    * :class:`ContentConflict` —— 内容哈希冲突（**不写库**）。
    """
    ensure_version_snapshot_columns(conn)
    patch = dict(patch or {})

    q = conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    if q is None:
        raise ValueError(f"题目不存在：{question_id}")
    source_id = int(q["source_id"])
    cur_version = int(q["version"])
    qkeys = set(q.keys())

    # 1) 提前校验（任何写操作之前）
    if "difficulty" in patch:
        _validate_difficulty(patch["difficulty"])
    formula_updates, cur_latex = _collect_formula_updates(
        conn, question_id, patch.get("formulas"))

    # 2) 占位符校验：题干所有 ⟦Fn⟧ ⊆ 现有 fid ∪ patch.formulas.fid
    new_text = patch.get("text", None)
    text_changed = new_text is not None and new_text != q["text"]
    if text_changed:
        placeholders = set(_txt.PLACEHOLDER_RE.findall(new_text))
        available = set(cur_latex) | {fid for fid, _ in formula_updates}
        missing = placeholders - available
        if missing:
            raise ValueError(f"题干占位符缺少对应公式：{'、'.join(sorted(missing))}")

    # 3) 计算新文本字段
    text = new_text if new_text is not None else q["text"]
    plain_text = _txt.strip_placeholders(text)
    char_length = len(_txt.normalize_text(text))
    new_hash = _txt.content_hash(text)

    # 4) 冲突预检（仅当文本变）：M2 —— 拒绝、不写库、不提供 force 绕过
    if text_changed:
        dup = conn.execute(
            "SELECT id, number, text FROM questions"
            " WHERE source_id = ? AND content_hash = ? AND id <> ?",
            (source_id, new_hash, question_id)).fetchone()
        if dup is not None:
            raise ContentConflict(
                f"该修改与同一来源文件内的另一题（第 {dup['number']} 题）内容重复，请调整内容",
                conflict={"question_id": dup["id"], "number": dup["number"],
                          "snippet": (dup["text"] or "")[:60]})

    # 5) 变更判定
    answer_changed = "answer" in patch and patch["answer"] != q["answer"]
    analysis_changed = "analysis" in patch and patch["analysis"] != q["analysis"]
    qtype_changed = "qtype" in patch and patch["qtype"] != q["qtype"]
    chapter_changed = "chapter" in patch and patch["chapter"] != q["chapter"]
    diff_changed = "difficulty" in patch and patch["difficulty"] != q["difficulty"]
    formulas_changed = any(cur_latex.get(fid) != latex for fid, latex in formula_updates)

    labels_patch = patch.get("labels")
    desired_labels: set[str] | None = None
    labels_changed = False
    if labels_patch is not None:
        if not isinstance(labels_patch, list):
            raise ValueError("labels 必须是字符串列表")
        desired_labels = {str(x).strip() for x in labels_patch if str(x).strip()}
        labels_changed = desired_labels != _current_knowledge(conn, question_id)

    if not any([text_changed, answer_changed, analysis_changed, qtype_changed,
                chapter_changed, diff_changed, formulas_changed, labels_changed]):
        return {"question": _q.get_question(conn, question_id), "version": cur_version,
                "warnings": ["没有检测到任何变更"]}

    warnings: list[str] = []
    try:
        # 6) 留版：确保当前版本行存在，并回填旧版完整快照（仅 snapshot_json IS NULL）
        conn.execute(
            "INSERT OR IGNORE INTO question_versions"
            "(question_id, version, content_hash, text, plain_text, char_length, created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (question_id, cur_version, q["content_hash"], q["text"], q["plain_text"],
             q["char_length"], q["created_at"] or _now()))
        old_snapshot = _build_snapshot(
            conn, question_id, version=cur_version, text=q["text"],
            plain_text=q["plain_text"], char_length=q["char_length"],
            content_hash=q["content_hash"])
        conn.execute(
            "UPDATE question_versions SET snapshot_json = ?,"
            " change_source = COALESCE(change_source, 'import')"
            " WHERE question_id = ? AND version = ? AND snapshot_json IS NULL",
            (json.dumps(old_snapshot, ensure_ascii=False), question_id, cur_version))

        # 7) 更新题目（version+1）
        sets = ["text = ?", "plain_text = ?", "char_length = ?", "content_hash = ?",
                "version = ?", "updated_at = ?"]
        vals: list = [text, plain_text, char_length, new_hash, cur_version + 1, _now()]
        if answer_changed:
            sets.append("answer = ?")
            vals.append(patch["answer"])
            sets.append("answer_source = ?")
            vals.append("manual" if patch["answer"] else None)
        if analysis_changed:
            sets.append("analysis = ?")
            vals.append(patch["analysis"])
        if qtype_changed:
            sets.append("qtype = ?")
            vals.append(patch["qtype"])
        if chapter_changed:
            sets.append("chapter = ?")
            vals.append(patch["chapter"])
        if diff_changed:
            sets.append("difficulty = ?")
            vals.append(patch["difficulty"])
        vals.append(question_id)
        conn.execute(f"UPDATE questions SET {', '.join(sets)} WHERE id = ?", vals)

        # 8) 检索索引：与 questions 更新**同一事务** DELETE + INSERT
        conn.execute("DELETE FROM question_fts WHERE question_id = ?", (str(question_id),))
        conn.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                     (_txt.tokenized_text(text), str(question_id)))

        # 9) 公式写回 + 复核状态（M1：人工编辑后清除 needs_review 并标记已处理）
        for fid, latex in formula_updates:
            conn.execute("UPDATE formulas SET latex = ?, needs_review = 0"
                         " WHERE question_id = ? AND fid = ?", (latex, question_id, fid))
            conn.execute(
                "UPDATE review_queue SET resolved = 1, reason = ?"
                " WHERE formula_id IN (SELECT id FROM formulas WHERE question_id = ? AND fid = ?)",
                ("人工编辑后已处理", question_id, fid))

        # 10) 知识点标签 diff
        if desired_labels is not None:
            current = _current_knowledge(conn, question_id)
            has_src = _has_column(conn, "question_labels", "source")
            for name in desired_labels - current:
                label_id = _get_or_create_label(conn, KNOWLEDGE_NAMESPACE, name)
                if has_src:
                    conn.execute(
                        "INSERT OR IGNORE INTO question_labels"
                        "(question_id, label_id, review_status, source) VALUES (?,?,?,?)",
                        (question_id, label_id, "待复核", "manual"))
                else:
                    conn.execute(
                        "INSERT OR IGNORE INTO question_labels"
                        "(question_id, label_id, review_status) VALUES (?,?,?)",
                        (question_id, label_id, "待复核"))
            for name in current - desired_labels:
                conn.execute(
                    "DELETE FROM question_labels WHERE question_id = ? AND label_id ="
                    " (SELECT id FROM labels WHERE namespace = ? AND name = ?)",
                    (question_id, KNOWLEDGE_NAMESPACE, name))

        # 11) 写新版本行（含新完整快照；满足 paper_questions 复合外键可引用性）
        new_snapshot = _build_snapshot(
            conn, question_id, version=cur_version + 1, text=text, plain_text=plain_text,
            char_length=char_length, content_hash=new_hash)
        conn.execute(
            "INSERT INTO question_versions"
            "(question_id, version, content_hash, text, plain_text, char_length,"
            " snapshot_json, change_source, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (question_id, cur_version + 1, new_hash, text, plain_text, char_length,
             json.dumps(new_snapshot, ensure_ascii=False), "edit", None, _now()))

        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # 说明：force 形参保留以对齐架构设计签名；按 M2 裁定，它**不改变** content_hash 冲突行为。
    _ = force
    return {"question": _q.get_question(conn, question_id), "version": cur_version + 1,
            "warnings": warnings}


# --------------------------------------------------------------------------- #
# 文件级元数据
# --------------------------------------------------------------------------- #
def update_file_metadata(conn: sqlite3.Connection, source_id: int, patch: dict,
                         *, confirm: bool = False) -> dict:
    """编辑**文件级**年级/教材（改一题即改该来源文件下**全部题**）。

    * ``confirm=False``（默认）时**不写库**，抛 :class:`ConfirmationRequired`（携带影响题数）；
    * ``confirm=True`` 才写入，并同步 ``grade_source``/``textbook_source = manual``（provenance）；
    * **不改变任何 content_hash**（元数据不参与题干哈希），不触发唯一约束冲突。
    """
    row = conn.execute("SELECT * FROM source_files WHERE id = ?", (source_id,)).fetchone()
    if row is None:
        raise ValueError(f"来源文件不存在：{source_id}")

    _enrich.ensure_provenance_columns(conn)

    patch = dict(patch or {})
    grade = patch.get("grade", _MISSING)
    textbook = patch.get("textbook", _MISSING)
    affected = conn.execute("SELECT COUNT(*) FROM questions WHERE source_id = ?",
                            (source_id,)).fetchone()[0]

    if not confirm:
        raise ConfirmationRequired(
            f"该操作将影响该来源文件下的 {affected} 道题，请确认后重试", affected=affected)

    sets: list[str] = []
    vals: list = []
    if grade is not _MISSING:
        sets += ["grade = ?", "grade_source = ?"]
        vals += [grade, "manual"]
    if textbook is not _MISSING:
        sets += ["textbook = ?", "textbook_source = ?"]
        vals += [textbook, "manual"]
    if not sets:
        raise ValueError("未提供 grade 或 textbook")

    vals.append(source_id)
    conn.execute(f"UPDATE source_files SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()

    src = conn.execute("SELECT * FROM source_files WHERE id = ?", (source_id,)).fetchone()
    return {"source": dict(src), "affected_questions": affected, "confirmed": True}


# --------------------------------------------------------------------------- #
# 难度标注
# --------------------------------------------------------------------------- #
def set_difficulty(conn: sqlite3.Connection, question_id: int, level: str) -> dict:
    """设置单题难度（仅 易/中/难）；返回 ``{"question": <详情>, "difficulty": level}``。"""
    _validate_difficulty(level)
    row = conn.execute("SELECT id FROM questions WHERE id = ?", (question_id,)).fetchone()
    if row is None:
        raise ValueError(f"题目不存在：{question_id}")
    conn.execute("UPDATE questions SET difficulty = ?, updated_at = ? WHERE id = ?",
                 (level, _now(), question_id))
    conn.commit()
    return {"question": _q.get_question(conn, question_id), "difficulty": level}


def batch_set_difficulty(conn: sqlite3.Connection, ids: list[int], level: str) -> dict:
    """批量设置难度；返回 ``{"updated", "missing", "difficulty"}``。"""
    _validate_difficulty(level)
    if not isinstance(ids, list):
        raise ValueError("ids 必须是整数列表")
    updated = 0
    missing: list[int] = []
    for raw in ids:
        try:
            qid = int(raw)
        except (TypeError, ValueError):
            missing.append(raw)  # type: ignore[arg-type]
            continue
        if conn.execute("SELECT 1 FROM questions WHERE id = ?", (qid,)).fetchone() is None:
            missing.append(qid)
            continue
        conn.execute("UPDATE questions SET difficulty = ?, updated_at = ? WHERE id = ?",
                     (level, _now(), qid))
        updated += 1
    conn.commit()
    return {"updated": updated, "missing": missing, "difficulty": level}


# --------------------------------------------------------------------------- #
# 版本历史（只读）
# --------------------------------------------------------------------------- #
def list_versions(conn: sqlite3.Connection, question_id: int) -> list[dict]:
    """列出某题的版本历史（时间/字数/摘要 + 是否有快照），**只读**。"""
    ensure_version_snapshot_columns(conn)
    rows = conn.execute(
        "SELECT version, content_hash, char_length, change_source, note, created_at,"
        " (snapshot_json IS NOT NULL) AS has_snapshot"
        " FROM question_versions WHERE question_id = ? ORDER BY version",
        (question_id,)).fetchall()
    return [dict(r) for r in rows]


def get_version(conn: sqlite3.Connection, question_id: int, version: int) -> dict | None:
    """取某题某版本的完整快照（只读）；不存在返回 ``None``。"""
    ensure_version_snapshot_columns(conn)
    row = conn.execute(
        "SELECT * FROM question_versions WHERE question_id = ? AND version = ?",
        (question_id, version)).fetchone()
    if row is None:
        return None
    d = dict(row)
    snapshot = None
    if d.get("snapshot_json"):
        try:
            snapshot = json.loads(d["snapshot_json"])
        except (ValueError, TypeError):
            snapshot = None
    return {
        "question_id": question_id,
        "version": version,
        "content_hash": d.get("content_hash"),
        "text": d.get("text"),
        "plain_text": d.get("plain_text"),
        "char_length": d.get("char_length"),
        "change_source": d.get("change_source"),
        "note": d.get("note"),
        "created_at": d.get("created_at"),
        "snapshot": snapshot,
    }


__all__ = [
    "DIFFICULTIES", "DEFAULT_DIFFICULTY", "KNOWLEDGE_NAMESPACE",
    "VERSION_SNAPSHOT_COLUMNS", "ContentConflict", "ConfirmationRequired",
    "ensure_version_snapshot_columns", "save_question", "update_file_metadata",
    "set_difficulty", "batch_set_difficulty", "list_versions", "get_version",
]
