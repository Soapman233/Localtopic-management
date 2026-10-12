# -*- coding: utf-8 -*-
"""调试：为什么含 MathType 公式的题导出后公式数为 0。

用 `_mtef_frozen` 里那份**打包版导入产物**的库，在源码模式下构建导出计划并逐层检查。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

DB = ROOT / "spike" / "acceptance" / "_mtef_frozen" / "outputs" / "bank.db"


def main() -> int:
    if not DB.is_file():
        print(f"[SKIP] 库不存在：{DB}")
        return 0

    from bank import export as E
    from bank import paper as P

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    pid = con.execute("SELECT id FROM papers ORDER BY id DESC LIMIT 1").fetchone()["id"]
    print(f"检查试卷 #{pid}")

    rows = con.execute(
        "SELECT pq.question_id, q.text FROM paper_questions pq "
        "JOIN questions q ON q.id = pq.question_id WHERE pq.paper_id=? ORDER BY pq.seq",
        (pid,)).fetchall()
    print(f"试卷含 {len(rows)} 题: {[r['question_id'] for r in rows]}")

    payload = P.build_export_payload(con, pid, answer_mode="学生版")
    plan = E.build_document_plan(payload, media_resolver=None)

    n_math = 0
    for s in plan["sections"]:
        for q in s["questions"]:
            kinds = {}
            for ln in (q.get("stem_lines") or []):
                for kind, _val in ln:
                    kinds[kind] = kinds.get(kind, 0) + 1
                    if kind == "math":
                        n_math += 1
            print(f"  q{q.get('number')}: segments={kinds}")
    print(f"\n计划中 math 段总数: {n_math}")
    print(f"plan['audit']: {json.dumps(plan['audit'], ensure_ascii=False)[:300]}")

    # 直接看某一题的 payload 里有什么
    for s in plan["sections"]:
        for q in s["questions"]:
            if (q.get("stem_lines") or []):
                print(f"\n第一题 stem_lines[0] 前 3 段: "
                      f"{json.dumps(q['stem_lines'][0][:3], ensure_ascii=False)[:300]}")
                break
        break
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
