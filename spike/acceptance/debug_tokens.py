# -*- coding: utf-8 -*-
"""调试：源扫描段落的 tokens 结构，以及重建后 blocks 文本与快照文本的差异。"""
from __future__ import annotations

import difflib
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

DB = ROOT / "spike" / "acceptance" / "_mtef_frozen" / "outputs" / "bank.db"


def main() -> int:
    from bank import export_content as C
    from bank import paper as P

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    items = P.list_items(con, 2)
    it = [x for x in items if x["question_id"] == 4][0]
    snap = it["snapshot"]
    src = snap.get("source") or {}
    receipt = con.execute("SELECT * FROM source_files WHERE id=?",
                          (src.get("source_id"),)).fetchone()
    print(f"源文件: {receipt['path'] if receipt else '（无凭据）'}")
    p = Path(receipt["path"]) if receipt else None
    print(f"源存在: {p.is_file() if p else False}")

    if p and p.is_file():
        doc = C._source_document(p)
        start, end = src.get("start_paragraph"), src.get("end_paragraph")
        print(f"范围: {start}..{end} / 共 {len(doc['paragraphs'])} 段")
        pars = doc["paragraphs"][start:end + 1]
        print(f"\n段落 tokens（前 3 段）:")
        for pp in pars[:3]:
            kinds = [k for k, _ in pp["tokens"]]
            print(f"  p{pp['index']} kinds={kinds}")
            for k, v in pp["tokens"][:6]:
                print(f"      {k}: {str(v)[:60]!r}")
        full = "\n".join(x["text"] for x in pars if x["text"].strip()).replace("\r\n", "\n")
        s = (snap.get("text") or "").replace("\r\n", "\n")
        print(f"\ntext_ok: {full == s}")
        print(f"  源 full 含⟦: {'⟦' in full}  快照含⟦: {'⟦' in s}")
        if full != s:
            d = list(difflib.unified_diff(s.splitlines(), full.splitlines(),
                                          "snapshot", "source", lineterm=""))[:14]
            for line in d:
                print("   ", line[:120])

    ins = C.inspect_paper(con, 2)["inspections"][it["id"]]
    blk = "\n".join(b["text"] for b in ins["blocks"]
                    if b["kind"] == "paragraph" and b["branch"] == "stem")
    s = snap.get("text") or ""
    print(f"\n重建 blocks(stem) 含⟦: {'⟦' in blk}  长度={len(blk)}")
    print(f"快照文本          含⟦: {'⟦' in s}  长度={len(s)}")
    n = min(len(blk), len(s))
    i = next((k for k in range(n) if blk[k] != s[k]), n)
    print(f"首个差异位置: {i}")
    print(f"  快照 …{s[max(0, i - 25):i + 25]!r}")
    print(f"  重建 …{blk[max(0, i - 25):i + 25]!r}")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
