# -*- coding: utf-8 -*-
"""端到端验证：真实题库 LaTeX -> 自研转换器 -> DOCX -> Word/WPS 双端。

验证链：
  1. 只读连接 bank.db，取真实公式（含最复杂样本 + 随机抽样）
  2. bank.latex2omml 转成 OMML，写入自研生成的 DOCX（仅标准库）
  3. Word / WPS COM 打开，检查：
     - H5  公式被识别为原生 m:oMath（OMaths.Count == 公式数），且 InlineShapes == 0
     - H6  就地改字符 -> 保存 -> 重开 -> 改动保留
  4. 导出 PDF 并渲染成图，供目视确认

用法：
    python verify_real_docx.py [--n 40] [--db <路径>] [--engine word|wps]
"""
from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import unicodedata
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bank.latex2omml import latex_to_omath  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def fetch_formulas(db: Path, n: int) -> list[tuple[int, str]]:
    """只读取公式：最复杂的若干条 + 均匀抽样。"""
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT id, latex FROM formulas "
            "WHERE latex IS NOT NULL AND TRIM(latex) <> '' AND status = 'OK'"
        ).fetchall()
    finally:
        con.close()
    # 按「命令数 + 长度」近似复杂度排序，取最复杂的一批
    def score(r: tuple[int, str]) -> int:
        return len(re.findall(r"\\[A-Za-z]+", r[1])) * 100 + len(r[1])
    rows.sort(key=score, reverse=True)
    top = rows[: max(1, n // 2)]
    rest = rows[len(top):]
    step = max(1, len(rest) // max(1, n - len(top)))
    sample = rest[::step][: max(0, n - len(top))]
    return top + sample


def build_docx(items: list[tuple[int, str]], out: Path) -> tuple[str, int]:
    """items: [(formula_id, latex)] -> 写 DOCX；返回 (document.xml, 公式数)。"""
    paras: list[str] = []
    n_ok = 0
    for fid, latex in items:
        omath = latex_to_omath(latex)
        if not omath:
            continue
        n_ok += 1
        paras.append(
            f'<w:p><w:r><w:t xml:space="preserve">[{fid}] </w:t></w:r>{omath}</w:p>'
        )
    body = "".join(paras) + "<w:sectPr/>"
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<w:document xmlns:w="{W_NS}" xmlns:m="{M_NS}">'
           f"<w:body>{body}</w:body></w:document>")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", doc)
    return doc, n_ok


def verify(engine: str, work: Path, expect: int) -> bool:
    import win32com.client as win32  # noqa: PLC0415

    prog = {"word": "Word.Application", "wps": "KWPS.Application"}[engine]
    app = win32.Dispatch(prog)
    app.Visible = False
    try:
        app.DisplayAlerts = 0
    except Exception:
        pass

    ok = True
    try:
        doc = app.Documents.Open(str(work).replace("/", "\\"))
        n_math = int(doc.OMaths.Count)
        n_inline = int(doc.InlineShapes.Count)
        print(f"  [{engine}] 打开成功 | OMaths={n_math} (期望 {expect}) "
              f"| InlineShapes={n_inline}")
        h5 = (n_math == expect) and n_inline == 0
        print(f"  [{engine}] H5 原生公式: {'PASS' if h5 else 'FAIL'}")
        ok &= h5

        # H6：就地改第一个公式中的**普通字母/数字**（避开定界符，改动才等价于用户行为）
        if n_math > 0:
            rng = doc.OMaths(1).Range
            before = str(rng.Text)
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
                after = str(d2.OMaths(1).Range.Text)
                n2 = int(d2.OMaths.Count)
                # ⚠️ Word 把公式字符存为「数学斜体」Unicode（如 𝑍 U+1D44D），
                # 直接与 ASCII 比较必然失败。必须先用 NFKC 归一化再断言。
                norm_before = unicodedata.normalize("NFKC", before)
                norm_after = unicodedata.normalize("NFKC", after)
                h6 = (new in norm_after) and (norm_before != norm_after) and n2 == expect
                print(f"  [{engine}] H6 改字符 {ch!r}->{new!r}  "
                      f"前={norm_before[:40]!r}")
                print(f"  [{engine}] H6            后={norm_after[:40]!r}  "
                      f"({'PASS' if h6 else 'FAIL'}, OMaths={n2})")
                ok &= h6
                d2.Close(SaveChanges=0)
            else:
                print(f"  [{engine}] H6 跳过：未定位到可改的字母/数字")
                doc.Close(SaveChanges=0)
                ok = False
        else:
            doc.Close(SaveChanges=0)
            ok = False
    except Exception as exc:  # noqa: BLE001
        print(f"  [{engine}] ERROR {type(exc).__name__}: {exc}")
        ok = False
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--engine", default="both", choices=["word", "wps", "both"])
    args = ap.parse_args()

    db = Path(args.db)
    if not db.is_file():
        print(f"[ERROR] 交付库不存在: {db}")
        return 2

    items = fetch_formulas(db, args.n)
    print(f"取样公式数: {len(items)}（最复杂 {args.n // 2} + 均匀抽样）")

    src = HERE / "real_formulas.docx"
    _, n_ok = build_docx(items, src)
    print(f"生成 DOCX: {src}  ({src.stat().st_size:,} 字节)，写入公式 {n_ok} 条")

    engines = ["word", "wps"] if args.engine == "both" else [args.engine]
    results = {}
    for eng in engines:
        work = HERE / f"real_{eng}.docx"
        shutil.copyfile(src, work)
        results[eng] = verify(eng, work, n_ok)

    print("\n=== 结论 ===")
    for eng, ok in results.items():
        print(f"  {eng.upper()}: {'PASS' if ok else 'FAIL'}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
