"""Scan a DOCX into a normalised structure: text + formulas + images + source anchors.

Walks word/document.xml in document order and replaces every equation - native OMML,
MathType OLE, or neither - with a stable placeholder, so downstream stages can segment
questions and rebuild documents without re-parsing the package.

Read-only: never writes to the input file.
"""
# ---------------------------------------------------------------------------
# title: DOCX 结构扫描
# description: 扫描 DOCX 公式与图片；旧 ProgID 按真实流版本分流，v5 转换候选仍待人工对照源图。
# author: 待补充
# version: 0.1.0
# category: 阶段1-预处理
# ---------------------------------------------------------------------------


from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field, asdict
from io import BytesIO
from pathlib import Path

import olefile

from .omml import omath_to_latex
from . import mtef_conv

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
O = "{urn:schemas-microsoft-com:office:office}"
V = "{urn:schemas-microsoft-com:vml}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

PLACEHOLDER = "⟦{id}⟧"
PLACEHOLDER_RE = re.compile(r"⟦(F\d+)⟧")

# Legacy equation ProgIDs whose "Equation Native" stream the vendored MTEF parser can decode.
MTEF_SUPPORTED = ("Equation.DSMT4", "DSEquations")

# 旧 ProgID 既可能保存 v3，也可能保存 v5；必须检查流头，v3 不交给 v5 解析器。
MTEF_UNSUPPORTED = ("Equation.KSEE3", "Equation.3")


@dataclass
class Formula:
    id: str
    kind: str                 # omml | mathtype | unknown
    status: str               # OK | EMPTY | FAIL | TIMEOUT | NO_STREAM | PENDING
    latex: str | None = None
    progid: str | None = None
    part: str | None = None   # package part holding the payload
    paragraph: int | None = None
    preview: str | None = None  # rendered preview image - lets a human rebuild a failed formula

    @property
    def needs_review(self) -> bool:
        return self.status != mtef_conv.OK


@dataclass
class Paragraph:
    index: int
    text: str                 # with ⟦Fn⟧ placeholders where equations were
    style: str | None = None
    formulas: list = field(default_factory=list)
    images: list = field(default_factory=list)
    is_table_cell: bool = False


@dataclass
class ScannedDoc:
    path: str
    paragraphs: list
    formulas: dict
    images: dict
    stats: dict


def _rels(z: zipfile.ZipFile, part: str = "word/document.xml"):
    name = part.rsplit("/", 1)[0] + "/_rels/" + part.rsplit("/", 1)[1] + ".rels"
    if name not in z.namelist():
        return {}
    root = ET.fromstring(z.read(name))
    out = {}
    for rel in root.findall(PKG_REL + "Relationship"):
        target = rel.get("Target", "")
        if target.startswith("../"):
            target = target[3:]
        out[rel.get("Id")] = {"target": target, "type": rel.get("Type", "")}
    return out


def _paragraph_style(p) -> str | None:
    pr = p.find(W + "pPr")
    if pr is None:
        return None
    st = pr.find(W + "pStyle")
    if st is None:
        return None
    return st.get(W + "val")


def _collect_runs(node, rels, ctx, formulas, images, paragraph_index, in_cell=False):
    """Walk one paragraph's children in document order, returning text with placeholders.

    MathType equations are NOT parsed here - we only record which stream belongs to which
    placeholder, so the whole document can be converted in one batch afterwards
    (one worker process for the file instead of one per equation).
    """
    buf = []

    def emit_formula(kind, latex, status, progid=None, part=None, stream=None, preview=None):
        fid = f"F{len(formulas) + 1}"
        formulas[fid] = Formula(id=fid, kind=kind, status=status, latex=latex,
                                progid=progid, part=part, paragraph=paragraph_index,
                                preview=preview)
        if stream is not None:
            ctx.setdefault("_pending", []).append(fid)
            ctx.setdefault("_streams", {})[fid] = stream
        buf.append(PLACEHOLDER.format(id=fid))
        return fid

    def handle_ole(obj_el, pict_el):
        ole = obj_el.find(O + "OLEObject")
        if ole is None:
            return False
        progid = ole.get("ProgID", "")
        rid = ole.get(f"{R}id")
        rel = rels.get(rid or "", {})
        target = rel.get("target", "")
        # The w:object also carries a rendered preview of the equation - invaluable for
        # rebuilding formulas whose binary format we cannot decode.
        preview = None
        img = obj_el.find(".//" + V + "imagedata")
        if img is not None:
            irid = img.get(f"{R}id")
            if irid and irid in rels:
                preview = rels[irid]["target"]
        is_eq = "Equation" in progid or "DSMT" in progid or "DSEquations" in progid
        if not is_eq:
            emit_formula("unknown", None, "NO_STREAM", progid=progid, part=target or None,
                         preview=preview)
            return True
        if any(p in progid for p in MTEF_UNSUPPORTED):
            # 旧 ProgID 也可能装有 v5；仅完整验证头部后进入带超时的严格解析。
            stream = ctx.get(target)
            if mtef_conv.native_v5_payload(stream) is not None:
                fid = emit_formula("mathtype", None, "PENDING", progid=progid,
                                   part=target or None, stream=stream, preview=preview)
                ctx.setdefault("_strict_v5", set()).add(fid)
            else:
                emit_formula("mathtype", None, "UNSUPPORTED", progid=progid,
                             part=target or None, preview=preview)
            return True
        stream = ctx.get(target)
        if stream is None:
            emit_formula("mathtype", None, "NO_STREAM", progid=progid, part=target or None,
                         preview=preview)
            return True
        emit_formula("mathtype", None, "PENDING", progid=progid, part=target or None,
                     stream=stream, preview=preview)
        return True

    def handle_image(el):
        rid = None
        blip = el.find(".//" + A + "blip")
        if blip is not None:
            rid = blip.get(f"{R}embed")
        if rid is None:
            for img in el.iter(V + "imagedata"):
                rid = img.get(f"{R}id")
                break
        if rid and rid in rels:
            images.setdefault(rels[rid]["target"], paragraph_index)

    def walk(el):
        tag = el.tag
        if tag == M + "oMath":
            latex = omath_to_latex(el)
            emit_formula("omml", latex, "OK" if latex.strip() else "EMPTY")
            return
        if tag == M + "oMathPara":
            parts = [omath_to_latex(o) for o in el.findall(M + "oMath")]
            latex = " ".join(p for p in parts if p)
            emit_formula("omml", latex, "OK" if latex.strip() else "EMPTY")
            return
        if tag == W + "object":
            if handle_ole(el, None):
                return
        if tag in (W + "drawing", W + "pict"):
            handle_image(el)
            return
        if tag == W + "t":
            buf.append(el.text or "")
            return
        if tag == W + "tab":
            buf.append("\t")
            return
        if tag in (W + "br", W + "cr"):
            buf.append("\n")
            return
        if tag == W + "fldSimple":
            buf.append(el.get(W + "instr", ""))
        for child in el:
            walk(child)

    walk(node)
    return "".join(buf)


def _equation_native(blob: bytes):
    """Pull the 'Equation Native' stream out of an OLE compound file.

    The embedded .bin is a whole OLE container; the MTEF payload is one stream inside it.
    Handing the container to the MTEF parser yields an empty result rather than an error,
    so this extraction is mandatory, not an optimisation.
    """
    try:
        ole = olefile.OleFileIO(BytesIO(blob))
        try:
            if not ole.exists("Equation Native"):
                return None
            return ole.openstream("Equation Native").read()
        finally:
            ole.close()
    except Exception:
        return None


def scan(path, timeout=10.0, progress=None) -> ScannedDoc:
    """Scan a .docx. Returns a ScannedDoc with text, formulas and images."""
    path = Path(path)
    paragraphs: list[Paragraph] = []
    formulas: dict[str, Formula] = {}
    images: dict[str, int] = {}

    with zipfile.ZipFile(path) as z:
        rels = _rels(z)
        ctx = {}
        for rid, rel in rels.items():
            t = rel["target"]
            if t.startswith("embeddings/"):
                try:
                    blob = z.read("word/" + t)
                except KeyError:
                    continue
                ctx[t] = _equation_native(blob)
        ctx["_timeout"] = timeout

        root = ET.fromstring(z.read("word/document.xml"))
        body = root.find(W + "body")
        if body is None:
            body = root

        def walk_block(el, in_cell=False):
            tag = el.tag
            if tag == W + "p":
                text = _collect_runs(el, rels, ctx, formulas, images, len(paragraphs), in_cell)
                paragraphs.append(Paragraph(index=len(paragraphs), text=text,
                                            style=_paragraph_style(el),
                                            is_table_cell=in_cell))
                return
            if tag == W + "tbl":
                for tr in el.findall(W + "tr"):
                    for tc in tr.findall(W + "tc"):
                        for child in tc:
                            walk_block(child, in_cell=True)
                return
            for child in el:
                walk_block(child, in_cell)

        walk_block(body)

        media = sorted(n for n in z.namelist() if n.startswith("word/media/") and not n.endswith("/"))

    # Batch-convert every MathType equation in one worker pass.
    pending = ctx.get("_pending", [])
    convert_seconds = 0.0
    for strict in (False, True):
        group = [fid for fid in pending if (fid in ctx.get("_strict_v5", set())) == strict]
        if not group:
            continue
        streams = [ctx["_streams"][fid] for fid in group]
        kwargs = {"strict_v5": True} if strict else {}
        results, elapsed = mtef_conv.convert_many(streams, per_chunk_timeout=timeout * 4, **kwargs)
        convert_seconds += elapsed
        for fid, res in zip(group, results):
            f = formulas[fid]
            # 真实库存在 OLE 与预览不一致的反例；解析成功不等于核对通过。
            f.status = "UNVERIFIED" if strict and res["status"] == mtef_conv.OK else res["status"]
            f.latex = res["latex"]

    stats = {
        "paragraphs": len(paragraphs),
        "formulas": len(formulas),
        "omml": sum(1 for f in formulas.values() if f.kind == "omml"),
        "mathtype": sum(1 for f in formulas.values() if f.kind == "mathtype"),
        "unknown_objects": sum(1 for f in formulas.values() if f.kind == "unknown"),
        "ok": sum(1 for f in formulas.values() if f.status == mtef_conv.OK),
        "needs_review": sum(1 for f in formulas.values() if f.needs_review),
        "images_referenced": len(images),
        "media_files": len(media),
        "convert_seconds": convert_seconds,
    }
    if progress:
        progress(stats)
    return ScannedDoc(path=str(path), paragraphs=paragraphs, formulas=formulas,
                      images=images, stats=stats)


def to_dict(doc: ScannedDoc) -> dict:
    return {
        "path": doc.path,
        "stats": doc.stats,
        "paragraphs": [asdict(p) for p in doc.paragraphs],
        "formulas": {k: asdict(v) | {"needs_review": v.needs_review} for k, v in doc.formulas.items()},
        "images": doc.images,
    }


def dump(doc: ScannedDoc, out_path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(to_dict(doc), ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path
