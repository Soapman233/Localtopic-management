"""Stage 1 - offline preprocessing pipeline.

Takes real DOCX papers and produces, per file:
  * a normalised structure (paragraphs with ⟦Fn⟧ placeholders, formulas as LaTeX, images)
  * a question segmentation (each question with its formulas and images attached)
  * a review queue (equations that could not be converted automatically)

Everything downstream (question bank, paper assembly, export) consumes this output, so
no later stage ever has to parse a DOCX again.

Usage:
    python -m pipeline.stage1 <file-or-dir> [...]
    python -m pipeline.stage1 <file> --out outputs/preprocess
    python -m pipeline.stage1 <dir> --limit 5 --timeout 8
"""
# ---------------------------------------------------------------------------
# title: 阶段1 主管线
# description: 串联扫描、公式转换与切分，把真实试卷 DOCX 批量转成结构化 JSON。
# author: 待补充
# version: 0.1.0
# category: 阶段1-预处理
# ---------------------------------------------------------------------------

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

from . import docx_scan, segment

DEFAULT_OUT = Path("outputs/preprocess")


def process_file(path: Path, out_dir: Path, timeout: float, verbose: bool):
    started = time.perf_counter()
    record = {"file": str(path), "name": path.name}
    try:
        doc = docx_scan.scan(path, timeout=timeout)
        seg = segment.segment(doc)

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = path.stem
        scan_path = docx_scan.dump(doc, out_dir / f"{stem}.scan.json")
        seg_path = out_dir / f"{stem}.questions.json"
        seg_path.write_text(json.dumps(segment.to_dict(seg, doc), ensure_ascii=False, indent=2),
                            encoding="utf-8")

        review = [
            {"id": f.id, "kind": f.kind, "status": f.status, "progid": f.progid,
             "part": f.part, "paragraph": f.paragraph, "preview": f.preview}
            for f in doc.formulas.values() if f.needs_review
        ]
        record.update({
            "status": "OK",
            "scan": doc.stats,
            "questions": seg.stats,
            "review_count": len(review),
            "review": review[:50],
            "outputs": [str(scan_path), str(seg_path)],
            "seconds": round(time.perf_counter() - started, 2),
        })
        if verbose:
            print(f"  {path.name[:60]:60s} q={seg.stats['questions']:3d} "
                  f"f={doc.stats['formulas']:4d} review={len(review):3d} "
                  f"{record['seconds']:5.1f}s", flush=True)
    except Exception as e:
        record.update({"status": "ERROR", "error": str(e),
                       "traceback": traceback.format_exc()[-800:],
                       "seconds": round(time.perf_counter() - started, 2)})
        if verbose:
            print(f"  {path.name[:60]:60s} ERROR {e}", flush=True)
    return record


def _is_temp_lock(path: Path) -> bool:
    """Word/WPS create ~$name.docx lock files next to open documents - not real inputs."""
    return path.name.startswith("~$")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pipeline.stage1",
                                 description="Stage 1 preprocessing: DOCX -> structured questions + LaTeX")
    ap.add_argument("inputs", nargs="+", help="DOCX files or directories")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    ap.add_argument("--limit", type=int, default=0, help="max files per input (0 = all)")
    ap.add_argument("--timeout", type=float, default=10.0, help="per-chunk parser timeout (s)")
    ap.add_argument("--filter-table-numeric", action="store_true",
                    help="同时把表格里的纯数值行（如实验数据 0.30）从题目里剔除（默认关闭）")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    # 阶段1 已知缺陷修复（阶段2）：表格纯数值行可选过滤，默认保持与既有产物一致。
    segment.FILTER_TABLE_NUMERIC = bool(args.filter_table_numeric)

    out_dir = Path(args.out)
    targets: list[Path] = []
    skipped_temp = 0
    for raw in args.inputs:
        p = Path(raw)
        if p.is_dir():
            found = sorted(x for x in p.rglob("*.docx") if not _is_temp_lock(x))
            skipped_temp += sum(1 for x in p.rglob("*.docx") if _is_temp_lock(x))
            targets.extend(found[: args.limit] if args.limit else found)
        elif p.is_file():
            if _is_temp_lock(p):
                skipped_temp += 1
            else:
                targets.append(p)
        else:
            print(f"skip (not found): {p}", file=sys.stderr)
    if skipped_temp:
        print(f"skipped {skipped_temp} Office lock file(s) (~$...)")

    if not targets:
        print("no .docx inputs found", file=sys.stderr)
        return 2

    print(f"Stage 1: {len(targets)} file(s) -> {out_dir}")
    records = []
    t0 = time.perf_counter()
    for i, path in enumerate(targets, 1):
        if not args.quiet:
            print(f"[{i}/{len(targets)}] {path.name[:70]}", flush=True)
        records.append(process_file(path, out_dir, args.timeout, verbose=not args.quiet))

    ok = [r for r in records if r["status"] == "OK"]
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "files_total": len(records),
        "files_ok": len(ok),
        "files_error": len(records) - len(ok),
        "questions_total": sum(r.get("questions", {}).get("questions", 0) for r in ok),
        "formulas_total": sum(r.get("scan", {}).get("formulas", 0) for r in ok),
        "formulas_ok": sum(r.get("scan", {}).get("ok", 0) for r in ok),
        "formulas_need_review": sum(r.get("review_count", 0) for r in ok),
        "images_referenced": sum(r.get("scan", {}).get("images_referenced", 0) for r in ok),
        "seconds": round(time.perf_counter() - t0, 2),
        "records": records,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2),
                                           encoding="utf-8")

    f_total = summary["formulas_total"]
    rate = round(summary["formulas_ok"] / f_total, 4) if f_total else None
    print("\n--- Stage 1 summary ---")
    print(f"files          : {summary['files_ok']}/{summary['files_total']} ok")
    print(f"questions      : {summary['questions_total']}")
    print(f"formulas       : {summary['formulas_ok']}/{f_total} converted  (rate {rate})")
    print(f"need review    : {summary['formulas_need_review']}")
    print(f"images linked  : {summary['images_referenced']}")
    print(f"elapsed        : {summary['seconds']}s")
    print(f"summary        : {out_dir / '_summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
