"""Cross-client (Microsoft Word vs WPS) compatibility tests on the frozen 30-question set.
Read-only on sources; writes only test copies under outputs/validation_30/crossclient/.
Does not activate OLE servers or execute macros.
"""
# ---------------------------------------------------------------------------
# title: 跨客户端验证脚本
# description: 在 WPS 与 Microsoft Word 两个客户端间验证公式可编辑性。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import datetime, json, os, shutil, sys, time, traceback
import pythoncom
import win32com.client

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")
CC = OUT / "crossclient"
CC.mkdir(exist_ok=True)


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


CLIENTS = {"word": "Word.Application", "wps": "KWPS.Application"}


def probe_clients():
    pythoncom.CoInitialize()
    report = {"at": datetime.datetime.now().astimezone().isoformat(), "clients": {}}
    for key, progid in CLIENTS.items():
        entry = {"progid": progid}
        app = None
        try:
            app = win32com.client.DispatchEx(progid)
            entry.update({"name": str(app.Name), "version": str(app.Version),
                          "build": str(app.Build), "path": str(app.Path)})
            entry["status"] = "PASS"
        except Exception as e:
            entry.update({"status": "ERROR", "error": str(e)})
        finally:
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
        report["clients"][key] = entry
        print(key, entry.get("status"), entry.get("name"), entry.get("version"), entry.get("build"), flush=True)
    # Is MathType installed anywhere obvious?
    mt = []
    for base in [r"C:\Program Files", r"C:\Program Files (x86)"]:
        p = Path(base)
        if p.is_dir():
            for child in p.iterdir():
                if "mathtype" in child.name.lower() or "design science" in child.name.lower():
                    mt.append(str(child))
    report["mathtype_dirs"] = mt
    dump("crossclient_clients.json", report)
    pythoncom.CoUninitialize()


def _edit_and_verify(app, src, tag):
    """Open src, edit one leaf char in every equation, save, reopen, compare."""
    row = {"id": tag, "source": str(src)}
    doc = None
    try:
        doc = app.Documents.Open(str(src), ReadOnly=True, AddToRecentFiles=False)
        row["open"] = "PASS"
        row["maths"] = doc.OMaths.Count
        row["inline_shapes"] = doc.InlineShapes.Count
        row["pages"] = doc.ComputeStatistics(2)
        row["text_len"] = len(doc.Content.Text)
        ole = []
        for i in range(1, doc.InlineShapes.Count + 1):
            sh = doc.InlineShapes.Item(i)
            if sh.Type == 1:
                try:
                    ole.append(sh.OLEFormat.ProgID)
                except Exception as e:
                    ole.append("UNAVAILABLE")
        row["ole_progids"] = ole
        edited = CC / f"{tag}_edited.docx"
        if doc.OMaths.Count == 0:
            row["edit"] = "NOT_APPLICABLE_NO_NATIVE_EQUATION"
            doc.Close(False)
            doc = None
            return row
        edits = []
        for i in range(doc.OMaths.Count, 0, -1):
            eq = doc.OMaths.Item(i)
            r = eq.Range
            before = r.Text
            char = None
            for j in range(r.Characters.Count, 0, -1):
                c = r.Characters.Item(j)
                if len(c.Text) == 1 and c.Text.isalnum():
                    char = c
                    break
            if char is None:
                edits.append({"index": i, "status": "NO_LEAF"})
                continue
            old = char.Text
            new = "8" if old != "8" else "7"
            char.Text = new
            edits.append({"index": i, "status": "EDITED", "old": old, "new": new,
                          "after": doc.OMaths.Item(i).Range.Text})
        expected = [doc.OMaths.Item(i).Range.Text for i in range(1, doc.OMaths.Count + 1)]
        doc.SaveAs2(str(edited), 12)
        doc.Close(False)
        doc = None
        doc = app.Documents.Open(str(edited), ReadOnly=True, AddToRecentFiles=False)
        actual = [doc.OMaths.Item(i).Range.Text for i in range(1, doc.OMaths.Count + 1)]
        row["edits"] = edits
        row["edit"] = "PASS" if expected == actual and edits and all(e["status"] == "EDITED" for e in edits) else "PARTIAL"
        row["persist"] = expected == actual
        row["reopened_maths"] = doc.OMaths.Count
        doc.Close(False)
        doc = None
    except Exception as e:
        row.update({"edit": "ERROR", "error": str(e), "traceback": traceback.format_exc()})
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
    return row


def cross_client(mode):
    """mode: 'A' or 'B'"""
    pythoncom.CoInitialize()
    results = []
    for ckey, progid in CLIENTS.items():
        app = None
        try:
            app = win32com.client.DispatchEx(progid)
            try:
                app.Visible = False
            except Exception:
                pass
            try:
                app.AutomationSecurity = 3
            except Exception:
                pass
            for qid in [f"{mode}{i:02d}" for i in range(1, 11)]:
                src = OUT / f"{qid}_native.docx"
                if not src.exists():
                    continue
                row = _edit_and_verify(app, src, f"{qid}_{ckey}")
                row["client"] = ckey
                row["question"] = qid
                results.append(row)
                print(ckey, qid, row.get("maths"), row.get("edit"), flush=True)
        except Exception as e:
            results.append({"client": ckey, "error": str(e), "traceback": traceback.format_exc()})
        finally:
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
    dump(f"crossclient_{mode}.json", results)
    pythoncom.CoUninitialize()


if __name__ == "__main__":
    {"probe": probe_clients, "A": lambda: cross_client("A"), "B": lambda: cross_client("B")}[sys.argv[1]]()
