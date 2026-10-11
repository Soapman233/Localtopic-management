"""Test the 'keep MathType objects as-is' route.

Question: if we never convert, does the MathType object survive extract -> export
intact, and does it still display correctly?  Read-only on sources.
"""
# ---------------------------------------------------------------------------
# title: MathType 保留测试
# description: 测试保留 MathType OLE 对象的处理策略。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import collections
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import time
import zipfile

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")
KEEP = OUT / "keep_mathtype"
KEEP.mkdir(exist_ok=True)

SRC = Path(os.path.join(os.path.expanduser("~"), "Desktop", "物理", "初中", "2026学科网教案",
                        "专项06 浮力的计算和实验专题（重难点训练）（解析版）.docx"))


def sha(p):
    h = hashlib.sha256()
    with Path(p).open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def pkg(path):
    """Inventory of the OOXML package: OLE objects, embedded binaries, preview media."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        doc = z.read("word/document.xml").decode("utf-8", "replace")
        return {
            "ole_objects": doc.count("<o:OLEObject"),
            "vml_preview_refs": doc.count("<v:imagedata"),
            "drawing_refs": doc.count("<a:blip"),
            "omath": doc.count("<m:oMath"),
            "embeddings": sorted(n for n in names if n.startswith("word/embeddings/") and not n.endswith("/")),
            "media": sorted(n for n in names if n.startswith("word/media/") and not n.endswith("/")),
            "progids": sorted(set(re.findall(r'ProgID="([^"]+)"', doc))),
        }


def main():
    report = {"at": datetime.datetime.now().astimezone().isoformat(), "source": str(SRC),
              "source_exists": SRC.is_file()}
    if not SRC.is_file():
        (OUT / "keep_mathtype_test.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    src_hash_before = sha(SRC)
    report["source_sha256"] = src_hash_before
    report["source_package"] = pkg(SRC)

    # 1) Pure copy round-trip: does anything get lost by just moving the bytes?
    copy = KEEP / "copy_of_source.docx"
    if copy.exists():
        copy.unlink()
    shutil.copy2(SRC, copy)
    report["copy"] = {"sha256": sha(copy), "identical": sha(copy) == src_hash_before,
                      "package": pkg(copy)}

    # 2) Generic "open and re-save" round-trip through the local editor bridge
    sys.path.insert(0, str(Path("D:/Open-source project/Localtopic-management/.workbuddy-ai")))
    import subprocess
    PY = "C:/Users/SOAP/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
    BRIDGE = ("C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/"
              "workbuddy-builtin/skills/tencent-local-office-edit/edsdk.py")

    def sdk(tool, **args):
        p = subprocess.run([PY, BRIDGE, "call", tool, "--json", json.dumps(args, ensure_ascii=False)],
                           capture_output=True, text=True, encoding="utf-8")
        if p.returncode:
            raise RuntimeError(p.stderr or p.stdout)
        try:
            return json.loads(p.stdout)
        except json.JSONDecodeError:
            return p.stdout.strip()

    resaved = KEEP / "resaved_via_bridge.docx"
    try:
        t = time.perf_counter()
        opened = sdk("open_file", file_path=str(copy.as_posix()), wait=True)
        sdk("save_file", file_id=str(copy.as_posix()), file_path=str(resaved.as_posix()))
        sdk("close_file", file_id=str(copy.as_posix()))
        report["resave"] = {"seconds": round(time.perf_counter() - t, 2), "status": "PASS",
                            "package": pkg(resaved)}
    except Exception as e:
        report["resave"] = {"status": "ERROR", "error": str(e)}

    # 3) Did the OLE payload survive byte-for-byte?
    if resaved.exists():
        a, b = pkg(SRC), pkg(resaved)
        report["preservation"] = {
            "ole_objects_before": a["ole_objects"], "ole_objects_after": b["ole_objects"],
            "ole_objects_preserved": a["ole_objects"] == b["ole_objects"],
            "embedded_count_before": len(a["embeddings"]), "embedded_count_after": len(b["embeddings"]),
            "media_count_before": len(a["media"]), "media_count_after": len(b["media"]),
            "omath_before": a["omath"], "omath_after": b["omath"],
            "progids_before": a["progids"], "progids_after": b["progids"],
        }
        # Compare each embedded OLE stream by content hash (names get renumbered, so compare sorted hashes)
        with zipfile.ZipFile(SRC) as z1, zipfile.ZipFile(resaved) as z2:
            h1 = sorted(hashlib.sha256(z1.read(n)).hexdigest() for n in a["embeddings"])
            h2 = sorted(hashlib.sha256(z2.read(n)).hexdigest() for n in b["embeddings"])
        report["preservation"]["embedded_payload_identical"] = h1 == h2
        report["preservation"]["embedded_payloads_before"] = len(h1)
        report["preservation"]["embedded_payloads_after"] = len(h2)

    report["source_sha256_after"] = sha(SRC)
    report["source_unchanged"] = sha(SRC) == src_hash_before

    (OUT / "keep_mathtype_test.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
