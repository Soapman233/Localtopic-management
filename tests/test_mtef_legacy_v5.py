"""旧 ProgID 中真实 MTEF v5 的保守转换回归。"""
# ---------------------------------------------------------------------------
# title: 旧公式 v5 转换测试
# description: 真实 R_x 流验证 v5 内容、错误头与 v3 拒绝；扫描器按流版本分流且成功候选仍保留复核。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

import base64
import struct
import unittest
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pipeline import mtef_conv, docx_scan

# 来源：交付库复核 74 的 Equation Native（R_x），无外部文件依赖。
NATIVE = base64.b64decode('HAAAAAIAl8HaAAAAnAOwAFCGUgAAAAAAFACwAAUBAAYARFNNVDYAARNXaW5BbGxCYXNpY0NvZGVQYWdlcwARBVRpbWVzIE5ldyBSb21hbgARA1N5bWJvbAARBUNvdXJpZXIgTmV3ABEETVQgRXh0cmEAEgAIIS9Fj0QvQVD0EA9HX0FQ8h8eQVD0FQ9BAPRF9CX0j0JfQQD0EA9DX0EA9I9F9CpfSPSPQQD0EA9A9I9Bf0j0EA9BKl9EX0X0X0X0X0EPDAEAAQABAgICAgACAAEBAQADAAEABAAACgEAAgCDUgADABsAAAsBAAIAg3gAAAEBAAAA')

class TestLegacyV5(unittest.TestCase):
    def test_real_legacy_content(self):
        status,latex=mtef_conv._parse_strict_v5(NATIVE)
        self.assertEqual(status,'OK')
        self.assertEqual(latex,'R_{ x }')

    def test_truncation_and_declared_length_rejected(self):
        self.assertIsNone(mtef_conv.native_v5_payload(NATIVE[:-1]))
        wrong=bytearray(NATIVE);struct.pack_into('<I',wrong,8,1)
        self.assertIsNone(mtef_conv.native_v5_payload(wrong))

    def test_v3_not_fed_to_v5_parser(self):
        old=bytearray(NATIVE);old[28]=3
        self.assertEqual(mtef_conv._parse_strict_v5(old),('FAIL',None))

    def test_scanner_uses_stream_version_not_progid(self):
        p=ET.fromstring(f'<w:p xmlns:w="{docx_scan.W[1:-1]}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="{docx_scan.R[1:-1]}"><w:object><o:OLEObject ProgID="Equation.KSEE3" r:id="r1"/></w:object></w:p>')
        for version,expected in [(5,'PENDING'),(3,'UNSUPPORTED')]:
            native=bytearray(NATIVE);native[28]=version
            ctx={'embeddings/test.bin':native};formulas={}
            docx_scan._collect_runs(p,{'r1':{'target':'embeddings/test.bin'}},ctx,formulas,{},0)
            self.assertEqual(formulas['F1'].status,expected)
            self.assertEqual(bool(ctx.get('_pending')),version==5)

    def test_successful_legacy_parse_still_requires_visual_review(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'legacy.docx'
            with zipfile.ZipFile(path,'w') as z:
                z.writestr('word/document.xml',f'<w:document xmlns:w="{docx_scan.W[1:-1]}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="{docx_scan.R[1:-1]}"><w:body><w:p><w:object><o:OLEObject ProgID="Equation.3" r:id="r1"/></w:object></w:p></w:body></w:document>')
                z.writestr('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="embeddings/oleObject1.bin" Type="oleObject"/></Relationships>')
                z.writestr('word/embeddings/oleObject1.bin',b'dummy')
            with patch.object(docx_scan,'_equation_native',return_value=NATIVE),patch.object(mtef_conv,'convert_many',return_value=([{'status':'OK','latex':'R_x'}],0)) as convert:
                result=docx_scan.scan(path)
            self.assertEqual(result.formulas['F1'].status,'UNVERIFIED')
            self.assertTrue(result.formulas['F1'].needs_review)
            self.assertTrue(convert.call_args.kwargs['strict_v5'])

if __name__=='__main__':unittest.main()
