"""题目编辑 / 留版 / 冲突 / FTS / 难度 单测。

覆盖（架构设计 T02 验收 + M1/M2 裁定）：
* ``ensure_version_snapshot_columns`` 幂等（二次调用返回 ``[]``）；
* 改文本 → ``version+1`` + ``plain_text``/``content_hash``/``char_length`` 重算 + FTS 即时生效；
* 改公式后**旧版快照**仍能取回旧 latex / 答案 / 解析（留版核心验收）；
* 仅改公式不改文本 → ``content_hash`` 不变；
* 冲突 → 抛 :class:`ContentConflict`、**不写库**、``force`` 也不绕过（M2）；
* 占位符缺失 / LaTeX 非法 → 报错；
* 难度仅 易/中/难；文件级元数据需二次确认。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 题目编辑与留版测试
# description: 覆盖版本快照迁移幂等、save_question 留版/冲突/FTS、公式复核状态、难度三档、文件级元数据确认与占位符题干编辑回归（B1）。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import edit as be
from bank import query as bq
from bank import textutil as bt


class EditTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def seed(self, *, text: str = "物体受到的浮力与排开液体体积有关", number: str = "1",
             answer: str = "A", analysis: str = "由阿基米德原理得",
             latex: str = "F=\\rho gV", needs_review: int = 1) -> dict:
        """塞入 1 个来源、1 道题（v1）、1 条公式、1 条待复核项与 FTS 行。"""
        c = self.conn
        c.execute(
            "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
            " VALUES ('p', 'sha1', 'f.docx', '初中', '物理', '八年级下册', '苏科版')")
        sid = c.execute("SELECT id FROM source_files").fetchone()[0]
        qid = c.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, content_hash,"
            " difficulty, char_length, version, answer, analysis, answer_source)"
            " VALUES (?,?,?,?,?, '未标注', ?, 1, ?, ?, 'inline')",
            (sid, number, text, bt.strip_placeholders(text), bt.content_hash(text),
             len(bt.normalize_text(text)), answer, analysis)).lastrowid
        c.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex,"
            " needs_review) VALUES (?,?,?,?,?,?,?,?)",
            (qid, sid, "F1", 1, "omml", "OK" if not needs_review else "FAIL", latex,
             needs_review))
        fid = c.execute("SELECT id FROM formulas WHERE question_id = ?", (qid,)).fetchone()[0]
        if needs_review:
            c.execute(
                "INSERT INTO review_queue(formula_id, question_id, status, reason, resolved,"
                " created_at) VALUES (?,?,?,?,0,?)",
                (fid, qid, "FAIL", "初始入队", "2026-01-01T00:00:00"))
        c.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                  (bt.tokenized_text(text), str(qid)))
        c.commit()
        return {"sid": sid, "qid": qid, "fid": fid}

    def _add_question(self, sid: int, number: str, text: str) -> int:
        return self.conn.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, content_hash,"
            " char_length, version) VALUES (?,?,?,?,?,?,1)",
            (sid, number, text, bt.strip_placeholders(text), bt.content_hash(text),
             len(bt.normalize_text(text)))).lastrowid


class TestVersionSnapshotMigration(EditTestBase):
    def test_migration_idempotent(self):
        # 新库的 DDL 不含快照列 -> 首次调用应新增 3 列
        added = be.ensure_version_snapshot_columns(self.conn)
        self.assertEqual(set(added), {
            "question_versions.snapshot_json",
            "question_versions.change_source",
            "question_versions.note",
        })
        # 二次调用返回 []
        self.assertEqual(be.ensure_version_snapshot_columns(self.conn), [])
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(question_versions)")}
        self.assertTrue({"snapshot_json", "change_source", "note"} <= cols)


class TestSaveQuestion(EditTestBase):
    def test_text_edit_bumps_version_and_fts(self):
        ids = self.seed()
        qid = ids["qid"]
        self.assertGreaterEqual(bq.search(self.conn, keyword="浮力")["total"], 1)

        res = be.save_question(self.conn, qid, {"text": "物体受到的重力与质量成正比"})
        self.assertEqual(res["version"], 2)

        row = self.conn.execute(
            "SELECT version, text, plain_text, content_hash, char_length FROM questions"
            " WHERE id = ?", (qid,)).fetchone()
        self.assertEqual(row["version"], 2)
        self.assertEqual(row["content_hash"], bt.content_hash("物体受到的重力与质量成正比"))
        self.assertEqual(row["plain_text"], bt.strip_placeholders("物体受到的重力与质量成正比"))
        self.assertEqual(row["char_length"], len(bt.normalize_text("物体受到的重力与质量成正比")))

        # FTS 即时生效：旧词不再命中、新词可命中
        self.assertEqual(bq.search(self.conn, keyword="浮力")["total"], 0)
        self.assertGreaterEqual(bq.search(self.conn, keyword="重力")["total"], 1)
        # v2 版本行存在
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM question_versions WHERE question_id = ? AND version = 2",
            (qid,)).fetchone()[0], 1)

    def test_snapshot_keeps_old_formula_answer_analysis(self):
        ids = self.seed(latex="F=\\rho gV", answer="A", analysis="由阿基米德原理得")
        qid = ids["qid"]
        be.save_question(self.conn, qid, {
            "answer": "B", "analysis": "新解析：F=mg",
            "formulas": [{"fid": "F1", "latex": "F=mg"}],
        })

        old = be.get_version(self.conn, qid, 1)
        self.assertIsNotNone(old)
        snap = old["snapshot"]
        self.assertEqual(snap["formulas"][0]["latex"], "F=\\rho gV")  # 旧公式
        self.assertEqual(snap["answer"], "A")                          # 旧答案
        self.assertEqual(snap["analysis"], "由阿基米德原理得")           # 旧解析

        new = be.get_version(self.conn, qid, 2)
        self.assertEqual(new["snapshot"]["formulas"][0]["latex"], "F=mg")
        self.assertEqual(new["snapshot"]["answer"], "B")

        # 当前库为新值
        cur = self.conn.execute("SELECT answer, analysis FROM questions WHERE id = ?",
                                (qid,)).fetchone()
        self.assertEqual(cur["answer"], "B")
        self.assertEqual(cur["analysis"], "新解析：F=mg")

        # M1：人工编辑公式后清除 needs_review 并标记 review_queue 已处理
        self.assertEqual(self.conn.execute(
            "SELECT needs_review FROM formulas WHERE question_id = ? AND fid = 'F1'",
            (qid,)).fetchone()[0], 0)
        self.assertEqual(self.conn.execute(
            "SELECT resolved FROM review_queue WHERE question_id = ?", (qid,)).fetchone()[0], 1)

    def test_formula_only_edit_keeps_hash(self):
        ids = self.seed(text="题干 ⟦F1⟧ 结束", latex="a")
        qid = ids["qid"]
        h0 = self.conn.execute("SELECT content_hash FROM questions WHERE id = ?",
                               (qid,)).fetchone()[0]
        be.save_question(self.conn, qid, {"formulas": [{"fid": "F1", "latex": "b"}]})
        row = self.conn.execute(
            "SELECT content_hash, version FROM questions WHERE id = ?", (qid,)).fetchone()
        self.assertEqual(row["content_hash"], h0)   # 只改公式 -> hash 不变
        self.assertEqual(row["version"], 2)

    def test_conflict_rejected_without_write(self):
        ids = self.seed()
        sid = ids["sid"]
        qb = self._add_question(sid, "2", "压强与受力面积有关")
        self.conn.commit()
        dup_text = "物体受到的浮力与排开液体体积有关"

        with self.assertRaises(be.ContentConflict):
            be.save_question(self.conn, qb, {"text": dup_text})
        # M2：force 也不绕过
        with self.assertRaises(be.ContentConflict):
            be.save_question(self.conn, qb, {"text": dup_text}, force=True)
        # 未写库
        row = self.conn.execute("SELECT version, text FROM questions WHERE id = ?",
                                (qb,)).fetchone()
        self.assertEqual(row["version"], 1)
        self.assertEqual(row["text"], "压强与受力面积有关")

    def test_placeholder_missing_rejected(self):
        ids = self.seed()
        with self.assertRaises(ValueError):
            be.save_question(self.conn, ids["qid"], {"text": "新增占位符 ⟦F9⟧ 无对应公式"})

    def test_placeholder_regex_returns_bare_fid(self):
        """B1 根因回归：``PLACEHOLDER_RE.findall`` 必须返回**裸 fid**（需带捕获组）。

        旧写法 ``r"⟦F\\d+⟧"`` 无捕获组 → ``findall`` 返回 ``['⟦F1⟧']``（带括号），
        与公式 fid 集合 ``{'F1'}`` 永远匹配不上，导致含占位符的题干无法编辑。
        """
        self.assertEqual(bt.PLACEHOLDER_RE.findall("a⟦F1⟧b⟦F12⟧"), ["F1", "F12"])
        # sub 消费点（strip_placeholders）不受捕获组影响：仍替换整个匹配。
        self.assertEqual(bt.strip_placeholders("a⟦F1⟧b"), "ab")
        self.assertEqual(bt.strip_placeholders("前⟦F1⟧中⟦F12⟧后"), "前中后")

    def test_placeholder_stem_edit_succeeds(self):
        """B1 回归：题干含 ``⟦F1⟧`` 且存在对应公式时，仅改文字应成功且 ``version+1``。"""
        ids = self.seed(text="物体受到的浮力⟦F1⟧与排开液体体积有关")
        res = be.save_question(
            self.conn, ids["qid"], {"text": "物体受到的浮力⟦F1⟧与排开液体的体积有关"})
        self.assertEqual(res["version"], 2)
        row = self.conn.execute("SELECT version, text, plain_text FROM questions WHERE id = ?",
                                (ids["qid"],)).fetchone()
        self.assertEqual(row["version"], 2)
        self.assertIn("⟦F1⟧", row["text"])            # 占位符保留
        self.assertNotIn("⟦", row["plain_text"])       # 纯文本仍剥离占位符

    def test_invalid_latex_rejected(self):
        ids = self.seed()
        with self.assertRaises(ValueError):
            be.save_question(self.conn, ids["qid"],
                             {"formulas": [{"fid": "F1", "latex": "\\frac{1}{2"}]})

    def test_unknown_fid_rejected(self):
        ids = self.seed()
        with self.assertRaises(ValueError):
            be.save_question(self.conn, ids["qid"],
                             {"formulas": [{"fid": "F9", "latex": "x"}]})

    def test_labels_diff(self):
        ids = self.seed()
        qid = ids["qid"]
        be.save_question(self.conn, qid, {"labels": ["浮力", "阿基米德原理"]})
        names = {r[0] for r in self.conn.execute(
            "SELECT l.name FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
            " WHERE ql.question_id = ? AND l.namespace = '知识点'", (qid,))}
        self.assertEqual(names, {"浮力", "阿基米德原理"})

        be.save_question(self.conn, qid, {"labels": ["浮力"]})
        names = {r[0] for r in self.conn.execute(
            "SELECT l.name FROM question_labels ql JOIN labels l ON l.id = ql.label_id"
            " WHERE ql.question_id = ? AND l.namespace = '知识点'", (qid,))}
        self.assertEqual(names, {"浮力"})

    def test_noop_returns_without_bump(self):
        ids = self.seed()
        res = be.save_question(self.conn, ids["qid"], {})
        self.assertEqual(res["version"], 1)
        self.assertTrue(res["warnings"])

    def test_missing_question(self):
        with self.assertRaises(ValueError):
            be.save_question(self.conn, 999999, {"text": "x"})


class TestDifficulty(EditTestBase):
    def test_set_and_batch_difficulty(self):
        ids = self.seed()
        qid = ids["qid"]
        for level in ("易", "中", "难"):
            be.set_difficulty(self.conn, qid, level)
            self.assertEqual(self.conn.execute(
                "SELECT difficulty FROM questions WHERE id = ?", (qid,)).fetchone()[0], level)

        with self.assertRaises(ValueError):
            be.set_difficulty(self.conn, qid, "很难")

        vals = {r[0] for r in self.conn.execute("SELECT DISTINCT difficulty FROM questions")}
        self.assertTrue(vals <= set(be.DIFFICULTIES))

        res = be.batch_set_difficulty(self.conn, [qid, 999999], "中")
        self.assertEqual(res["updated"], 1)
        self.assertEqual(res["missing"], [999999])


class TestFileMetadata(EditTestBase):
    def test_update_file_metadata_requires_confirm(self):
        ids = self.seed()
        sid = ids["sid"]
        with self.assertRaises(be.ConfirmationRequired):
            be.update_file_metadata(self.conn, sid, {"grade": "九年级上册"})
        # 未确认 -> 未写库
        self.assertEqual(self.conn.execute(
            "SELECT grade FROM source_files WHERE id = ?", (sid,)).fetchone()[0], "八年级下册")

        res = be.update_file_metadata(self.conn, sid, {"grade": "九年级上册"}, confirm=True)
        self.assertTrue(res["confirmed"])
        self.assertGreaterEqual(res["affected_questions"], 1)
        row = self.conn.execute(
            "SELECT grade, grade_source FROM source_files WHERE id = ?", (sid,)).fetchone()
        self.assertEqual(row["grade"], "九年级上册")
        self.assertEqual(row["grade_source"], "manual")


class TestVersions(EditTestBase):
    def test_list_and_get_versions(self):
        ids = self.seed()
        qid = ids["qid"]
        be.save_question(self.conn, qid, {"text": "新的题干内容"})
        versions = be.list_versions(self.conn, qid)
        self.assertEqual([v["version"] for v in versions], [1, 2])
        self.assertIsNotNone(versions[0]["has_snapshot"])
        self.assertIsNone(be.get_version(self.conn, qid, 99))


if __name__ == "__main__":
    unittest.main()
