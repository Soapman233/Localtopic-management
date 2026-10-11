"""把阶段1（``pipeline``）产出的 JSON 导入 SQLite。

特性
----
* **幂等**：源文件按 ``sha256`` 去重，题目按 ``(source_id, content_hash)`` 去重；
  同一份 JSON 重复导入不会产生重复数据。
* **变更检测**：同一来源内若题号+大题不变但内容变了，则更新题目并 **version + 1**，
  同时在 ``question_versions`` 里追加一条历史版本（组卷快照据此锁定版本）。
* **元数据提取**：从文件名与文档标题推断 学段/年级/教材版本/章节号/学科。
* **容错**：单个文件失败只记录错误，不中断整批；且**单文件原子**——文件内任何异常
  都会 ``rollback``，保证「要么整个文件成功、要么完全不入库」。
* **待复核入队**：所有非 ``OK`` 的公式进入 ``review_queue``。
* **垃圾过滤**：可选跳过「纯数值被误切成题目」的条目（如表格里的 ``0.30``）。
* **LaTeX 规范化**：入库即还原 ``[U+XXXX]`` 转义并去掉 ``$`` 定界符（见
  :mod:`bank.latexnorm`）。
"""
# ---------------------------------------------------------------------------
# title: JSON 导入器
# description: 把阶段1 的结构化 JSON 幂等导入 SQLite，含版本管理与待复核入队。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import json
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import latexnorm as _latexnorm
from . import metadata as _meta
from . import textutil as _txt

# 公式状态：只有 OK 视为成功。
STATUS_OK = "OK"


@dataclass
class ImportStats:
    """导入统计。"""
    files_total: int = 0
    files_imported: int = 0
    files_skipped: int = 0
    files_failed: int = 0
    questions_new: int = 0
    questions_updated: int = 0
    questions_skipped: int = 0
    questions_junk: int = 0
    formulas: int = 0
    images: int = 0
    review: int = 0
    errors: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "files_total": self.files_total,
            "files_imported": self.files_imported,
            "files_skipped": self.files_skipped,
            "files_failed": self.files_failed,
            "questions_new": self.questions_new,
            "questions_updated": self.questions_updated,
            "questions_skipped": self.questions_skipped,
            "questions_junk": self.questions_junk,
            "formulas": self.formulas,
            "images": self.images,
            "review": self.review,
            "errors": self.errors,
        }


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _source_sha256(source_path: str | None, qjson_path: Path) -> str:
    """源文件指纹：优先对原始 DOCX 取 sha256；原文件缺失时退化为对 JSON 取 sha256。"""
    if source_path:
        p = Path(source_path)
        if p.is_file():
            return _sha256_file(p)
    return _sha256_file(qjson_path)


def _load_media_hashes(docx_path: str | None) -> dict[str, str]:
    """从 DOCX 包内读取 ``word/media/*`` 的 sha256；原文件缺失时返回空表。"""
    if not docx_path:
        return {}
    p = Path(docx_path)
    if not p.is_file():
        return {}
    out: dict[str, str] = {}
    try:
        with zipfile.ZipFile(p) as z:
            for name in z.namelist():
                if name.startswith("word/media/") and not name.endswith("/"):
                    out[name[len("word/"):]] = _sha256_bytes(z.read(name))
    except Exception:
        return {}
    return out


def iter_question_files(path: str | Path) -> list[Path]:
    """枚举待导入的 ``*.questions.json``（目录则递归）。"""
    p = Path(path)
    if p.is_file():
        return [p]
    if p.is_dir():
        return sorted(p.rglob("*.questions.json"))
    return []


def _scan_path_for(qjson_path: Path) -> Path:
    name = qjson_path.name
    stem = name[: -len(".questions.json")] if name.endswith(".questions.json") else qjson_path.stem
    return qjson_path.with_name(stem + ".scan.json")


# --------------------------------------------------------------------------- #
# 标签
# --------------------------------------------------------------------------- #
def _get_or_create_label(conn, namespace: str, name: str) -> int:
    conn.execute("INSERT OR IGNORE INTO labels(namespace, name) VALUES (?, ?)",
                 (namespace, name))
    row = conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                       (namespace, name)).fetchone()
    return row["id"]


def _attach_label(conn, question_id: int, namespace: str, name: str) -> None:
    if not name:
        return
    label_id = _get_or_create_label(conn, namespace, name)
    conn.execute("INSERT OR IGNORE INTO question_labels(question_id, label_id) VALUES (?, ?)",
                 (question_id, label_id))


# --------------------------------------------------------------------------- #
# 题目的子对象（公式 / 图片 / 标签 / 检索索引）
# --------------------------------------------------------------------------- #
def _delete_children(conn, question_id: int) -> None:
    conn.execute("DELETE FROM formulas WHERE question_id = ?", (question_id,))
    conn.execute("DELETE FROM images WHERE question_id = ?", (question_id,))
    conn.execute("DELETE FROM question_labels WHERE question_id = ?", (question_id,))
    conn.execute("DELETE FROM question_fts WHERE question_id = ?", (str(question_id),))


@dataclass
class _Counters:
    """单文件写入过程中的子对象计数（公式/图片/待复核）。"""
    formulas: int = 0
    images: int = 0
    review: int = 0


def _validated_formula_ids(q: dict) -> list[str]:
    """校验并返回题目的 ``formula_ids``（F2）。

    必须为**字符串列表**；``None``（JSON ``null``）视同「无公式」，返回空列表。
    任何其它类型（尤其是**字符串**——逐字符迭代会造出 ``fid='F'``/``'1'`` 假公式）
    或非字符串元素都视为**数据错误**，抛 :class:`ValueError`，由 :func:`import_file`
    的原子事务回滚整份文件。**不做静默容错**。
    """
    fids = q.get("formula_ids")
    if fids is None:
        return []
    if not isinstance(fids, list):
        raise ValueError(
            f"formula_ids 必须是字符串列表，收到 {type(fids).__name__}：{fids!r}"
            f"（题目 number={q.get('number')!r}）")
    for i, fid in enumerate(fids):
        if not isinstance(fid, str):
            raise ValueError(
                f"formula_ids[{i}] 必须是字符串，收到 {type(fid).__name__}：{fid!r}"
                f"（题目 number={q.get('number')!r}）")
    return fids


def _write_children(conn, question_id: int, source_id: int, q: dict,
                    scan_formulas: dict, formula_index: dict,
                    media_hashes: dict[str, str], chapter: str | None,
                    counters: _Counters) -> None:
    """写入某道题的公式、图片、标签与检索索引。"""
    # 公式（F2：先校验 formula_ids 类型，非法即抛错 -> 整文件回滚）
    for seq, fid in enumerate(_validated_formula_ids(q), start=1):
        info = scan_formulas.get(fid) or formula_index.get(fid) or {}
        status = info.get("status")
        kind = info.get("kind")
        needs_review = 1 if status != STATUS_OK else 0
        # D1/D2：入库即规范化 LaTeX（还原 [U+XXXX]、去掉 $ 定界符），幂等无害。
        latex = _latexnorm.normalize_latex(info.get("latex"))
        cur = conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex,"
            " progid, part, preview, needs_review) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (question_id, source_id, fid, seq, kind, status, latex,
             info.get("progid"), info.get("part"), info.get("preview"), needs_review))
        counters.formulas += 1
        if needs_review:
            conn.execute(
                "INSERT OR IGNORE INTO review_queue(formula_id, question_id, status, kind,"
                " progid, part, preview, reason, resolved, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,0,?)",
                (cur.lastrowid, question_id, status, kind, info.get("progid"),
                 info.get("part"), info.get("preview"),
                 f"公式状态为 {status}，需人工复核", _now()))
            counters.review += 1

    # 图片
    for media in q.get("images", []):
        conn.execute("INSERT INTO images(question_id, source_id, media_path, sha256)"
                     " VALUES (?,?,?,?)",
                     (question_id, source_id, media, media_hashes.get(media)))
        counters.images += 1

    # 标签：章节号 + 大题
    _attach_label(conn, question_id, "chapter", chapter)
    _attach_label(conn, question_id, "section", q.get("section"))

    # 检索索引（双字切分）
    conn.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                 (_txt.tokenized_text(q.get("text")), str(question_id)))


# --------------------------------------------------------------------------- #
# 单文件导入
# --------------------------------------------------------------------------- #
def import_file(conn, qjson_path: str | Path, *, skip_numeric_junk: bool = True,
                verbose: bool = False) -> dict:
    """导入单个 ``<名>.questions.json``（连同同名 ``.scan.json``）。

    返回该文件的导入记录字典；异常会被捕获并记录，不向外抛出。
    """
    qjson_path = Path(qjson_path)
    record = {"file": str(qjson_path), "status": "OK"}
    try:
        qj = json.loads(qjson_path.read_text(encoding="utf-8"))
        scan_path = _scan_path_for(qjson_path)
        scan = json.loads(scan_path.read_text(encoding="utf-8")) if scan_path.is_file() else {}
        source_path = qj.get("path") or scan.get("path")

        sha = _source_sha256(source_path, qjson_path)
        row = conn.execute("SELECT id FROM source_files WHERE sha256 = ?", (sha,)).fetchone()

        head = qj.get("unassigned_before_first", []) or []
        title = head[0].strip() if head else ""
        meta = _meta.extract(qjson_path.name[: -len(".questions.json")],
                             title, " ".join(head), str(source_path or ""))

        if row is None:
            cur = conn.execute(
                "INSERT INTO source_files(path, sha256, file_name, stage, grade, subject,"
                " textbook, chapter, imported_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (str(source_path or ""), sha, Path(source_path).name if source_path else qjson_path.name,
                 meta["stage"], meta["grade"], meta["subject"], meta["textbook"],
                 meta["chapter"], _now()))
            source_id = cur.lastrowid
        else:
            source_id = row["id"]

        media_hashes = _load_media_hashes(source_path)
        scan_formulas = scan.get("formulas", {}) or {}
        formula_index = qj.get("formula_index", {}) or {}
        counters = _Counters()

        file_new = file_updated = file_skipped = file_junk = 0
        for q in qj.get("questions", []):
            text = q.get("text", "")
            plain = _txt.strip_placeholders(text)
            # 跳过两类「假题目」：表格纯数值行；文档标题（章节号）被误切。
            is_junk = skip_numeric_junk and (
                _txt.is_numeric_junk(plain)
                or (q.get("start_paragraph", 0) <= 2
                    and _txt.is_title_artifact(q.get("number"), text)))
            if is_junk:
                file_junk += 1
                continue
            chash = _txt.content_hash(text)

            existing = conn.execute(
                "SELECT id FROM questions WHERE source_id = ? AND content_hash = ?",
                (source_id, chash)).fetchone()
            if existing is not None:
                file_skipped += 1
                continue

            # 变更检测：同来源、同题号、同大题、同起始段落 -> 视为同一题的修订
            # （加入 start_paragraph 是为了避免同一文件内「题号+大题」重复时相互覆盖）
            ident = conn.execute(
                "SELECT id, version FROM questions WHERE source_id = ? AND number = ?"
                " AND IFNULL(section,'') = IFNULL(?,'') AND IFNULL(start_paragraph,-1) = ?",
                (source_id, q.get("number"), q.get("section"),
                 q.get("start_paragraph", -1))).fetchone()

            qtype = _meta.detect_qtype(q.get("section"), plain)
            char_length = len(_txt.normalize_text(text))

            if ident is not None:
                qid = ident["id"]
                new_version = int(ident["version"]) + 1
                conn.execute(
                    "UPDATE questions SET label=?, text=?, plain_text=?, section=?, chapter=?,"
                    " qtype=?, char_length=?, start_paragraph=?, end_paragraph=?,"
                    " sub_question_count=?, content_hash=?, version=?, updated_at=? WHERE id=?",
                    (q.get("label"), text, plain, q.get("section"), meta["chapter"], qtype,
                     char_length, q.get("start_paragraph"), q.get("end_paragraph"),
                     q.get("sub_question_count", 0), chash, new_version, _now(), qid))
                conn.execute(
                    "INSERT INTO question_versions(question_id, version, content_hash, text,"
                    " plain_text, char_length, created_at) VALUES (?,?,?,?,?,?,?)",
                    (qid, new_version, chash, text, plain, char_length, _now()))
                _delete_children(conn, qid)
                _write_children(conn, qid, source_id, q, scan_formulas, formula_index,
                                media_hashes, meta["chapter"], counters)
                file_updated += 1
            else:
                cur = conn.execute(
                    "INSERT INTO questions(source_id, number, label, text, plain_text, section,"
                    " chapter, qtype, difficulty, char_length, start_paragraph, end_paragraph,"
                    " sub_question_count, content_hash, version, created_at, updated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
                    (source_id, q.get("number"), q.get("label"), text, plain, q.get("section"),
                     meta["chapter"], qtype, _meta.DEFAULT_DIFFICULTY, char_length,
                     q.get("start_paragraph"), q.get("end_paragraph"),
                     q.get("sub_question_count", 0), chash, _now(), _now()))
                qid = cur.lastrowid
                conn.execute(
                    "INSERT INTO question_versions(question_id, version, content_hash, text,"
                    " plain_text, char_length, created_at) VALUES (?,1,?,?,?,?,?)",
                    (qid, chash, text, plain, char_length, _now()))
                _write_children(conn, qid, source_id, q, scan_formulas, formula_index,
                                media_hashes, meta["chapter"], counters)
                file_new += 1

        # 更新来源统计
        qcount = conn.execute("SELECT COUNT(*) AS c FROM questions WHERE source_id = ?",
                              (source_id,)).fetchone()["c"]
        fcount = conn.execute("SELECT COUNT(*) AS c FROM formulas WHERE source_id = ?",
                              (source_id,)).fetchone()["c"]
        conn.execute("UPDATE source_files SET questions_count=?, formulas_count=? WHERE id=?",
                     (qcount, fcount, source_id))
        conn.commit()

        record.update({
            "status": "OK",
            "source_id": source_id,
            "sha256": sha[:12],
            "meta": meta,
            "new": file_new, "updated": file_updated,
            "skipped": file_skipped, "junk": file_junk,
            "formulas": counters.formulas,
            "images": counters.images,
            "review": counters.review,
            "questions_in_file": len(qj.get("questions", [])),
        })
        if verbose:
            print(f"  {qjson_path.name[:56]:56s} new={file_new:3d} upd={file_updated:3d} "
                  f"skip={file_skipped:3d} junk={file_junk:3d}", flush=True)
    except Exception as exc:  # 单文件失败不中断整批
        # F1：**单文件原子** —— 该文件内任何异常都回滚，保证「要么整个文件成功、
        # 要么完全不入库」，绝不把半截数据留给下一个文件的 commit 落盘。
        try:
            conn.rollback()
        except Exception:
            pass
        record.update({"status": "ERROR", "error": str(exc)})
        if verbose:
            print(f"  {qjson_path.name[:56]:56s} ERROR {exc}", flush=True)
    return record


# --------------------------------------------------------------------------- #
# 目录 / 批次导入
# --------------------------------------------------------------------------- #
def import_path(conn, path: str | Path, *, skip_numeric_junk: bool = True,
                verbose: bool = True) -> ImportStats:
    """导入一个文件或目录下的所有 ``*.questions.json``，返回批次统计。

    单个文件失败会被记录到 ``stats.errors``，不中断整批。

    **F3**：路径不存在时抛 :class:`FileNotFoundError`（而非静默返回「0 文件 0 错误」），
    以免用户误以为导入成功。CLI 会据此给出友好提示并非零退出。
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"导入路径不存在：{p}")
    files = iter_question_files(p)
    stats = ImportStats(files_total=len(files))
    for qf in files:
        record = import_file(conn, qf, skip_numeric_junk=skip_numeric_junk, verbose=verbose)
        if record["status"] != "OK":
            stats.files_failed += 1
            stats.errors.append({"file": record["file"], "error": record.get("error")})
            continue
        stats.questions_new += record.get("new", 0)
        stats.questions_updated += record.get("updated", 0)
        stats.questions_skipped += record.get("skipped", 0)
        stats.questions_junk += record.get("junk", 0)
        stats.formulas += record.get("formulas", 0)
        stats.images += record.get("images", 0)
        stats.review += record.get("review", 0)
        if record.get("new", 0) == 0 and record.get("updated", 0) == 0:
            stats.files_skipped += 1
        else:
            stats.files_imported += 1
    return stats


__all__ = ["import_file", "import_path", "iter_question_files", "ImportStats", "STATUS_OK"]
