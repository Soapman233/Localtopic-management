"""Read-only package diagnostics. Never modifies, executes, or uploads source files.
Counts physical XML nodes, not questions or verified distinct formulas.
"""
# ---------------------------------------------------------------------------
# title: 素材检查脚本
# description: 只读检查真实物理素材目录的结构与文件分布。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import collections
import datetime
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from pypdf import PdfReader

ROOTS = [
    Path("C:/Users/SOAP/Desktop/物理/初中/2026学科网教案"),
    Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷"),
]
OUTPUT = Path("D:/Open-source project/Localtopic-management/outputs/material_diagnostics_20261005.json")
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "o": "urn:schemas-microsoft-com:office:office",
    "v": "urn:schemas-microsoft-com:vml",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}

def docx_stats(path):
    counts = collections.Counter()
    progids = collections.Counter()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        parts = [n for n in names if re.fullmatch(r"word/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml", n)]
        media = [n for n in names if n.startswith("word/media/") and not n.endswith("/")]
        embedding = [n for n in names if n.startswith("word/embeddings/") and not n.endswith("/")]
        for name in parts:
            info = z.getinfo(name)
            if info.file_size > 64 * 1024 * 1024:
                raise ValueError("XML part exceeds 64 MB inspection limit")
            root = ET.fromstring(z.read(name))
            for key, q in {
                "omml_nodes": ".//m:oMath", "omml_paragraphs": ".//m:oMathPara",
                "ole_nodes": ".//o:OLEObject", "vml_image_references": ".//v:imagedata",
                "drawing_image_references": ".//a:blip", "alternate_content": ".//mc:AlternateContent",
                "superscript_subscript_properties": ".//w:vertAlign",
            }.items():
                counts[key] += len(root.findall(q, NS))
            for node in root.findall(".//o:OLEObject", NS):
                progids[node.get("ProgID", "(missing)")] += 1
            for obj in root.findall(".//w:object", NS):
                if obj.find(".//o:OLEObject", NS) is not None:
                    counts["ole_preview_image_references"] += len(obj.findall(".//v:imagedata", NS)) + len(obj.findall(".//a:blip", NS))
        eq = sum(v for k, v in progids.items() if any(t in k.lower() for t in ["equation", "mathtype", "dsmt"]))
        return {
            "parts_examined": parts,
            **dict(counts),
            "equation_ole_nodes": eq,
            "ole_progids": dict(progids),
            "media_files": len(media),
            "media_types": dict(collections.Counter(Path(n).suffix.lower() for n in media)),
            "embedded_files": len(embedding),
            "note": "Physical XML counts include compatibility alternatives; media include diagrams and OLE previews, not just formula pictures.",
        }


def pdf_stats(path):
    reader = PdfReader(path)
    if reader.is_encrypted and not reader.decrypt(""):
        return {"encrypted": True, "error": "Password required; not bypassed"}
    pages = []
    for i, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text() or ""
            chars = len(re.sub(r"\s+", "", text))
            chinese = sum("\u4e00" <= c <= "\u9fff" for c in text)
            resources = page.get("/Resources", {})
            if hasattr(resources, "get_object"):
                resources = resources.get_object()
            xo = resources.get("/XObject", {})
            if hasattr(xo, "get_object"):
                xo = xo.get_object()
            images = sum(ref.get_object().get("/Subtype") == "/Image" for ref in xo.values())
            pages.append({"page": i, "nonspace_text_chars": chars, "chinese_chars": chinese,
                          "direct_image_xobjects": images, "width_pt": float(page.mediabox.width),
                          "height_pt": float(page.mediabox.height)})
        except Exception as exc:
            pages.append({"page": i, "error": str(exc)})
    valid = [p for p in pages if "error" not in p]
    return {
        "page_count": len(reader.pages), "pages": pages,
        "zero_text_pages": [p["page"] for p in valid if p["nonspace_text_chars"] == 0],
        "low_text_pages_under_50": [p["page"] for p in valid if p["nonspace_text_chars"] < 50],
        "text_chars": sum(p["nonspace_text_chars"] for p in valid),
        "note": "Text extraction does not establish formula structure or correctness. Image XObjects count only top-level resources. No OCR performed.",
    }


def main():
    report = {"generated_at": datetime.datetime.now().astimezone().isoformat(),
              "scope": "Local read-only metadata and package inspection; no source writes, upload, OCR or archive expansion.",
              "roots": [], "files": [], "errors": [], "skipped_links": []}
    for root in ROOTS:
        types = collections.Counter()
        total_bytes = 0
        if not root.is_dir():
            raise FileNotFoundError(root)
        for base, dirs, names in os.walk(root, followlinks=False):
            kept = []
            for d in dirs:
                path = os.path.join(base, d)
                if os.path.islink(path) or os.path.isjunction(path):
                    report["skipped_links"].append(path)
                else:
                    kept.append(d)
            dirs[:] = kept
            for name in sorted(names):
                path = Path(base) / name
                if path.is_symlink():
                    report["skipped_links"].append(str(path))
                    continue
                before = path.stat()
                ext = path.suffix.lower()
                types[ext] += 1
                total_bytes += before.st_size
                row = {"root": str(root), "relative_path": str(path.relative_to(root)),
                       "path": str(path), "extension": ext, "bytes": before.st_size,
                       "modified": datetime.datetime.fromtimestamp(before.st_mtime).astimezone().isoformat()}
                try:
                    if ext == ".docx":
                        row["docx"] = docx_stats(path)
                    elif ext == ".pdf":
                        row["pdf"] = pdf_stats(path)
                    after = path.stat()
                    row["size_mtime_unchanged_during_read"] = (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
                except Exception as exc:
                    row["error"] = f"{type(exc).__name__}: {exc}"
                    report["errors"].append({"path": str(path), "error": row["error"]})
                report["files"].append(row)
        report["roots"].append({"path": str(root), "files": sum(types.values()), "bytes": total_bytes, "types": dict(types)})
    docs = [f for f in report["files"] if "docx" in f]
    categories = collections.Counter()
    for f in docs:
        d = f["docx"]
        categories[("OMML+OLE" if d.get("equation_ole_nodes", 0) else "OMML only") if d.get("omml_nodes", 0) else ("OLE only" if d.get("equation_ole_nodes", 0) else "Neither detected")] += 1
    progids = collections.Counter()
    for f in docs:
        progids.update(f["docx"]["ole_progids"])
    report["summary"] = {
        "files": len(report["files"]), "docx_inspected": len(docs),
        "docx_categories": dict(categories), "ole_progids": dict(progids),
        "omml_physical_nodes": sum(f["docx"].get("omml_nodes", 0) for f in docs),
        "equation_ole_physical_nodes": sum(f["docx"].get("equation_ole_nodes", 0) for f in docs),
        "docs_with_media_but_no_detected_equation_nodes": sum(f["docx"].get("media_files", 0) > 0 and not f["docx"].get("omml_nodes", 0) and not f["docx"].get("equation_ole_nodes", 0) for f in docs),
        "pdf_inspected": sum("pdf" in f for f in report["files"]),
        "all_size_mtime_unchanged_during_read": all(f.get("size_mtime_unchanged_during_read", False) for f in report["files"]),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "roots": report["roots"], "summary": report["summary"], "errors": report["errors"],
                      "pdfs": [{"path": f["path"], **{k: v for k, v in f["pdf"].items() if k not in ("pages", "note")}} for f in report["files"] if "pdf" in f]}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
