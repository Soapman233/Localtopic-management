# -*- coding: utf-8 -*-
"""探针（第 2 步）：用 Word COM 验证自研 DOCX 的公式是否**原生可编辑**。

判定标准（照搬项目铁律）：
  H4. Word 能打开且不报错
  H5. 公式被识别为**原生 Word 公式**（doc.OMaths.Count > 0），而非图片/OLE
  H6. **实际修改公式内部字符 → 保存 → 关闭 → 重开 → 比对**，改动保留

用法：
    python probe_word_edit.py <docx路径> [--engine word|wps]
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

PROG_IDS = {"word": "Word.Application", "wps": "KWPS.Application"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("docx")
    ap.add_argument("--engine", default="word", choices=sorted(PROG_IDS))
    args = ap.parse_args()

    import win32com.client as win32  # noqa: PLC0415

    src = Path(args.docx).resolve()
    if not src.is_file():
        print(f"[ERROR] 找不到 {src}")
        return 2

    work = src.with_name(src.stem + "_edited.docx")
    shutil.copyfile(src, work)

    prog = PROG_IDS[args.engine]
    print(f"引擎: {prog}")
    app = win32.Dispatch(prog)
    app.Visible = False
    try:
        app.DisplayAlerts = 0
    except Exception:
        pass

    ok = True
    try:
        # ---------- H4：能否打开 ----------
        doc = app.Documents.Open(str(work).replace("/", "\\"))
        print(f"\n[H4] 打开成功")

        # ---------- H5：是否原生公式 ----------
        n_math = int(doc.OMaths.Count)
        n_inline = int(doc.InlineShapes.Count)
        n_shapes = int(doc.Shapes.Count)
        print(f"[H5] OMaths.Count   = {n_math}   ← 原生 Word 公式数（>0 即原生）")
        print(f"[H5] InlineShapes   = {n_inline}  ← 图片/内联对象数（应为 0）")
        print(f"[H5] Shapes         = {n_shapes}")
        h5 = n_math > 0 and n_inline == 0
        print(f"[H5] 判定: {'PASS' if h5 else 'FAIL'}")
        ok &= h5

        # ---------- H6：改公式内部字符 ----------
        # 注意：不能用 rng.Text = ...（那是"整体覆写公式"，会拆散公式结构，
        # 属 COM 的粗暴操作，不代表用户行为）。必须**就地替换单个字符**。
        if n_math > 0:
            rng = doc.OMaths(1).Range
            before = str(rng.Text)
            print(f"\n[H6] 公式1 修改前: {before!r}")

            target_idx = target_ch = None
            for i in range(1, int(rng.Characters.Count) + 1):
                t = str(rng.Characters(i).Text)
                if t.strip() == "2":
                    target_idx, target_ch = i, t
                    break

            if target_idx is None:
                print("[H6] 未在公式1中定位到字符 '2' → 无法执行就地修改")
                ok = False
                doc.Close(SaveChanges=0)
            else:
                print(f"[H6] 就地修改：第 {target_idx} 个字符 {target_ch!r} → '3'")
                rng.Characters(target_idx).Text = "3"
                doc.Save()
                doc.Close(SaveChanges=0)
                doc = None

                doc2 = app.Documents.Open(str(work).replace("/", "\\"))
                reopened = str(doc2.OMaths(1).Range.Text)
                n_math2 = int(doc2.OMaths.Count)
                print(f"[H6] 重开后:       {reopened!r}   (OMaths={n_math2})")
                h6 = ("3" in reopened) and (n_math2 == n_math)
                print(f"[H6] 判定: {'PASS' if h6 else 'FAIL'}  "
                      f"← 字符改动保留（{n_math}→{n_math2} 公式数不变）")
                ok &= h6
                doc2.Close(SaveChanges=0)
        else:
            print("[H6] 跳过：未识别到原生公式")
            ok = False
            doc.Close(SaveChanges=0)
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] {type(exc).__name__}: {exc}")
        ok = False
    finally:
        try:
            app.Quit()
        except Exception:
            pass

    print(f"\n=== 结论：{'PASS' if ok else 'FAIL'} ===")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
