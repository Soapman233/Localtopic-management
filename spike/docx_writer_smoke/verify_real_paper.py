# -*- coding: utf-8 -*-
"""端到端验证：真实试卷 payload -> build_document_plan -> 自研 docx_writer -> Word/WPS。

这是 Phase 1.3 的关键验证：证明「自研生成器」能承接**真实试卷**，
而不是只能渲染手工构造的样例。

只读：全程用 mode=ro 打开交付库，不写任何业务数据。
"""
from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

HERE = Path(__file__).resolve().parent
DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")


def main() -> int:
    if not DB.is_file():
        print(f"[SKIP] 交付库不存在：{DB}")
        return 0

    import sqlite3
    from bank import db as bank_db, paper as bank_paper, export as bank_export
    from bank import docx_writer

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT id, title FROM papers ORDER BY id").fetchall()
        if not rows:
            print("[SKIP] 库里没有试卷")
            return 0
        pid, title = rows[0]["id"], rows[0]["title"]
        print(f"取用试卷 #{pid}：{title}")

        payload = bank_paper.build_export_payload(con, pid, answer_mode="答案解析版")
        plan = bank_export.build_document_plan(
            payload, media_resolver=lambda sid, mp, sha: bank_export.resolve_media(
                con, sid, mp, sha, cache_dir=HERE / "_media"))
    finally:
        con.close()

    n_q = sum(len(s.get("questions") or []) for s in plan["sections"])
    print(f"计划：{len(plan['sections'])} 个大题 / {n_q} 道题 / "
          f"公式 {plan['audit']['payload_formulas']} / 图片 {plan['audit']['payload_images']}")

    out = HERE / f"real_paper_{pid}.docx"
    stats = docx_writer.write_plan(plan, out)
    print(f"生成：{out}  ({stats['bytes']:,} 字节)")
    print(f"统计：段 {stats['paragraphs']} / 公式 {stats['formulas']} / 图片 {stats['images']}")
    if stats["warnings"]:
        print(f"警告 {len(stats['warnings'])} 条，前 3：")
        for w in stats["warnings"][:3]:
            print("   -", w[:110])

    # ---- Word / WPS 验证 ----
    import win32com.client as win32
    ok = True
    for eng, prog in (("word", "Word.Application"), ("wps", "KWPS.Application")):
        work = HERE / f"real_paper_{pid}_{eng}.docx"
        work.write_bytes(out.read_bytes())
        app = win32.Dispatch(prog)
        app.Visible = False
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        try:
            doc = app.Documents.Open(str(work).replace("/", "\\"))
            n_math = int(doc.OMaths.Count)
            n_img = int(doc.InlineShapes.Count)
            pages = int(doc.ComputeStatistics(2))     # wdStatisticPages
            print(f"  [{eng}] 打开成功 | 页数={pages} | OMaths={n_math} "
                  f"| InlineShapes={n_img}（含图片）")
            h = n_math == stats["formulas"]
            print(f"  [{eng}] 公式全部为原生 OMath: {'PASS' if h else 'FAIL'}")
            ok &= h
            if n_math:
                rng = doc.OMaths(1).Range
                before = unicodedata.normalize("NFKC", str(rng.Text))
                idx = ch = None
                for i in range(1, int(rng.Characters.Count) + 1):
                    t = str(rng.Characters(i).Text).strip()
                    if t and t.isalnum():
                        idx, ch = i, t
                        break
                if idx:
                    new = "Z" if ch != "Z" else "Y"
                    rng.Characters(idx).Text = new
                    doc.Save()
                    doc.Close(SaveChanges=0)
                    doc = None
                    d2 = app.Documents.Open(str(work).replace("/", "\\"))
                    after = unicodedata.normalize("NFKC", str(d2.OMaths(1).Range.Text))
                    h2 = (new in after) and before != after
                    print(f"  [{eng}] 改公式字符重开保留: {'PASS' if h2 else 'FAIL'}")
                    ok &= h2
                    d2.Close(SaveChanges=0)
            else:
                doc.Close(SaveChanges=0)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{eng}] ERROR {type(exc).__name__}: {exc}")
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
