"""Read-only probes for legacy equation handling in WPS.
Does not activate OLE servers, does not execute macros, does not modify source files.
"""
# ---------------------------------------------------------------------------
# title: 旧式公式探测脚本
# description: 探测旧式（OLE / MathType）公式对象的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import datetime, json, sys, traceback, winreg
import pythoncom
import win32com.client

OUT = Path("D:/Open-source project/Localtopic-management/outputs/validation_30")


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def registry_probe():
    report = {"at": datetime.datetime.now().astimezone().isoformat(), "progids": {}}
    for progid in ["Equation.DSMT4", "Equation.3", "Equation.KSEE3", "DSMT4", "MathType.Application"]:
        entry = {}
        for path, label in [(progid, "progid"), (progid + "\\CLSID", "clsid_key"),
                            (progid + "\\CurVer", "curver")]:
            try:
                with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, path) as k:
                    entry[label] = winreg.QueryValueEx(k, "")[0]
            except OSError as e:
                entry[label] = f"NOT_FOUND ({e.winerror})"
        if "clsid_key" in entry and not str(entry["clsid_key"]).startswith("NOT_FOUND"):
            clsid = entry["clsid_key"]
            for sub in ["LocalServer32", "InprocServer32", "LocalServer"]:
                try:
                    with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"CLSID\\{clsid}\\{sub}") as k:
                        entry[sub] = winreg.QueryValueEx(k, "")[0]
                except OSError:
                    pass
        report["progids"][progid] = entry
    # WPS installed add-ins that could convert equations
    addins = []
    for root, label in [(winreg.HKEY_CURRENT_USER, "HKCU"), (winreg.HKEY_LOCAL_MACHINE, "HKLM")]:
        for sub in ["Software\\Kingsoft\\Office\\6.0\\Common\\Addins",
                    "Software\\Microsoft\\Office\\Word\\Addins"]:
            try:
                with winreg.OpenKey(root, sub) as k:
                    for i in range(winreg.QueryInfoKey(k)[0]):
                        name = winreg.EnumKey(k, i)
                        try:
                            with winreg.OpenKey(k, name) as kk:
                                addins.append({"hive": label, "key": f"{sub}\\{name}",
                                               "description": winreg.QueryValueEx(kk, "Description")[0] if _has(kk, "Description") else "",
                                               "path": winreg.QueryValueEx(kk, "Path")[0] if _has(kk, "Path") else ""})
                        except OSError:
                            addins.append({"hive": label, "key": f"{sub}\\{name}"})
            except OSError:
                pass
    report["wps_addins"] = addins
    dump("legacy_environment_probe.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def _has(key, name):
    try:
        winreg.QueryValueEx(key, name)
        return True
    except OSError:
        return False


def ole_inspect():
    """Inspect legacy OLE objects as seen by WPS; no activation attempted."""
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("KWPS.Application")
    results = []
    try:
        app.AutomationSecurity = 3
        for qid in [f"B{i:02d}" for i in range(1, 11)]:
            path = OUT / f"{qid}_native.docx"
            doc = None
            row = {"id": qid}
            try:
                doc = app.Documents.Open(str(path), ReadOnly=True, AddToRecentFiles=False)
                row["maths"] = doc.OMaths.Count
                shapes = []
                for i in range(1, doc.InlineShapes.Count + 1):
                    sh = doc.InlineShapes.Item(i)
                    item = {"index": i, "type": sh.Type}
                    if sh.Type == 1:
                        try:
                            item["progid"] = sh.OLEFormat.ProgID
                        except Exception as e:
                            item["progid"] = f"UNAVAILABLE: {e}"
                        try:
                            item["class_type"] = sh.OLEFormat.ClassType
                        except Exception as e:
                            item["class_type"] = f"UNAVAILABLE: {e}"
                    shapes.append(item)
                row["inline_shapes"] = shapes
                row["ole_count"] = sum(1 for s in shapes if s["type"] == 1)
                row["status"] = "PASS"
            except Exception as e:
                row.update({"status": "ERROR", "error": str(e), "traceback": traceback.format_exc()})
            finally:
                if doc is not None:
                    doc.Close(False)
            results.append(row)
            print(qid, row["status"], row.get("ole_count"), row.get("error", ""), flush=True)
    finally:
        dump("legacy_ole_inspect.json", results)
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    {"registry": registry_probe, "ole": ole_inspect}[sys.argv[1]]()
