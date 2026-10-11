"""阶段4 导出（``bank/export.py``）的单元测试。

覆盖**不依赖 Office / 桥接**的纯逻辑：

* LaTeX 清洗（``sanitize_latex``）：``$`` 剥离、``\\text{[U+XXXX]}`` 转汉字、不重复套 ``\\text{}``、
  替换字符降级；
* LaTeX 修复（``repair_latex``）：裸多字母标识符包裹、命令内容不二次包裹；
* 占位符解析与降级（``iter_placeholders`` / ``text_to_lines``）；
* 文档计划（``build_document_plan``）：题号连续、模板差异（是否标分）、答案按模式门控；
* 图片解析（``resolve_media``）：命中 / 哈希不符 / 成员缺失 / 源缺失。

**渲染与双客户端验证需要真实 Office 组件**，故不在单元测试里执行（由 CLI ``export`` 实测）。
"""
# ---------------------------------------------------------------------------
# title: 导出测试
# description: 覆盖导出纯逻辑：LaTeX 清洗与修复、占位符按 fid 映射与降级、题号连续编号、模板差异、答案按模式门控与图片按 sha256 解析；并覆盖 v0.2 新增的瞬时错误识别与重试、页脚「第 X 页 共 Y 页」注入、大题标题常见写法与行距常量。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------


from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bank import export  # noqa: E402


def _seg_kinds(line):
    return [k for k, _ in line]


class TestSanitizeLatex(unittest.TestCase):
    """LaTeX 清洗。"""

    def test_strip_dollar_and_cjk(self):
        raw = "$ p_{ {\\text{[U+7532]}} } =p_{ {\\text{[U+4e59]}} } $"
        self.assertEqual(export.sanitize_latex(raw), "p_{{\\text{甲}}} =p_{{\\text{乙}}}")

    def test_no_double_text_wrap(self):
        # 已经是 \text{甲} 的不应再被包一层 \text{\text{甲}}。
        raw = "F_{{\\text{甲}}}"
        self.assertEqual(export.sanitize_latex(raw), "F_{{\\text{甲}}}")
        self.assertNotIn("\\text{\\text", export.sanitize_latex(raw))

    def test_replacement_char_degraded(self):
        raw = "$ p_{ {\\text{[U+7532]}} } ^ { \\text{\ufffd} } $"
        out = export.sanitize_latex(raw)
        self.assertIn("\\text{□}", out)
        self.assertNotIn("\ufffd", out)

    def test_bare_uplus(self):
        self.assertEqual(export.sanitize_latex("F_[U+6d6e]"), "F_\\text{浮}")
        self.assertEqual(export.sanitize_latex("[U+6d6e]"), "\\text{浮}")

    def test_rm_command_unwrapped(self):
        # \rm 包装在导出前**展开**：桥接会破坏 \rm{ \Delta }（退化成字面文本），
        # 展开后 \Delta 回到顶层，可被正常渲染 + 实体还原。
        self.assertEqual(export.sanitize_latex("$ 20{ \\rm{ N } } $"), "20{N}")
        self.assertEqual(export.sanitize_latex("$ { \\rm{ \\Delta } }p $"), "{\\Delta}p")
        self.assertEqual(export.sanitize_latex("$ { \\rm{ g } } $"), "{g}")
        self.assertEqual(export.sanitize_latex("$ \\mathrm{cm} $"), "cm")

    def test_empty_returns_none(self):
        self.assertIsNone(export.sanitize_latex("$  $"))
        self.assertIsNone(export.sanitize_latex(None))


class TestStripOriginalNumber(unittest.TestCase):
    """题干行首原始题号的剥离（避免与新题号叠成双重题号）。"""

    def test_strip_when_matches(self):
        self.assertEqual(export.strip_original_number("7．如图所示", "7"), "如图所示")
        self.assertEqual(export.strip_original_number("1. 题干", "1"), "题干")
        self.assertEqual(export.strip_original_number("12、题干", "12"), "题干")
        self.assertEqual(export.strip_original_number("  3． 题干", "3"), "题干")

    def test_keep_when_mismatch(self):
        # 行首数字与原题号不符 → 视为正文内容，不剥离（宁可留冗余也不误删）。
        self.assertEqual(export.strip_original_number("3．14是圆周率", "7"), "3．14是圆周率")

    def test_keep_when_no_number(self):
        self.assertEqual(export.strip_original_number("无题号题干", "1"), "无题号题干")
        self.assertEqual(export.strip_original_number("（1）小问题干", "1"), "（1）小问题干")

    def test_none(self):
        self.assertIsNone(export.strip_original_number(None, "1"))


class TestMathEntities(unittest.TestCase):
    """OMML 符号实体还原（桥接把 \\Delta 等输出成 &Delta;）。"""

    def test_resolve_entities(self):
        xml = ('<m:oMath><m:t>&amp;Delta;p</m:t></m:oMath>'
               '<m:t>x&amp;leq;y</m:t><m:t>&amp;Omega;</m:t>')
        new, n = export._resolve_math_entities(xml)
        self.assertEqual(n, 3)
        self.assertIn("Δp", new)
        self.assertIn("x≤y", new)
        self.assertIn("Ω", new)
        self.assertNotIn("&amp;Delta;", new)

    def test_keep_legit_xml_escapes(self):
        # &lt;/&gt; 是合法 XML 转义（数学的 < / >），必须保持。
        xml = "<m:t>a&lt;b</m:t>"
        new, n = export._resolve_math_entities(xml)
        self.assertEqual(n, 0)
        self.assertEqual(new, xml)

    def test_unknown_entity_untouched(self):
        xml = "<m:t>&amp;notanentity;</m:t>"
        new, n = export._resolve_math_entities(xml)
        self.assertEqual(n, 0)
        self.assertEqual(new, xml)

    def test_postprocess_docx_entities(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            docx = td / "e.docx"
            doc = ('<w:document xmlns:m="x"><m:oMath><m:t>&amp;Delta;p</m:t></m:oMath>'
                   '</w:document>')
            with zipfile.ZipFile(docx, "w") as z:
                z.writestr("word/document.xml", doc)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["math_entities"], 1)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertIn("Δp", xml)
            self.assertNotIn("&amp;Delta;", xml)


class TestRepairLatex(unittest.TestCase):
    """渲染失败后的保守修复。"""

    def test_wrap_bare_unit(self):
        self.assertEqual(export.repair_latex("4cm ^ {3}"), "4{cm} ^ {3}")
        self.assertEqual(export.repair_latex("1cm^{3}"), "1{cm}^{3}")

    def test_do_not_touch_commands(self):
        # \frac / \rm / \text 内容不应被包裹。
        self.assertEqual(export.repair_latex("\\frac{a}{b}"), "\\frac{a}{b}")
        self.assertEqual(export.repair_latex("{\\rm{N}}"), "{\\rm{N}}")
        self.assertEqual(export.repair_latex("\\text{cm}"), "\\text{cm}")

    def test_single_letter_untouched(self):
        self.assertEqual(export.repair_latex("x^{2}"), "x^{2}")
        self.assertEqual(export.repair_latex("V_{a}"), "V_{a}")

    # ------------------------------------------------------------------ #
    # 波浪号命令与单位上标（全库回归发现的真实缺陷，2026-10-11）
    # ------------------------------------------------------------------ #
    def test_tilde_range_normalized_to_sim(self):
        """MTEF 把「范围号 ~」转成 ``\\tilde{\\ }``，桥接无法渲染 → 归一为 ``\\sim``。"""
        self.assertEqual(export.repair_latex("0\\tilde{\\ }0.6{A}"), "0\\sim0.6{A}")
        # sanitize_latex 会去掉内部空格，故 ``\tilde{\}`` 形态也要覆盖
        self.assertEqual(export.repair_latex("0\\tilde{\\}0.6{A}"), "0\\sim0.6{A}")

    def test_mathrm_tilde_normalized_to_sim(self):
        """``t_{1}\\mathrm{\\~{}}t_{2}``（约等号）同样无法渲染。"""
        self.assertEqual(export.repair_latex("t_{1}\\mathrm{\\~{}}t_{2}"),
                         "t_{1}\\simt_{2}")

    def test_bare_tilde_braces_normalized(self):
        self.assertEqual(export.repair_latex("18℃\\~{}30℃"), "18℃\\sim30℃")

    def test_rm_superscript_normalized(self):
        """``\\rm{{}^\\text{3}}``（单位上标，如 m³）→ ``^{\\text{3}}``。"""
        self.assertEqual(export.repair_latex("V=0.5{c}{m}{\\rm{{}^\\text{3}}}"),
                         "V=0.5{c}{m}{^{\\text{3}}}")

    def test_normal_formula_untouched_by_tilde_rule(self):
        """不应误伤普通 ``\\sim`` 或含 ``~`` 的正文命令。"""
        self.assertEqual(export.repair_latex("a\\sim b"), "a\\sim b")
        self.assertEqual(export.repair_latex("\\text{约}3\\text{米}"), "\\text{约}3\\text{米}")

    def test_stray_alignment_ampersand_removed(self):
        """MTEF 表格残留的游离 ``&``（无对齐语义）→ 剔除。"""
        out = export.repair_latex("\\rho _{ & x } =")
        self.assertNotIn("&", out)
        self.assertEqual(out, "\\rho _{x } =")   # 残留一个空格，LaTeX 数学模式中无影响

    def test_array_environment_keeps_ampersand(self):
        """``\\begin{array}`` 内的 ``&`` 有真实对齐语义，不得剔除。"""
        src = "\\begin{array}{cc} a & b \\end{array}"
        self.assertIn("&", export.repair_latex(src))

    def test_nested_rm_unwrapped(self):
        """``\\rm`` 内含**嵌套花括号**时 sanitize 的展开规则漏网，需展开外壳。"""
        out = export.repair_latex("F_{{\\rm{{\\text{浮}}}}}")
        self.assertNotIn("\\rm", out)
        self.assertIn("\\text{浮}", out)

    def test_nested_rm_inside_xrightarrow(self):
        """``\\xrightarrow{\\mathrm{{\\text{若}}...}}`` 曾无法渲染（实测）。"""
        out = export.repair_latex("\\xrightarrow {\\mathrm{{\\text{若}}{\\text{形}}}}")
        self.assertNotIn("\\mathrm", out)
        self.assertIn("\\xrightarrow", out)
        self.assertIn("\\text{若}", out)

    def test_simple_rm_untouched(self):
        """无嵌套的 ``\\rm`` 交给既有规则，本函数不动。"""
        self.assertEqual(export.repair_latex("{\\rm{N}}"), "{\\rm{N}}")
        self.assertEqual(export.repair_latex("\\mathrm{A}"), "\\mathrm{A}")

    def test_unbalanced_braces_left_alone(self):
        """括号不平衡时原样保留，不猜。"""
        src = "{\\rm{{\\text{浮}}"
        self.assertEqual(export.unwrap_nested_rm(src), src)

    def test_sqrt_empty_optional_arg_removed(self):
        """``\\sqrt[]``（空可选参数）桥接无法渲染 → 去掉 ``[]``。"""
        self.assertEqual(export.repair_latex("b=\\sqrt[] {\\frac {1} {2}}"),
                         "b=\\sqrt {\\frac {1} {2}}")

    def test_sqrt_with_real_index_kept(self):
        """``\\sqrt[3]{x}`` 的可选参数有真实语义，不得去掉。"""
        self.assertEqual(export.repair_latex("\\sqrt[3]{x}"), "\\sqrt[3]{x}")


class TestPlaceholders(unittest.TestCase):
    """占位符解析与降级。"""

    def test_iter(self):
        self.assertEqual(export.iter_placeholders("压力为⟦F59⟧、⟦F60⟧"), ["F59", "F60"])
        self.assertEqual(export.iter_placeholders("无占位符"), [])

    def test_line_mapping_by_fid(self):
        ctx = {"warnings": [], "formulas": 0, "qid": "#1"}
        fid_latex = {"F59": "$ F_{ {\\text{[U+7532]}} } $", "F60": "$ F_{ {\\text{[U+4e59]}} } $"}
        lines = export.text_to_lines("压力为⟦F59⟧、⟦F60⟧", fid_latex, ctx, prefix="9．")
        self.assertEqual(len(lines), 1)
        kinds = _seg_kinds(lines[0])
        self.assertEqual(kinds, ["text", "math", "text", "math"])
        self.assertEqual(lines[0][0][1], "9．压力为")
        self.assertEqual(lines[0][1][1], "F_{{\\text{甲}}}")
        self.assertEqual(lines[0][3][1], "F_{{\\text{乙}}}")
        self.assertEqual(ctx["formulas"], 2)
        self.assertEqual(ctx["warnings"], [])

    def test_missing_formula_degrades_with_warning(self):
        ctx = {"warnings": [], "formulas": 0, "qid": "#9"}
        lines = export.text_to_lines("已知⟦F99⟧", {}, ctx)
        kinds = _seg_kinds(lines[0])
        self.assertEqual(kinds, ["text", "text"])
        self.assertIn("⟦F99⟧", lines[0][1][1])
        self.assertEqual(ctx["formulas"], 0)
        self.assertTrue(any("F99" in w for w in ctx["warnings"]))

    def test_multiline_and_tabs(self):
        ctx = {"warnings": [], "formulas": 0, "qid": "#1"}
        lines = export.text_to_lines("第一行\tA\n\n第二行", {}, ctx)
        self.assertEqual(len(lines), 2)
        self.assertIn("\t", lines[0][0][1])          # 保留真实TAB，由模板制表位控制
        self.assertEqual(lines[1][0][1], "第二行")


class TestBridgeSafeText(unittest.TestCase):
    """控制字符安全化：桥接拒绝 TAB/控制字符（实测 code=9/11），须换成哨兵。

    回归背景：真实样例卷因「选项行内公式后紧跟 TAB」导出失败
    （``DocEditor::InsertText: control character (code=9)``）。修复方式为送桥接前
    把 ``\\t`` 换成 :data:`export.BRIDGE_TAB_SENTINEL`，保存后在 OOXML 层还原为
    ``<w:tab/>``。
    """

    def test_tab_becomes_sentinel(self):
        self.assertEqual(export.bridge_safe_text("A．\tB．"),
                         "A．" + export.BRIDGE_TAB_SENTINEL + "B．")

    def test_leading_and_trailing_tab(self):
        """段首/段尾 TAB 同样必须被换掉（原故障正是段首 TAB）。"""
        self.assertEqual(export.bridge_safe_text("\tB．"),
                         export.BRIDGE_TAB_SENTINEL + "B．")
        self.assertEqual(export.bridge_safe_text("B．\t"),
                         "B．" + export.BRIDGE_TAB_SENTINEL)

    def test_other_control_chars_dropped(self):
        """无排版语义的控制字符直接剔除，不得残留。"""
        self.assertEqual(export.bridge_safe_text("A\x0bB\x0cC\x00D"), "ABCD")
        self.assertEqual(export.bridge_safe_text("A\x7fB"), "AB")

    def test_plain_text_unchanged(self):
        self.assertEqual(export.bridge_safe_text("压力 p=ρgh（　　）"), "压力 p=ρgh（　　）")

    def test_empty_and_none_passthrough(self):
        self.assertEqual(export.bridge_safe_text(""), "")
        self.assertIsNone(export.bridge_safe_text(None))

    def test_newline_preserved(self):
        """换行不是控制字符路径处理的（按行切分在更早阶段完成），应原样保留。"""
        self.assertEqual(export.bridge_safe_text("甲\n乙"), "甲\n乙")


class TestExplicitTabStops(unittest.TestCase):
    """OOXML 后处理：哨兵/真实 TAB → ``<w:tab/>`` 并补制表位停靠点。"""

    def test_sentinel_restored_to_real_tab(self):
        xml = ('<w:document><w:body><w:p><w:pPr><w:jc w:val="left"/></w:pPr>'
               '<w:r><w:t xml:space="preserve">A．'
               + export.BRIDGE_TAB_SENTINEL +
               'B．</w:t></w:r></w:p></w:body></w:document>')
        out, count = export._set_explicit_tab_stops(xml)
        self.assertEqual(count, 1)
        self.assertIn("<w:tab/>", out)
        self.assertNotIn(export.BRIDGE_TAB_SENTINEL, out)   # 哨兵必须被完全还原
        self.assertIn("<w:tabs>", out)                      # 停靠点已补
        self.assertIn("A．", out)
        self.assertIn("B．", out)

    def test_paragraph_without_tab_untouched(self):
        xml = ('<w:document><w:body><w:p><w:r><w:t>普通文本</w:t></w:r></w:p>'
               '</w:body></w:document>')
        out, count = export._set_explicit_tab_stops(xml)
        self.assertEqual(count, 0)
        self.assertEqual(out, xml)


class TestOptionLabelSegments(unittest.TestCase):
    """选项标签判定：含**行内公式**的选项行也必须被识别（否则配图被拆页）。

    回归背景：原实现要求「整段全是纯文本」，真实选项行常形如
    ``A．⟦F66⟧，⟦F67⟧\\tB．``，含公式段 → 判定失效 → 选项标签与其配图被分到两页。
    """

    def test_plain_label_line(self):
        self.assertTrue(export.is_option_label_segments([("text", "B．")]))

    def test_label_after_tab_with_inline_formulas(self):
        segs = [("text", "A．"), ("math", "F66"), ("text", "，"),
                ("math", "F67"), ("text", "\tB．")]
        self.assertTrue(export.is_option_label_segments(segs))

    def test_label_with_trailing_formula_is_not_a_label(self):
        """段尾是公式（不是 ``A．``）→ 不应判定为选项标签行。"""
        segs = [("text", "A．"), ("math", "F1")]
        self.assertFalse(export.is_option_label_segments(segs))

    def test_normal_sentence_is_not_a_label(self):
        self.assertFalse(export.is_option_label_segments(
            [("text", "下列说法正确的是（　　）")]))

    def test_letter_not_at_segment_tail_is_not_a_label(self):
        """中间出现 ``A．`` 但段尾不是 → 不算（避免整段误连）。"""
        self.assertFalse(export.is_option_label_segments(
            [("text", "A．甲物体\tB．乙物体，故选 C")]))

    def test_empty_segments(self):
        self.assertFalse(export.is_option_label_segments([]))


def _payload(answer_mode="答案解析版", template="考试", show_answer=True, show_analysis=True):
    """构造一个最小 payload（结构对齐 bank.paper.build_export_payload）。"""
    return {
        "paper": {"id": 1, "title": "测试卷", "subject": "物理", "grade": "八年级下册",
                  "template": template, "answer_mode": answer_mode},
        "answer_mode": answer_mode,
        "sections": [
            {
                "section_id": 1, "name": "一、选择题", "seq": 1, "item_count": 2,
                "subtotal": 6.0,
                "questions": [
                    {
                        "item_id": 11, "seq": 1, "question_id": 101, "question_version": 1,
                        "number": "7", "qtype": "选择题", "score": 3.0,
                        "text": "1．设压力为⟦F1⟧。则（　　）A．甲\tB．乙\n【答案】C\n【详解】因为⟦F1⟧，故正确。",
                        "formulas": [
                            {"fid": "F1", "seq": 1, "latex": "$ F_{ {\\text{[U+538b]}} } $",
                             "kind": "mathtype", "status": "OK"},
                        ],
                        "latex_list": ["$ F_{ {\\text{[U+538b]}} } $"],
                        "images": [{"media_path": "media/image1.png", "sha256": "deadbeef"}],
                        "image_paths": ["media/image1.png"],
                        "answer": "C" if show_answer else None,
                        "analysis": "因为⟦F1⟧，故正确。" if show_analysis else None,
                        "answer_source": "inline",
                        "show_answer": show_answer, "show_analysis": show_analysis,
                        "source": {"source_id": 7, "file_name": "x.docx"},
                    },
                    {
                        "item_id": 12, "seq": 2, "question_id": 102, "question_version": 1,
                        "number": "1", "qtype": "选择题", "score": 3.0,
                        "text": "2．纯文本题，无公式。",
                        "formulas": [], "latex_list": [], "images": [], "image_paths": [],
                        "answer": "A" if show_answer else None,
                        "analysis": None, "answer_source": None,
                        "show_answer": show_answer, "show_analysis": show_analysis,
                        "source": {"source_id": 7, "file_name": "x.docx"},
                    },
                ],
            },
            {
                "section_id": 2, "name": "二、计算题", "seq": 2, "item_count": 1,
                "subtotal": 6.0,
                "questions": [
                    {
                        "item_id": 13, "seq": 3, "question_id": 103, "question_version": 1,
                        "number": "1", "qtype": "计算解答题", "score": 6.0,
                        "text": "3．求重力。",
                        "formulas": [], "latex_list": [], "images": [], "image_paths": [],
                        "answer": None, "analysis": None, "answer_source": None,
                        "show_answer": show_answer, "show_analysis": show_analysis,
                        "source": {"source_id": 7, "file_name": "x.docx"},
                    },
                ],
            },
        ],
    }


class TestBuildDocumentPlan(unittest.TestCase):
    """文档计划：题号连续 / 模板差异 / 答案门控。"""

    def test_continuous_numbering_across_sections(self):
        plan = export.build_document_plan(_payload())
        numbers = [q["number"] for s in plan["sections"] for q in s["questions"]]
        self.assertEqual(numbers, [1, 2, 3])
        prefixes = [q["prefix"] for s in plan["sections"] for q in s["questions"]]
        self.assertEqual(prefixes, ["1．（3 分）", "2．（3 分）", "3．（6 分）"])

    def test_section_header_has_score(self):
        plan = export.build_document_plan(_payload(template="考试"))
        # 采用常见试卷写法「本大题共 N 小题，每小题 X 分，共 T 分」（问题②）。
        self.assertEqual(plan["sections"][0]["header"],
                         "一、选择题（本大题共 2 小题，每小题 3 分，共 6 分）")

    def test_template_show_score_differs(self):
        exam = export.build_document_plan(_payload(template="考试"))
        hw = export.build_document_plan(_payload(template="作业"))
        self.assertTrue(exam["spec"]["show_score"])
        self.assertFalse(hw["spec"]["show_score"])
        # 作业模板题号不带分值。
        self.assertEqual(hw["sections"][0]["questions"][0]["prefix"], "1．")
        # 作业模板卷头与考试不同。
        self.assertNotEqual(exam["info_line"], hw["info_line"])

    def test_answer_gating_student_version(self):
        plan = export.build_document_plan(
            _payload(answer_mode="学生版", show_answer=False, show_analysis=False))
        for s in plan["sections"]:
            for q in s["questions"]:
                self.assertIsNone(q["answer_lines"])
                self.assertIsNone(q["analysis_lines"])
        # 题干里内联的 【答案】/【详解】 必须已被剥离。
        stem_text = "".join(v for k, v in plan["sections"][0]["questions"][0]["stem_lines"][0]
                            if k == export.SEG_TEXT)
        self.assertNotIn("【答案】", stem_text)
        self.assertNotIn("【详解】", stem_text)

    def test_answer_present_in_analysis_version(self):
        plan = export.build_document_plan(_payload(answer_mode="答案解析版"))
        q = plan["sections"][0]["questions"][0]
        self.assertIsNotNone(q["answer_lines"])
        self.assertIsNotNone(q["analysis_lines"])
        self.assertIn("【答案】", q["answer_lines"][0][0][1])
        self.assertIn("【解析】", q["analysis_lines"][0][0][1])

    def test_formula_audit_counts(self):
        plan = export.build_document_plan(_payload())
        # 题干 1 个 + 解析 1 个 = 2 个占位符都被渲染。
        self.assertEqual(plan["audit"]["payload_formulas"], 1)
        self.assertEqual(plan["audit"]["rendered_formulas"], 2)

    def test_unknown_template_raises(self):
        with self.assertRaises(export.ExportError):
            export.build_document_plan(_payload(), template="不存在的模板")

    def test_media_resolver_invoked(self):
        calls = []

        def resolver(source_id, media_path, sha256):
            calls.append((source_id, media_path, sha256))
            return Path("C:/tmp/img.png"), None

        plan = export.build_document_plan(_payload(), media_resolver=resolver)
        self.assertEqual(calls, [(7, "media/image1.png", "deadbeef")])
        q = plan["sections"][0]["questions"][0]
        self.assertEqual(q["images"][0]["path"], "C:\\tmp\\img.png")
        self.assertEqual(plan["audit"]["resolved_images"], 1)

    def test_stem_original_number_stripped(self):
        # 题干行首原题号（7．）与快照题号一致 → 剥离，只保留新连续题号。
        p = _payload()
        q0 = p["sections"][0]["questions"][0]
        q0["text"] = "7．设压力为⟦F1⟧。\n【答案】C"
        q0["number"] = "7"
        plan = export.build_document_plan(p)
        stem_text = "".join(v for k, v in plan["sections"][0]["questions"][0]["stem_lines"][0]
                            if k == export.SEG_TEXT)
        self.assertEqual(stem_text, "1．（3 分）设压力为。")
        self.assertNotIn("7．", stem_text)

    def test_stem_number_kept_when_mismatch(self):
        # 行首数字与快照题号不符 → 不剥离（视为正文）。
        p = _payload()
        q0 = p["sections"][0]["questions"][0]
        q0["text"] = "3．14 是圆周率。"
        q0["number"] = "7"
        plan = export.build_document_plan(p)
        stem_text = "".join(v for k, v in plan["sections"][0]["questions"][0]["stem_lines"][0]
                            if k == export.SEG_TEXT)
        self.assertIn("3．14", stem_text)


class TestResolveMedia(unittest.TestCase):
    """图片从源 DOCX 包内按 sha256 解析。"""

    def _make_source(self, tmp: Path, *, member="word/media/image1.png", blob=b"PNGDATA"):
        src = tmp / "source.docx"
        with zipfile.ZipFile(src, "w") as z:
            z.writestr("[Content_Types].xml", "<Types/>")
            z.writestr(member, blob)
        return src, hashlib.sha256(blob).hexdigest()

    def test_hit(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            src, sha = self._make_source(td)
            conn = sqlite3.connect(":memory:")
            conn.row_factory = sqlite3.Row
            conn.execute("CREATE TABLE source_files (id INTEGER PRIMARY KEY, path TEXT)")
            conn.execute("INSERT INTO source_files VALUES (1, ?)", (str(src),))
            conn.commit()
            out, reason = export.resolve_media(conn, 1, "media/image1.png", sha,
                                               cache_dir=td / "cache")
            self.assertIsNone(reason)
            self.assertTrue(out.exists())
            self.assertEqual(out.read_bytes(), b"PNGDATA")
            self.assertTrue(out.is_absolute())
            conn.close()

    def test_sha_mismatch(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            src, _ = self._make_source(td)
            conn = sqlite3.connect(":memory:")
            conn.row_factory = sqlite3.Row
            conn.execute("CREATE TABLE source_files (id INTEGER PRIMARY KEY, path TEXT)")
            conn.execute("INSERT INTO source_files VALUES (1, ?)", (str(src),))
            conn.commit()
            out, reason = export.resolve_media(conn, 1, "media/image1.png", "0" * 64,
                                               cache_dir=td / "cache")
            self.assertIsNone(out)
            self.assertEqual(reason, "sha256_mismatch")
            conn.close()

    def test_member_not_found(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            src, _ = self._make_source(td)
            conn = sqlite3.connect(":memory:")
            conn.row_factory = sqlite3.Row
            conn.execute("CREATE TABLE source_files (id INTEGER PRIMARY KEY, path TEXT)")
            conn.execute("INSERT INTO source_files VALUES (1, ?)", (str(src),))
            conn.commit()
            out, reason = export.resolve_media(conn, 1, "media/nope.png", None,
                                               cache_dir=td / "cache")
            self.assertIsNone(out)
            self.assertEqual(reason, "member_not_found")
            conn.close()

    def test_source_missing(self):
        import sqlite3
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE source_files (id INTEGER PRIMARY KEY, path TEXT)")
        conn.commit()
        out, reason = export.resolve_media(conn, 999, "media/image1.png", None)
        self.assertIsNone(out)
        self.assertEqual(reason, "source_file_missing")
        conn.close()


class TestTemplateSpecs(unittest.TestCase):
    """三模板必须有可观察差异。"""

    def test_three_templates(self):
        self.assertEqual(set(export.TEMPLATE_SPECS), {"考试", "测验", "作业"})

    def test_observable_differences(self):
        e, q, h = (export.TEMPLATE_SPECS[k] for k in ("考试", "测验", "作业"))
        # 标题字号：考试 > 测验 > 作业。
        self.assertGreater(e["title_size"], q["title_size"])
        self.assertGreater(q["title_size"], h["title_size"])
        # 装订线仅考试非零。
        self.assertGreater(e["gutter"], 0)
        self.assertEqual(q["gutter"], 0)
        self.assertEqual(h["gutter"], 0)
        # 是否标分 / 大题是否分页。
        self.assertTrue(e["show_score"] and q["show_score"])
        self.assertFalse(h["show_score"])
        self.assertTrue(e["page_break_sections"])
        self.assertFalse(h["page_break_sections"])
        # 页边距各不相同。
        self.assertNotEqual(e["margins"], q["margins"])
        self.assertNotEqual(q["margins"], h["margins"])

    def test_line_spacing_present(self):
        # 问题②：三模板均须带 1.5 倍行距（避免中文挤成一团）。
        for name, spec in export.TEMPLATE_SPECS.items():
            self.assertIn("line_spacing", spec, name)
            self.assertGreaterEqual(spec["line_spacing"], 1.0)


class TestReadOnlyExport(unittest.TestCase):
    """导出为只读操作：不触发 schema 迁移，不改动 bank.db（hash+mtime 不变）。"""

    def _make_db(self, td: Path) -> Path:
        from bank import db as _db
        from bank import paper as _paper
        p = td / "bank.db"
        c = _db.connect(p)
        c.execute("INSERT INTO source_files(id,path,sha256,file_name)"
                  " VALUES (1,'a','h','a.docx')")
        c.execute("INSERT INTO questions(id,source_id,number,text,plain_text,content_hash,version)"
                  " VALUES (1,1,'1','7．题干⟦F1⟧','题干','h',1)")
        c.execute("INSERT INTO question_versions(question_id,version,content_hash,text,plain_text)"
                  " VALUES (1,1,'h','7．题干⟦F1⟧','题干')")
        c.execute("INSERT INTO formulas(question_id,fid,seq,kind,status,latex)"
                  " VALUES (1,'F1',1,'mathtype','OK','$ \\Delta p $')")
        c.commit()
        from tests.export_source_fixture import materialize_source
        materialize_source(c,1)
        _paper.create_paper(c, "只读测试卷")
        _paper.add_questions(c, 1, [1], section="一、选择题", score=3)
        c.close()
        return p

    def test_connect_readonly_rejects_write(self):
        from bank import db as _db
        with tempfile.TemporaryDirectory() as td:
            p = self._make_db(Path(td))
            ro = _db.connect_readonly(p)
            with self.assertRaises(sqlite3.OperationalError):
                ro.execute("INSERT INTO meta(key, value) VALUES ('x', 'y')")
            ro.close()

    def test_connect_readonly_missing_file(self):
        from bank import db as _db
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(FileNotFoundError):
                _db.connect_readonly(Path(td) / "nope.db")

    def test_build_export_payload_does_not_touch_db(self):
        from bank import db as _db
        from bank import paper as _paper
        with tempfile.TemporaryDirectory() as td:
            p = self._make_db(Path(td))
            before = (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            ro = _db.connect_readonly(p)
            payload = _paper.build_export_payload(ro, 1, answer_mode="学生版")
            ro.close()
            after = (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            self.assertEqual(payload["paper"]["id"], 1)
            self.assertEqual(payload["sections"][0]["questions"][0]["text"], "7．题干⟦F1⟧")
            self.assertEqual(before, after)          # hash 与 mtime 均未变


class TestWordCompatibility(unittest.TestCase):
    """图片 graphicData 的 uri 补齐（Word 严格、WPS 宽松）。"""

    def test_inject_uri(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            docx = td / "a.docx"
            doc = ('<w:document xmlns:a="x"><w:body><w:p><w:r><w:drawing>'
                   '<a:graphic><a:graphicData><a:blip/></a:graphicData></a:graphic>'
                   '</w:drawing></w:r></w:p></w:body></w:document>')
            with zipfile.ZipFile(docx, "w") as z:
                z.writestr("word/document.xml", doc)
                z.writestr("word/styles.xml", "<styles/>")
            n = export.make_docx_word_compatible(docx)
            self.assertEqual(n, 1)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertIn("graphicData uri=", xml)
            # 其余部件保持完好。
            self.assertEqual(zipfile.ZipFile(docx).read("word/styles.xml"), b"<styles/>")

    def test_noop_without_graphicdata(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            docx = td / "b.docx"
            with zipfile.ZipFile(docx, "w") as z:
                z.writestr("word/document.xml", "<w:document/>")
            self.assertEqual(export.make_docx_word_compatible(docx), 0)


class TestImageParagraphMerge(unittest.TestCase):
    """问题③：把「空段 + 图片段」合并为一段（恢复居中 / 间距 / 分页控制）。

    桥接 ``doc_insert_image`` 会先建一个空段承载 ``paragraph_property``，再另起一段放图。
    合并后图片段继承空段的 ``jc`` / ``spacing`` / ``keepNext``，图片才会**居中**且能与题干
    ``keepNext`` **不断链**。
    """

    @staticmethod
    def _docx(td: Path, body: str) -> Path:
        docx = td / "m.docx"
        doc = f'<w:document xmlns:w="x"><w:body>{body}</w:body></w:document>'
        with zipfile.ZipFile(docx, "w") as z:
            z.writestr("word/document.xml", doc)
        return docx

    def test_merge_empty_then_image(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            body = ('<w:p><w:pPr><w:jc w:val="center"/><w:keepNext w:val="1"/></w:pPr></w:p>'
                    '<w:p><w:pPr><w:pStyle w:val="s"/></w:pPr>'
                    '<w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>')
            docx = self._docx(td, body)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["image_merge"], 1)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertEqual(xml.count("<w:p>"), 1)              # 两段并作一段
            self.assertIn('<w:jc w:val="center"/>', xml)         # 继承居中
            self.assertIn('<w:keepNext w:val="1"/>', xml)        # 继承分页控制
            self.assertIn("<w:drawing>", xml)                    # 图片未丢

    def test_no_merge_when_next_not_image(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            body = '<w:p><w:pPr/></w:p><w:p><w:r><w:t>text</w:t></w:r></w:p>'
            docx = self._docx(td, body)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["image_merge"], 0)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertEqual(xml.count("<w:p>"), 2)              # 原样保留

    def test_no_merge_when_prev_not_empty(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            body = ('<w:p><w:r><w:t>stem</w:t></w:r></w:p>'
                    '<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>')
            docx = self._docx(td, body)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["image_merge"], 0)

    def test_no_merge_when_prev_is_formula_only(self):
        # 纯公式段（只有 <m:oMath>、无 <w:t>）不得被误判为空段并进图片。
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            body = ('<w:p><w:pPr/><m:oMath><m:t>x</m:t></m:oMath></w:p>'
                    '<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>')
            docx = self._docx(td, body)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["image_merge"], 0)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertEqual(xml.count("<w:p>"), 2)

    def test_merge_two_images_in_a_row(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            img = '<w:r><w:drawing><wp:inline/></w:drawing></w:r>'
            body = (f'<w:p><w:pPr/></w:p><w:p>{img}</w:p>'
                    f'<w:p><w:pPr/></w:p><w:p>{img}</w:p>')
            docx = self._docx(td, body)
            res = export.postprocess_bridge_docx(docx)
            self.assertEqual(res["image_merge"], 2)
            xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
            self.assertEqual(xml.count("<w:p>"), 2)
            self.assertEqual(xml.count("<w:drawing>"), 2)


class TestPageNumberFooter(unittest.TestCase):
    """页脚「第 X 页 共 Y 页」注入（问题②）。"""

    def _make_docx(self, td: Path, *, sect: str) -> Path:
        docx = td / "f.docx"
        doc = ('<w:document xmlns:w="x" xmlns:r="y"><w:body>'
               '<w:p><w:r><w:t>hi</w:t></w:r></w:p>'
               + sect + '</w:body></w:document>')
        with zipfile.ZipFile(docx, "w") as z:
            z.writestr("word/document.xml", doc)
            z.writestr("word/_rels/document.xml.rels",
                       '<Relationships xmlns="r"></Relationships>')
            z.writestr("[Content_Types].xml", '<Types xmlns="t"></Types>')
        return docx

    def test_footer_injected(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            docx = self._make_docx(td, sect='<w:sectPr><w:pgMar w:top="1440"/></w:sectPr>')
            res = export.postprocess_bridge_docx(docx)
            self.assertTrue(res["footer"])
            with zipfile.ZipFile(docx) as z:
                self.assertIn("word/footer1.xml", z.namelist())
                foot = z.read("word/footer1.xml").decode("utf-8")
                doc = z.read("word/document.xml").decode("utf-8")
                rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
                ctypes_xml = z.read("[Content_Types].xml").decode("utf-8")
            self.assertIn("PAGE", foot)
            self.assertIn("NUMPAGES", foot)
            self.assertIn("第 ", foot)
            self.assertIn(" 页 共 ", foot)
            self.assertIn("footerReference", doc)
            # footerReference 必须排在 pgMar 之前（OOXML 顺序约束）。
            self.assertLess(doc.index("footerReference"), doc.index("pgMar"))
            self.assertIn("footer1.xml", rels)
            self.assertIn("/word/footer1.xml", ctypes_xml)

    def test_footer_self_closing_sectpr(self):
        with tempfile.TemporaryDirectory() as td:
            docx = self._make_docx(Path(td), sect="<w:sectPr/>")
            res = export.postprocess_bridge_docx(docx)
            self.assertTrue(res["footer"])
            with zipfile.ZipFile(docx) as z:
                doc = z.read("word/document.xml").decode("utf-8")
            self.assertIn("footerReference", doc)

    def test_footer_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            docx = self._make_docx(Path(td), sect="<w:sectPr/>")
            export.postprocess_bridge_docx(docx)
            res2 = export.postprocess_bridge_docx(docx)     # 已有 footerReference → 跳过
            self.assertFalse(res2["footer"])

    def test_no_sectpr_no_footer(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            docx = td / "n.docx"
            with zipfile.ZipFile(docx, "w") as z:
                z.writestr("word/document.xml", '<w:document xmlns:w="x"><w:body/></w:document>')
            res = export.postprocess_bridge_docx(docx)
            self.assertFalse(res["footer"])


class TestTransientRetry(unittest.TestCase):
    """问题①：瞬时错误识别 + 重试（确定性错误不重试）。"""

    def test_transient_detection(self):
        self.assertTrue(export._is_transient_rpc_error(
            -32603, "SetDocDefaults failed: [-1]SetDocDefaults failed: document is not opened."))
        self.assertTrue(export._is_transient_rpc_error(
            -32603, "[-1]DocEditor::GetLastOperablePos: document is not open"))
        # 确定性错误 / 其他错误码 → 不重试。
        self.assertFalse(export._is_transient_rpc_error(-32603, "invalid parameter foo"))
        self.assertFalse(export._is_transient_rpc_error(-32602, "document is not open"))

    def test_rpc_retries_transient_then_succeeds(self):
        calls = {"n": 0}

        def fake_once(method, params=None):
            calls["n"] += 1
            if calls["n"] < 2:
                raise export.TransientBridgeError("boom")
            return {"ok": True}

        orig_once, orig_sleep = export._mcp_rpc_once, export.time.sleep
        export._mcp_rpc_once = fake_once
        export.time.sleep = lambda *_: None
        try:
            res = export._mcp_rpc("tools/call", {}, attempts=3)
        finally:
            export._mcp_rpc_once, export.time.sleep = orig_once, orig_sleep
        self.assertEqual(res, {"ok": True})
        self.assertEqual(calls["n"], 2)

    def test_rpc_gives_up_after_attempts(self):
        calls = {"n": 0}

        def fake_once(method, params=None):
            calls["n"] += 1
            raise export.TransientBridgeError("boom")

        orig_once, orig_sleep = export._mcp_rpc_once, export.time.sleep
        export._mcp_rpc_once = fake_once
        export.time.sleep = lambda *_: None
        try:
            with self.assertRaises(export.TransientBridgeError):
                export._mcp_rpc("tools/call", {}, attempts=3)
        finally:
            export._mcp_rpc_once, export.time.sleep = orig_once, orig_sleep
        self.assertEqual(calls["n"], 3)

    def test_rpc_no_retry_on_deterministic(self):
        calls = {"n": 0}

        def fake_once(method, params=None):
            calls["n"] += 1
            raise export.ExportError("deterministic")

        orig_once = export._mcp_rpc_once
        export._mcp_rpc_once = fake_once
        try:
            with self.assertRaises(export.ExportError):
                export._mcp_rpc("tools/call", {})
        finally:
            export._mcp_rpc_once = orig_once
        self.assertEqual(calls["n"], 1)


if __name__ == "__main__":
    unittest.main()
