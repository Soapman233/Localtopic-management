"""私有字形根因、已知空白与未知字符降级回归。"""
# ---------------------------------------------------------------------------
# title: 私有字形清洗测试
# description: 真实 EF01 流验证空映射不再回退；直接/转义/幂等/未知字形/中文回归及无图导出页脚命名空间反例。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

import unittest
import xml.etree.ElementTree as ET
from bank import latexnorm,export
from pipeline import mtef_conv
from tests.test_mtef_legacy_v5 import NATIVE


class TestPrivateGlyphs(unittest.TestCase):
    def test_pure_formula_export_footer_declares_relationship_prefix(self):
        xml=b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sectPr/></w:body></w:document>'
        items={'word/document.xml':(None,xml)}
        export._inject_page_number_footer(items)
        root=ET.fromstring(items['word/document.xml'][1])
        ref=root.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footerReference')
        self.assertEqual(ref.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'],'rIdFooterPageNum')

    def test_empty_vendor_mapping_does_not_emit_unknown(self):
        # R_x 流内 R 字符改成已在 chars 表登记为空的 EF01；长度不变。
        original=NATIVE.replace(bytes.fromhex('0200835200'),bytes.fromhex('02008301ef'))
        self.assertNotEqual(original,NATIVE)
        status,latex=mtef_conv._parse_strict_v5(original)
        self.assertEqual(status,'OK')
        self.assertNotIn('\uef01',latex)
        self.assertNotIn('[U+',latex)

    def test_known_spacing_and_encoded_forms(self):
        for glyph in ['\uef01','[U+ef01]','[U+EF01]']:
            s=export.sanitize_latex('p_{甲}'+r'{\text{'+glyph+r'}}>p_{乙}')
            self.assertNotIn('\uef01',s)
            self.assertNotIn(r'\text{}',s)
            self.assertEqual(export.sanitize_latex(s),s)
            self.assertIn('p_{甲}',s)

    def test_unknown_remains_visible_and_warned(self):
        raw=r'\text{'+chr(0xef0a)+'}h'
        self.assertEqual(latexnorm.unknown_private_glyphs(raw),['U+EF0A'])
        self.assertIn('□',export.sanitize_latex(raw))
        ctx={'qid':3429,'warnings':[],'formulas':0}
        lines=export.text_to_lines('⟦F32⟧',{'F32':raw},ctx)
        self.assertIn('□',str(lines))
        self.assertIn('U+EF0A',ctx['warnings'][0])

    def test_chinese_and_replacement_regression(self):
        result=export.sanitize_latex(r'\rho_{\text{[U+6c34]}}+\text{�}')
        self.assertEqual(result,r'\rho_{\text{水}}+\text{□}')
        self.assertNotIn(r'\text{\text',result)
