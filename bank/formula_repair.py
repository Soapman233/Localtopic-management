"""将已逐项核对的公式修复清单原子写入，保留题目旧版与锁定试卷快照。"""
# ---------------------------------------------------------------------------
# title: 已核对公式修复
# description: 乐观校验修复前状态、整批事务、按题留版与幂等写回；不自动批准转换候选。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import sqlite3
from . import edit


def apply_verified(conn: sqlite3.Connection, entries: list[dict], *, evidence: str) -> dict:
    """调用方须先备份并核验；entries 只能包含源图和双端导出均核对通过的条目。

    每项包含 formula_id/question_id/old_latex/old_status/latex。重复执行不留空版本；
    任一前置状态不匹配整批拒绝。不开启迁移，不触碰历史试卷快照。
    """
    if not evidence.strip():
        raise ValueError("必须提供逐项核对证据")
    if conn.in_transaction:
        raise ValueError("必须使用无未提交事务的专用连接")
    if len({e['formula_id'] for e in entries}) != len(entries):
        raise ValueError("修复清单包含重复公式")
    pending = []
    try:
        conn.execute('BEGIN IMMEDIATE')
        for e in entries:
            if not e['latex'].strip():
                raise ValueError("禁止将公式修复为空")
            edit._validate_latex(e['latex'])
            row = conn.execute('SELECT * FROM formulas WHERE id=?', (e['formula_id'],)).fetchone()
            if row is None or row['question_id'] != e['question_id']:
                raise ValueError(f"公式归属变化：{e['formula_id']}")
            if row['latex'] == e['latex'] and row['status'] == 'OK' and not row['needs_review']:
                open_count = conn.execute('SELECT COUNT(*) FROM review_queue WHERE formula_id=? AND resolved=0', (row['id'],)).fetchone()[0]
                if not open_count:
                    continue
            if row['latex'] != e['old_latex'] or row['status'] != e['old_status'] or not row['needs_review']:
                raise ValueError(f"公式已变化，拒绝覆盖：{e['formula_id']}")
            pending.append(e)
        questions = {}
        for qid in sorted({e['question_id'] for e in pending}):
            q = conn.execute('SELECT * FROM questions WHERE id=?', (qid,)).fetchone()
            questions[qid] = q
            snap = edit._build_snapshot(conn, qid, version=q['version'], text=q['text'], plain_text=q['plain_text'], char_length=q['char_length'], content_hash=q['content_hash'])
            conn.execute('INSERT OR IGNORE INTO question_versions(question_id,version,content_hash,text,plain_text,char_length,created_at) VALUES (?,?,?,?,?,?,?)', (qid,q['version'],q['content_hash'],q['text'],q['plain_text'],q['char_length'],q['created_at'] or edit._now()))
            conn.execute("UPDATE question_versions SET snapshot_json=?,change_source=COALESCE(change_source,'import') WHERE question_id=? AND version=? AND snapshot_json IS NULL", (json.dumps(snap,ensure_ascii=False),qid,q['version']))
        for e in pending:
            conn.execute("UPDATE formulas SET latex=?,status='OK',needs_review=0 WHERE id=?", (e['latex'],e['formula_id']))
            conn.execute('UPDATE review_queue SET resolved=1,reason=? WHERE formula_id=? AND resolved=0', (evidence,e['formula_id']))
        for qid,q in questions.items():
            ver = q['version'] + 1
            conn.execute('UPDATE questions SET version=?,updated_at=? WHERE id=?', (ver,edit._now(),qid))
            snap = edit._build_snapshot(conn,qid,version=ver,text=q['text'],plain_text=q['plain_text'],char_length=q['char_length'],content_hash=q['content_hash'])
            conn.execute('INSERT INTO question_versions(question_id,version,content_hash,text,plain_text,char_length,snapshot_json,change_source,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', (qid,ver,q['content_hash'],q['text'],q['plain_text'],q['char_length'],json.dumps(snap,ensure_ascii=False),'formula_repair',evidence,edit._now()))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {'formulas':len(pending),'questions':len(questions)}
