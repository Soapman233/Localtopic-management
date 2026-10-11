"""待复核队列 resolve/summary + facets/coverage/source_detail + 标签逐条复核 单测。

覆盖（架构设计 T02 验收）：
* ``review.resolve`` / ``review.summary``（含 by_status）；
* ``query.facets`` 各维度计数 + 「待补充」桶 + 覆盖率；
* ``query.coverage_summary`` / ``query.source_detail``；
* ``labels.review_items`` / ``labels.preview_decision``。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 待复核队列与统计查询测试
# description: 覆盖 review resolve/summary、query facets/coverage_summary/source_detail 与 labels 逐条复核。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import enrich as be_enrich
from bank import labels as lbl
from bank import query as bq
from bank import review as brv
from bank import textutil as bt


class ReviewTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def _add_question(self, sid: int, number: str, text: str, *, chapter=None, qtype=None,
                      difficulty="未标注", answer=None) -> int:
        return self.conn.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, content_hash, chapter,"
            " qtype, difficulty, char_length, version, answer) VALUES (?,?,?,?,?,?,?,?,?,1,?)",
            (sid, number, text, bt.strip_placeholders(text), bt.content_hash(text), chapter,
             qtype, difficulty, len(bt.normalize_text(text)), answer)).lastrowid

    def seed_source(self) -> int:
        self.conn.execute(
            "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
            " VALUES ('p', 'sha1', 'f.docx', '初中', '物理', '八年级下册', '苏科版')")
        return self.conn.execute("SELECT id FROM source_files").fetchone()[0]


class TestReviewQueue(ReviewTestBase):
    def test_resolve_and_summary(self):
        sid = self.seed_source()
        qid = self._add_question(sid, "1", "浮力计算")
        f1 = self.conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex,"
            " needs_review) VALUES (?,?,?,1,'omml','FAIL','x',1)", (qid, sid, "F1")).lastrowid
        f2 = self.conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex,"
            " needs_review) VALUES (?,?,?,2,'omml','EMPTY',NULL,1)", (qid, sid, "F2")).lastrowid
        rq1 = self.conn.execute(
            "INSERT INTO review_queue(formula_id, question_id, status, resolved)"
            " VALUES (?,?, 'FAIL', 0)", (f1, qid)).lastrowid
        self.conn.execute(
            "INSERT INTO review_queue(formula_id, question_id, status, resolved)"
            " VALUES (?,?, 'EMPTY', 0)", (f2, qid))
        # 一条已处理
        f3 = self.conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex,"
            " needs_review) VALUES (?,?,?,3,'omml','FAIL','y',1)", (qid, sid, "F3")).lastrowid
        self.conn.execute(
            "INSERT INTO review_queue(formula_id, question_id, status, resolved)"
            " VALUES (?,?, 'FAIL', 1)", (f3, qid))
        self.conn.commit()

        s = brv.summary(self.conn)
        self.assertEqual(s["open"], 2)
        self.assertEqual(s["resolved"], 1)
        self.assertEqual(s["total"], 3)
        self.assertEqual(s["by_status"], {"FAIL": 1, "EMPTY": 1})

        res = brv.resolve(self.conn, rq1)
        self.assertTrue(res["resolved"])
        self.assertEqual(brv.summary(self.conn)["open"], 1)

        # 恢复
        brv.resolve(self.conn, rq1, resolved=False)
        self.assertEqual(brv.summary(self.conn)["open"], 2)

        with self.assertRaises(ValueError):
            brv.resolve(self.conn, 999999)


class TestFacets(ReviewTestBase):
    def test_facets_counts_and_missing(self):
        sid = self.seed_source()
        self._add_question(sid, "1", "浮力题一", chapter="9.4", difficulty="易", answer="A")
        self._add_question(sid, "2", "浮力题二", chapter="9.4", difficulty="未标注", answer="B")
        self._add_question(sid, "3", "压强题三", chapter=None, difficulty="未标注")
        self.conn.commit()

        f = bq.facets(self.conn)
        chapter = f["dimensions"]["chapter"]
        self.assertEqual(chapter["items"], [{"key": "9.4", "count": 2}])
        self.assertEqual(chapter["missing"], 1)

        qtype = f["dimensions"]["qtype"]
        self.assertEqual(qtype["items"], [])
        self.assertEqual(qtype["missing"], 3)

        self.assertIn("coverage", f)
        self.assertIn("has_answer", f)
        self.assertEqual(f["has_answer"]["有答案"], 2)
        self.assertEqual(f["has_answer"]["无答案"], 1)

    def test_facets_with_keyword(self):
        sid = self.seed_source()
        q1 = self._add_question(sid, "1", "浮力与排开液体体积有关", chapter="9.4")
        q2 = self._add_question(sid, "2", "压强与受力面积有关", chapter="9.1")
        self.conn.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                          (bt.tokenized_text("浮力与排开液体体积有关"), str(q1)))
        self.conn.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                          (bt.tokenized_text("压强与受力面积有关"), str(q2)))
        self.conn.commit()

        f = bq.facets(self.conn, keyword="浮力")
        # 关键词命中 1 题（浮力），章节分布只含该题所在章节
        self.assertEqual(f["dimensions"]["chapter"]["items"], [{"key": "9.4", "count": 1}])


class TestCoverageAndSource(ReviewTestBase):
    def test_coverage_summary_keys(self):
        sid = self.seed_source()
        self._add_question(sid, "1", "浮力题", chapter="9.4", answer="A")
        self.conn.commit()
        cov = bq.coverage_summary(self.conn)
        for key in ("grade", "textbook", "chapter", "qtype", "difficulty", "answer",
                    "analysis", "knowledge", "review_open", "questions_total"):
            self.assertIn(key, cov)
        self.assertEqual(cov["questions_total"], 1)
        self.assertEqual(cov["answer"]["n"], 1)

    def test_source_detail(self):
        sid = self.seed_source()
        self._add_question(sid, "1", "浮力题", chapter="9.4")
        self._add_question(sid, "2", "压强题", chapter=None)
        self.conn.commit()
        d = bq.source_detail(self.conn, sid)
        self.assertIsNotNone(d)
        self.assertEqual(d["questions_count"], 2)
        self.assertEqual(len(d["question_ids_preview"]), 2)
        self.assertIn("coverage", d)
        self.assertIsNone(bq.source_detail(self.conn, 999999))


class TestLabelReviewItems(ReviewTestBase):
    def _seed_labels(self):
        be_enrich.ensure_provenance_columns(self.conn)
        sid = self.seed_source()
        q1 = self._add_question(sid, "1", "浮力与排开液体体积有关")
        q2 = self._add_question(sid, "2", "浮力产生的原因")
        self.conn.execute("INSERT INTO labels(namespace, name) VALUES ('知识点', '浮力')")
        lid = self.conn.execute("SELECT id FROM labels WHERE name = '浮力'").fetchone()[0]
        self.conn.execute(
            "INSERT INTO question_labels(question_id, label_id, source) VALUES (?,?, 'dictionary')",
            (q1, lid))
        self.conn.execute(
            "INSERT INTO question_labels(question_id, label_id, source) VALUES (?,?, 'dictionary')",
            (q2, lid))
        self.conn.commit()
        return {"sid": sid, "q1": q1, "q2": q2, "lid": lid}

    def test_review_items(self):
        ids = self._seed_labels()
        res = lbl.review_items(self.conn, label_name="浮力")
        self.assertEqual(res["total"], 2)
        self.assertEqual(len(res["items"]), 2)
        self.assertIn("snippet", res["items"][0])
        self.assertEqual(res["items"][0]["source"], "dictionary")
        with self.assertRaises(ValueError):
            lbl.review_items(self.conn, label_name="不存在的标签")

    def test_preview_decision(self):
        ids = self._seed_labels()
        p = lbl.preview_decision(self.conn, label_name="浮力", decision="已确认")
        self.assertTrue(p["found"])
        self.assertEqual(p["matched"], 2)
        self.assertEqual(p["will_update"], 2)

        p_one = lbl.preview_decision(self.conn, label_name="浮力", decision="已否决",
                                     question_id=ids["q1"])
        self.assertEqual(p_one["matched"], 1)
        self.assertEqual(p_one["will_update"], 1)

        # 执行决策后，preview 的 will_update 归零
        lbl.set_review_status(self.conn, label_name="浮力", decision="已确认")
        p2 = lbl.preview_decision(self.conn, label_name="浮力", decision="已确认")
        self.assertEqual(p2["will_update"], 0)

        missing = lbl.preview_decision(self.conn, label_name="无此标签", decision="已确认")
        self.assertFalse(missing["found"])
        with self.assertRaises(ValueError):
            lbl.preview_decision(self.conn, label_name="浮力", decision="随便")


if __name__ == "__main__":
    unittest.main()
