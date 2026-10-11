"""自研 DOCX 生成器：把「文档计划」（:func:`bank.export.build_document_plan` 的产出）
直接渲染为 .docx，**不依赖 editor_sdk / Office**。

为什么自研
----------
原渲染链路 ``render_plan_to_docx(bridge, plan)`` 依赖 ``editor_sdk``——那是 WorkBuddy
宿主提供的本地 MCP 服务，**不可随客户端分发**。「便携 + 轻量」路线必须自研。

设计要点
--------
* **纯标准库**（``zipfile`` + 字符串拼 XML），无 python-docx / lxml 依赖 → 打包体积小。
* **直接写 OOXML**，因此**不再需要 TAB 哨兵绕行**：原链路要把 ``\\t`` 换成
  ``U+E000`` 再在 OOXML 层还原，是因为桥接的 ``doc_insert_text`` 拒绝制表符；
  这里直接输出 ``<w:tab/>`` 即可。
* **图片必须带 ``<a:graphicData uri="...">``**：历史教训——桥接生成的
  ``<a:graphicData>`` 缺 ``uri`` 属性，**WPS 容忍但 Word 报错打不开**。
* 公式经 :func:`bank.latex2omml.latex_to_omath` 写入原生 OMML（已验证双端可编辑）。

公开 API
--------
``render_plan(plan) -> bytes``
    把文档计划渲染为 .docx 字节流。
``write_plan(plan, path) -> dict``
    渲染并落盘，返回统计（段数 / 公式数 / 图片数 / 警告）。
"""
# ---------------------------------------------------------------------------
# title: 自研 DOCX 生成器
# description: 把文档计划直接渲染为 .docx（原生 OMML 公式 + 内嵌图片 + 制表位），不依赖 editor_sdk/Office；纯标准库实现。
# author: 待补充
# version: 0.1.0
# category: 阶段4-导出
# ---------------------------------------------------------------------------

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

from .latex2omml import latex_to_omath

__all__ = ["DocxWriter", "render_plan", "write_plan", "DOCX_WRITER_VERSION"]

DOCX_WRITER_VERSION = "0.1.0"

# --- 命名空间 ---------------------------------------------------------------- #
NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS_PR = "http://schemas.openxmlformats.org/package/2006/relationships"

# --- 单位换算 ---------------------------------------------------------------- #
EMU_PER_PT = 12700          # 1 磅 = 12700 EMU
EMU_PER_CM = 360000         # 1 厘米 = 360000 EMU
A4_W_TWIP = 11906           # A4 宽（twip）
A4_H_TWIP = 16838           # A4 高（twip）

SEG_TEXT = "text"
SEG_MATH = "math"

_IMAGE_CT = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff",
    "emf": "image/x-emf", "wmf": "image/x-wmf",
}


def _esc(text: str) -> str:
    """XML 文本转义（保留空白由调用方用 xml:space 声明）。"""
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;"))


def _pt(v: float) -> int:
    """磅 -> 半磅（OOXML 的 w:sz 单位）。"""
    return int(round(float(v) * 2))


def _twip(v: float) -> int:
    """磅 -> twip（OOXML 的间距单位）。"""
    return int(round(float(v) * 20))


class DocxWriter:
    """最小可用的 DOCX 生成器（面向试卷排版）。

    只实现本项目实际需要的排版能力：标题 / 信息行 / 大题标题 / 题行（文本 + 行内公式 +
    制表位）/ 图片（自适应宽度、居中、keepNext）/ 分页 / 页脚页码。
    """

    def __init__(self, spec: dict[str, Any] | None = None) -> None:
        self.spec = spec or {}
        self.body: list[str] = []
        self.images: list[tuple[str, bytes]] = []   # (文件名, 内容)
        self.warnings: list[str] = []
        self.n_math = 0
        self.n_para = 0
        self._rid = 1                                # rId 计数（rId1 留给 styles）
        self._docpr = 1
        self._body_font = self.spec.get("body_font") or "宋体"
        self._body_size = self.spec.get("body_size") or 12.0
        self._line_spacing = self.spec.get("line_spacing") or 1.5

    # ------------------------------------------------------------------ #
    # 基础段落
    # ------------------------------------------------------------------ #
    def _p(self, runs: str, *, align: str | None = None, size: float | None = None,
           font: str | None = None, bold: bool = False,
           before: float = 0.0, after: float = 0.0,
           keep_next: bool = False, keep_lines: bool = False,
           border_bottom: bool = False) -> str:
        ppr = ["<w:pPr>"]
        # 段落含制表符时补**显式制表位**（1/4、1/2、3/4 版心宽），
        # 否则会依赖 Word 默认停靠点（每 0.5 英寸），选项对齐会不准。
        if "<w:tab/>" in runs:
            ppr.append(self._tab_stops())
        if align:
            ppr.append(f'<w:jc w:val="{align}"/>')
        ppr.append(f'<w:spacing w:before="{_twip(before)}" w:after="{_twip(after)}"'
                   f' w:line="{int(round(self._line_spacing * 240))}" w:lineRule="auto"/>')
        if keep_next:
            ppr.append("<w:keepNext/>")
        if keep_lines:
            ppr.append("<w:keepLines/>")
        if border_bottom:
            ppr.append('<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1"'
                       ' w:color="000000"/></w:pBdr>')
        rpr = self._rpr(size=size, font=font, bold=bold)
        if rpr:
            ppr.append("<w:rPr>" + rpr + "</w:rPr>")
        ppr.append("</w:pPr>")
        self.n_para += 1
        return "<w:p>" + "".join(ppr) + runs + "</w:p>"

    def _avail_twip(self) -> int:
        """版心可用宽度（twip）＝ A4 宽 − 左右页边距 − 装订线。"""
        m = self.spec.get("margins") or {}
        avail = (A4_W_TWIP
                 - _twip(m.get("left", 73.7))
                 - _twip(m.get("right", 56.7))
                 - _twip(float(self.spec.get("gutter") or 0.0)))
        return max(2000, avail)

    def _tab_stops(self) -> str:
        """显式制表位：版心 1/4、1/2、3/4 处各一个左停靠点。

        原桥接实现（``_set_explicit_tab_stops``）同样按版心 1/4 设点；不设则退回
        Word 默认停靠点（每 0.5 英寸），四选项题的对齐会不准。
        """
        a = self._avail_twip()
        stops = "".join(f'<w:tab w:val="left" w:pos="{round(a * n / 4)}"/>' for n in (1, 2, 3))
        return f"<w:tabs>{stops}</w:tabs>"

    def _rpr(self, *, size: float | None = None, font: str | None = None,
             bold: bool = False) -> str:
        out: list[str] = []
        if font:
            out.append(f'<w:rFonts w:ascii="{_esc(font)}" w:eastAsia="{_esc(font)}"'
                       f' w:hAnsi="{_esc(font)}"/>')
        if bold:
            out.append("<w:b/>")
        if size:
            out.append(f'<w:sz w:val="{_pt(size)}"/><w:szCs w:val="{_pt(size)}"/>')
        return "".join(out)

    def _text_run(self, text: str, *, size: float | None = None,
                  font: str | None = None, bold: bool = False) -> str:
        """文本 run；``\\t`` 直接输出 ``<w:tab/>``（无需哨兵绕行）。"""
        if not text:
            return ""
        parts: list[str] = []
        for i, chunk in enumerate(text.split("\t")):
            if i:
                parts.append("<w:tab/>")
            if chunk:
                parts.append(f'<w:t xml:space="preserve">{_esc(chunk)}</w:t>')
        rpr = self._rpr(size=size or self._body_size, font=font or self._body_font, bold=bold)
        return f"<w:r><w:rPr>{rpr}</w:rPr>" + "".join(parts) + "</w:r>"

    def add_paragraph(self, text: str = "", **kw) -> None:
        self.body.append(self._p(self._text_run(text, size=kw.get("size"),
                                                font=kw.get("font"),
                                                bold=bool(kw.get("bold"))), **{
            k: v for k, v in kw.items() if k not in ("size", "font", "bold")}))

    def add_line(self, segments: list[tuple[str, str]], *, prefix: str = "",
                 **kw) -> None:
        """一行「文本 + 行内公式」。``segments`` 形如 ``[("text", ...), ("math", latex)]``。"""
        runs: list[str] = []
        if prefix:
            runs.append(self._text_run(prefix, size=kw.get("size"), font=kw.get("font")))
        for kind, value in segments:
            if kind == SEG_MATH:
                omml = latex_to_omath(value)
                if omml:
                    runs.append(omml)
                    self.n_math += 1
                else:
                    runs.append(self._text_run(value))
                    self.warnings.append(f"公式转 OMML 失败，降级为文本：{value[:40]}")
            else:
                runs.append(self._text_run(value, size=kw.get("size"), font=kw.get("font")))
        self.body.append(self._p("".join(runs), **kw))

    # ------------------------------------------------------------------ #
    # 图片
    # ------------------------------------------------------------------ #
    def _register_image(self, path: Path) -> tuple[str, str]:
        """登记图片，返回 ``(rId, 目标文件名)``。"""
        ext = path.suffix.lower().lstrip(".") or "png"
        name = f"image{len(self.images) + 1}.{ext}"
        self.images.append((name, path.read_bytes()))
        self._rid += 1
        return f"rId{self._rid}", name

    def add_image(self, path: str | Path, *, width_cm: float, height_cm: float,
                  align: str = "center", before: float = 6.0, after: float = 6.0,
                  keep_next: bool = False) -> None:
        """插入居中内联图片。

        ⚠️ ``<a:graphicData>`` **必须带 ``uri``**——历史教训：缺 ``uri`` 时
        WPS 容忍但 **Word 报错打不开**。
        """
        p = Path(path)
        if not p.is_file():
            self.warnings.append(f"图片不存在，跳过：{p}")
            return
        rid, name = self._register_image(p)
        cx, cy = int(width_cm * EMU_PER_CM), int(height_cm * EMU_PER_CM)
        self._docpr += 1
        drawing = (
            "<w:r><w:drawing>"
            '<wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:docPr id="{self._docpr}" name="Picture {self._docpr}"/>'
            "<a:graphic>"
            f'<a:graphicData uri="{NS_PIC}">'
            "<pic:pic>"
            f'<pic:nvPicPr><pic:cNvPr id="{self._docpr}" name="{_esc(name)}"/>'
            "<pic:cNvPicPr/></pic:nvPicPr>"
            f'<pic:blipFill><a:blip r:embed="{rid}"/>'
            "<a:stretch><a:fillRect/></a:stretch></pic:blipFill>"
            "<pic:spPr>"
            f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            "</pic:spPr></pic:pic></a:graphicData></a:graphic>"
            "</wp:inline></w:drawing></w:r>"
        )
        self.body.append(self._p(drawing, align=align, before=before, after=after,
                                 keep_next=keep_next, keep_lines=True))

    def add_page_break(self) -> None:
        self.body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

    # ------------------------------------------------------------------ #
    # 序列化
    # ------------------------------------------------------------------ #
    def _document_xml(self) -> str:
        sect = self._sect_pr()
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:document xmlns:w="{NS_W}" xmlns:m="{NS_M}" xmlns:r="{NS_R}"'
                f' xmlns:wp="{NS_WP}" xmlns:a="{NS_A}" xmlns:pic="{NS_PIC}">'
                f"<w:body>{''.join(self.body)}{sect}</w:body></w:document>")

    def _sect_pr(self) -> str:
        m = self.spec.get("margins") or {}
        g = float(self.spec.get("gutter") or 0.0)
        inner = (f'<w:pgSz w:w="{A4_W_TWIP}" w:h="{A4_H_TWIP}"/>'
                 f'<w:pgMar w:top="{_twip(m.get("top", 72.0))}"'
                 f' w:right="{_twip(m.get("right", 56.7))}"'
                 f' w:bottom="{_twip(m.get("bottom", 72.0))}"'
                 f' w:left="{_twip(m.get("left", 73.7))}"'
                 f' w:gutter="{_twip(g)}"/>')
        if self._footer_enabled():
            inner += f'<w:footerReference w:type="default" r:id="rId{self._footer_rid()}"/>'
        return f"<w:sectPr>{inner}</w:sectPr>"

    def _footer_enabled(self) -> bool:
        return bool(self.spec.get("_footer", True))

    def _footer_rid(self) -> int:
        return self._rid + 1

    def _styles_xml(self) -> str:
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:styles xmlns:w="{NS_W}">'
                '<w:docDefaults><w:rPrDefault><w:rPr>'
                f'<w:rFonts w:ascii="{_esc(self._body_font)}"'
                f' w:eastAsia="{_esc(self._body_font)}" w:hAnsi="{_esc(self._body_font)}"/>'
                f'<w:sz w:val="{_pt(self._body_size)}"/>'
                f'<w:szCs w:val="{_pt(self._body_size)}"/>'
                "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>"
                f'<w:spacing w:line="{int(round(self._line_spacing * 240))}"'
                ' w:lineRule="auto"/>'
                "</w:pPr></w:pPrDefault></w:docDefaults>"
                '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
                '<w:name w:val="Normal"/></w:style>'
                "</w:styles>")

    def _footer_xml(self) -> str:
        fld = ('<w:r><w:t xml:space="preserve">第 </w:t></w:r>'
               '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
               '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
               '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
               '<w:r><w:t xml:space="preserve"> 页 共 </w:t></w:r>'
               '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
               '<w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>'
               '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
               '<w:r><w:t xml:space="preserve"> 页</w:t></w:r>')
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:ftr xmlns:w="{NS_W}">'
                f'<w:p><w:pPr><w:jc w:val="center"/><w:rPr>'
                f'<w:sz w:val="{_pt(9.0)}"/></w:rPr></w:pPr>{fld}</w:p></w:ftr>')

    def _content_types(self) -> str:
        defaults = "".join(
            f'<Default Extension="{ext}" ContentType="{ct}"/>'
            for ext, ct in sorted({n.rsplit(".", 1)[-1]: _IMAGE_CT.get(
                n.rsplit(".", 1)[-1], "application/octet-stream") for n, _ in self.images}.items())
        )
        ftr = ('<Override PartName="/word/footer1.xml" ContentType="application/vnd.'
               'openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
               if self._footer_enabled() else "")
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Types xmlns="{NS_CT}">'
                '<Default Extension="rels" ContentType="application/vnd.'
                'openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                f"{defaults}"
                '<Override PartName="/word/document.xml" ContentType="application/vnd.'
                'openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                '<Override PartName="/word/styles.xml" ContentType="application/vnd.'
                'openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                f"{ftr}"
                "</Types>")

    def _root_rels(self) -> str:
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{NS_PR}">'
                f'<Relationship Id="rId1" Type="{NS_R}/officeDocument"'
                ' Target="word/document.xml"/>'
                "</Relationships>")

    def _doc_rels(self) -> str:
        rels = [f'<Relationship Id="rId1" Type="{NS_R}/styles" Target="styles.xml"/>']
        for i, (name, _) in enumerate(self.images, start=2):
            rels.append(f'<Relationship Id="rId{i}" Type="{NS_R}/image"'
                        f' Target="media/{name}"/>')
        if self._footer_enabled():
            rels.append(f'<Relationship Id="rId{self._footer_rid()}" Type="{NS_R}/footer"'
                        ' Target="footer1.xml"/>')
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{NS_PR}">' + "".join(rels) + "</Relationships>")

    def to_bytes(self) -> bytes:
        """序列化为 .docx 字节流。"""
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", self._content_types())
            z.writestr("_rels/.rels", self._root_rels())
            z.writestr("word/document.xml", self._document_xml())
            z.writestr("word/_rels/document.xml.rels", self._doc_rels())
            z.writestr("word/styles.xml", self._styles_xml())
            if self._footer_enabled():
                z.writestr("word/footer1.xml", self._footer_xml())
            for name, data in self.images:
                z.writestr(f"word/media/{name}", data)
        return buf.getvalue()

    def save(self, path: str | Path) -> Path:
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(self.to_bytes())
        return out


# --------------------------------------------------------------------------- #
# 计划渲染
# --------------------------------------------------------------------------- #
def _fit_image_cm(path: Path, avail_cm: float,
                  src_w_emu: int | None = None) -> tuple[float, float]:
    """按页面可用宽度自适应图片显示尺寸。

    **关键规则：不得大于源文档中原图的显示尺寸**（``src_w_emu``）。
    原桥接实现（``bank/export.py:1271-1276``）同样做了这层钳制：

        width = min(fit_image_size(...), extent[0]/360000, avail_width_cm)

    缺了这层钳制，图片会被放大到「可用宽度档位」，实测使同一份试卷
    从 **4 页膨胀到 6 页**（图片平均宽 5.70cm → 9.81cm）。源文档的尺寸是
    编者有意设定的，必须尊重。
    """
    try:
        from PIL import Image  # 可选依赖：读不到就退回默认
        with Image.open(path) as im:
            px_w, px_h = im.size
    except Exception:  # noqa: BLE001
        return min(8.0, avail_cm), min(6.0, avail_cm)
    if not px_w or not px_h:
        return min(8.0, avail_cm), min(6.0, avail_cm)
    ratio = px_w / px_h
    if ratio > 3.0:
        cap = 0.82 * avail_cm
    elif ratio >= 1.2:
        cap = 0.68 * avail_cm
    else:
        cap = 0.55 * avail_cm
    # 按 96 DPI 估算自然尺寸，且不放大
    nat_w = px_w / 96.0 * 2.54
    w = min(cap, nat_w, avail_cm)
    # 最小宽度：**有限放大**（而非硬性下限）——原实现同样如此：
    #   if width < MIN: width = min(MIN, natural * MAX_UPSCALE)
    # 注意顺序：**必须在源尺寸钳制之前**。若放在其后，会把已经按源尺寸缩小的图
    # 重新放大回 4cm（实测：源宽 3.07cm 的图被抬到 4.0cm，与基线不符）。
    if w < 4.0:
        w = min(4.0, nat_w * 1.5)
    # ★ 最后再钳到「源文档中原图的显示尺寸」——这是最外层的硬约束
    if src_w_emu:
        src_cm = float(src_w_emu) / EMU_PER_CM
        if src_cm > 0 and w > src_cm:
            w = src_cm
    w = min(w, avail_cm)
    h = w / ratio
    if h > 7.0:
        h = 7.0
        w = h * ratio
    return round(w, 2), round(h, 2)


def render_plan(plan: dict) -> tuple[bytes, dict]:
    """把文档计划渲染为 .docx 字节流；返回 ``(字节, 统计)``。"""
    spec = dict(plan.get("spec") or {})
    w = DocxWriter(spec)
    margins = spec.get("margins") or {}
    # 版心宽 = A4 − 左右边距 − 装订线（装订线必须计入，否则图会偏宽）
    avail_cm = (21.0 - (margins.get("left", 73.7) + margins.get("right", 56.7)
                        + float(spec.get("gutter") or 0.0)) / 72.0 * 2.54)
    avail_cm = max(6.0, avail_cm)

    # 卷头
    w.add_paragraph(plan.get("title") or "试卷", align="center",
                    size=spec.get("title_size") or 18.0,
                    font=spec.get("title_font") or "黑体", bold=True,
                    before=0.0, after=8.0, border_bottom=bool(spec.get("title_border")))
    if plan.get("info_line"):
        w.add_paragraph(plan["info_line"], align="center", size=spec.get("body_size"),
                        after=12.0)

    for si, sec in enumerate(plan.get("sections") or []):
        if si and spec.get("page_break_sections"):
            w.add_page_break()
        if sec.get("header"):
            w.add_paragraph(sec["header"], size=spec.get("section_size"),
                            font=spec.get("title_font"), bold=True,
                            before=12.0, after=6.0, keep_next=True)
        for q in sec.get("questions") or []:
            blocks = q.get("render_blocks")
            if blocks:
                _render_blocks(w, q, blocks, avail_cm, spec)
            else:
                _render_question(w, q, avail_cm, spec)
    return w.to_bytes(), {
        "paragraphs": w.n_para, "formulas": w.n_math,
        "images": len(w.images), "warnings": w.warnings,
    }


def _render_question(w: DocxWriter, q: dict, avail_cm: float, spec: dict) -> None:
    """渲染一道题。

    ⚠️ **不要再加题号**：``build_document_plan`` 已经把题号（``prefix``）写进
    ``stem_lines`` 的第一段了，渲染层重复添加会产生「1．（3 分）1．（3 分）…」的
    **双重题号**（实测发现）。同理，原卷题号也已由 ``strip_original_number`` 剥离。
    """
    lines = q.get("stem_lines") or []
    for i, segs in enumerate(lines):
        w.add_line(segs, after=8.0,
                   keep_next=(i < len(lines) - 1) or bool(q.get("images")))
    for im in q.get("images") or []:
        p = im.get("path")
        if p:
            cw, ch = _fit_image_cm(Path(p), avail_cm, im.get("source_width_emu"))
            w.add_image(p, width_cm=cw, height_cm=ch)
    for key in ("answer_lines", "analysis_lines"):
        for segs in (q.get(key) or []):
            w.add_line(segs, after=4.0)


def _render_blocks(w: DocxWriter, q: dict, blocks: list, avail_cm: float, spec: dict) -> None:
    """按 ``render_blocks`` 的交错顺序渲染（题干/图片/答案/解析保序）。

    ⚠️ 同上：题号已由 ``build_document_plan`` 写入首段，此处不得再加。
    """
    n = len(blocks)
    for idx, blk in enumerate(blocks):
        kind = blk[0]
        keep = idx < n - 1
        if kind == "image":
            im = blk[1]
            p = im.get("path")
            if p:
                cw, ch = _fit_image_cm(Path(p), avail_cm, im.get("source_width_emu"))
                w.add_image(p, width_cm=cw, height_cm=ch, keep_next=keep)
        else:
            _, segs, _branch = blk
            w.add_line(segs, after=6.0, keep_next=keep)


def write_plan(plan: dict, path: str | Path) -> dict:
    """渲染文档计划并落盘；返回统计信息。"""
    data, stats = render_plan(plan)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    stats["path"] = str(out)
    stats["bytes"] = len(data)
    return stats
