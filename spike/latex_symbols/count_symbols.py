# -*- coding: utf-8 -*-
"""题库公式 LaTeX 符号/结构频次统计（只读，可复现）。

用途
----
为「自研 LaTeX → OMML 转换器」确定真实覆盖范围：扫描 ``bank.db`` 的
``formulas`` 表，统计 LaTeX 命令、结构符号、中文字符的出现频次，输出
原始数字与覆盖率分析。

铁律
----
* **只读**：用 ``bank.db.connect_readonly``（SQLite URI ``mode=ro``）打开库，
  绝不写入 / 迁移。
* 所有数字均来自真实扫描，不做估算。

用法
----
    python spike/latex_symbols/count_symbols.py
    python spike/latex_symbols/count_symbols.py --db "D:/.../bank.db"
    python spike/latex_symbols/count_symbols.py --json out.json   # 另存机器可读结果
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# --- 让脚本可直接从 worktree 根目录运行 -------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from bank.db import connect_readonly  # noqa: E402

DEFAULT_DB = Path(r"D:/Open-source project/Localtopic-management/outputs/bank.db")

# --------------------------------------------------------------------------- #
# 正则定义
# --------------------------------------------------------------------------- #
# LaTeX 命令：反斜杠 + 字母序列（\frac \sqrt \text \mathrm \rho \Delta ...）
RE_COMMAND = re.compile(r"\\[a-zA-Z]+")
# 反斜杠转义（非字母）：\, \; \! \  \{ \} \% ...（\\ 换行单独处理）
RE_ESCAPE = re.compile(r"\\[^a-zA-Z]")
# 中文字符（CJK 统一表意文字基本区）
RE_CJK = re.compile(r"[\u4e00-\u9fff]")
# 特殊字符：非 ASCII 且非 CJK（希腊字母、℃，×，−，′，Ω 等原始 Unicode 符号）
RE_SPECIAL = re.compile(r"[^\x00-\x7f]")
# 双反斜杠（LaTeX 换行）
RE_NEWLINE = re.compile(r"\\\\")


def iter_latex(db_path: Path):
    """只读遍历 formulas 表，产出 (id, kind, status, latex) —— 仅非空 latex。"""
    conn = connect_readonly(db_path)
    try:
        cur = conn.execute(
            "SELECT id, kind, status, latex FROM formulas "
            "WHERE latex IS NOT NULL AND TRIM(latex) <> '' ORDER BY id"
        )
        for row in cur:
            yield row["id"], row["kind"], row["status"], row["latex"]
    finally:
        conn.close()


def max_brace_depth(s: str) -> int:
    """最大花括号嵌套深度。"""
    depth = cur_max = 0
    for ch in s:
        if ch == "{":
            depth += 1
            if depth > cur_max:
                cur_max = depth
        elif ch == "}":
            if depth > 0:
                depth -= 1
    return cur_max


def analyze(db_path: Path):
    cmd_counter: Counter[str] = Counter()        # 字母命令
    escape_counter: Counter[str] = Counter()      # 非字母转义
    struct = Counter()                            # 结构符号
    cjk_counter: Counter[str] = Counter()         # 中文字符
    special_counter: Counter[str] = Counter()     # 非 ASCII 非中文的特殊字符
    total_cmd_occurrences = 0
    formulas = []                                 # 每式元信息
    kinds = Counter()
    statuses = Counter()
    n_total = 0
    n_with_cmd = 0

    for fid, kind, status, latex in iter_latex(db_path):
        n_total += 1
        kinds[kind] += 1
        statuses[status] += 1

        cmds = RE_COMMAND.findall(latex)
        escs = RE_ESCAPE.findall(latex)
        # RE_ESCAPE 会把换行 "\\" 也匹配进来（\\ + \ 中的第二个字符不是字母），
        # 这里剔除纯换行，换行单独统计。
        escs = [e for e in escs if e != "\\\\"]

        cmd_counter.update(cmds)
        escape_counter.update(escs)
        total_cmd_occurrences += len(cmds)
        if cmds:
            n_with_cmd += 1

        # 结构符号
        struct["^"] += latex.count("^")
        struct["_"] += latex.count("_")
        struct["{"] += latex.count("{")
        struct["}"] += latex.count("}")
        struct["&"] += latex.count("&")
        struct["\\\\"] += len(RE_NEWLINE.findall(latex))
        struct["\\left"] += len(re.findall(r"\\left(?![a-zA-Z])", latex))
        struct["\\right"] += len(re.findall(r"\\right(?![a-zA-Z])", latex))

        # 中文
        cjk = RE_CJK.findall(latex)
        cjk_counter.update(cjk)

        # 特殊字符（非 ASCII 非 CJK）
        for ch in RE_SPECIAL.findall(latex):
            if not RE_CJK.match(ch):
                special_counter[ch] += 1

        formulas.append({
            "id": fid,
            "kind": kind,
            "status": status,
            "len": len(latex),
            "n_cmd": len(cmds),
            "n_cmd_unique": len(set(cmds)),
            "cmds": sorted(set(cmds)),
            "depth": max_brace_depth(latex),
            "n_cjk": len(cjk),
            "latex": latex,
        })

    # 覆盖率：按命令出现次数降序
    total = total_cmd_occurrences
    cum = 0
    coverage = []  # (rank, cmd, count, share, cum_share)
    for rank, (cmd, cnt) in enumerate(cmd_counter.most_common(), start=1):
        cum += cnt
        coverage.append({
            "rank": rank, "cmd": cmd, "count": cnt,
            "share": cnt / total if total else 0.0,
            "cum_share": cum / total if total else 0.0,
        })

    def min_n_for(threshold: float):
        for row in coverage:
            if row["cum_share"] >= threshold:
                return row["rank"]
        return None

    # 按「式子完整覆盖」评估：某式子的全部命令都落在 Top-N 命令集合内才算覆盖
    top_cmds = [c for c, _ in cmd_counter.most_common()]
    formula_full_cov = {}
    for n in (3, 5, 7, 10, 15, 20, 35):
        allowed = set(top_cmds[:n])
        hit = sum(1 for f in formulas if set(f["cmds"]) <= allowed)
        formula_full_cov[n] = hit

    return {
        "db_path": str(db_path),
        "n_total": n_total,
        "formula_full_cov": formula_full_cov,
        "top_cmds": top_cmds,
        "n_with_cmd": n_with_cmd,
        "kinds": dict(kinds),
        "statuses": dict(statuses),
        "total_cmd_occurrences": total,
        "n_distinct_cmds": len(cmd_counter),
        "cmd_counter": dict(cmd_counter.most_common()),
        "escape_counter": dict(escape_counter.most_common()),
        "struct": dict(struct),
        "cjk_counter": dict(cjk_counter.most_common()),
        "n_cjk_occurrences": sum(cjk_counter.values()),
        "n_cjk_distinct": len(cjk_counter),
        "special_counter": dict(special_counter.most_common()),
        "n_special_occurrences": sum(special_counter.values()),
        "n_special_distinct": len(special_counter),
        "coverage": coverage,
        "min_n_90": min_n_for(0.90),
        "min_n_95": min_n_for(0.95),
        "min_n_99": min_n_for(0.99),
        "top_complex_by_cmd": top_complex(formulas, 20, "n_cmd"),
        "top_complex_by_depth": top_complex(formulas, 20, "depth"),
    }


def top_complex(formulas, n=10, by="n_cmd"):
    return sorted(formulas, key=lambda f: (f[by], f["len"]), reverse=True)[:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--json", default=None, help="另存机器可读结果到该路径")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[FATAL] 数据库不存在：{db_path}", file=sys.stderr)
        sys.exit(2)

    r = analyze(db_path)

    print("=" * 78)
    print("一、数据来源与样本量")
    print("=" * 78)
    print(f"数据库路径           : {r['db_path']}")
    print(f"formulas 总数        : {r['n_total']}  (非空 latex)")
    print(f"含至少 1 个命令的式子 : {r['n_with_cmd']}")
    print(f"kind 分布            : {r['kinds']}")
    print(f"status 分布          : {r['statuses']}")
    print(f"命令出现总次数       : {r['total_cmd_occurrences']}")
    print(f"去重命令种类数       : {r['n_distinct_cmds']}")

    print()
    print("=" * 78)
    print("二、LaTeX 命令频次 Top-50")
    print("=" * 78)
    print(f"{'rank':>4}  {'command':<20} {'count':>8} {'share':>8} {'cum':>8}")
    for row in r["coverage"][:50]:
        print(f"{row['rank']:>4}  {row['cmd']:<20} {row['count']:>8} "
              f"{row['share']*100:>7.2f}% {row['cum_share']*100:>7.2f}%")

    print()
    print("=" * 78)
    print("三、覆盖率分析")
    print("=" * 78)
    for t in (0.50, 0.80, 0.90, 0.95, 0.99, 1.00):
        for row in r["coverage"]:
            if row["cum_share"] >= t:
                print(f"覆盖 >= {t*100:5.0f}% 需要 Top-{row['rank']:<4} "
                      f"(该处累计 {row['cum_share']*100:.2f}%)")
                break
    print("-- 按「式子完整覆盖」（该式全部命令都在 Top-N 集合内）--")
    for n, hit in r["formula_full_cov"].items():
        print(f"  Top-{n:<3} 完整覆盖式子数 : {hit:>6} / {r['n_total']} "
              f"({hit/r['n_total']*100:.2f}%)")

    print()
    print("=" * 78)
    print("四、结构符号与特殊字符")
    print("=" * 78)
    print("-- 结构符号 --")
    for k, v in sorted(r["struct"].items(), key=lambda x: -x[1]):
        print(f"  {k!r:<12} {v:>8}")
    print(f"-- 非字母转义（Top-20，共 {len(r['escape_counter'])} 种）--")
    for k, v in list(r["escape_counter"].items())[:20]:
        print(f"  {k!r:<12} {v:>8}")
    print(f"-- 中文字符 --")
    print(f"  中文出现总次数 : {r['n_cjk_occurrences']}")
    print(f"  中文去重字符数 : {r['n_cjk_distinct']}")
    print(f"  去重字符集     : {''.join(sorted(r['cjk_counter'].keys()))}")
    print(f"  高频中文 Top-30: {r['cjk_counter'] and list(r['cjk_counter'].items())[:30]}")
    print(f"-- 特殊字符（非 ASCII 非中文，如 ℃ × − Ω ρ Δ ′ 等）--")
    print(f"  出现总次数     : {r['n_special_occurrences']}")
    print(f"  去重字符数     : {r['n_special_distinct']}")
    for ch, cnt in list(r["special_counter"].items()):
        print(f"    {ch!r}  U+{ord(ch):04X}  {cnt:>8}")

    print()
    print("=" * 78)
    print("五、最复杂 Top-10 公式（按命令数）")
    print("=" * 78)
    for i, f in enumerate(r["top_complex_by_cmd"][:10], 1):
        print(f"[{i}] id={f['id']} kind={f['kind']} n_cmd={f['n_cmd']} "
              f"uniq_cmd={f['n_cmd_unique']} depth={f['depth']} len={f['len']}")
        print(f"    {f['latex']}")
        print()

    print("=" * 78)
    print("五-B、最复杂 Top-10 公式（按花括号嵌套深度）")
    print("=" * 78)
    for i, f in enumerate(r["top_complex_by_depth"][:10], 1):
        print(f"[{i}] id={f['id']} depth={f['depth']} n_cmd={f['n_cmd']} len={f['len']}")
        print(f"    {f['latex']}")
        print()

    if args.json:
        out = Path(args.json)
        out.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[saved] {out}")


if __name__ == "__main__":
    main()
