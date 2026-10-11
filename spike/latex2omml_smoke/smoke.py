# -*- coding: utf-8 -*-
"""冒烟测试：用真实语料样本验证 bank.latex2omml。

样本取自 outputs/handoff/R-公式符号频次.md 第五节「最复杂 Top-10 公式」，
覆盖：Mathtype 空格风格 / OMML 紧凑风格 / 深层嵌套 / 损坏字符 / 中文。
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bank.latex2omml import latex_to_omath, latex_to_omml  # noqa: E402

M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"

CASES: list[tuple[str, str]] = [
    ("简单上标", "E=mc^2"),
    ("简单下标", "v=v_0+at"),
    ("分式", r"\rho=\frac{m}{V}"),
    ("上下标并存", "x_i^2"),
    ("根号", r"\sqrt{a^2+b^2}"),
    ("正体包裹(mathrm)", r"\mathrm{=}\frac{\mathrm{m}}{\mathrm{V}}"),
    ("中文 text", r"\rho_{\text{水}}"),
    ("自适应定界", r"\left(h_2-h_1\right)"),
    ("重音", r"\tilde{x}"),
    ("Mathtype 空格风格", r"\frac { F_{ { \rm{ A } } } } { F_{ { \rm{ B } } } }=\rho _{ { \rm{ A } } } { \rm{ \Delta } }V_{ { \rm{ A } } } g"),
    ("OMML 紧凑风格", r"\mathrm{=}\frac{\mathrm{m}}{\mathrm{V}}\mathrm{=}\frac{{\mathrm{ρ}}_{\text{水}}\mathrm{g(}{\mathrm{h}}_{\mathrm{2}}\mathrm{−}{\mathrm{h}}_{\mathrm{1}}\mathrm{)}}{\mathrm{g(}{\mathrm{h}}_{\mathrm{3}}\mathrm{−}{\mathrm{h}}_{\mathrm{1}}\mathrm{)}}"),
    ("深层嵌套(depth=6)", r"h=\frac { V_{ {\text{排}}{\text{管}} } } { S }=\frac { 4\times 10 ^ { -6 } { \rm{ m } } ^ { 3 } -\left ( { { \rm{ 0 } }{ \rm{ . } }{ \rm{ 0 } }{ \rm{ 1 } }{ \rm{ 8 } }{ \rm{ m } }\times S-\frac { \rho _{ {\text{水}} } S\times 0.01{ \rm{ m } } } { \rho _{ {\text{饮}}{\text{料}} } } } \right ) } { S }"),
    ("损坏字符 U+FFFD", "p_{2}^{\ufffd}=\\frac{F''}{S_{A}}"),
    ("未知命令降级", r"\xrightarrow{abc}\unknowncmd{x}"),
    ("空输入", ""),
    ("孤立花括号", "}{a}{"),
]


def main() -> int:
    print(f"{'用例':<20} {'OMML长度':>9} {'m:oMath':>8} {'可解析':>7}  结论")
    print("-" * 72)
    all_ok = True
    for name, latex in CASES:
        omml = latex_to_omml(latex)
        omath = latex_to_omath(latex)
        # 关键校验：生成的片段必须能作为合法 XML 解析
        parseable = True
        try:
            ET.fromstring(f'<m:oMath xmlns:m="{M[1:-1]}">{omml}</m:oMath>')
        except ET.ParseError as exc:
            parseable = False
            print(f"  !! XML 解析失败: {exc}")
        n_omath = omath.count("<m:oMath>")
        ok = parseable and (n_omath == 1 or not latex)
        all_ok &= ok
        print(f"{name:<20} {len(omml):>9} {n_omath:>8} {str(parseable):>7}  {'PASS' if ok else 'FAIL'}")

    print("-" * 72)
    print(f"总计：{'全部通过' if all_ok else '存在失败'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
