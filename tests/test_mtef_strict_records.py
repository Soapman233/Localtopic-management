"""严格v5规范字段与缺损反例；普通转换继续保留原行为。"""
# ---------------------------------------------------------------------------
# title: 严格v5记录兼容测试
# description: 短长与截断nudge、FONT_STYLE_DEF边界、左右括号和缺损反例，确认普通路径不开启兼容。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------
import contextlib
import io
import struct
import unittest
from pipeline import mtef_conv
from mtef_py.mtef import MTEF
from mtef_py.record import MtAST, MtTmpl, RecordType, SelectorType


class TestStrictRecords(unittest.TestCase):
    def parser(self, data=b''):
        parser = MTEF()
        parser.strict_compat = True
        parser.reader = io.BytesIO(data)
        return parser

    def test_short_nudge_keeps_following_record(self):
        parser = self.parser(b'\x80\xe0\x02')
        self.assertEqual(parser.readNudge(), (0, 96, None))
        self.assertEqual(parser.reader.read(), b'\x02')
        self.assertEqual(self.parser(b'\x00\xff').readNudge(), (-128, 127, None))

    def test_long_nudge_signed_and_boundary(self):
        parser = self.parser(b'\x80\x80' + struct.pack('<hh', -32768, 32767) + b'X')
        self.assertEqual(parser.readNudge(), (-32768, 32767, None))
        self.assertEqual(parser.reader.read(), b'X')

    def test_truncated_nudge_is_rejected(self):
        for data in (b'', b'\x80', b'\x80\x80', b'\x80\x80\x00\x00\x01'):
            with self.subTest(data=data), self.assertRaises(EOFError):
                self.parser(data).readNudge()

    def test_style_byte_does_not_swallow_next_char(self):
        header = bytes([5, 0, 0, 0, 0, 0, 0])
        for style in (0, 2, 255):
            # 定义后立即跟CHAR 'x'，非零style不能吞掉CHAR头里的零字节。
            data = header + bytes([8, 2, style, 2, 0, 131, 120, 0, 0])
            parser = self.parser(data)
            with contextlib.redirect_stdout(io.StringIO()):
                parser.readRecord()
            chars = [node.value.mtcode for node in parser.nodes if node.tag == RecordType.CHAR]
            self.assertEqual(chars, [120])
            self.assertTrue(parser.Valid)
        with self.assertRaises(EOFError), contextlib.redirect_stdout(io.StringIO()):
            self.parser(header + b'\x08\x02').readRecord()

    def fence(self, variation, values):
        parser = self.parser()
        tmpl = MtTmpl()
        tmpl.selector = SelectorType.tmPAREN
        tmpl.variation = variation
        ast = MtAST(RecordType.TMPL, tmpl, values)
        original = parser.makeLatex
        parser.makeLatex = lambda node: (node, None) if isinstance(node, str) else original(node)
        return parser.makeLatex(ast)[0]

    def test_fences_follow_declared_sides(self):
        self.assertEqual(self.fence(1, ['x', '(']), r'\left( x\right.')
        self.assertEqual(self.fence(2, ['x', ')']), r'\left. x\right)')
        self.assertEqual(self.fence(3, ['x', '(', ')']), r'\left( x\right)')

    def test_broken_fences_are_not_filled(self):
        for variation, values in [(1, ['x']), (3, ['x', '(']), (1, ['x', '']), (2, ['x', '(', ')'])]:
            with self.subTest(variation=variation, values=values), self.assertRaises(ValueError):
                self.fence(variation, values)

    def test_ordinary_path_compat_is_off(self):
        self.assertFalse(MTEF().strict_compat)


if __name__ == '__main__':
    unittest.main()
