"""阶段1 题目切分缺陷修复的正反例测试。

覆盖：

* 正例（应被修复）：小数/章节号标题不再被当成题号；版头区块不参与切分。
* 反例（不能误伤）：以数字开头正文的真题、全角句点题号、半角点号题号后接汉字的真题，
  以及「题号 + 年份」开头的真题，都必须保留。
"""
# ---------------------------------------------------------------------------
# title: 切分修复测试
# description: 覆盖阶段1 切分修复：章节号伪题与表格数据块的识别。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import unittest

from pipeline.docx_scan import Paragraph, ScannedDoc
from pipeline import segment


def make_doc(texts: list[str], cells: list[bool] | None = None) -> ScannedDoc:
    """按给定文本构造一个最小的 ScannedDoc（无公式、无图片）。"""
    cells = cells or [False] * len(texts)
    paras = [Paragraph(index=i, text=t, is_table_cell=cells[i])
             for i, t in enumerate(texts)]
    return ScannedDoc(path="t.docx", paragraphs=paras, formulas={}, images={}, stats={})


def numbers(doc: ScannedDoc) -> list[str]:
    return [q.number for q in segment.segment(doc).questions]


class TestSegmentationFix(unittest.TestCase):
    def test_chapter_title_not_a_question(self):
        """文档标题 10.3探索更小的微粒 不能被切成第 10 题。"""
        doc = make_doc([
            "10.3探索更小的微粒",
            "学校:___________姓名：___________班级：___________考号：___________",
            "",
            "一、单选题",
            "1．下列微观粒子中，按空间尺度由大到小排列的是（　　）",
            "\tA．原子、原子核、质子\tB．质子、原子核、原子",
            "2．第二题",
        ])
        res = segment.segment(doc)
        self.assertEqual([q.number for q in res.questions], ["1", "2"])
        self.assertIn("10.3探索更小的微粒", res.unassigned_before_first)

    def test_three_part_chapter_title(self):
        """9.1.2固体压强的比较与计算 也要被识别为标题而非第 9 题。"""
        doc = make_doc(["9.1.2固体压强的比较与计算", "1.一个质量分布均匀的正方体", "2.第二题"])
        self.assertEqual(numbers(doc), ["1", "2"])

    def test_chapter_title_with_suffix(self):
        """标题较长（含教材版本后缀）时，位于头部也应跳过。"""
        doc = make_doc([
            "9.4浮力 课后练习题2024-2025学年物理苏科版八年级下册",
            "一、单选题",
            "1．体积相同的木块、铝块与铁块浸没于同一液体中",
        ])
        res = segment.segment(doc)
        self.assertEqual([q.number for q in res.questions], ["1"])

    def test_header_block_not_a_question(self):
        """版头行（学校/姓名/班级/考号）不参与切分。"""
        doc = make_doc(["学校:___姓名：___班级：___考号：___", "1．第一题"])
        res = segment.segment(doc)
        self.assertEqual([q.number for q in res.questions], ["1"])
        self.assertTrue(any("学校" in h for h in res.unassigned_before_first))

    def test_head_instruction_line_excluded(self):
        """头部的「考生须知」类行（含版头关键词且形似题号）仍不作为题目。"""
        doc = make_doc([
            "1．答题前，考生务必将姓名、班级填写在答题卡上",
            "2．第一道真正的题目",
        ])
        self.assertEqual(numbers(doc), ["2"])

    def test_header_words_inside_question_body_kept(self):
        """正文里含「学校」等版头关键词的真题不能被丢弃（版头判定只作用于头部）。

        回归：修复前 looks_like_header 全篇生效，下列真题被整段丢掉。
        """
        doc = make_doc([
            "1．第一题",
            "2．在清华大学校园内，张嘉奇等同学拍到“太空中的中国空间站”的照片",
            "3．如图，是学校塑胶跑道的一角，下列分析正确的是（　　）",
            "4．如图所示是学校运动会比赛的几个场景，下列说法正确的是（　　）",
            "5．（2025上·江苏连云港·九年级灌云县实验中学校考开学考试）探究二力平衡条件",
        ])
        self.assertEqual(numbers(doc), ["1", "2", "3", "4", "5"])

    def test_header_words_mid_document_without_number(self):
        """正文含「学校」但本身不是题号的段落，不能导致后续题目丢失。"""
        doc = make_doc([
            "1．第一题",
            "小铭在学校期间使用免洗洗手液消毒",
            "2．第二题",
        ])
        self.assertEqual(numbers(doc), ["1", "2"])

    # ---- 反例：不能误伤真题 ----

    def test_fullwidth_dot_question_with_leading_year(self):
        """1．2025年9月3日… 是全角句点题号，正文以年份开头，必须保留。"""
        doc = make_doc(["1．2025年9月3日，纪念抗战胜利80周年阅兵在首都举行", "2．第二题"])
        self.assertEqual(numbers(doc), ["1", "2"])

    def test_halfwidth_dot_question_with_chinese_body(self):
        """1.一个质量分布均匀… 是半角点号题号，点号后是汉字，必须保留。"""
        doc = make_doc(["1.一个质量分布均匀的正方体静止在水平地面上", "2.第二题"])
        self.assertEqual(numbers(doc), ["1", "2"])

    def test_halfwidth_dot_question_with_four_digit_year(self):
        """27.2018年5月13日… 是真题（题号 27 + 年份正文），章节号形状不成立，必须保留。"""
        doc = make_doc(["27.2018年5月13日，中国首艘国产航母001A型离港海试", "28.下一题"])
        self.assertEqual(numbers(doc), ["27", "28"])

    def test_dunhao_question_kept(self):
        """9、2023年… 顿号题号，正文以年份开头，必须保留。"""
        doc = make_doc(["9、2023年6月3日世界女排联赛中国女排取胜", "10、下一题"])
        self.assertEqual(numbers(doc), ["9", "10"])

    # ---- 可选的表格数值过滤 ----

    def test_table_numeric_default_off(self):
        """默认不开启时，表格里的纯数值行仍会（按旧行为）被当作题号。"""
        doc = make_doc(["1．题目一", "0.30", "2．题目二"],
                       cells=[False, True, False])
        self.assertEqual(numbers(doc), ["1", "0", "2"])

    def test_table_numeric_filter_on(self):
        """开启 FILTER_TABLE_NUMERIC 后，表格纯数值行被剔除。"""
        old = segment.FILTER_TABLE_NUMERIC
        segment.FILTER_TABLE_NUMERIC = True
        try:
            doc = make_doc(["1．题目一", "0.30", "2．题目二"],
                           cells=[False, True, False])
            self.assertEqual(numbers(doc), ["1", "2"])
        finally:
            segment.FILTER_TABLE_NUMERIC = old


if __name__ == "__main__":
    unittest.main()
