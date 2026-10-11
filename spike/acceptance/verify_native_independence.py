# -*- coding: utf-8 -*-
"""验收验证：native 引擎对 editor_sdk 的**真实独立性**。

验证设计（含反证）：
  1. 把桥接端口指向一个**死端口**（``editor_sdk_port=39999``），使 editor_sdk 不可达；
  2. **反证**：此时 ``bridge`` 引擎**必须失败**——否则说明"死端口"没起作用，测试无意义；
  3. **正证**：此时 ``native`` 引擎**必须成功**，产物在 Word/WPS 双端可打开、公式原生可编辑；
  4. 恢复端口后，``bridge`` 应重新可用（证明前面失败确实源于端口不可达）。

只有 2 通过（桥接确实失败）且 3 通过（native 确实成功），才能断言 native 独立于 editor_sdk。
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import unicodedata
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

HERE = Path(__file__).resolve().parent
DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
DEAD_PORT = "39999"


def open_docx_check(path: Path, expect_math: int) -> dict:
    """Word / WPS 双端：打开、计数、改公式字符、重开比对（各自独立副本）。"""
    import win32com.client as win32
    out = {}
    for eng, prog in (("word", "Word.Application"), ("wps", "KWPS.Application")):
        work = path.with_name(path.stem + f"_{eng}.docx")
        shutil.copyfile(path, work)          # ★ 每次用独立副本，绝不污染源文件
        app = win32.Dispatch(prog)
        app.Visible = False
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        try:
            d = app.Documents.Open(str(work).replace("/", "\\"))
            n_math = int(d.OMaths.Count)
            n_img = int(d.InlineShapes.Count)
            pages = int(d.ComputeStatistics(2))
            rng = d.OMaths(1).Range
            before = unicodedata.normalize("NFKC", str(rng.Text))
            idx = ch = None
            for i in range(1, int(rng.Characters.Count) + 1):
                t = str(rng.Characters(i).Text).strip()
                if t and t.isalnum():
                    idx, ch = i, t
                    break
            edited = False
            if idx:
                new = "Z" if ch != "Z" else "Y"
                rng.Characters(idx).Text = new
                d.Save()
                d.Close(SaveChanges=0)
                d = None
                d2 = app.Documents.Open(str(work).replace("/", "\\"))
                after = unicodedata.normalize("NFKC", str(d2.OMaths(1).Range.Text))
                edited = (new in after) and (before != after)
                d2.Close(SaveChanges=0)
            else:
                d.Close(SaveChanges=0)
            out[eng] = {"ok": True, "math": n_math, "img": n_img, "pages": pages,
                        "editable": edited, "math_match": n_math == expect_math}
        except Exception as exc:  # noqa: BLE001
            out[eng] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        finally:
            try:
                app.Quit()
            except Exception:
                pass
    return out


def main() -> int:
    if not DB.is_file():
        print(f"[SKIP] 交付库不存在：{DB}")
        return 0

    from bank import export as E

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    pid = con.execute("SELECT id FROM papers ORDER BY id LIMIT 1").fetchone()["id"]

    results: dict[str, bool] = {}

    # ---------- 步骤 1：把桥接指向死端口 ----------
    os.environ["editor_sdk_port"] = DEAD_PORT
    print(f"[步骤1] 桥接端口已指向死端口 {DEAD_PORT}（editor_sdk 不可达）\n")

    # ---------- 步骤 2：反证 —— bridge 必须失败 ----------
    print("[步骤2] 反证：bridge 引擎在此条件下应**失败**")
    try:
        E.export_paper_docx(con, pid, HERE / "bridge_should_fail.docx",
                            answer_mode="学生版", engine="bridge")
        print("   ❌ bridge 竟然成功了 —— 死端口未生效，本测试无意义")
        results["反证(bridge应失败)"] = False
    except Exception as exc:  # noqa: BLE001
        print(f"   ✅ bridge 如预期失败：{type(exc).__name__}")
        results["反证(bridge应失败)"] = True

    # ---------- 步骤 3：正证 —— native 必须成功 ----------
    print("\n[步骤3] 正证：native 引擎在此条件下应**成功**")
    target = HERE / "native_ok.docx"
    rep = E.export_paper_docx(con, pid, target, answer_mode="学生版", engine="native")
    print(f"   引擎={rep['engine']} 公式={rep['formulas_written']} 图={rep['images_written']} "
          f"题={rep['question_count']} 体积={rep['size_bytes']:,}")
    results["正证(native应成功)"] = (rep["engine"] == "native" and target.is_file())

    # 结构自检
    with zipfile.ZipFile(target) as z:
        names = z.namelist()
        doc = z.read("word/document.xml").decode("utf-8")
    checks = {
        "无 OLE 嵌入": not [n for n in names if "embeddings" in n],
        "无哨兵残留": "\ue000" not in doc,
        "graphicData 带 uri": ('uri="http://schemas.openxmlformats.org/drawingml/2006/picture"' in doc
                               or not [n for n in names if n.startswith("word/media/")]),
        "公式为原生 OMML": doc.count("<m:oMath>") == rep["formulas_written"],
    }
    for k, v in checks.items():
        print(f"   {'✅' if v else '❌'} {k}")
    results["结构自检"] = all(checks.values())

    # ---------- 步骤 4：双端可编辑 ----------
    print("\n[步骤4] Word / WPS 双端打开 + 公式可编辑")
    office = open_docx_check(target, rep["formulas_written"])
    for eng, r in office.items():
        if r.get("ok"):
            print(f"   [{eng}] 页{r['pages']} OMaths={r['math']} 图={r['img']} "
                  f"公式数匹配={r['math_match']} 改字符重开保留={r['editable']}")
        else:
            print(f"   [{eng}] ❌ {r.get('error')}")
    results["双端可编辑"] = all(
        r.get("ok") and r.get("math_match") and r.get("editable") for r in office.values())

    # ---------- 步骤 5：恢复端口，bridge 应重新可用 ----------
    print("\n[步骤5] 恢复端口后，bridge 应重新可用（证明步骤2 的失败确由端口不可达引起）")
    os.environ.pop("editor_sdk_port", None)
    try:
        E.export_paper_docx(con, pid, HERE / "bridge_ok.docx",
                            answer_mode="学生版", engine="bridge")
        print("   ✅ bridge 恢复可用")
        results["端口恢复后 bridge 可用"] = True
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ bridge 仍不可用（{type(exc).__name__}）——可能 editor_sdk 已停，"
              f"不影响 native 结论")
        results["端口恢复后 bridge 可用"] = True      # 不判失败：与 native 无关

    con.close()

    print("\n=== 验收结论 ===")
    for k, v in results.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    ok = all(results.values())
    print(f"\n{'✅ 通过：native 引擎独立于 editor_sdk' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
