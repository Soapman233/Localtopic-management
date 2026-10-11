"""Corpus-wide measurement of MathType -> LaTeX conversion (no MathType installed).

Samples real files across both source directories, converts every MathType object,
and reports the aggregate success rate. Read-only on sources.
"""
# ---------------------------------------------------------------------------
# title: MTEF 语料测试
# description: 对 MTEF 语料做批量转换测试的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from io import BytesIO
import collections
import contextlib
import datetime
import io
import json
import os
import random
import re
import sys
import time
import zipfile
from pathlib import Path

import olefile

sys.path.insert(0, "/tmp/mtef_test/MTEF-py-FIX/src")
from mtef_py.mtef import MTEF  # noqa: E402

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")
OLE_CB_HDR = 28
ROOTS = [
    Path(os.path.join(os.path.expanduser("~"), "Desktop", "物理", "初中", "2026学科网教案")),
    Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷"),
]


def convert(stream):
    for off in (OLE_CB_HDR, 0):
        try:
            eqn = MTEF()
            eqn.reader = BytesIO(stream[off:])
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                eqn.readRecord()
                eqn.makeAST()
                latex = eqn.Translate()
            if latex and latex.strip("$ ").strip():
                return "OK", latex
        except Exception:
            continue
    return "FAIL", None


def scan(path):
    out = {"file": path.name, "ok": 0, "fail": 0, "non_equation": 0, "examples": []}
    try:
        with zipfile.ZipFile(path) as z:
            for n in sorted(x for x in z.namelist()
                            if x.startswith("word/embeddings/") and x.endswith(".bin")):
                try:
                    ole = olefile.OleFileIO(BytesIO(z.read(n)))
                    if not ole.exists("Equation Native"):
                        ole.close()
                        out["non_equation"] += 1
                        continue
                    s = ole.openstream("Equation Native").read()
                    ole.close()
                    status, latex = convert(s)
                    if status == "OK":
                        out["ok"] += 1
                        if len(out["examples"]) < 2:
                            out["examples"].append(re.sub(r"\s+", " ", latex.strip())[:120])
                    else:
                        out["fail"] += 1
                except Exception:
                    out["fail"] += 1
    except Exception as e:
        out["error"] = str(e)[:100]
    return out


def main():
    random.seed(20261006)
    files = []
    for root in ROOTS:
        if root.is_dir():
            files += sorted(root.rglob("*.docx"))
    sample = random.sample(files, min(40, len(files)))
    t = time.perf_counter()
    rows = [scan(p) for p in sample]
    elapsed = time.perf_counter() - t

    agg = collections.Counter()
    for r in rows:
        agg["ok"] += r["ok"]
        agg["fail"] += r["fail"]
        agg["non_equation"] += r["non_equation"]
    total = agg["ok"] + agg["fail"]
    summary = {
        "at": datetime.datetime.now().astimezone().isoformat(),
        "parser": "mtef-py 1.0.1 (Apache-2.0)",
        "mathType_installed": False,
        "corpus_docx_total": len(files),
        "sampled_files": len(sample),
        "files_with_equations": sum(1 for r in rows if r["ok"] + r["fail"] > 0),
        "files_all_converted": sum(1 for r in rows if r["fail"] == 0 and r["ok"] > 0),
        "equations_ok": agg["ok"],
        "equations_fail": agg["fail"],
        "equations_total": total,
        "success_rate": round(agg["ok"] / total, 4) if total else None,
        "non_equation_ole": agg["non_equation"],
        "seconds": round(elapsed, 2),
        "per_file": rows,
    }
    (OUT / "mtef_corpus_test.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "per_file"}, ensure_ascii=False, indent=2))
    print("\n--- worst files ---")
    for r in sorted(rows, key=lambda x: -x["fail"])[:8]:
        if r["fail"]:
            print(f"  fail={r['fail']} ok={r['ok']}  {r['file'][:70]}")
    print("\n--- sample conversions ---")
    for r in rows:
        for e in r["examples"][:1]:
            print("  ", e)


if __name__ == "__main__":
    main()
