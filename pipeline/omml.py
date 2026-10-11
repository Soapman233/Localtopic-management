"""OMML (Office Math Markup Language) -> LaTeX.

Word/WPS store native equations as OMML inside word/document.xml.  To use one
canonical formula representation across all three import paths (native OMML,
MathType/MTEF, scanned PDF) we normalise everything to LaTeX.

Scope: the constructs that actually occur in K-12 physics papers.  Unknown
constructs degrade to their inner text rather than raising, so a single exotic
node can never abort a whole document.

This is a pure function module: no I/O, no global state.
"""
# ---------------------------------------------------------------------------
# title: OMML 解析与转换
# description: 解析 Word 原生公式 OMML，转换为 LaTeX 与可复用的公式表示。
# author: 待补充
# version: 0.1.0
# category: 阶段1-预处理
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Characters that MTEF/OMML carry literally but LaTeX must escape.
_ESCAPE = {
    "\\": r"\backslash ",
    "{": r"\{",
    "}": r"\}",
    "#": r"\#",
    "$": r"\$",
    "%": r"\%",
    "&": r"\&",
    "_": r"\_",
    "^": r"\^{}",
    "~": r"\~{}",
}

# MTEF/OMML encode CJK inside equations; keep them readable and searchable.
_CJK = re.compile(r"[\u3000-\u9fff\uff00-\uffef]")

# n-ary operators keyed by the chr attribute OMML stores.
_NARY = {
    "∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint",
    "∮": r"\oint", "⋃": r"\bigcup", "⋂": r"\bigcap", "⋁": r"\bigvee", "⋀": r"\bigwedge",
}

# Accent characters used by m:acc.
_ACCENT = {
    "̂": r"\hat", "̄": r"\bar", "̇": r"\dot", "̈": r"\ddot", "̃": r"\tilde",
    "̆": r"\breve", "̌": r"\check", "⃗": r"\vec", "̲": r"\underline", "̅": r"\overline",
    "́": r"\acute", "̀": r"\grave",
}

# Function names that must be upright and prefixed with a backslash.
_FUNCS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min",
    "det", "gcd", "deg", "arg", "Pr", "sup", "inf",
}


def _escape(text: str) -> str:
    """Escape LaTeX specials, but leave CJK untouched (wrapped by the caller)."""
    if not text:
        return ""
    if _CJK.search(text):
        # Keep CJK as literal text; escape only the non-CJK parts.
        parts = re.split(r"([\u3000-\u9fff\uff00-\uffef]+)", text)
        out = []
        for part in parts:
            if not part:
                continue
            if _CJK.search(part):
                out.append(r"\text{" + part + "}")
            else:
                out.append("".join(_ESCAPE.get(c, c) for c in part))
        return "".join(out)
    return "".join(_ESCAPE.get(c, c) for c in text)


def _attr(node, name, default=None):
    return node.get(M + name, default) if node is not None else default


def _children(node, tag):
    return [c for c in node if c.tag == M + tag]


def _first(node, tag):
    for c in node:
        if c.tag == M + tag:
            return c
    return None


def _val(node, prop, tag, default=None):
    """Read m:<prop>/m:<tag m:val="...">."""
    p = _first(node, prop) if node is not None else None
    if p is None:
        return default
    t = _first(p, tag)
    if t is None:
        return default
    return t.get(M + "val", default)


def _is_plain(node) -> bool:
    """m:rPr/m:sty val='p' means upright text (not italic variables)."""
    return _val(node, "rPr", "sty") == "p"


def _run(node) -> str:
    """A run: m:t text plus optional script styling."""
    text = "".join(t.text or "" for t in node.iter(M + "t"))
    if not text:
        return ""
    if _is_plain(node):
        return r"\mathrm{" + _escape(text) + "}" if not _CJK.search(text) else _escape(text)
    return _escape(text)


def _group(nodes) -> str:
    return "".join(convert(n) for n in nodes)


def _wrap(inner: str) -> str:
    return "{" + inner + "}" if len(inner) > 1 else inner


def convert(node) -> str:
    """Convert one OMML node (and its subtree) to LaTeX."""
    tag = node.tag

    if tag == M + "oMath" or tag == M + "oMathPara" or tag == M + "e" or tag == M + "num" \
            or tag == M + "den" or tag == M + "sub" or tag == M + "sup" or tag == M + "deg" \
            or tag == M + "fName" or tag == M + "lim" or tag == M + "box":
        return _group(list(node))

    if tag == M + "r":
        return _run(node)

    if tag == M + "t":
        return _escape(node.text or "")

    # --- fractions -------------------------------------------------------
    if tag == M + "f":
        num = _first(node, "num")
        den = _first(node, "den")
        n = convert(num) if num is not None else ""
        d = convert(den) if den is not None else ""
        ftype = _val(node, "fPr", "type")
        if ftype == "lin":
            return n + "/" + d
        if ftype == "noBar":
            return r"\binom{" + n + "}{" + d + "}"
        if ftype == "skw":
            return r"{}^{" + n + "}/_{" + d + "}"
        return r"\frac{" + n + "}{" + d + "}"

    # --- scripts ---------------------------------------------------------
    if tag in (M + "sSup", M + "sSub", M + "sSubSup"):
        base = _first(node, "e")
        b = _wrap(convert(base)) if base is not None else ""
        out = b
        sub = _first(node, "sub")
        sup = _first(node, "sup")
        if sub is not None:
            out += "_{" + convert(sub) + "}"
        if sup is not None:
            out += "^{" + convert(sup) + "}"
        return out

    if tag in (M + "preSubSup",):
        base = _first(node, "e")
        b = _wrap(convert(base)) if base is not None else ""
        out = b
        sub = _first(node, "sub")
        sup = _first(node, "sup")
        if sub is not None:
            out = "_{" + convert(sub) + "}" + out
        if sup is not None:
            out = "^{" + convert(sup) + "}" + out
        return out

    # --- radicals --------------------------------------------------------
    if tag == M + "rad":
        deg = _first(node, "deg")
        e = _first(node, "e")
        inner = convert(e) if e is not None else ""
        if deg is not None:
            d = convert(deg)
            if d:
                return r"\sqrt[" + d + "]{" + inner + "}"
        return r"\sqrt{" + inner + "}"

    # --- delimiters ------------------------------------------------------
    if tag == M + "d":
        beg = _val(node, "dPr", "begChr", "(")
        end = _val(node, "dPr", "endChr", ")")
        sep = _val(node, "dPr", "sepChr", "|")
        parts = [convert(e) for e in _children(node, "e")]
        inner = (" " + sep + " ").join(parts)
        lb = {"": ".", "{": r"\{", "(": "(", "[": "[", "|": "|", "‖": r"\|"}.get(beg, beg)
        rb = {"": ".", "}": r"\}", ")": ")", "]": "]", "|": "|", "‖": r"\|"}.get(end, end)
        return r"\left" + lb + inner + r"\right" + rb

    # --- n-ary (sum / integral) -----------------------------------------
    if tag == M + "nary":
        chr_ = _val(node, "naryPr", "chr", "∫")
        op = _NARY.get(chr_, r"\int")
        sub = _first(node, "sub")
        sup = _first(node, "sup")
        e = _first(node, "e")
        out = op
        if sub is not None:
            s = convert(sub)
            if s:
                out += "_{" + s + "}"
        if sup is not None:
            s = convert(sup)
            if s:
                out += "^{" + s + "}"
        if e is not None:
            out += " " + convert(e)
        return out

    # --- functions -------------------------------------------------------
    if tag == M + "func":
        name = _first(node, "fName")
        e = _first(node, "e")
        raw = "".join(t.text or "" for t in name.iter(M + "t")) if name is not None else ""
        fn = raw.strip()
        head = ("\\" + fn) if fn in _FUNCS else (r"\mathrm{" + _escape(fn) + "}" if fn else "")
        arg = convert(e) if e is not None else ""
        return head + _wrap(arg) if arg else head

    # --- accents / bars / group chars -----------------------------------
    if tag == M + "acc":
        e = _first(node, "e")
        chr_ = _val(node, "accPr", "chr", "̂")
        cmd = _ACCENT.get(chr_, r"\hat")
        return cmd + "{" + (convert(e) if e is not None else "") + "}"

    if tag == M + "bar":
        e = _first(node, "e")
        pos = _val(node, "barPr", "pos", "top")
        cmd = r"\underline" if pos == "bot" else r"\overline"
        return cmd + "{" + (convert(e) if e is not None else "") + "}"

    if tag == M + "groupChr":
        e = _first(node, "e")
        chr_ = _val(node, "groupChrPr", "chr", "⏟")
        cmd = {r"⏟": r"\underbrace", r"⏞": r"\overbrace", r"⏜": r"\widehat",
               r"⏝": r"\widetilde"}.get(chr_, r"\underbrace")
        return cmd + "{" + (convert(e) if e is not None else "") + "}"

    # --- limits ----------------------------------------------------------
    if tag in (M + "limLow", M + "limUpp"):
        e = _first(node, "e")
        lim = _first(node, "lim")
        base = _wrap(convert(e)) if e is not None else ""
        l = convert(lim) if lim is not None else ""
        if tag == M + "limLow":
            if base.startswith(r"\lim") or base.startswith(r"\sum") or base.startswith(r"\int"):
                return base + "_{" + l + "}"
            return r"\underset{" + l + "}{" + base + "}"
        if base.startswith(r"\lim") or base.startswith(r"\sum") or base.startswith(r"\int"):
            return base + "^{" + l + "}"
        return r"\overset{" + l + "}{" + base + "}"

    # --- matrices --------------------------------------------------------
    if tag == M + "m":
        rows = []
        for mr in _children(node, "mr"):
            rows.append(" & ".join(convert(e) for e in _children(mr, "e")))
        beg = _val(node, "mPr", "begChr", "(")
        end = _val(node, "mPr", "endChr", ")")
        env = {("(", ")"): "pmatrix", ("[", "]"): "bmatrix", ("|", "|"): "vmatrix",
               ("{", "}"): "Bmatrix", ("", ""): "matrix"}.get((beg, end), "matrix")
        return r"\begin{" + env + "}" + r" \\ ".join(rows) + r"\end{" + env + "}"

    # --- fallback: keep the text, never lose content ---------------------
    text = "".join(t.text or "" for t in node.iter(M + "t"))
    return _escape(text)


def omath_to_latex(omath_node) -> str:
    """Convert a single m:oMath element to a LaTeX string (no delimiters)."""
    latex = convert(omath_node)
    latex = re.sub(r"\s+", " ", latex).strip()
    return latex


def omath_para_to_latex(omath_para_node) -> str:
    """Convert m:oMathPara (display equation) to LaTeX."""
    parts = [omath_to_latex(o) for o in _children(omath_para_node, "oMath")]
    return " ".join(p for p in parts if p)
