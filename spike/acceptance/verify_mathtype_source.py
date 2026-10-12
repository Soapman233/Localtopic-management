# -*- coding: utf-8 -*-
"""验证 MathType（Equation.DSMT4 OLE）转换链路——**源码模式**。

Phase 1 遗留的最大未知数：`pipeline/mtef_conv.py` 用 `multiprocessing` spawn，
冻结（打包）后是否正常。本脚本先在源码模式建立基线，
再由 `verify_mathtype_frozen.py` 在打包版上做同样的事。

样例：`11.5 机械效率（重难点专练）（答案版）.docx`（DSMT4×23，体积小跑得快）。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SAMPLE = Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/"
              "11.5 机械效率（重难点专练）（答案版）.docx")
WORK = ROOT / "spike" / "acceptance" / "_mtef"


def main() -> int:
    if not SAMPLE.is_file():
        print(f"[SKIP] 样例不存在：{SAMPLE}")
        return 0
    WORK.mkdir(parents=True, exist_ok=True)

    from pipeline import stage1

    t0 = time.perf_counter()
    rec = stage1.process_file(SAMPLE, WORK, timeout=600.0, verbose=False)
    dt = time.perf_counter() - t0

    print(f"阶段1 状态: {rec.get('status')}  耗时 {dt:.1f}s")
    q = rec.get("questions") or {}
    print(f"  题数={q.get('questions')} 含公式={q.get('with_formulas')} "
          f"公式引用={q.get('total_formula_refs')}")
    scan = rec.get("scan") or {}
    print(f"  扫描: {json.dumps(scan, ensure_ascii=False)[:220]}")
    print(f"  待复核={rec.get('review_count')}")
    if rec.get("status") != "OK":
        print(f"  错误: {rec.get('error')}")
        return 1

    # 检查产出 JSON 里公式是否真的转成了 LaTeX
    qjson = WORK / f"{SAMPLE.stem}.questions.json"
    if qjson.is_file():
        data = json.loads(qjson.read_text(encoding="utf-8"))
        forms = []
        for qq in data.get("questions") or []:
            forms.extend(qq.get("formulas") or [])
        latex_like = [f for f in forms if isinstance(f, str) and any(
            c in f for c in ("\\", "^", "_", "{"))]
        print(f"\n  题目 JSON 中公式条目 {len(forms)} 条，含 LaTeX 记号 {len(latex_like)} 条")
        for f in forms[:5]:
            print(f"    {str(f)[:80]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
