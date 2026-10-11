"""LaTeX -> OMML (Office Math Markup Language)。

与 :mod:`pipeline.omml` 互为逆运算：那里把 Word 原生公式（OMML）读成 LaTeX，
这里把 LaTeX 写回 OMML，供**自研 DOCX 生成器**使用。

为什么需要它
------------
原导出链路依赖 ``editor_sdk``（WorkBuddy 宿主提供的本地 MCP 服务）完成
LaTeX→OMML。该服务**不可随客户端分发**，因此「便携 + 轻量」路线必须自研本模块。

覆盖范围（由真实语料统计决定，见 ``outputs/handoff/R-公式符号频次.md``）
------------------------------------------------------------------------
全库 17,639 条公式只出现 35 种 LaTeX 命令。本模块覆盖 **Top-15** 命令：

    \\rm \\text \\frac \\mathrm \\times \\rho \\Omega \\Delta \\left \\right
    \\circ \\cdot \\prime \\approx \\eta \\tilde \\sqrt

按「式子完整覆盖」口径可让 **≥99%** 的式子零遗漏；其余长尾命令降级处理。

设计约束
--------
* **纯函数模块**：无 I/O、无全局状态、不依赖第三方库（仅标准库 ``re``）。
* **永不抛异常**：任何未识别/损坏输入都降级为文本，保证不中断整卷导出
  （历史教训：一个异常节点曾导致整卷导出中断）。
* 输出为 **OMML 片段**，可直接嵌入 ``word/document.xml`` 的 ``<m:oMath>``。
"""
# ---------------------------------------------------------------------------
# title: LaTeX 转 OMML
# description: 把题库中的 LaTeX 公式写回 Word 原生公式（OMML），供自研 DOCX 生成器使用；纯函数、无第三方依赖、永不抛异常。
# author: 待补充
# version: 0.1.0
# category: 阶段4-导出
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
import xml.sax.saxutils as _sax

__all__ = ["latex_to_omml", "latex_to_omath", "LATEX2OMML_VERSION"]

LATEX2OMML_VERSION = "0.1.0"

# --------------------------------------------------------------------------- #
# 符号表：LaTeX 命令 -> Unicode 字符（放入 m:t，由 Word 按数学字体渲染）
# --------------------------------------------------------------------------- #
_SYMBOLS: dict[str, str] = {
    # 运算符
    "times": "×", "cdot": "⋅", "centerdot": "⋅", "ast": "∗",
    "circ": "∘", "prime": "′", "approx": "≈", "sim": "∼",
    "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
    "ne": "≠", "neq": "≠", "equiv": "≡", "propto": "∝",
    "parallel": "∥", "perp": "⊥", "pm": "±", "mp": "∓",
    "cdots": "⋯", "ldots": "…", "dots": "…", "therefore": "∴", "because": "∵",
    "to": "→", "rightarrow": "→", "leftarrow": "←", "Rightarrow": "⇒",
    "in": "∈", "infty": "∞", "angle": "∠", "triangle": "△", "deg": "°",
    # 希腊字母（小写）
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "varepsilon": "ε", "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι",
    "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ",
    "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ",
    "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    # 希腊字母（大写）
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
    "Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ",
    "Omega": "Ω",
}

# 字体/文本包裹命令：内容以「正体」呈现（m:rPr/m:sty val="p"）
_UPRIGHT_CMDS = {"rm", "mathrm", "text", "mbox", "operatorname"}

# 间距命令：映射为空白（薄空格用普通空格近似，避免依赖 Word 的 m:spacing 细节）
_SPACES = {" ": " ", ",": "", "!": "", ";": " ", ":": " ", "quad": "  ", "qquad": "    "}

# 需转义为字面量的命令
_LITERALS = {"%": "%", "_": "_", "#": "#", "&": "&", "$": "$", "{": "{", "}": "}",
             "backslash": "\\", "~": "~", "^": "^"}

# 自适应定界符：\left X ... \right Y 的字符映射
_DELIMS = {
    "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", ".": "",
    "\\{": "{", "\\}": "}", "\\|": "‖", "\\lbrace": "{", "\\rbrace": "}",
}

# 重音命令 -> OMML accPr/chr
_ACCENTS = {
    "hat": "\u0302", "widehat": "\u0302", "bar": "\u0304", "overline": "\u0305",
    "dot": "\u0307", "ddot": "\u0308", "tilde": "\u0303", "widetilde": "\u0303",
    "vec": "\u20d7", "breve": "\u0306", "check": "\u030c",
    "acute": "\u0301", "grave": "\u0300", "underline": "\u0332",
}

# 损坏/脏字符：直接丢弃（见频次报告 4.4）
_DIRTY = {"\u200b", "\u0ba2"}

_TOKEN_RE = re.compile(
    r"(?P<cmd>\\[A-Za-z]+)"      # \frac / \rm
    r"|(?P<esym>\\[^A-Za-z])"     # \  \, \% \! \_ \{ \}
    r"|(?P<brace>[{}])"
    r"|(?P<script>[\^_])"
    r"|(?P<char>[\s\S])"
)


def _esc(text: str) -> str:
    """XML 转义（OMML 文本节点）。"""
    return _sax.escape(text, {'"': "&quot;"})


def _run(text: str, upright: bool = False) -> str:
    """生成一个 ``m:r``；``upright=True`` 时用正体（m:sty val="p"）。"""
    if not text:
        return ""
    pr = '<m:rPr><m:sty m:val="p"/></m:rPr>' if upright else ""
    return f"<m:r>{pr}<m:t>{_esc(text)}</m:t></m:r>"


def _join(nodes: list[str]) -> str:
    return "".join(n for n in nodes if n)


#: 匹配「尚未带 rPr 的 m:r」，用于批量标为正体。
_UPRIGHT_RUN_RE = re.compile(r"<m:r>(?!<m:rPr>)")


def _uprightify(omml: str) -> str:
    """把 OMML 片段中所有未带 ``rPr`` 的 ``m:r`` 标为**正体**（``m:sty val="p"``）。

    用于 ``\\rm`` / ``\\mathrm`` / ``\\text``：它们的内容应直立显示，但内容本身
    可能包含分式、上下标等结构，故先正常解析、再统一改字体。
    """
    return _UPRIGHT_RUN_RE.sub('<m:r><m:rPr><m:sty m:val="p"/></m:rPr>', omml)


# --------------------------------------------------------------------------- #
# 词法与语法
# --------------------------------------------------------------------------- #
def _tokenize(src: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in _TOKEN_RE.finditer(src):
        kind = m.lastgroup or "char"
        out.append((kind, m.group()))
    return out


class _Parser:
    """递归下降解析器；任何异常都被 ``latex_to_omml`` 兜底捕获。"""

    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.toks = tokens
        self.i = 0

    # -- 基础操作 ---------------------------------------------------------- #
    def peek(self) -> tuple[str, str] | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def next(self) -> tuple[str, str] | None:
        t = self.peek()
        if t is not None:
            self.i += 1
        return t

    # -- 行：解析到 } 或结尾 ------------------------------------------------- #
    def skip_ws(self) -> None:
        """跳过纯空白 token。

        LaTeX 数学模式中空白不显著（``x ^ 2`` 等价 ``x^2``）。MathType 风格的
        LaTeX 会在 ``} ^ {`` 之间插入空格，若不跳过，``^`` 会错误地绑定到空格上
        ——这是实现期实测发现的真实缺陷。
        """
        while True:
            t = self.peek()
            if t is not None and t[0] == "char" and t[1].isspace():
                self.i += 1
            else:
                return

    def parse_row(self, stop_at_brace: bool = False) -> list[str]:
        nodes: list[str] = []
        while True:
            self.skip_ws()
            t = self.peek()
            if t is None:
                break
            kind, val = t
            if kind == "brace" and val == "}":
                if stop_at_brace:
                    break
                self.next()          # 多余的 } 直接丢弃
                continue
            node = self.parse_atom()
            if node is None:
                break
            if node:
                nodes.append(node)
        return nodes

    # -- 原子：基础单元 + 可选的上下标 --------------------------------------- #
    def parse_atom(self) -> str | None:
        self.skip_ws()
        base = self.parse_base()
        if base is None:
            return None

        sub: str | None = None
        sup: str | None = None
        while True:
            self.skip_ws()
            t = self.peek()
            if t is None or t[0] != "script":
                break
            self.next()
            arg = self.parse_script_arg()
            if t[1] == "^":
                sup = arg
            else:
                sub = arg

        if sub is None and sup is None:
            return base
        if sub is not None and sup is not None:
            return f"<m:sSubSup><m:e>{base}</m:e><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup></m:sSubSup>"
        if sup is not None:
            return f"<m:sSup><m:e>{base}</m:e><m:sup>{sup}</m:sup></m:sSup>"
        return f"<m:sSub><m:e>{base}</m:e><m:sub>{sub}</m:sub></m:sSub>"

    def parse_script_arg(self) -> str:
        """``^``/``_`` 之后：``{...}`` 或**单个基**。

        注意：无花括号时只能取 ``parse_base()``，**不能用 ``parse_atom()``**——
        后者会贪婪吞掉紧随其后的 ``^``/``_``，使 ``x_i^2`` 错成
        ``sSub(x, sSup(i,2))`` 而不是 ``sSubSup(x,i,2)``（单元测试发现的真实缺陷）。
        """
        self.skip_ws()
        t = self.peek()
        if t is not None and t[0] == "brace" and t[1] == "{":
            self.next()
            inner = self.parse_row(stop_at_brace=True)
            self.expect_close()
            return _join(inner)
        node = self.parse_base()
        return node or ""

    def expect_close(self) -> None:
        t = self.peek()
        if t is not None and t[0] == "brace" and t[1] == "}":
            self.next()

    def parse_group(self) -> str:
        """解析一个 ``{...}`` 组，返回其 OMML 片段（调用方保证当前是 ``{``）。"""
        self.next()  # 吃掉 {
        inner = self.parse_row(stop_at_brace=True)
        self.expect_close()
        return _join(inner)

    # -- 基础单元 ---------------------------------------------------------- #
    def parse_base(self) -> str | None:  # noqa: C901 - 分支多但线性
        t = self.next()
        if t is None:
            return None
        kind, val = t

        if kind == "brace":
            if val == "{":
                self.i -= 1
                return self.parse_group()
            return ""  # 孤立的 }

        if kind == "script":          # 无基底的 ^ / _ ：降级为字面量
            return _run(val)

        if kind == "char":
            ch = val
            if ch in _DIRTY:
                return ""
            if ch == "\ufffd":        # 损坏字符 -> 占位
                return _run("\ufffd")
            if ch.isspace():
                return _run(" ") if ch != "\n" else ""
            return _run(ch)

        # 命令 / 转义符号
        name = val[1:] if kind == "cmd" else val[1:]

        # 结构命令
        if kind == "cmd":
            if name in ("frac", "dfrac", "tfrac"):
                num = self._braced_group()
                den = self._braced_group()
                return f"<m:f><m:num>{num}</m:num><m:den>{den}</m:den></m:f>"

            if name == "sqrt":
                deg = ""
                p = self.peek()
                if p is not None and p[0] == "char" and p[1] == "[":
                    deg = self._bracket_group()
                body = self._braced_group()
                if deg:
                    return (f"<m:rad><m:deg>{deg}</m:deg>"
                            f"<m:e>{body}</m:e></m:rad>")
                return (f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr>'
                        f"<m:deg/><m:e>{body}</m:e></m:rad>")

            if name == "left":
                return self._delimiter()

            if name in _UPRIGHT_CMDS:
                # 注意：``\rm{...}`` 的内容**可能含结构**，不能当纯文本读。
                # 真实语料里出现过 ``{ \rm{ {}^\text{3} } }``（\rm 里嵌上标），
                # 故必须正常解析内容，再把结果中的 run 统一标为正体。
                return _uprightify(self._braced_group())

            if name in _ACCENTS:
                body = self._braced_group()
                return (f'<m:acc><m:accPr><m:chr m:val="{_esc(_ACCENTS[name])}"/>'
                        f"</m:accPr><m:e>{body}</m:e></m:acc>")

            if name in ("overline", "underline"):  # 已在 _ACCENTS 内，此处不可达
                return ""

            if name in _SYMBOLS:
                return _run(_SYMBOLS[name])

            if name in _SPACES:
                return _run(_SPACES[name]) if _SPACES[name] else ""

            if name in _LITERALS:
                return _run(_LITERALS[name])

            # 未知命令：降级为「命令名」文本，绝不中断
            return _run(name)

        # 转义符号（\  \, \% 等）
        if name in _SPACES:
            return _run(_SPACES[name]) if _SPACES[name] else ""
        if name in _LITERALS:
            return _run(_LITERALS[name])
        return _run(name)

    # -- 辅助 -------------------------------------------------------------- #
    def _braced_group(self) -> str:
        """取一个 ``{...}``；若下一个不是 ``{`` 则取单个原子（容错）。"""
        t = self.peek()
        if t is not None and t[0] == "brace" and t[1] == "{":
            return self.parse_group()
        node = self.parse_atom()
        return node or ""

    def _bracket_group(self) -> str:
        """取 ``[...]``（用于 ``\\sqrt[n]{x}``）。"""
        self.next()  # [
        buf: list[str] = []
        while True:
            t = self.peek()
            if t is None:
                break
            if t[0] == "char" and t[1] == "]":
                self.next()
                break
            node = self.parse_atom()
            if node is None:
                break
            buf.append(node)
        return _join(buf)

    def _delimiter(self) -> str:
        """``\\left X ... \\right Y`` -> ``m:d``。"""
        beg = self._delim_char()
        body: list[str] = []
        while True:
            t = self.peek()
            if t is None:
                break
            if t[0] == "cmd" and t[1] == "\\right":
                self.next()
                break
            node = self.parse_atom()
            if node is None:
                break
            body.append(node)
        end = self._delim_char()
        return (f'<m:d><m:dPr><m:begChr m:val="{_esc(beg)}"/>'
                f'<m:endChr m:val="{_esc(end)}"/></m:dPr>'
                f"<m:e>{_join(body)}</m:e></m:d>")

    def _delim_char(self) -> str:
        t = self.peek()
        if t is None:
            return ""
        kind, val = t
        if kind == "char":
            self.next()
            return _DELIMS.get(val, val)
        if kind in ("cmd", "esym"):
            self.next()
            return _DELIMS.get(val, "")
        return ""


# --------------------------------------------------------------------------- #
# 公开 API
# --------------------------------------------------------------------------- #
def latex_to_omml(latex: str) -> str:
    """LaTeX -> OMML **片段**（不含 ``<m:oMath>`` 外壳）。

    * 空输入返回空串；
    * 任何内部异常都降级为「把原 LaTeX 当文本输出」，**绝不抛出**。
    """
    if not latex:
        return ""
    src = latex.replace("\r", " ").replace("\n", " ")
    try:
        tokens = _tokenize(src)
        nodes = _Parser(tokens).parse_row(stop_at_brace=False)
        return _join(nodes)
    except Exception:  # noqa: BLE001 - 兜底：宁可降级为文本，也不能中断整卷
        return _run(src)


def latex_to_omath(latex: str) -> str:
    """LaTeX -> 完整的 ``<m:oMath>`` 元素（可直接嵌入 ``w:p``）。"""
    inner = latex_to_omml(latex)
    if not inner:
        return ""
    return f"<m:oMath>{inner}</m:oMath>"
