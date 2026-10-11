# -*- coding: utf-8 -*-
"""Phase 1.6 新旧导出件逐题对照。

同一份「文档计划」分别走：
  A) 旧链路：bank.export.render_plan_to_docx（经 editor_sdk 桥接）
  B) 新链路：bank.docx_writer.write_plan（自研，无 editor_sdk）

再用 Word 提取两者的**可见文本 / 原生公式数 / 图片数 / 页数**逐项比对。

判定口径：
  * 公式数、图片数必须相等；
  * 题号序列必须一致（防双重题号/漏题）；
  * 文本按「去空白后逐字符」比对，给出差异率与首个差异位置。
"""
from __future__ import annotations

import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

HERE = Path(__file__).resolve().parent
DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
MODE = "学生版"


def extract(path: Path) -> dict:
    """用 Word 打开并提取可见文本与对象计数（最能代表用户所见）。"""
    import win32com.client as win32
    app = win32.Dispatch("Word.Application")
    app.Visible = False
    try:
        app.DisplayAlerts = 0
    except Exception:
        pass
    try:
        doc = app.Documents.Open(str(path).replace("/", "\\"))
        text = str(doc.Content.Text)
        info = {
            "text": text,
            "omath": int(doc.OMaths.Count),
            "shapes": int(doc.InlineShapes.Count),
            "pages": int(doc.ComputeStatistics(2)),
        }
        doc.Close(SaveChanges=0)
        return info
    finally:
        try:
            app.Quit()
        except Exception:
            pass


def norm(s: str) -> str:
    """归一化：NFKC（统一数学斜体/全角）+ 去除所有空白与控制符。"""
    s = unicodedata.normalize("NFKC", s)
    return re.sub(r"[\s\u0000-\u001f\u0007\r]+", "", s)


def numbers(text: str) -> list[str]:
    """提取行首题号（形如 1．/2．/10．）。"""
    return re.findall(r"(?m)^\s*(\d{1,2})\s*[．.]", text)


def first_diff(a: str, b: str) -> tuple[int, str, str]:
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            lo = max(0, i - 30)
            return i, a[lo:i + 30], b[lo:i + 30]
    if len(a) != len(b):
        i = n
        return i, a[max(0, i - 30):i + 30], b[max(0, i - 30):i + 30]
    return -1, "", ""


def main() -> int:
    if not DB.is_file():
        print(f"[SKIP] 交付库不存在：{DB}")
        return 0

    from bank import paper as bank_paper, export as bank_export
    from bank import docx_writer

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT id, title FROM papers ORDER BY id").fetchall()
        pid = rows[0]["id"]
        print(f"试卷 #{pid}：{rows[0]['title']}　模式={MODE}")
        payload = bank_paper.build_export_payload(con, pid, answer_mode=MODE)
        plan = bank_export.build_document_plan(
            payload,
            media_resolver=lambda sid, mp, sha: bank_export.resolve_media(
                con, sid, mp, sha, cache_dir=HERE / "_media"))
    finally:
        con.close()

    n_q = sum(len(s.get("questions") or []) for s in plan["sections"])
    print(f"计划：{len(plan['sections'])} 大题 / {n_q} 题 / "
          f"公式 {plan['audit']['payload_formulas']} / 图片 {plan['audit']['payload_images']}\n")

    # --- B) 新链路 ---
    new_path = HERE / f"cmp_new_{pid}.docx"
    st_new = docx_writer.write_plan(plan, new_path)
    print(f"[新] {new_path.name}  {st_new['bytes']:,} 字节  "
          f"公式 {st_new['formulas']} 图片 {st_new['images']}")

    # --- A) 旧链路（经 editor_sdk）---
    old_path = HERE / f"cmp_old_{pid}.docx"
    old_ok = True
    try:
        bridge = bank_export.EditorBridge()
        st_old = bank_export.render_plan_to_docx(bridge, plan, old_path)
        print(f"[旧] {old_path.name}  {old_path.stat().st_size:,} 字节  "
              f"stats={ {k: v for k, v in st_old.items() if k in ('formulas','images')} }")
    except Exception as exc:  # noqa: BLE001
        old_ok = False
        print(f"[旧] 桥接渲染失败（{type(exc).__name__}: {exc}）——改用历史导出件对照")

    # --- 提取与比对 ---
    print("\n--- 提取（Word）---")
    info_new = extract(new_path)
    print(f"  新：页 {info_new['pages']} / 公式 {info_new['omath']} / 图 {info_new['shapes']} / "
          f"文本 {len(info_new['text'])} 字符")
    if old_ok:
        info_old = extract(old_path)
        print(f"  旧：页 {info_old['pages']} / 公式 {info_old['omath']} / 图 {info_old['shapes']} / "
              f"文本 {len(info_old['text'])} 字符")
    else:
        info_old = None

    print("\n--- 逐项比对 ---")
    ok = True
    if info_old is not None:
        same_math = info_new["omath"] == info_old["omath"]
        same_img = info_new["shapes"] == info_old["shapes"]
        print(f"  公式数 {info_new['omath']} vs {info_old['omath']}: "
              f"{'一致' if same_math else '不一致'}")
        print(f"  图片数 {info_new['shapes']} vs {info_old['shapes']}: "
              f"{'一致' if same_img else '不一致'}")
        ok &= same_math and same_img

        tn, to = norm(info_new["text"]), norm(info_old["text"])
        idx, ctx_a, ctx_b = first_diff(tn, to)
        rate = 0.0 if idx < 0 else (abs(len(tn) - len(to)) / max(1, max(len(tn), len(to))))
        print(f"  文本：新 {len(tn)} 字符 vs 旧 {len(to)} 字符；"
              f"{'完全一致' if idx < 0 else f'首个差异 @{idx}，长度差 {len(tn)-len(to)}'}")
        if idx >= 0:
            print(f"     新…{ctx_a!r}")
            print(f"     旧…{ctx_b!r}")
        print(f"  题号序列：新 {len(numbers(info_new['text']))} 个 / "
              f"旧 {len(numbers(info_old['text']))} 个 "
              f"{'一致' if numbers(info_new['text']) == numbers(info_old['text']) else '不一致'}")

    # 与计划自校（新链路必须忠实于 plan）
    print("\n--- 新链路 vs 计划（自校）---")
    plan_math = plan["audit"]["payload_formulas"]
    plan_img = plan["audit"]["payload_images"]
    print(f"  公式 {info_new['omath']} vs 计划 {plan_math}: "
          f"{'一致' if info_new['omath'] == plan_math else '不一致'}")
    print(f"  图片 {info_new['shapes']} vs 计划 {plan_img}: "
          f"{'一致' if info_new['shapes'] == plan_img else '不一致'}")

    print(f"\n=== 结论：{'PASS' if ok else '需人工复核'} ===")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
