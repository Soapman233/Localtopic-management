"""已核对修复的留版、幂等和整批拒绝回归。"""
# ---------------------------------------------------------------------------
# title: 公式修复事务测试
# description: 临时库验证旧新版本、题干与哈希不变、重复执行无写入、冲突及中途故障整批回滚。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

import json
from tests.test_edit import EditTestBase
from bank import edit, formula_repair


class TestVerifiedRepair(EditTestBase):
    def setUp(self):
        super().setUp()
        edit.ensure_version_snapshot_columns(self.conn)
        self.ids=self.seed(latex=None)
        self.entry={'formula_id':self.ids['fid'],'question_id':self.ids['qid'],'old_latex':None,'old_status':'FAIL','latex':'R_x'}

    def test_versions_and_idempotence(self):
        before=dict(self.conn.execute('SELECT * FROM questions').fetchone())
        self.assertEqual(formula_repair.apply_verified(self.conn,[self.entry],evidence='源图与双端验证'),{'formulas':1,'questions':1})
        rows=self.conn.execute('SELECT snapshot_json FROM question_versions ORDER BY version').fetchall()
        self.assertIsNone(json.loads(rows[0][0])['formulas'][0]['latex'])
        self.assertEqual(json.loads(rows[1][0])['formulas'][0]['latex'],'R_x')
        after=dict(self.conn.execute('SELECT * FROM questions').fetchone())
        for key in ['text','plain_text','content_hash','char_length','answer','analysis']:
            self.assertEqual(before[key],after[key])
        changes=self.conn.total_changes
        self.assertEqual(formula_repair.apply_verified(self.conn,[self.entry],evidence='重复核对')['formulas'],0)
        self.assertEqual(self.conn.total_changes,changes)

    def test_conflict_rejects_whole_batch(self):
        bad={**self.entry,'formula_id':99999}
        with self.assertRaises(ValueError):
            formula_repair.apply_verified(self.conn,[self.entry,bad],evidence='test')
        self.assertIsNone(self.conn.execute('SELECT latex FROM formulas').fetchone()[0])
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM question_versions').fetchone()[0],0)

    def test_failure_after_formula_update_rolls_back(self):
        self.conn.execute("CREATE TRIGGER fail_version BEFORE INSERT ON question_versions WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'probe'); END")
        self.conn.commit()
        with self.assertRaises(Exception):
            formula_repair.apply_verified(self.conn,[self.entry],evidence='test')
        self.assertIsNone(self.conn.execute('SELECT latex FROM formulas').fetchone()[0])
        self.assertEqual(self.conn.execute('SELECT resolved FROM review_queue').fetchone()[0],0)
        self.assertEqual(self.conn.execute('SELECT version FROM questions').fetchone()[0],1)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM question_versions').fetchone()[0],0)
