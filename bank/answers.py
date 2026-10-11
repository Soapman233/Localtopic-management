"""答案 / 解析的抽取与配对（阶段2 题库补充能力）。

背景
----
阶段1 产出、阶段2 入库时，**题干与答案/解析混在同一段文本里**（如
``…（题目正文）…【答案】B【解析】因为…``），导出 payload 的 ``answer`` /
``analysis`` 恒为 ``null``，导致「答案解析版」导出做不出来。

事实（实测，见 ``bank/README.md`` 与交付报告）
---------------------------------------------
* 库内 7,945 道题中，``text`` 含 ``【答案】`` 的 **2,419** 条、含 ``【解析】`` 的
  **506** 条、含 ``【详解】`` 的 **2,146** 条（``【详解】`` 才是主流解析标记）。
* 源目录另有成对的「原卷版 / 答案版 / 解析版」DOCX：解析版题干与原卷版**逐字一致**，
  只是尾部多了答案与解析；答案版则是「题号 + 答案」的简表。

本模块提供**两条互相独立的抽取路径**：

* **路径 A（:func:`split_inline` / :func:`extract_inline`）**：把题干按内联标记
  （``【答案】`` / ``【解析】`` / ``【详解】`` …）拆成 ``stem`` / ``answer`` /
  ``analysis`` 三段。**只改文本，不动公式与图片**——公式/图片是按题存的全量列表，
  拆分不会触碰它们，``stem`` 仍保留原有的 ``⟦Fn⟧`` 占位符。
* **路径 B（:func:`extract_paired`）**：按「去掉版本后缀后的共同前缀」把
  「解析版 / 答案版 / 参考答案及评分细则」与原卷版配对，解析答案文件里的
  题号与答案/解析，**按题干内容对齐**到原卷版题目。
* **路径 C（题号路径，已收紧）**：对「答案版 / 参考答案及评分细则」这类
  「题号 + 答案」简表，**仅当简表条目里除「题号 + 答案」外还有与原题重叠的题干文本
  （内容佐证）时才按题号写入**；纯「题号 + 答案」**无法佐证即跳过**。实测本语料的
  答案版编号与原卷版**并不一致**（如《走进分子世界》原卷版题型01 有 3 题、答案版只有
  2 条），故无佐证时宁可不写——**错配答案比没有答案更糟**。

数据模型
--------
给 ``questions`` 增加三列（可空，幂等迁移，见 :func:`ensure_answer_columns`）：

* ``answer``        —— 答案（``NULL`` 表示未收录，**绝不编造**）；
* ``analysis``      —— 解析/详解（同上）；
* ``answer_source`` —— provenance：``inline``（题干内联拆分）/ ``paired_file``
  （配对文件抽取）/ ``NULL``（未抽取）。

**不覆盖已有非空值**；改库前由调用方先备份并校验（见 ``bank.enrich.backup_db`` /
``verify_backup``）。

设计取舍
--------
* 答案标记**只认** ``【答案】`` / ``【参考答案】``：``参考答案`` / ``答案：`` 在语料里
  多为**整卷答案表**（如 ``《…》参考答案\n题号\n1\n2…\n答案\nA\nC…``），并非某道题的
  答案，故**不**作为逐题答案标记，避免错配。
* 解析标记取 ``【详解】`` / ``【解析】`` / ``【解答】`` / ``【分析】`` / ``【点评】``
  及 ``【答案与解析】`` / ``【答案详解】``。
* 解析版里 ``N.答案 【解析】…`` 这种「答案内嵌在题干与解析之间」的形态**没有独立题干**
  （题干被替换成答案），无法恢复题干，故**不拆答案**，只保留原文，避免制造空题干。
* **题号路径必须内容佐证**：答案版 / 评分细则的编号常与原卷版**不一致**（跳号、少题），
  纯按题号对齐会**静默错配**——实测 id=2919（填空「沙子是____（连续的/不连续的）」）
  被错写成 ``A``。故题号路径要求简表条目**除「题号 + 答案」外还带与原题重叠的题干文本**
  才写入，无佐证一律跳过。另提供 :func:`find_suspicious_answers` 供全库复核
  （如「填空题却得到单个大写字母答案」）。

只依赖标准库与项目内已有模块。
"""

# ---------------------------------------------------------------------------
# title: 答案 / 解析抽取
# description: 从题干内联标记拆分、从配对答案/解析文件抽取答案与解析；含幂等迁移、provenance、题号路径内容佐证与可疑答案复核。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
import sqlite3

from . import textutil as _txt

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 逐题**答案**标记（按优先级/长度排序）。**刻意不含** ``参考答案`` / ``答案：``，
#: 因为它们在语料里多为整卷答案表或题干内容，逐题使用会错配。
ANS_MARKERS: tuple[str, ...] = ("【参考答案】", "【答案】")

#: **解析**标记（按长度降序，保证 ``【答案与解析】`` 不被 ``【答案】`` 截断）。
ANA_MARKERS: tuple[str, ...] = (
    "【答案与解析】", "【答案详解】", "【详解】", "【解析】", "【解答】", "【分析】", "【点评】",
)

#: provenance 取值。
SOURCE_INLINE = "inline"
SOURCE_PAIRED = "paired_file"

#: 需要新增的列：表 -> [(列名, 类型)]。
ANSWER_COLUMNS: dict[str, tuple[tuple[str, str], ...]] = {
    "questions": (("answer", "TEXT"), ("analysis", "TEXT"), ("answer_source", "TEXT")),
}

#: 版本后缀（配对用）。``参考答案及评分细则`` 长度最长，放前面避免被误切。
VERSION_TOKENS: tuple[str, ...] = (
    "参考答案及评分细则", "答案解析版", "原卷版", "答案版", "解析版", "学生版",
)
#: 去掉版本后缀（含其外层中文括号）的正则。
_VERSION_RE = re.compile(r"（?(?:" + "|".join(VERSION_TOKENS) + r")）?")
#: 原卷版来源后缀名。
ORIGINAL_KIND = "原卷版"
#: 作为「答案/解析来源」的版本后缀（按处理优先级）。
SOURCE_KINDS: tuple[str, ...] = ("解析版", "答案版", "参考答案及评分细则")

#: 「题号 + 答案」简表行的解析（答案版 / 评分细则）。
_ANSWER_KEY_RE = re.compile(r"^\s*\d{1,3}\s*[．.、]\s*(.+)$", re.S)

#: 去掉题干开头的题号（如 ``2．``），用于题号路径的内容佐证比较。
_NUMBER_PREFIX_RE = re.compile(r"^\s*\d{1,3}\s*[．.、]\s*")

#: 题干兼容判定的最小重叠字数与「较长者允许多出的尾部字数」。
#: 解析版题干常比原卷版**多**一段被误并进来的章节标题（如「第二卷\n二、填空题…」），
#: 故允许较长者比短者多出至多 :data:`MAX_TAIL_CHARS` 字；超过则判为不同题。
MIN_OVERLAP_CHARS = 8
MAX_TAIL_CHARS = 60

#: 答案版简表里「答案」文本的长度上限（超过则判定不是答案，跳过）。
MAX_ANSWER_KEY_LEN = 80

#: 可疑答案复核用的正则（见 :func:`find_suspicious_answers`）。
#: 选项字母（含全角）——用于判断某题是否为选择题；下划线空格——用于判断是否为填空题。
_OPTION_LETTER_RE = re.compile(r"([A-D])[．.、]")
_UNDERSCORE_BLANK_RE = re.compile(r"_{2,}")
#: 单个**大写**字母答案。刻意不含小写：``选填“a”“b”“c”`` 这类填空题的答案本就是小写字母。
_UPPER_LETTER_RE = re.compile(r"^[A-D]$")


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def _first_marker(text: str, markers: tuple[str, ...]) -> tuple[int, str] | None:
    """返回文本中**最早出现**的标记 ``(下标, 标记)``；都没有则 ``None``。"""
    best: tuple[int, str] | None = None
    for m in markers:
        i = text.find(m)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, m)
    return best


def _norm(text: str | None) -> str:
    """归一化题干（去占位符 + 去空白），用于内容匹配。"""
    return _txt.normalize_text(text)


# --------------------------------------------------------------------------- #
# 路径 A：题干内联拆分
# --------------------------------------------------------------------------- #
def split_inline(text: str | None) -> tuple[str, str | None, str | None]:
    """把题干按内联标记拆成 ``(stem, answer, analysis)``。

    规则（按实测语料确定）：

    1. 找**最早**的答案标记与解析标记；
    2. 若答案标记在前：``stem`` 取标记前文本，``answer`` 取答案标记到解析标记之间
       （无解析标记则取到末尾），``analysis`` 取解析标记之后；
    3. 若只有解析标记：``stem`` 取标记前文本，``analysis`` 取标记之后，``answer=None``；
    4. 都没有：原样返回，``answer`` / ``analysis`` 均为 ``None``。

    **保守约束**：

    * ``stem`` 为空（原文以标记开头，说明没有可保留的题干）时**整体放弃拆分**，
      返回原文与 ``None``——绝不制造空题干。
    * ``⟦Fn⟧`` 占位符随其所在文本段自然保留；本函数**不触碰**公式/图片数据。
    """
    t = text or ""
    ans = _first_marker(t, ANS_MARKERS)
    ana = _first_marker(t, ANA_MARKERS)

    if ans is not None and (ana is None or ans[0] < ana[0]):
        stem = t[: ans[0]].strip()
        start = ans[0] + len(ans[1])
        if ana is not None and ana[0] > ans[0]:
            answer = t[start:ana[0]].strip()
            analysis = t[ana[0] + len(ana[1]):].strip()
        else:
            answer = t[start:].strip()
            analysis = ""
        if not stem:                      # 没有题干可保留 -> 放弃，避免空题干
            return t.strip(), None, None
        return stem, (answer or None), (analysis or None)

    if ana is not None:                   # 只有解析标记
        stem = t[: ana[0]].strip()
        analysis = t[ana[0] + len(ana[1]):].strip()
        if not stem:                      # 同上
            return t.strip(), None, None
        return stem, None, (analysis or None)

    return t.strip(), None, None


def extract_inline(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:
    """路径 A：对全库题目做内联拆分，写回 ``answer`` / ``analysis``。

    幂等：以 ``answer_source`` 是否为 ``NULL`` 作为「是否已处理」的锚点，第二次执行
    不重复写、不覆盖已有非空值。

    返回统计字典 ``{"answer", "analysis", "either", "skipped_no_marker",
    "skipped_empty_stem", "kept_existing"}``。
    """
    if not dry_run:
        ensure_answer_columns(conn)

    cols = _column_names(conn, "questions")
    has_cols = {"answer", "analysis", "answer_source"} <= cols
    sel = ("SELECT id, text, answer, analysis, answer_source FROM questions"
           if has_cols else "SELECT id, text, NULL AS answer, NULL AS analysis,"
                            " NULL AS answer_source FROM questions")

    stats = {"answer": 0, "analysis": 0, "either": 0,
             "skipped_no_marker": 0, "skipped_empty_stem": 0, "kept_existing": 0}

    for row in conn.execute(sel).fetchall():
        if row["answer_source"] is not None:      # 已处理过 -> 幂等跳过
            stats["kept_existing"] += 1
            continue
        raw = row["text"] or ""
        stem, answer, analysis = split_inline(raw)
        if answer is None and analysis is None:
            stats["skipped_no_marker"] += 1
            continue
        if not stem:
            stats["skipped_empty_stem"] += 1
            continue

        new_answer = answer if (answer and not row["answer"]) else None
        new_analysis = analysis if (analysis and not row["analysis"]) else None
        if new_answer is None and new_analysis is None:
            continue

        if answer is not None:
            stats["answer"] += 1
        if analysis is not None:
            stats["analysis"] += 1
        stats["either"] += 1

        if not dry_run:
            conn.execute(
                "UPDATE questions SET answer = COALESCE(answer, ?),"
                " analysis = COALESCE(analysis, ?),"
                " answer_source = COALESCE(answer_source, ?) WHERE id = ?",
                (new_answer, new_analysis, SOURCE_INLINE, row["id"]))

    if not dry_run:
        conn.commit()
    return stats


# --------------------------------------------------------------------------- #
# 路径 B：配对文件抽取
# --------------------------------------------------------------------------- #
def _stem_name(file_name: str | None) -> str:
    """去掉扩展名。"""
    return re.sub(r"\.(docx|doc)$", "", (file_name or "").strip(), flags=re.IGNORECASE)


def canonical_name(file_name: str | None) -> str:
    """去掉版本后缀与空白，得到用于配对的**共同前缀**。"""
    return re.sub(r"\s+", "", _VERSION_RE.sub("", _stem_name(file_name)))


def pair_source_files(conn: sqlite3.Connection) -> dict[str, dict[str, int]]:
    """把 ``source_files`` 按「共同前缀」配对，返回 ``{前缀: {版本后缀: source_id}}``。

    仅返回**含原卷版**的组（原卷版是答案/解析的挂靠目标）。
    """
    groups: dict[str, dict[str, int]] = {}
    for row in conn.execute("SELECT id, file_name FROM source_files ORDER BY id"):
        stem = _stem_name(row["file_name"])
        m = _VERSION_RE.search(stem)
        if not m:
            continue
        groups.setdefault(canonical_name(stem), {})[m.group(0).strip("（）")] = row["id"]
    return {k: v for k, v in groups.items() if ORIGINAL_KIND in v}


def _questions_of(conn: sqlite3.Connection, source_id: int) -> list[sqlite3.Row]:
    """取某来源文件的题目（按段落顺序），含答案相关列（缺列时以 NULL 兜底）。"""
    cols = _column_names(conn, "questions")
    has_cols = {"answer", "analysis", "answer_source"} <= cols
    extra = ("answer, analysis, answer_source" if has_cols
             else "NULL AS answer, NULL AS analysis, NULL AS answer_source")
    return conn.execute(
        f"SELECT id, number, section, text, {extra} FROM questions"
        " WHERE source_id = ? ORDER BY start_paragraph, id", (source_id,)).fetchall()


def _compatible(a: str | None, b: str | None) -> bool:
    """判断两段题干是否「兼容」（相等，或一方是另一方的前缀且多出部分很短）。

    解析版题干可能比原卷版**多**一段被误并进来的章节标题，故用前缀关系而非严格相等；
    又要求「较长者多出的字数 ≤ :data:`MAX_TAIL_CHARS`」，避免把不同题误判为同一题。
    """
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if min(len(na), len(nb)) < MIN_OVERLAP_CHARS:
        return False
    short, long = (na, nb) if len(na) <= len(nb) else (nb, na)
    return long.startswith(short) and (len(long) - len(short)) <= MAX_TAIL_CHARS


def _parse_answer_key(text: str | None) -> str | None:
    """解析「题号 + 答案」简表行（答案版 / 评分细则），返回答案文本或 ``None``。

    形如 ``1．C`` / ``13．  扩散  分子…``：取题号分隔符之后的**首行**，长度超过
    :data:`MAX_ANSWER_KEY_LEN` 视为不是答案，跳过。
    """
    m = _ANSWER_KEY_RE.match((text or "").strip())
    if not m:
        return None
    body = m.group(1).strip().split("\n", 1)[0].strip()
    if not body or len(body) > MAX_ANSWER_KEY_LEN:
        return None
    return body


def _answer_key_stem(text: str | None) -> str:
    """从「题号 + 答案」简表条目里取出可能的**题干残留**文本。

    答案版 / 评分细则的条目通常是 ``2．A`` 或 ``9. （1）分子，空隙…``：去掉题号与
    首行答案后，若还剩后续行（可能是被误并进来的题干或章节标题），作为「内容佐证」的
    候选；纯「编号 + 答案」则返回空串。
    """
    m = _ANSWER_KEY_RE.match((text or "").strip())
    if not m:
        return ""
    parts = m.group(1).split("\n", 1)
    return parts[1].strip() if len(parts) > 1 else ""


def _number_corroborated(sq_text: str | None, target_text: str | None) -> bool:
    """题号路径的**内容佐证**：简表条目须在「题号 + 答案」之外还带**原题的题干文本**。

    纯「编号 + 答案」（如 ``2．A``）**无法**佐证其题号确与原题对应，一律返回 ``False``
    ——宁可少写答案，也不能写错答案。

    判定：去掉两侧开头的题号后做**前缀**比较（简表残留通常是原题题干的开头）。刻意
    **不**用「包含」判定：答案版条目后常跟着**章节标题**（如 ``二、填空题(共12分。)``），
    而该标题在入库时被并进**上一题**的题干尾部，用「包含」会把章节标题误当题干佐证
    （实测本语料会因此多写 19 条、其中 1 条恰好正确但机制不可靠）。前缀判定只认真正的
    题干开头，故本语料的答案版（无题干文本）一律跳过。较短一方须至少
    :data:`MIN_OVERLAP_CHARS` 字，避免「如图」之类短词误命中。
    """
    stem = _NUMBER_PREFIX_RE.sub("", _norm(_answer_key_stem(sq_text))).strip()
    tgt = _NUMBER_PREFIX_RE.sub("", _norm(target_text)).strip()
    if len(stem) < MIN_OVERLAP_CHARS or not tgt:
        return False
    short, long = (stem, tgt) if len(stem) <= len(tgt) else (tgt, stem)
    return long.startswith(short)


def extract_paired(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:
    """路径 B/C：从配对的原卷版/解析版/答案版抽取答案与解析，对齐到原卷版题目。

    对齐策略（**保守**，不确定即跳过）：

    * 来源为**解析版**：按 :func:`split_inline` 拆出 ``stem`` 后，用 :func:`_compatible`
      在原卷版题目里找候选；**唯一**候选才写入，0 个记 ``skip_no_stem``、多个记
      ``skip_ambig_stem``；
    * 来源为**答案版 / 评分细则**：用 :func:`_parse_answer_key` 取答案，按**题号**在原卷版
      题目里找候选；**唯一**候选**且**简表条目带题干文本佐证（:func:`_number_corroborated`）
      才写入，否则记 ``skip_no_number`` / ``skip_ambig_number`` / ``skip_no_corroboration``。

    幂等：以目标题的 ``answer_source`` 是否为 ``NULL`` 作为锚点；**不覆盖**已有非空值。
    写入前**重新读取目标题的当前值**（而非批次开始时抓取的旧行），并用 ``assigned``
    集合记录本轮已写过的题，避免同一轮内因旧行导致的重复写入 / 错配。

    返回统计字典（含 ``groups`` / ``matched`` / ``skipped`` 明细与 ``examples`` 示例）。
    """
    if not dry_run:
        ensure_answer_columns(conn)

    groups = pair_source_files(conn)
    stats = {
        "groups": len(groups),
        "source_files": {"解析版": 0, "答案版": 0, "参考答案及评分细则": 0},
        "matched": 0, "match_stem": 0, "match_number": 0,
        "skipped": {"no_data": 0, "no_stem": 0, "ambiguous_stem": 0,
                    "no_number": 0, "ambiguous_number": 0,
                    "no_corroboration": 0, "kept_existing": 0},
        "examples": [],
    }

    assigned: set[int] = set()
    for kinds in groups.values():
        targets = _questions_of(conn, kinds[ORIGINAL_KIND])
        for kind in SOURCE_KINDS:
            if kind not in kinds:
                continue
            stats["source_files"][kind] += 1
            for sq in _questions_of(conn, kinds[kind]):
                if kind == "解析版":
                    stem, answer, analysis = split_inline(sq["text"])
                    if answer is None and analysis is None:
                        stats["skipped"]["no_data"] += 1
                        continue
                    cands = [t for t in targets if _compatible(stem, t["text"])]
                    if len(cands) == 1:
                        if _assign(conn, cands[0], answer, analysis, dry_run, assigned):
                            stats["matched"] += 1
                            stats["match_stem"] += 1
                            _record_example(stats, kinds[ORIGINAL_KIND], cands[0], answer, kind)
                        else:
                            stats["skipped"]["kept_existing"] += 1
                    elif not cands:
                        stats["skipped"]["no_stem"] += 1
                    else:
                        stats["skipped"]["ambiguous_stem"] += 1
                else:
                    answer = _parse_answer_key(sq["text"])
                    if answer is None:
                        stats["skipped"]["no_data"] += 1
                        continue
                    cands = [t for t in targets if str(t["number"]) == str(sq["number"])]
                    if not cands:
                        stats["skipped"]["no_number"] += 1
                        continue
                    if len(cands) > 1:
                        stats["skipped"]["ambiguous_number"] += 1
                        continue
                    # 内容佐证：题号路径必须同时有题干文本佐证，否则跳过（避免静默错配）
                    if not _number_corroborated(sq["text"], cands[0]["text"]):
                        stats["skipped"]["no_corroboration"] += 1
                        continue
                    if _assign(conn, cands[0], answer, None, dry_run, assigned):
                        stats["matched"] += 1
                        stats["match_number"] += 1
                        _record_example(stats, kinds[ORIGINAL_KIND], cands[0], answer, kind)
                    else:
                        stats["skipped"]["kept_existing"] += 1

    if not dry_run:
        conn.commit()
    return stats


def _assign(conn: sqlite3.Connection, target: sqlite3.Row,
            answer: str | None, analysis: str | None,
            dry_run: bool, assigned: set[int]) -> bool:
    """把 ``answer`` / ``analysis`` 写到目标题（**不覆盖已有非空值**）。

    读取目标题的**当前**数据库状态（而非批次开始时抓取的旧行），并用 ``assigned``
    记录本轮已写过的题号，避免同一轮内重复写入 / 覆盖判定失准。

    返回 ``True`` 表示确有可写入的内容（dry-run 下即「将要写入」），``False`` 表示
    目标题已有来源标记（幂等跳过）或无新内容可写。
    """
    qid = target["id"]
    if qid in assigned:
        return False
    row = conn.execute(
        "SELECT answer, analysis, answer_source FROM questions WHERE id = ?",
        (qid,)).fetchone()
    if row is None or row["answer_source"] is not None:
        assigned.add(qid)
        return False
    new_answer = answer if (answer and not row["answer"]) else None
    new_analysis = analysis if (analysis and not row["analysis"]) else None
    if new_answer is None and new_analysis is None:
        return False
    if not dry_run:
        conn.execute(
            "UPDATE questions SET answer = COALESCE(answer, ?),"
            " analysis = COALESCE(analysis, ?),"
            " answer_source = COALESCE(answer_source, ?) WHERE id = ?",
            (new_answer, new_analysis, SOURCE_PAIRED, qid))
    assigned.add(qid)
    return True


def _record_example(stats: dict, orig_source_id: int, target: sqlite3.Row,
                    answer: str | None, kind: str) -> None:
    """记录对齐成功示例（原题号 ↔ 答案），最多保留 5 条。"""
    if len(stats["examples"]) >= 5:
        return
    stats["examples"].append({
        "source_id": orig_source_id,
        "question_id": target["id"],
        "number": target["number"],
        "answer": answer,
        "from": kind,
    })


# --------------------------------------------------------------------------- #
# 迁移 / 覆盖率
# --------------------------------------------------------------------------- #
def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    """返回某表的列名集合（只读 PRAGMA）。"""
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def ensure_answer_columns(conn: sqlite3.Connection) -> list[str]:
    """幂等地新增 ``answer`` / ``analysis`` / ``answer_source`` 列；返回本次实际新增项。"""
    added: list[str] = []
    for table, columns in ANSWER_COLUMNS.items():
        existing = _column_names(conn, table)
        for col, coltype in columns:
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
                added.append(f"{table}.{col}")
    conn.commit()
    return added


def coverage(conn: sqlite3.Connection) -> dict:
    """统计有答案 / 有解析的题数，以及按 ``answer_source`` 的分布。"""
    cols = _column_names(conn, "questions")
    if not {"answer", "analysis", "answer_source"} <= cols:
        total = conn.execute("SELECT COUNT(*) AS c FROM questions").fetchone()["c"]
        return {"total": total, "with_answer": 0, "with_analysis": 0, "by_source": {}}

    total = conn.execute("SELECT COUNT(*) AS c FROM questions").fetchone()["c"]
    with_answer = conn.execute(
        "SELECT COUNT(*) AS c FROM questions"
        " WHERE answer IS NOT NULL AND answer != ''").fetchone()["c"]
    with_analysis = conn.execute(
        "SELECT COUNT(*) AS c FROM questions"
        " WHERE analysis IS NOT NULL AND analysis != ''").fetchone()["c"]
    by_source = {row["answer_source"] or "NULL": row["c"] for row in conn.execute(
        "SELECT answer_source, COUNT(*) AS c FROM questions GROUP BY answer_source")}
    return {"total": total, "with_answer": with_answer,
            "with_analysis": with_analysis, "by_source": by_source}


def _question_kind(text: str | None) -> str:
    """粗分题型：``mcq``（选择题）/ ``blank``（填空题）/ ``other``（其它）。

    先判选择题（≥3 个不同选项字母，容忍选项被并进题干），再判填空题（含下划线空格）。
    该分类**只用于可疑答案复核**，不参与抽取。
    """
    t = text or ""
    if len(set(_OPTION_LETTER_RE.findall(t))) >= 3:
        return "mcq"
    if _UNDERSCORE_BLANK_RE.search(t):
        return "blank"
    return "other"


def find_suspicious_answers(conn: sqlite3.Connection) -> list[dict]:
    """扫描已写入的答案，返回**可疑项**列表（供人工复核；**不修改**数据库）。

    规则（保守，只报明显矛盾者）：

    * ``single_letter_on_blank``：填空题（含下划线空格、且非选择题）却得到**单个大写
      字母**答案——如 id=2919：填空「沙子是____（连续的/不连续的）」被错写成 ``A``。
      刻意只认大写字母：``选填“a”“b”“c”`` 这类填空题的答案本就是小写字母，不算可疑。

    返回每项含 ``id`` / ``number`` / ``section`` / ``answer`` / ``answer_source`` /
    ``kind`` / ``reason``。
    """
    cols = _column_names(conn, "questions")
    if not {"answer", "analysis", "answer_source"} <= cols:
        return []
    out: list[dict] = []
    for row in conn.execute(
        "SELECT id, number, section, text, answer, answer_source FROM questions"
        " WHERE answer IS NOT NULL AND answer != ''"):
        ans = (row["answer"] or "").strip()
        kind = _question_kind(row["text"])
        reason = None
        if kind == "blank" and _UPPER_LETTER_RE.match(ans):
            reason = "single_letter_on_blank"
        if reason is not None:
            out.append({"id": row["id"], "number": row["number"],
                        "section": row["section"], "answer": ans,
                        "answer_source": row["answer_source"],
                        "kind": kind, "reason": reason})
    return out


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def extract(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:
    """执行路径 A + 路径 B，返回含前后对比的完整统计。

    ``dry_run=True`` 时**只统计不写库**（也不做迁移）。
    """
    before = coverage(conn)
    inline = extract_inline(conn, dry_run=dry_run)
    paired = extract_paired(conn, dry_run=dry_run)
    after = coverage(conn) if not dry_run else before
    return {"dry_run": dry_run, "inline": inline, "paired": paired,
            "before": before, "after": after}


__all__ = [
    "ANS_MARKERS", "ANA_MARKERS", "SOURCE_INLINE", "SOURCE_PAIRED", "ANSWER_COLUMNS",
    "VERSION_TOKENS", "ORIGINAL_KIND", "SOURCE_KINDS",
    "split_inline", "extract_inline", "pair_source_files", "canonical_name",
    "extract_paired", "ensure_answer_columns", "coverage", "find_suspicious_answers",
    "extract",
]
