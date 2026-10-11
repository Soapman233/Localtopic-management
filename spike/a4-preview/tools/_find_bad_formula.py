import sqlite3, json
con = sqlite3.connect('file:outputs/bank.db?mode=ro', uri=True)
con.row_factory = sqlite3.Row
for r in con.execute('SELECT seq, question_id, snapshot_json FROM paper_questions WHERE paper_id=1'):
    snap = json.loads(r['snapshot_json'])
    for f in (snap.get('formulas') or []):
        L = f.get('latex') or ''
        if '甲' in L or '乙' in L:
            print('qid', r['question_id'], 'seq', r['seq'], 'fid', f.get('fid'), 'status', f.get('status'))
            print('   repr latex=', repr(L))
