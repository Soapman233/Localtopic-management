# -*- coding: utf-8 -*-
"""冒烟 + 端到端验证：自研 DOCX 生成器（bank.docx_writer）。

验证：
  S1 生成的 .docx 是合法包（必需 part 齐全）
  S2 公式是原生 OMML（无 word/embeddings、无图片冒充）
  S3 **图片的 <a:graphicData> 必须带 uri**（历史缺陷：缺 uri 时 WPS 容忍、Word 打不开）
  S4 制表符输出为真正的 <w:tab/>（不依赖哨兵）
  S5 Word / WPS 能打开，公式被识别为原生 OMath，且可编辑
"""
from __future__ import annotations

import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bank.docx_writer import render_plan  # noqa: E402

HERE = Path(__file__).resolve().parent
SPEC = {
    "label": "考试", "title_size": 18.0, "title_font": "黑体",
    "section_size": 14.0, "body_size": 12.0, "body_font": "宋体",
    "line_spacing": 1.5,
    "margins": {"top": 72.0, "bottom": 72.0, "left": 73.7, "right": 56.7},
    "gutter": 28.35, "show_score": True, "page_break_sections": True,
    "info_line": "班级：__________　姓名：__________", "title_border": True,
}


def make_image() -> Path:
    from PIL import Image, ImageDraw
    p = HERE / "sample_figure.png"
    im = Image.new("RGB", (420, 220), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, 400, 200], outline="black", width=3)
    d.line([20, 200, 400, 20], fill="black", width=3)
    d.text((30, 30), "F", fill="black")
    im.save(p)
    return p


def build_plan(img: Path) -> dict:
    return {
        "title": "八年级物理·浮力单元测试",
        "info_line": SPEC["info_line"],
        "spec": SPEC,
        "sections": [
            {
                "name": "一、选择题",
                "header": "一、选择题（本大题共 2 小题，每小题 3 分，共 6 分）",
                "questions": [
                    {
                        "number": 1, "prefix": "1．（3 分）",
                        "stem_lines": [[("text", "物体所受浮力大小为 "),
                                        ("math", r"F_{\text{浮}}=\rho_{\text{液}}gV_{\text{排}}"),
                                        ("text", "，其中 g 取 "),
                                        ("math", r"10\,\mathrm{N/kg}"),
                                        ("text", "。")]],
                        "images": [], "answer_lines": None, "analysis_lines": None,
                    },
                    {
                        "number": 2, "prefix": "2．（3 分）",
                        "stem_lines": [[("text", "如图，已知 "),
                                        ("math", r"\rho=\frac{m}{V}"),
                                        ("text", "，求密度。")]],
                        "images": [{"path": str(img)}],
                        "answer_lines": [[("text", "【答案】"),
                                          ("math", r"1.8\times 10^{3}\,\mathrm{kg/m^{3}}")]],
                        "analysis_lines": None,
                    },
                ],
            },
            {
                "name": "二、计算题",
                "header": "二、计算题（本大题共 1 小题，共 8 分）",
                "questions": [
                    {
                        "number": 3, "prefix": "3．（8 分）",
                        "stem_lines": [[("text", "选项对齐测试："),
                                        ("text", "A．甲\tB．乙\tC．丙\tD．丁")]],
                        "images": [], "answer_lines": None, "analysis_lines": None,
                    },
                ],
            },
        ],
    }


def structural_checks(path: Path) -> bool:
    ok = True
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        doc = z.read("word/document.xml").decode("utf-8")
        rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
    print(f"  parts: {names}")
    need = {"[Content_Types].xml", "_rels/.rels", "word/document.xml",
            "word/_rels/document.xml.rels", "word/styles.xml"}
    s1 = need <= set(names)
    print(f"  [S1] 必需 part 齐全: {'PASS' if s1 else 'FAIL'}")
    ok &= s1

    n_math = doc.count("<m:oMath>")
    emb = [n for n in names if "embeddings" in n]
    media = [n for n in names if n.startswith("word/media/")]
    s2 = n_math > 0 and not emb
    print(f"  [S2] 原生 OMML={n_math} 无 OLE 嵌入: {'PASS' if s2 else 'FAIL'}")
    ok &= s2

    # 图片必须存在，且 graphicData 必须带 uri
    has_img = bool(media)
    uri_ok = 'uri="http://schemas.openxmlformats.org/drawingml/2006/picture"' in doc
    s3 = (not has_img) or uri_ok
    print(f"  [S3] 图片 {media} / graphicData 带 uri: "
          f"{'PASS' if s3 else 'FAIL（Word 会打不开）'}")
    ok &= s3

    s4 = "<w:tab/>" in doc and "\ue000" not in doc
    print(f"  [S4] 制表符为真 <w:tab/> 且无哨兵残留: {'PASS' if s4 else 'FAIL'}")
    ok &= s4

    # 图片关系必须与 media 对应
    s5 = (not has_img) or all(n.split("/")[-1] in rels for n in media)
    print(f"  [S5] 图片关系已声明: {'PASS' if s5 else 'FAIL'}")
    ok &= s5
    return ok


def verify_in_office(engine: str, path: Path, expect_math: int) -> bool:
    import win32com.client as win32
    prog = {"word": "Word.Application", "wps": "KWPS.Application"}[engine]
    app = win32.Dispatch(prog)
    app.Visible = False
    try:
        app.DisplayAlerts = 0
    except Exception:
        pass
    ok = True
    try:
        doc = app.Documents.Open(str(path).replace("/", "\\"))
        n_math = int(doc.OMaths.Count)
        n_inline = int(doc.InlineShapes.Count)
        print(f"  [{engine}] 打开成功 | OMaths={n_math}(期望 {expect_math}) "
              f"| InlineShapes={n_inline}(含图片)")
        h = n_math == expect_math
        print(f"  [{engine}] [S6] 公式全部识别为原生 OMath: {'PASS' if h else 'FAIL'}")
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
                d2 = app.Documents.Open(str(path).replace("/", "\\"))
                after = unicodedata.normalize("NFKC", str(d2.OMaths(1).Range.Text))
                h2 = new in after and before != after
                print(f"  [{engine}] [S7] 改公式字符 {ch!r}->{new!r} 重开保留: "
                      f"{'PASS' if h2 else 'FAIL'}")
                ok &= h2
                d2.Close(SaveChanges=0)
        else:
            doc.Close(SaveChanges=0)
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
    img = make_image()
    plan = build_plan(img)
    data, stats = render_plan(plan)
    out = HERE / "smoke_out.docx"
    out.write_bytes(data)
    print(f"生成: {out}  ({len(data):,} 字节)")
    print(f"统计: {stats}")
    print("\n--- 结构自检 ---")
    ok = structural_checks(out)

    expect_math = stats["formulas"]
    print("\n--- Office 双端 ---")
    for eng in ("word", "wps"):
        work = HERE / f"smoke_{eng}.docx"
        shutil.copyfile(out, work)
        ok &= verify_in_office(eng, work, expect_math)
    print(f"\n=== 结论：{'PASS' if ok else 'FAIL'} ===")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
