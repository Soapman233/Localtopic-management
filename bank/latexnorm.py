"""LaTeX 表示规范化（D1 / D2）。

背景
----
阶段1 的两条公式路径产出的 LaTeX **表示不一致**：

* **MTEF（MathType）**：中文被写成 ``[U+XXXX]`` 转义（例如 ``\\rho_{{\\text{[U+6c34]}}}``），
  且整条公式**带 ``$…$`` 定界符**；
* **OMML（Word 原生）**：中文是真字符，且**不带 ``$``**。

这种差异对**导出**无碍——导出侧的 :func:`bank.export.sanitize_latex` 会在渲染前
还原 ``[U+XXXX]`` 并剥离 ``$``。但任何**直接读 ``formulas.latex`` 的消费方**
（如未来的 Web 界面渲染 KaTeX/MathJax）会看到 ``[U+6c34]`` 或多余的 ``$``。

本模块把库内的 LaTeX **规范化**为可直接消费的形式，并保证**幂等**：

* :func:`restore_uplus`（D1）：把 ``[U+XXXX]`` 还原为真字符，且**只在已有的
  ``\\text{}`` 内部替换**（``{\\text{[U+6c34]}}`` → ``{\\text{水}}``），
  **绝不**套成 ``\\text{\\text{水}}``（那会让渲染器报错）；
* :func:`strip_dollar`（D2）：统一为**不带 ``$`` 定界符**（规范 LaTeX 主体）；
* :func:`normalize_latex`：上述两步的组合（幂等）；
* :func:`migrate_latex`：对既有 ``formulas.latex``（可选连同试卷快照）执行一次性迁移。

约定（D2 选定）
--------------
**统一为不带 ``$`` 定界符**。理由：

1. 规范 LaTeX 的「公式主体」本就不含定界符，``$`` 只是文本环境里的行内标记；
2. 导出侧 :func:`bank.export.sanitize_latex` 会剥离 ``$``，故对导出**无影响**；
3. 5,908 条 OMML 公式本就不带 ``$``，去掉 MathType 的 ``$`` 即把两种来源统一为
   「不带 ``$``」这一更规范、更少歧义的约定。
"""

# ---------------------------------------------------------------------------
# title: LaTeX 表示规范化
# description: LaTeX 转义与定界符规范化；展示时去除已知 EF01 空白标记，未知私有字符显式占位，不改原库。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------


from __future__ import annotations

import json
import re
import sqlite3

#: ``\text{[U+XXXX]}`` 形式的 CJK 转义（MTEF 产物）。与 ``bank.export`` 中的定义一致。
_TEXT_UPLUS_RE = re.compile(r"\\text\{\[U\+([0-9a-fA-F]{4})\]\}")
#: 裸 ``[U+XXXX]``（不在 ``\text{}`` 内）。
_UPLUS_RE = re.compile(r"\[U\+([0-9a-fA-F]{4})\]")
#: 行首 / 行尾的 ``$`` 定界符（可重复）。
_LEAD_DOLLAR_RE = re.compile(r"^\$+")
_TRAIL_DOLLAR_RE = re.compile(r"\$+$")

#: 标记：用于迁移前后计数（判断 LaTeX 是否含 ``[U+`` 转义）。
UPLUS_MARKER = "[U+"


def _uplus_to_char(hex_digits: str) -> str:
    """把 ``[U+XXXX]`` 里的十六进制码位转成真字符。"""
    return chr(int(hex_digits, 16))


def restore_uplus(latex: str | None) -> str | None:
    """把 ``[U+XXXX]`` 还原为真字符（D1，幂等）。

    **先**在已有 ``\\text{...}`` 内部替换（``\\text{[U+6c34]}`` → ``\\text{水}``），
    **再**替换 ``\\text{}`` 之外的裸 ``[U+XXXX]``（补上 ``\\text{}`` 包裹）。
    因此绝不会产生 ``\\text{\\text{水}}`` 这种会让渲染器报错的双重包裹。

    传入 ``None`` 原样返回；其余按 ``str`` 处理。
    """
    if latex is None:
        return None
    s = str(latex)
    # 1) 已有 \text{...} 内部：只还原字符，保留（且不新增）\text{} 包裹。
    s = _TEXT_UPLUS_RE.sub(lambda m: "\\text{" + _uplus_to_char(m.group(1)) + "}", s)
    # 2) \text{} 之外的裸 [U+XXXX]：补 \text{} 包裹（中文需在文本环境内渲染）。
    s = _UPLUS_RE.sub(lambda m: "\\text{" + _uplus_to_char(m.group(1)) + "}", s)
    return s


def unknown_private_glyphs(latex: str | None) -> list[str]:
    """列出无法解释的私有字符，EF01 已由本地 MTCode 表定义为空白。"""
    s = restore_uplus(latex) or ''
    return sorted({f'U+{ord(c):04X}' for c in s if '\ue000' <= c <= '\uf8ff' and c != '\uef01'})


def sanitize_glyphs(latex: str | None) -> str | None:
    """纯展示清洗：EF01 空标记去除；未知私有字形显式变为 □，禁止猜成数学符号。"""
    s = restore_uplus(latex)
    if s is None:
        return None
    s = s.replace('\uef01', '')
    # 去除已知空标记留下的空文本，避免桥接拒绝空文本命令。
    s = re.sub(r'\\text\{\s*\}', '', s)
    return re.sub('[\ue000-\uf8ff]', '□', s)


def strip_dollar(latex: str | None) -> str | None:
    """去掉公式外层 ``$`` 定界符（D2，幂等）。

    只剥离**首尾**的 ``$``（可重复，如 ``$$…$$``）；公式**内部**的 ``$`` 不动。
    定界符与内容之间常有空格（``$ x $``），故剥离后**再次 trim**，保证幂等。
    传入 ``None`` 原样返回。
    """
    if latex is None:
        return None
    s = str(latex).strip()
    s = _LEAD_DOLLAR_RE.sub("", s).strip()
    s = _TRAIL_DOLLAR_RE.sub("", s).strip()
    return s


def normalize_latex(latex: str | None) -> str | None:
    """规范化一条 LaTeX：还原 ``[U+XXXX]`` + 去掉 ``$`` 定界符（D1 + D2，幂等）。

    传入 ``None`` 原样返回（表示「无 LaTeX」，如 FAIL/EMPTY 公式）。
    """
    if latex is None:
        return None
    return strip_dollar(restore_uplus(latex))


def count_uplus(values) -> int:
    """统计一组 LaTeX 中含 ``[U+`` 转义的条数。"""
    return sum(1 for v in values if v is not None and UPLUS_MARKER in str(v))


def count_dollar(values) -> int:
    """统计一组 LaTeX 中带 ``$`` 定界符（以 ``$`` 开头）的条数。"""
    return sum(1 for v in values if v is not None and str(v).strip().startswith("$"))


def _snapshot_formulas(snap) -> list[dict]:
    """从已解析的快照字典里取出公式列表（无则返回 ``[]``）。"""
    if not isinstance(snap, dict):
        return []
    formulas = snap.get("formulas")
    return [f for f in (formulas or []) if isinstance(f, dict)]


def migrate_latex(conn: sqlite3.Connection, *, include_snapshots: bool = True,
                  dry_run: bool = False) -> dict:
    """把库内 LaTeX 规范化（D1 + D2），**幂等**；返回迁移统计。

    处理范围：

    * ``formulas.latex``：始终处理；
    * ``paper_questions.snapshot_json`` 内的 ``formulas[].latex``：``include_snapshots=True``
      时一并处理（默认开启）。**说明**：快照代表「出卷时锁定的内容」，但本次改动是
      **纯表示规范化**（同一公式的渲染结果不变），因此不会改变任何试卷的语义；
      规范化后导出侧的还原逻辑对快照成为**幂等空操作**。

    参数
    ----
    include_snapshots  是否同时规范化试卷快照里的公式 LaTeX（默认 True）。
    dry_run            只统计不写库（默认 False）。

    返回
    ----
    统计字典：``formulas_total`` / ``formulas_changed``、
    ``snapshots_scanned`` / ``snapshots_changed``，
    以及迁移前后的 ``uplus_before`` / ``uplus_after``、``dollar_before`` / ``dollar_after``。

    **注意**：本函数**不**负责备份；调用方应先对 ``bank.db`` 备份并校验
    （见 :func:`bank.enrich.backup_db` / :func:`bank.enrich.verify_backup`）。
    """
    # 迁移前标记计数（针对 formulas.latex）。
    before_rows = conn.execute("SELECT latex FROM formulas").fetchall()
    before_values = [r["latex"] for r in before_rows]
    uplus_before = count_uplus(before_values)
    dollar_before = count_dollar(before_values)

    formulas_changed = 0
    for r in conn.execute("SELECT id, latex FROM formulas").fetchall():
        old = r["latex"]
        new = normalize_latex(old)
        if new != old:
            formulas_changed += 1
            if not dry_run:
                conn.execute("UPDATE formulas SET latex = ? WHERE id = ?", (new, r["id"]))

    snapshots_scanned = 0
    snapshots_changed = 0
    if include_snapshots:
        for r in conn.execute(
                "SELECT id, snapshot_json FROM paper_questions"
                " WHERE snapshot_json IS NOT NULL").fetchall():
            snapshots_scanned += 1
            try:
                snap = json.loads(r["snapshot_json"])
            except (ValueError, TypeError):
                continue
            changed = False
            for f in _snapshot_formulas(snap):
                old = f.get("latex")
                new = normalize_latex(old)
                if new != old:
                    f["latex"] = new
                    changed = True
            if changed:
                snapshots_changed += 1
                if not dry_run:
                    conn.execute("UPDATE paper_questions SET snapshot_json = ? WHERE id = ?",
                                 (json.dumps(snap, ensure_ascii=False), r["id"]))

    if not dry_run:
        conn.commit()

    after_values = [r["latex"] for r in conn.execute("SELECT latex FROM formulas").fetchall()]
    return {
        "dry_run": bool(dry_run),
        "include_snapshots": bool(include_snapshots),
        "formulas_total": len(before_values),
        "formulas_changed": formulas_changed,
        "snapshots_scanned": snapshots_scanned,
        "snapshots_changed": snapshots_changed,
        "uplus_before": uplus_before,
        "uplus_after": count_uplus(after_values),
        "dollar_before": dollar_before,
        "dollar_after": count_dollar(after_values),
    }


__all__ = [
    "restore_uplus", "strip_dollar", "normalize_latex",
    "count_uplus", "count_dollar", "migrate_latex",
    "UPLUS_MARKER",
]
