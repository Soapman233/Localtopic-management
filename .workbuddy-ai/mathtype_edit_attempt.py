"""What actually happens when a user double-clicks a MathType equation on a machine
without MathType?  We activate the real OLE object (not the preview picture) and capture
the outcome in both clients.  Read-only; nothing is saved.
"""
# ---------------------------------------------------------------------------
# title: MathType 编辑尝试脚本
# description: 尝试在客户端编辑 MathType 公式对象的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

import json
import os

import pythoncom
import win32com.client

SRC = os.path.join(os.path.expanduser("~"), "Desktop", "物理", "初中", "2026学科网教案",
                   "专项06 浮力的计算和实验专题（重难点训练）（解析版）.docx")
OUT = r"D:/Open-source project/Localtopic-management/outputs/validation_30/mathtype_edit_attempt.json"

result = {"file": SRC, "at": "2026-10-06", "note": "Activating a real OLE object; MathType is not installed."}
pythoncom.CoInitialize()
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
    doc = app.Documents.Open(SRC, ReadOnly=True, AddToRecentFiles=False)
    entry = {}
    # find the first genuine OLE shape
    target = None
    for i in range(1, doc.InlineShapes.Count + 1):
        sh = doc.InlineShapes.Item(i)
        if sh.Type == 1:
            target = sh
            entry["first_ole_index"] = i
            break
    if target is None:
        entry["result"] = "NO_OLE_SHAPE_FOUND"
    else:
        try:
            entry["progid"] = target.OLEFormat.ProgID
        except Exception as e:
            entry["progid"] = "UNAVAILABLE: " + str(e)[:100]
        try:
            entry["class_type"] = target.OLEFormat.ClassType
        except Exception as e:
            entry["class_type"] = "UNAVAILABLE: " + str(e)[:100]
        try:
            obj = target.OLEFormat.Object
            entry["object_access"] = "RETURNED: " + str(type(obj))
        except Exception as e:
            entry["object_access"] = "ERROR: " + str(e)[:250]
        try:
            target.OLEFormat.Activate()
            entry["activate"] = "NO_ERROR_RAISED"
        except Exception as e:
            entry["activate"] = "ERROR: " + str(e)[:250]
        try:
            target.OLEFormat.DoVerb()
            entry["doverb"] = "NO_ERROR_RAISED"
        except Exception as e:
            entry["doverb"] = "ERROR: " + str(e)[:250]
        entry["result"] = "ATTEMPTED"
    result[key] = entry
    doc.Close(False)
    app.Quit()
pythoncom.CoUninitialize()

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
