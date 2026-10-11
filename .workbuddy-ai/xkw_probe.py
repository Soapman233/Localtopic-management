"""Concrete check on a real downloaded 学科网 file: is the formula editable in Word / WPS?
Read-only; nothing is saved.
"""
# ---------------------------------------------------------------------------
# title: 学科网探测脚本
# description: 探测学科网来源文件结构的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

import collections
import json
import os

import pythoncom
import win32com.client

SRC = os.path.join(
    os.path.expanduser("~"), "Desktop", "物理", "初中", "2026学科网教案",
    "专项06 浮力的计算和实验专题（重难点训练）（解析版）.docx",
)
OUT = r"D:/Open-source project/Localtopic-management/outputs/validation_30/xuekewang_file_probe.json"

result = {"file": SRC, "exists": os.path.exists(SRC), "at": "2026-10-06"}
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
    oles = []
    for i in range(1, min(doc.InlineShapes.Count, 1500) + 1):
        sh = doc.InlineShapes.Item(i)
        if sh.Type == 1:
            try:
                oles.append(sh.OLEFormat.ProgID)
            except Exception:
                oles.append("UNAVAILABLE")
    entry = {
        "OMaths": doc.OMaths.Count,
        "InlineShapes": doc.InlineShapes.Count,
        "pages": doc.ComputeStatistics(2),
        "ole_total": len(oles),
        "ole_progids": dict(collections.Counter(oles)),
    }
    try:
        sh = doc.InlineShapes.Item(1)
        if sh.Type == 1:
            sh.OLEFormat.Activate()
            entry["activate"] = "NO_ERROR_RAISED"
        else:
            entry["activate"] = "first_shape_not_ole"
    except Exception as e:
        entry["activate"] = "ERROR: " + str(e)[:200]
    result[key] = entry
    doc.Close(False)
    app.Quit()
pythoncom.CoUninitialize()

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
