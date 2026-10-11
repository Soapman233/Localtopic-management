# -*- coding: utf-8 -*-
"""对比 API 导出产物与直调产物的结构差异（排查体积差 706,254 vs 700,259）。"""
from __future__ import annotations

import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]
PAIRS = [
    ("API ", HERE / "outputs/export/八年级物理·浮力与压强单元测验_学生版_b08db3cf.docx"),
    ("直调", HERE / "spike/docx_writer_smoke/engine_native.docx"),
]

for name, p in PAIRS:
    if not p.is_file():
        print(f"{name}: 文件不存在 {p}")
        continue
    raw = p.read_bytes()
    with zipfile.ZipFile(p) as z:
        doc = z.read("word/document.xml").decode("utf-8")
        parts = [x for x in z.namelist() if "media" not in x]
    n_p = doc.count("<w:p>") + doc.count("<w:p ")
    print(f"{name}: 体积={len(raw):,}  段落={n_p}  oMath={doc.count('<m:oMath>')}  "
          f"tabs={doc.count('<w:tabs>')}  parts={len(z.namelist())}")
    print(f"      parts: {parts}")
