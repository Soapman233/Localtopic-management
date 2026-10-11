"""LaTeX -> OMML 转换器（bank.latex2omml）单元测试。

覆盖：
* 结构映射（分式 / 上下标 / 根号 / 定界符 / 重音）
* 正体包裹（\\rm \\mathrm \\text，含中文）
* **MathType 风格空白缺陷的回归**（实现期实测发现的两个真实 bug）
* 健壮性：任何输入都不得抛异常、输出必须是合法 XML
* 真实语料抽样（交付库不存在时自动跳过）
"""
from __future__ import annotations

import re
import sqlite3
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from bank.latex2omml import latex_to_omath, latex_to_omml

M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_DEFAULT_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")


def _assert_well_formed(test: unittest.TestCase, omml: str) -> None:
    """输出必须是合法 XML（否则 Word 打不开）。"""
    try:
        ET.fromstring(f'<m:oMath xmlns:m="{M_NS}">{omml}</m:oMath>')
    except ET.ParseError as exc:  # pragma: no cover - 失败时给出可读信息
        test.fail(f"生成的 OMML 不是合法 XML: {exc}\n片段={omml[:200]}")


class TestStructure(unittest.TestCase):
    def test_frac(self):
        out = latex_to_omml(r"\frac{a}{b}")
        self.assertIn("<m:f>", out)
        self.assertIn("<m:num><m:r><m:t>a</m:t></m:r></m:num>", out)
        self.assertIn("<m:den><m:r><m:t>b</m:t></m:r></m:den>", out)
        _assert_well_formed(self, out)

    def test_superscript(self):
        out = latex_to_omml("E=mc^2")
        self.assertIn("<m:sSup>", out)
        self.assertIn("<m:sup><m:r><m:t>2</m:t></m:r></m:sup>", out)
        _assert_well_formed(self, out)

    def test_subscript(self):
        out = latex_to_omml("v=v_0")
        self.assertIn("<m:sSub>", out)
        self.assertIn("<m:sub><m:r><m:t>0</m:t></m:r></m:sub>", out)
        _assert_well_formed(self, out)

    def test_sub_and_sup_together(self):
        out = latex_to_omml("x_i^2")
        self.assertIn("<m:sSubSup>", out)
        self.assertIn("<m:sub>", out)
        self.assertIn("<m:sup>", out)
        _assert_well_formed(self, out)

    def test_sqrt_hides_degree(self):
        out = latex_to_omml(r"\sqrt{a}")
        self.assertIn("<m:rad>", out)
        self.assertIn('<m:degHide m:val="1"/>', out)
        _assert_well_formed(self, out)

    def test_delimiter(self):
        out = latex_to_omml(r"\left(a+b\right)")
        self.assertIn("<m:d>", out)
        self.assertIn('<m:begChr m:val="("/>', out)
        self.assertIn('<m:endChr m:val=")"/>', out)
        _assert_well_formed(self, out)

    def test_accent(self):
        out = latex_to_omml(r"\tilde{x}")
        self.assertIn("<m:acc>", out)
        _assert_well_formed(self, out)

    def test_symbols_map_to_unicode(self):
        self.assertIn("×", latex_to_omml(r"a\times b"))
        self.assertIn("ρ", latex_to_omml(r"\rho"))
        self.assertIn("Δ", latex_to_omml(r"\Delta"))
        self.assertIn("Ω", latex_to_omml(r"\Omega"))


class TestUprightText(unittest.TestCase):
    def test_mathrm_is_upright(self):
        out = latex_to_omml(r"\mathrm{m}")
        self.assertIn('<m:sty m:val="p"/>', out)
        self.assertIn("<m:t>m</m:t>", out)

    def test_text_keeps_cjk(self):
        out = latex_to_omml(r"\rho_{\text{水}}")
        self.assertIn("<m:t>水</m:t>", out)
        self.assertIn('<m:sty m:val="p"/>', out)
        _assert_well_formed(self, out)

    def test_rm_containing_structure_is_parsed(self):
        """``\\rm{ {}^\\text{3} }`` —— \\rm 内嵌上标结构，不得被当作纯文本。"""
        out = latex_to_omml(r"{ \rm{ {}^\text{3} } }")
        self.assertIn("<m:sSup>", out)
        self.assertNotIn("\\text", out)
        self.assertNotIn("{}", out)
        _assert_well_formed(self, out)


class TestMathTypeWhitespaceRegression(unittest.TestCase):
    """MathType 风格的 LaTeX 会插入大量填充空格，曾导致两个真实缺陷。

    这两个用例是**回归测试**：修复前必须失败，修复后必须通过。
    """

    def test_adjacent_rm_runs_do_not_gain_spaces(self):
        """``{ \\rm{ k } }{ \\rm{ g } }`` 必须产出 ``kg``，而不是 ``k g``。"""
        out = latex_to_omml(r"{ \rm{ k } }{ \rm{ g } }")
        self.assertIn("<m:t>k</m:t>", out)
        self.assertIn("<m:t>g</m:t>", out)
        self.assertNotIn("<m:t> </m:t>", out, "填充空格泄漏成了真实空格")
        _assert_well_formed(self, out)

    def test_script_binds_across_whitespace(self):
        """``} ^ {`` 之间有空格的 ``^`` 必须绑定到前一个基，而非空格。

        修复前：``^`` 绑定到空格 -> sSup(e=' ', sup=' ') + 游离的 3。
        """
        out = latex_to_omml(r"{ \rm{ 1 } }{ \rm{ 0 } } ^ { 3 }")
        self.assertIn("<m:sSup>", out)
        self.assertIn("<m:e><m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr>"
                      "<m:t>0</m:t></m:r></m:e>", out)
        self.assertIn("<m:sup><m:r><m:t>3</m:t></m:r></m:sup>", out)
        _assert_well_formed(self, out)


class TestRobustness(unittest.TestCase):
    """铁律：任何输入都不得抛异常（否则会中断整卷导出）。"""

    CASES = [
        "", "   ", r"\frac{a}", r"\frac{}{}", "}{", "{{{", "}}}",
        r"\unknowncmd{x}", r"\xrightarrow{abc}", "\ufffd", "\u200b", "\u0ba2",
        "a^", "a_", "^", "_", r"\left(", r"\right)", r"\sqrt", r"\text{",
        "{ \rm{ A } }{ \rm{ B } }", "10{\\text{kg/m}}^{3}", "x" * 500,
    ]

    def test_never_raises_and_always_well_formed(self):
        for src in self.CASES:
            with self.subTest(src=src[:40]):
                out = latex_to_omml(src)          # 不抛异常即通过
                _assert_well_formed(self, out)

    def test_no_backslash_leaks(self):
        """输出中不应残留 LaTeX 反斜杠（说明有命令未被识别）。"""
        for src in self.CASES:
            with self.subTest(src=src[:40]):
                self.assertNotIn("\\", latex_to_omml(src))

    def test_empty_input_yields_empty(self):
        self.assertEqual(latex_to_omml(""), "")
        self.assertEqual(latex_to_omath(""), "")

    def test_omath_wrapper(self):
        out = latex_to_omath("a+b")
        self.assertTrue(out.startswith("<m:oMath>"))
        self.assertTrue(out.endswith("</m:oMath>"))


class TestRealCorpus(unittest.TestCase):
    """真实语料抽样：库不可用时跳过（不失败）。"""

    @classmethod
    def setUpClass(cls):
        if not _DEFAULT_DB.is_file():
            raise unittest.SkipTest(f"交付库不存在，跳过：{_DEFAULT_DB}")
        con = sqlite3.connect(f"file:{_DEFAULT_DB.as_posix()}?mode=ro", uri=True)
        try:
            cls.rows = con.execute(
                "SELECT id, latex FROM formulas "
                "WHERE latex IS NOT NULL AND TRIM(latex) <> '' AND status='OK'"
            ).fetchall()
        finally:
            con.close()

    def test_sample_converts_without_backslash_leak(self):
        """抽样 300 条真实公式：全部不得残留反斜杠、必须 XML 合法。"""
        rows = self.rows[:: max(1, len(self.rows) // 300)][:300]
        bad_leak, bad_xml = [], []
        for fid, latex in rows:
            out = latex_to_omml(latex)
            if "\\" in out:
                bad_leak.append(fid)
            try:
                ET.fromstring(f'<m:oMath xmlns:m="{M_NS}">{out}</m:oMath>')
            except ET.ParseError:
                bad_xml.append(fid)
        self.assertEqual(bad_xml, [], f"XML 非法：{bad_xml[:10]}")
        # 允许极少数长尾命令降级为文本，但比例必须很低
        ratio = len(bad_leak) / max(1, len(rows))
        self.assertLess(ratio, 0.02,
                        f"反斜杠残留比例过高 {ratio:.2%}：{bad_leak[:10]}")


if __name__ == "__main__":
    unittest.main()
