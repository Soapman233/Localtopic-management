"""自研 DOCX 生成器（bank.docx_writer）单元测试。

重点守护三条历史缺陷：
* 图片 ``<a:graphicData>`` 必须带 ``uri``（缺了 Word 打不开，WPS 却容忍）
* 制表符必须是真 ``<w:tab/>``，且**不得**残留哨兵 ``U+E000``
* 公式必须是原生 OMML（不得是图片或 OLE 嵌入）
"""
from __future__ import annotations

import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from bank.docx_writer import DocxWriter, render_plan

SPEC = {
    "title_size": 18.0, "title_font": "黑体", "section_size": 14.0,
    "body_size": 12.0, "body_font": "宋体", "line_spacing": 1.5,
    "margins": {"top": 72.0, "bottom": 72.0, "left": 73.7, "right": 56.7},
    "gutter": 28.35, "page_break_sections": True, "title_border": True,
}
PIC_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture"


def _png(path: Path, w: int = 40, h: int = 20) -> Path:
    from PIL import Image
    Image.new("RGB", (w, h), "white").save(path)
    return path


def _plan(img: Path | None = None) -> dict:
    return {
        "title": "测试卷", "info_line": "班级：____", "spec": SPEC,
        "sections": [{
            "name": "一、选择题", "header": "一、选择题（共 2 小题）",
            "questions": [
                {"number": 1, "prefix": "1．", "images": [],
                 "stem_lines": [[("text", "力为 "), ("math", "F=ma"), ("text", "。")]],
                 "answer_lines": None, "analysis_lines": None},
                {"number": 2, "prefix": "2．",
                 "images": ([{"path": str(img)}] if img else []),
                 "stem_lines": [[("text", "A．甲\tB．乙")]],
                 "answer_lines": [[("text", "【答案】"), ("math", "1.8\\times 10^{3}")]],
                 "analysis_lines": None},
            ],
        }],
    }


def _read(path: Path) -> tuple[list[str], str, str]:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        doc = z.read("word/document.xml").decode("utf-8")
        rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
    return names, doc, rels


class TestPackage(unittest.TestCase):
    def test_required_parts(self):
        data, _ = render_plan(_plan())
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            names, _, _ = _read(p)
        for need in ("[Content_Types].xml", "_rels/.rels", "word/document.xml",
                     "word/_rels/document.xml.rels", "word/styles.xml"):
            self.assertIn(need, names)

    def test_formulas_are_native_omml(self):
        # 题干 1 条（F=ma）+ 答案 1 条（1.8×10³）= 2 条
        data, stats = render_plan(_plan())
        self.assertEqual(stats["formulas"], 2)
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            names, doc, _ = _read(p)
        self.assertEqual(doc.count("<m:oMath>"), 2)
        self.assertFalse([n for n in names if "embeddings" in n], "不得有 OLE 嵌入")
        self.assertFalse([n for n in names if n.startswith("word/media/")], "无图时不应有媒体")


class TestImageGraphicDataUri(unittest.TestCase):
    """🔴 历史缺陷回归：缺 uri 时 WPS 容忍、**Word 报错打不开**。"""

    def test_graphic_data_has_uri(self):
        with TemporaryDirectory() as td:
            img = _png(Path(td) / "f.png")
            data, stats = render_plan(_plan(img))
            self.assertEqual(stats["images"], 1)
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            names, doc, rels = _read(p)
            self.assertIn("word/media/image1.png", names)
            self.assertIn(f'uri="{PIC_URI}"', doc,
                          "graphicData 缺 uri —— Word 将无法打开")
            self.assertIn("media/image1.png", rels, "图片关系未声明")

    def test_missing_image_degrades_with_warning(self):
        plan = _plan()
        plan["sections"][0]["questions"][1]["images"] = [{"path": "不存在.png"}]
        data, stats = render_plan(plan)
        self.assertEqual(stats["images"], 0)
        self.assertTrue(any("不存在" in w for w in stats["warnings"]))


class TestTabHandling(unittest.TestCase):
    """🔴 历史缺陷回归：桥接拒绝 TAB，曾用 U+E000 哨兵绕行；自研后应直接写真 <w:tab/>。"""

    def test_tab_is_real_wtab_and_no_sentinel(self):
        data, _ = render_plan(_plan())
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
        self.assertIn("<w:tab/>", doc)
        self.assertNotIn("\ue000", doc, "哨兵残留会导致豆腐块")

    def test_explicit_tab_stops_present(self):
        """🔴 回归：含制表符的段落必须带**显式制表位**（版心 1/4、1/2、3/4）。

        不设则退回 Word 默认停靠点（每 0.5 英寸），四选项题对齐会不准。
        """
        data, _ = render_plan(_plan())
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
        self.assertIn("<w:tabs>", doc, "缺少显式制表位")
        self.assertGreaterEqual(doc.count('<w:tab w:val="left"'), 3)
        # 制表位应落在版心宽度内
        import re
        positions = [int(x) for x in re.findall(r'<w:tab w:val="left" w:pos="(\d+)"', doc)]
        self.assertTrue(positions, "未找到制表位")
        self.assertTrue(all(0 < x < 11906 for x in positions),
                        f"制表位越界：{positions}")


class TestLayout(unittest.TestCase):
    def test_page_break_between_sections(self):
        plan = _plan()
        plan["sections"].append({
            "name": "二、计算题", "header": "二、计算题",
            "questions": [{"number": 3, "prefix": "3．", "images": [],
                           "stem_lines": [[("text", "x")]],
                           "answer_lines": None, "analysis_lines": None}],
        })
        data, _ = render_plan(plan)
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
        self.assertIn('<w:br w:type="page"/>', doc)

    def test_footer_present(self):
        data, _ = render_plan(_plan())
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            names, _, _ = _read(p)
        self.assertIn("word/footer1.xml", names)


class TestImageSizing(unittest.TestCase):
    """🔴 图片尺寸规则回归。

    与基线（桥接版）逐张对齐的三条规则，顺序不可颠倒：
      1. 档位上限（按宽高比取可用宽度比例）
      2. 最小宽度：**有限放大**（min(4.0, natural×1.5)），不是硬性抬到 4cm
      3. **最后**钳到源文档中原图尺寸 —— 最外层硬约束
    顺序错了会把已按源尺寸缩小的图重新放大（实测：源宽 3.07cm → 4.0cm），
    并使整卷从 4 页膨胀到 6 页。
    """

    def _img(self, td, w, h):
        from PIL import Image
        p = Path(td) / "f.png"
        Image.new("RGB", (w, h), "white").save(p)
        return p

    def test_source_extent_is_outermost_clamp(self):
        from bank.docx_writer import _fit_image_cm
        with TemporaryDirectory() as td:
            p = self._img(td, 669, 243)          # 自然宽 17.7cm，档位上限 10.47cm
            src = int(7.73 * 360000)             # 源图 7.73cm
            w, h = _fit_image_cm(p, 15.4, src)
            self.assertAlmostEqual(w, 7.73, places=2)
            self.assertAlmostEqual(h, 7.73 / (669 / 243), places=1)

    def test_small_image_not_force_inflated(self):
        """源宽 3.07cm 的图必须保持 3.07，不得被最小宽度抬到 4.0。"""
        from bank.docx_writer import _fit_image_cm
        with TemporaryDirectory() as td:
            p = self._img(td, 544, 375)
            src = int(3.07 * 360000)
            w, _ = _fit_image_cm(p, 15.4, src)
            self.assertAlmostEqual(w, 3.07, places=2)

    def test_min_width_allows_limited_upscale(self):
        """无源尺寸时，极小的图允许有限放大到不超过 4cm。"""
        from bank.docx_writer import _fit_image_cm
        with TemporaryDirectory() as td:
            p = self._img(td, 77, 40)            # 自然宽 2.04cm
            w, _ = _fit_image_cm(p, 15.4, None)
            self.assertLessEqual(w, 4.0)
            self.assertGreater(w, 2.0)

    def test_width_ratio_tiers_and_height_cap(self):
        from bank.docx_writer import _fit_image_cm
        with TemporaryDirectory() as td:
            # 宽幅 ratio 4.0 → 0.82×可用宽（自然宽 21.2cm 远超上限，取档位）
            wide = self._img(td, 800, 200)
            self.assertAlmostEqual(_fit_image_cm(wide, 15.4)[0], round(0.82 * 15.4, 2), places=1)
            # 竖高 ratio 0.67 → 宽度档位(0.55×)受**高度上限 7cm** 约束，取更小者
            tall = self._img(td, 200, 300)
            w, h = _fit_image_cm(tall, 15.4)
            self.assertAlmostEqual(h, 7.0, places=1)
            self.assertAlmostEqual(w, round(7.0 * (200 / 300), 2), places=1)


class TestQuestionNumbering(unittest.TestCase):
    """🔴 历史缺陷回归：题号**双重渲染**。

    ``build_document_plan`` 已把题号（prefix）写进 ``stem_lines`` 首段，
    渲染层若再加一次，就会输出「1．（3 分）1．（3 分）…」（实测发现的真实缺陷）。
    """

    def test_prefix_not_duplicated(self):
        plan = _plan()
        q = plan["sections"][0]["questions"][0]
        q["prefix"] = "1．（3 分）"
        # 模拟 build_document_plan 的产出：题号已在首段
        q["stem_lines"] = [[("text", "1．（3 分）力为 "), ("math", "F=ma")]]
        data, _ = render_plan(plan)
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
        self.assertEqual(doc.count("1．（3 分）"), 1, "题号被重复渲染")

    def test_render_blocks_prefix_not_duplicated(self):
        plan = _plan()
        q = plan["sections"][0]["questions"][0]
        q["prefix"] = "1．（3 分）"
        q["render_blocks"] = [("para", [("text", "1．（3 分）力为 x")], "stem")]
        data, _ = render_plan(plan)
        with TemporaryDirectory() as td:
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
        self.assertEqual(doc.count("1．（3 分）"), 1, "render_blocks 路径题号重复")


class TestRobustness(unittest.TestCase):
    def test_empty_plan_does_not_raise(self):
        data, stats = render_plan({"title": "", "spec": SPEC, "sections": []})
        self.assertGreater(len(data), 0)
        self.assertEqual(stats["formulas"], 0)

    def test_bad_math_degrades_to_text(self):
        plan = _plan()
        plan["sections"][0]["questions"][0]["stem_lines"] = [[("math", "")]]
        _, stats = render_plan(plan)
        self.assertIsInstance(stats["warnings"], list)

    def test_render_blocks_order_is_respected(self):
        """render_blocks 存在时，应按交错顺序渲染（题干/图片/答案保序）。"""
        with TemporaryDirectory() as td:
            img = _png(Path(td) / "f.png")
            plan = _plan(img)
            q = plan["sections"][0]["questions"][1]
            q["render_blocks"] = [
                ("para", [("text", "2．题干")], "stem"),
                ("image", q["images"][0], "stem"),
                ("para", [("text", "【答案】B")], "answer"),
            ]
            data, stats = render_plan(plan)
            self.assertGreaterEqual(stats["images"], 1)
            p = Path(td) / "a.docx"
            p.write_bytes(data)
            _, doc, _ = _read(p)
            self.assertLess(doc.index("2．题干"), doc.index("<w:drawing>"))
            self.assertLess(doc.index("<w:drawing>"), doc.index("【答案】"))


class TestWriterApi(unittest.TestCase):
    def test_direct_writer_usage(self):
        w = DocxWriter(SPEC)
        w.add_paragraph("标题", align="center", size=18.0, bold=True)
        w.add_line([("text", "x="), ("math", "a+b")])
        data = w.to_bytes()
        self.assertGreater(len(data), 0)
        with TemporaryDirectory() as td:
            p = Path(td) / "b.docx"
            p.write_bytes(data)
            names, doc, _ = _read(p)
        self.assertIn("word/document.xml", names)
        self.assertIn("<m:oMath>", doc)


if __name__ == "__main__":
    unittest.main()
