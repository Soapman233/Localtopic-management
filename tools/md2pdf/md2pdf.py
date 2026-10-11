# -*- coding: utf-8 -*-
"""
Markdown -> PDF（经 HTML + Word COM），面向中文长报告。

链路：.md -> 自建解析器 -> 带打印样式的 .html -> Word 打开 -> ExportAsFixedFormat(PDF)

无第三方依赖（仅需 pywin32，项目 kb venv 已具备）。
用法：
    python md2pdf.py <input.md> <output.pdf> [--html-out <path>] [--title <标题>]
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------- #
# 行内解析
# --------------------------------------------------------------------------- #
_CODE_RE = re.compile(r"`([^`]+)`")
_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
# 纯锚点链接（如目录的 [引言](#引言)）：PDF 中无对应 id，降级为纯文本
_ANCHOR_RE = re.compile(r"\[([^\]]+)\]\(#[^)]*\)")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")


def inline(text: str) -> str:
    """转义 HTML 后处理行内语法。顺序重要：先转义，再套标签。"""
    out = html.escape(text, quote=False)
    # 用占位符保护代码段，避免其内部被后续规则改写
    slots: list[str] = []

    def _stash(m: re.Match) -> str:
        slots.append(f"<code>{m.group(1)}</code>")
        return f"\x00{len(slots) - 1}\x00"

    out = _CODE_RE.sub(_stash, out)
    out = _ANCHOR_RE.sub(r"\1", out)
    out = _LINK_RE.sub(
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>', out
    )
    out = _BOLD_RE.sub(r"<strong>\1</strong>", out)
    out = _ITALIC_RE.sub(r"<em>\1</em>", out)
    out = re.sub(r"\x00(\d+)\x00", lambda m: slots[int(m.group(1))], out)
    return out


# --------------------------------------------------------------------------- #
# 块级解析
# --------------------------------------------------------------------------- #
_H_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_UL_RE = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_OL_RE = re.compile(r"^(\s*)\d+[.)]\s+(.*)$")
_HR_RE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def convert(md_text: str) -> str:
    lines = md_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        # 空行
        if not line.strip():
            i += 1
            continue

        # 水平线
        if _HR_RE.match(line):
            out.append("<hr/>")
            i += 1
            continue

        # 标题
        m = _H_RE.match(line)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2).strip())}</h{lvl}>")
            i += 1
            continue

        # 表格：当前行含 | 且下一行是分隔行
        if "|" in line and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1]):
            header = _split_row(line)
            i += 2
            body: list[list[str]] = []
            while i < n and "|" in lines[i] and lines[i].strip():
                body.append(_split_row(lines[i]))
                i += 1
            out.append("<table>")
            out.append("<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in header) + "</tr></thead>")
            if body:
                out.append("<tbody>")
                for row in body:
                    cells = "".join(f"<td>{inline(c)}</td>" for c in row)
                    out.append(f"<tr>{cells}</tr>")
                out.append("</tbody>")
            out.append("</table>")
            continue

        # 引用块
        if line.lstrip().startswith(">"):
            buf: list[str] = []
            while i < n and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            out.append("<blockquote>" + "<br/>".join(inline(b) for b in buf) + "</blockquote>")
            continue

        # 无序列表（不用 <ul>：Word 对 <ul> 的默认缩进过大且难覆盖，
        # 改用「悬挂缩进段落」精确控制）
        if _UL_RE.match(line):
            while i < n and _UL_RE.match(lines[i]):
                out.append(f'<p class="li">\u2022\u2003{inline(_UL_RE.match(lines[i]).group(2))}</p>')
                i += 1
            continue

        # 有序列表
        if _OL_RE.match(line):
            k = 1
            while i < n and _OL_RE.match(lines[i]):
                out.append(f'<p class="li">{k}.\u2003{inline(_OL_RE.match(lines[i]).group(2))}</p>')
                k += 1
                i += 1
            continue

        # 段落（连续非空行合并）
        buf = [line]
        i += 1
        while i < n and lines[i].strip() and not (
            _H_RE.match(lines[i])
            or _HR_RE.match(lines[i])
            or lines[i].lstrip().startswith(">")
            or _UL_RE.match(lines[i])
            or _OL_RE.match(lines[i])
            or ("|" in lines[i] and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1]))
        ):
            buf.append(lines[i])
            i += 1
        out.append("<p>" + "<br/>".join(inline(b) for b in buf) + "</p>")

    return "\n".join(out)


# --------------------------------------------------------------------------- #
# 打印样式（中文字体优先）
# --------------------------------------------------------------------------- #
CSS = """
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
body {
  font-family: "Microsoft YaHei", "微软雅黑", "SimSun", "宋体", sans-serif;
  font-size: 10.5pt; line-height: 1.75; color: #1a1a1a; margin: 0;
}
h1 { font-size: 20pt; line-height: 1.4; margin: 0 0 6pt 0; color: #111; }
h2 { font-size: 15pt; margin: 22pt 0 8pt 0; padding-bottom: 4pt;
     border-bottom: 1px solid #d0d0d0; color: #111; page-break-after: avoid; }
h3 { font-size: 12.5pt; margin: 16pt 0 6pt 0; color: #1a1a1a; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 12pt 0 4pt 0; color: #333; page-break-after: avoid; }
p  { margin: 0 0 8pt 0; text-align: justify; }
p.li { margin: 0 0 4pt 0; padding-left: 20pt; text-indent: -20pt; text-align: left; }
a  { color: #1a5fb4; text-decoration: none; word-break: break-all; }
strong { font-weight: 600; color: #000; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt;
       background: #f4f4f4; padding: 0 2px; }
hr { border: none; border-top: 1px solid #dcdcdc; margin: 16pt 0; }
ul, ol { margin: 0 0 8pt 0; padding-left: 16pt; }
li { margin: 0 0 4pt 0; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #f7f7f7;
             border-left: 3px solid #c0c0c0; color: #333; font-size: 10pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0 12pt 0;
        font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #c8c8c8; padding: 4pt 6pt; text-align: left;
         vertical-align: top; word-break: break-word; }
th { background: #f0f0f0; font-weight: 600; }
"""

HTML_TMPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>{title}</title>
<style>{css}</style>
</head>
<body>
{body}
</body>
</html>
"""


def build_html(md_path: Path, title: str) -> str:
    md_text = md_path.read_text(encoding="utf-8")
    return HTML_TMPL.format(title=html.escape(title), css=CSS, body=convert(md_text))


def html_to_pdf(html_path: Path, pdf_path: Path) -> None:
    import win32com.client as win32  # 延迟导入，便于单独测试 convert()

    word = win32.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = None
    try:
        # Word 对正斜杠路径不友好，统一用反斜杠
        doc = word.Documents.Open(str(html_path).replace("/", "\\"), ReadOnly=False)
        doc.ExportAsFixedFormat(
            OutputFileName=str(pdf_path).replace("/", "\\"),
            ExportFormat=17,       # wdExportFormatPDF
            OpenAfterExport=False,
            OptimizeFor=0,         # wdExportOptimizeForPrint
            CreateBookmarks=1,     # 用标题生成书签
            DocStructureTags=True,
        )
    finally:
        if doc is not None:
            doc.Close(SaveChanges=0)
        word.Quit()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("md")
    ap.add_argument("pdf")
    ap.add_argument("--html-out", default=None)
    ap.add_argument("--title", default=None)
    args = ap.parse_args()

    md_path = Path(args.md).resolve()
    pdf_path = Path(args.pdf).resolve()
    if not md_path.is_file():
        print(f"[ERROR] 输入不存在: {md_path}", file=sys.stderr)
        return 2

    title = args.title or md_path.stem
    html_text = build_html(md_path, title)

    html_path = Path(args.html_out).resolve() if args.html_out else md_path.with_suffix(".html")
    html_path.write_text(html_text, encoding="utf-8")
    print(f"[OK] HTML 已生成: {html_path}  ({len(html_text):,} 字符)")

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    html_to_pdf(html_path, pdf_path)
    print(f"[OK] PDF  已生成: {pdf_path}  ({pdf_path.stat().st_size:,} 字节)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
