"""End-to-end proof: real MathType equation -> MTEF parser -> LaTeX -> OMML -> editable in Word/WPS.

This closes the loop without MathType being installed.
Read-only on sources; writes only a new test document under outputs/validation_30/.
"""
# ---------------------------------------------------------------------------
# title: MTEF 往返测试
# description: MTEF 二进制往返解析 / 生成的测试脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from io import BytesIO
import contextlib
import io
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import olefile

sys.path.insert(0, "/tmp/mtef_test/MTEF-py-FIX/src")
from mtef_py.mtef import MTEF  # noqa: E402

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")
SRC = Path(os.path.join(os.path.expanduser("~"), "Desktop", "物理", "初中", "2026学科网教案",
                        "专项06 浮力的计算和实验专题（重难点训练）（解析版）.docx"))
PY = "C:/Users/SOAP/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
BRIDGE = ("C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/"
          "workbuddy-builtin/skills/tencent-local-office-edit/edsdk.py")
OLE_CB_HDR = 28


def sdk(tool, **args):
    p = subprocess.run([PY, BRIDGE, "call", tool, "--json", json.dumps(args, ensure_ascii=False)],
                       capture_output=True, text=True, encoding="utf-8")
    if p.returncode:
        raise RuntimeError(p.stderr or p.stdout)
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return p.stdout.strip()


def mtef_to_latex(stream):
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
                return latex.strip().strip("$").strip()
        except Exception:
            continue
    return None


def cjk_fix(latex):
    """MTEF emits CJK as [U+XXXX]. OMML needs the char inside a single \\text{}.

    Note the MTEF output already wraps them, e.g. {\\text{[U+6d6e]}} - so substitute
    INSIDE the existing \\text{} rather than wrapping again (double \\text{\\text{}} is rejected).
    """
    latex = re.sub(r"\\text\{\[U\+([0-9a-fA-F]{4})\]\}",
                   lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", latex)
    latex = re.sub(r"\[U\+([0-9a-fA-F]{4})\]",
                   lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", latex)
    # MathType uses a non-breaking/space marker '~' at the start of some runs
    latex = re.sub(r"^[~]+", "", latex.strip())
    latex = re.sub(r"\s+", " ", latex)
    # collapse { x } -> {x}
    for _ in range(4):
        latex = latex.replace("{ ", "{").replace(" }", "}")
    return latex.strip()


def main():
    # pick 8 real equations that contain structure (fractions / subscripts / CJK)
    picked = []
    with zipfile_open(SRC) as z:
        for n in sorted(x for x in z.namelist()
                        if x.startswith("word/embeddings/") and x.endswith(".bin")):
            ole = olefile.OleFileIO(BytesIO(z.read(n)))
            if not ole.exists("Equation Native"):
                ole.close()
                continue
            latex = mtef_to_latex(ole.openstream("Equation Native").read())
            ole.close()
            if not latex:
                continue
            if ("frac" in latex or "_" in latex or "^" in latex) and len(latex) < 160:
                picked.append((n, latex))
            if len(picked) >= 8:
                break

    report = {"at": "2026-10-06", "mathType_installed": False, "picked": [], "rendered": None}
    fid = re.search(r"file_id=([^,\s]+)", str(sdk("create_doc"))).group(1)
    for part, latex in picked:
        fixed = cjk_fix(latex)
        entry = {"part": part, "latex_from_mtef": latex, "latex_sent": fixed}
        try:
            pos = sdk("doc_get_last_operable_pos", file_id=fid)["position"]
            sdk("doc_insert_paragraph_with_text", file_id=fid, idx=pos, text=f"[{part}]",
                text_format={"font_family": "宋体", "font_size": 9})
            pos = sdk("doc_get_last_operable_pos", file_id=fid)["position"]
            res = sdk("doc_insert_math", file_id=fid, idx=pos, latex=fixed)
            entry["insert"] = "OK" if "error" not in str(res).lower() else str(res)[:160]
            pos = sdk("doc_get_last_operable_pos", file_id=fid)["position"]
            sdk("doc_insert_paragraph", file_id=fid, idx=pos)
        except Exception as e:
            entry["insert"] = "ERROR: " + str(e)[:160]
        report["picked"].append(entry)

    dest = OUT / "mtef_roundtrip.docx"
    sdk("save_file", file_id=fid, file_path=str(dest.as_posix()))
    sdk("close_file", file_id=fid)
    report["document"] = str(dest)

    # verify in both clients
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    verified = {}
    for key, progid in [("word", "Word.Application"), ("wps", "KWPS.Application")]:
        app = win32com.client.DispatchEx(progid)
        try:
            app.Visible = False
        except Exception:
            pass
        try:
            app.AutomationSecurity = 3
        except Exception:
            pass
        doc = app.Documents.Open(str(dest), ReadOnly=True, AddToRecentFiles=False)
        verified[key] = {"omaths": doc.OMaths.Count,
                         "texts": [re.sub(r"[\r\x07]", "", doc.OMaths.Item(i).Range.Text) for i in
                                   range(1, min(doc.OMaths.Count, 8) + 1)]}
        doc.Close(False)
        app.Quit()
    pythoncom.CoUninitialize()
    report["rendered"] = verified
    (OUT / "mtef_roundtrip.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2)[:4000])


@contextlib.contextmanager
def zipfile_open(p):
    import zipfile
    z = zipfile.ZipFile(p)
    try:
        yield z
    finally:
        z.close()


if __name__ == "__main__":
    main()
