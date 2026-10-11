"""Measure how well an open-source MTEF parser converts the real MathType equations
in the user's downloaded files - without MathType installed.

Read-only: only reads .docx packages. Nothing is written back to source files.
"""
# ---------------------------------------------------------------------------
# title: MTEF 测试
# description: MTEF 解析的基础测试脚本。
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
import re
import sys
import time
import zipfile
from pathlib import Path

import olefile

sys.path.insert(0, "/tmp/mtef_test/MTEF-py-FIX/src")
from mtef_py.mtef import MTEF  # noqa: E402

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")
OLE_CB_HDR = 28  # Equation Native stream header length used by the reference tool


def convert_equation(stream_bytes):
    """Return (status, latex). status in OK / EMPTY / FAIL."""
    for offset, label in ((OLE_CB_HDR, "hdr28"), (0, "raw")):
        try:
            eqn = MTEF()
            eqn.reader = BytesIO(stream_bytes[offset:])
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


def scan_docx(path, limit=None):
    rows = []
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist()
                       if n.startswith("word/embeddings/") and n.endswith(".bin"))
        if limit:
            names = names[:limit]
        for n in names:
            row = {"part": n}
            try:
                ole = olefile.OleFileIO(BytesIO(z.read(n)))
                if not ole.exists("Equation Native"):
                    row["status"] = "NOT_EQUATION"
                    ole.close()
                    rows.append(row)
                    continue
                stream = ole.openstream("Equation Native").read()
                ole.close()
                row["stream_bytes"] = len(stream)
                status, latex = convert_equation(stream)
                row["status"] = status
                if latex:
                    row["latex"] = re.sub(r"\s+", " ", latex.strip())
            except Exception as e:
                row["status"] = "FAIL"
                row["error"] = str(e)[:120]
            rows.append(row)
    return rows


def main():
    targets = [
        ("xuekewang_980", Path.home() / "Desktop/物理/初中/2026学科网教案"
         / "专项06 浮力的计算和实验专题（重难点训练）（解析版）.docx", None),
        ("B_group_q", OUT / "11.5 机械效率（重难点专练）（原卷版）.docx", None),
    ]
    report = {"at": datetime.datetime.now().astimezone().isoformat(),
              "parser": "mtef-py 1.0.1 (Apache-2.0)", "mathType_installed": False, "files": {}}
    for label, path, limit in targets:
        if not path.is_file():
            report["files"][label] = {"status": "MISSING", "path": str(path)}
            continue
        t = time.perf_counter()
        rows = scan_docx(path, limit)
        counts = collections.Counter(r["status"] for r in rows)
        ok = [r for r in rows if r["status"] == "OK"]
        total = len([r for r in rows if r["status"] != "NOT_EQUATION"])
        report["files"][label] = {
            "path": str(path),
            "objects_scanned": len(rows),
            "equation_objects": total,
            "status_counts": dict(counts),
            "success_rate": round(len(ok) / total, 4) if total else None,
            "seconds": round(time.perf_counter() - t, 2),
            "samples": [{"part": r["part"], "latex": r.get("latex", "")[:160]} for r in ok[:12]],
        }
        print(label, dict(counts), "success=", report["files"][label]["success_rate"], flush=True)
    (OUT / "mtef_conversion_test.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2)[:3000])


if __name__ == "__main__":
    main()
