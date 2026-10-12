# -*- coding: utf-8 -*-
"""扫描源 DOCX，找出含**旧式 MathType OLE**（Equation.DSMT4）的真实样例。

用途：Phase 1 遗留的「MathType 路径未实证」——需要真实样例才能在打包版上端到端验证。
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

DIRS = [
    Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷"),
    Path("C:/Users/SOAP/Desktop/物理/初中/2026学科网教案"),
]
PROGID_RE = re.compile(r"ProgID=\"([^\"]+)\"")
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 40


def main() -> int:
    found: list[tuple[Path, dict]] = []
    scanned = 0
    for d in DIRS:
        if not d.is_dir():
            print(f"[跳过] 目录不存在：{d}")
            continue
        for p in sorted(d.rglob("*.docx")):
            scanned += 1
            if scanned > 400:
                break
            try:
                with zipfile.ZipFile(p) as z:
                    names = z.namelist()
                    if not any(n.startswith("word/embeddings/") for n in names):
                        continue
                    counts: dict[str, int] = {}
                    for n in names:
                        if not n.endswith(".xml"):
                            continue
                        try:
                            text = z.read(n).decode("utf-8", "ignore")
                        except Exception:  # noqa: BLE001
                            continue
                        for pid in PROGID_RE.findall(text):
                            counts[pid] = counts.get(pid, 0) + 1
            except Exception:  # noqa: BLE001
                continue
            if counts:
                found.append((p, counts))
            if len(found) >= LIMIT:
                break

    print(f"扫描 {scanned} 份 DOCX，含 OLE 嵌入的 {len(found)} 份\n")
    dsmt4 = [x for x in found if any("DSMT4" in k for k, v in x[1].items() if v)]
    print(f"其中含 Equation.DSMT4（MathType）的：**{len(dsmt4)} 份**\n")
    for p, c in dsmt4[:8]:
        brief = ", ".join(f"{k.split('.')[-1]}×{v}" for k, v in sorted(c.items(), key=lambda x: -x[1]))
        print(f"  {p.name[:60]}")
        print(f"     {brief}")
    if dsmt4:
        print(f"\n可用样例（完整路径）：\n  {dsmt4[0][0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
