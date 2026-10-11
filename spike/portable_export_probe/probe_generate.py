# -*- coding: utf-8 -*-
"""探针：不依赖 editor_sdk / Office，用标准库直接生成含「原生 OMML 公式」的 DOCX。

验证目标（对应「便携 + 轻量」路线的核心假设）：
  H1. 仅用 Python 标准库（zipfile + 手写 OOXML）即可产出合法 DOCX
  H2. 公式是**原生 OMML**（word/document.xml 内含 <m:oMath>）
  H3. 不含任何 word/embeddings/*（即**不是 OLE 对象**，也不是图片冒充）

用法：
    python probe_generate.py [输出路径.docx]
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def _r(text: str) -> str:
    """普通文本 run。"""
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def _mr(text: str) -> str:
    """OMML 数学 run。"""
    return f"<m:r><m:t>{text}</m:t></m:r>"


def _sup(base: str, sup: str) -> str:
    """上标结构（如 c²）。"""
    return (f"<m:sSup><m:e>{_mr(base)}</m:e>"
            f"<m:sup>{_mr(sup)}</m:sup></m:sSup>")


def _frac(num: str, den: str) -> str:
    """分式结构（如 m/V）。"""
    return (f"<m:f><m:num>{_mr(num)}</m:num>"
            f"<m:den>{_mr(den)}</m:den></m:f>")


def build_document_xml() -> str:
    """构造含三条物理公式的文档：上标、分式、简单等式。"""
    body = [
        # 普通文本段落
        f"<w:p>{_r('便携导出探针 —— 原生 OMML 公式（无 editor_sdk / 无 Office 生成依赖）')}</w:p>",
        # 公式 1：E = mc²（含上标）
        f"<w:p>{_r('公式1（上标）：')}"
        f"<m:oMath>{_mr('E')}{_mr('=')}{_mr('m')}{_sup('c', '2')}</m:oMath></w:p>",
        # 公式 2：ρ = m/V（含分式）
        f"<w:p>{_r('公式2（分式）：')}"
        f"<m:oMath>{_mr('ρ')}{_mr('=')}{_frac('m', 'V')}</m:oMath></w:p>",
        # 公式 3：v = v₀ + at（下标）
        f"<w:p>{_r('公式3（下标）：')}"
        f"<m:oMath>{_mr('v')}{_mr('=')}"
        f"<m:sSub><m:e>{_mr('v')}</m:e><m:sub>{_mr('0')}</m:sub></m:sSub>"
        f"{_mr('+')}{_mr('at')}</m:oMath></w:p>",
        # 中文公式（验证 CJK 在 OMML 中的表现）
        f"<w:p>{_r('公式4（含中文）：')}"
        f"<m:oMath>{_mr('浮')}{_mr('=')}{_frac('ρ', '液')}{_mr('g')}"
        f"<m:sSub><m:e>{_mr('V')}</m:e><m:sub>{_mr('排')}</m:sub></m:sSub>"
        f"</m:oMath></w:p>",
        # 占位标记：供 Word COM 修改后比对
        f"<w:p>{_r('PROBE_MARKER_BEFORE')}</w:p>",
        "<w:sectPr/>",
    ]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" xmlns:m="{M_NS}">'
        f"<w:body>{''.join(body)}</w:body></w:document>"
    )


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "probe_out.docx").resolve()
    doc_xml = build_document_xml()

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", doc_xml)

    print(f"[OK] 已生成: {out}  ({out.stat().st_size:,} 字节)")
    print(f"[OK] 依赖：仅标准库 zipfile（未使用 python-docx / editor_sdk / Office）")

    # ---- 结构自检 ----
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        doc = z.read("word/document.xml").decode("utf-8")

    print("\n--- 结构自检 ---")
    print(f"parts: {names}")
    print(f"H1 合法 DOCX（3 个必需 part）: "
          f"{'PASS' if {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'} <= set(names) else 'FAIL'}")
    n_omath = doc.count("<m:oMath>")
    print(f"H2 原生 OMML（<m:oMath> 数量）: {n_omath}  "
          f"{'PASS' if n_omath >= 4 else 'FAIL'}")
    emb = [n for n in names if "embeddings" in n]
    print(f"H3 无 OLE 嵌入对象（word/embeddings/*）: {emb or '无'}  "
          f"{'PASS' if not emb else 'FAIL'}")
    has_media = [n for n in names if n.startswith("word/media/")]
    print(f"H3 无图片冒充: {has_media or '无'}  "
          f"{'PASS' if not has_media else 'FAIL'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
