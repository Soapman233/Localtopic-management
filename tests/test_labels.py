"""知识点人工复核工作流测试：迁移幂等 / 汇总 / 确认否决 / 导出导入容错 / 检索过滤。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 知识点复核测试
# description: 覆盖 review_status 迁移、按标签汇总、确认/否决、复核 CSV 导出导入容错与检索过滤。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import enrich as be
from bank import labels as lbl
from bank import query as bq


def _seed(conn) -> dict:
    """塞入 1 个来源、2 道题、2 个知识点标签与关联（review_status 默认 待复核）。

    先跑 enrich 的列迁移，使 ``question_labels.source`` 存在（贴近真实库状态）。
    """
    be.ensure_provenance_columns(conn)
    conn.execute(
        "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
        " VALUES ('p', 'sha1', 'f.docx', '初中', '物理', '八年级下册', '苏科版')")
    sid = conn.execute("SELECT id FROM source_files").fetchone()[0]
    qids = []
    for i, (num, text) in enumerate([("1", "物体受到的浮力与排开液体体积有关"),
                                     ("2", "压强与浮力综合计算")]):
        cur = conn.execute(
            "INSERT INTO questions(source_id, number, text, plain_text, content_hash,"
            " difficulty, char_length, version) VALUES (?,?,?,?,?, '未标注', 0, 1)",
            (sid, num, text, text, f"h{i}"))
        qids.append(cur.lastrowid)
    for name in ("浮力", "压强"):
        conn.execute("INSERT INTO labels(namespace, name) VALUES ('知识点', ?)", (name,))
    lf = conn.execute("SELECT id FROM labels WHERE name='浮力'").fetchone()[0]
    lq = conn.execute("SELECT id FROM labels WHERE name='压强'").fetchone()[0]
    conn.execute("INSERT INTO question_labels(question_id, label_id, source) VALUES (?,?, 'dictionary')",
                 (qids[0], lf))
    conn.execute("INSERT INTO question_labels(question_id, label_id, source) VALUES (?,?, 'dictionary')",
                 (qids[1], lf))
    conn.execute("INSERT INTO question_labels(question_id, label_id, source) VALUES (?,?, 'chapter_title')",
                 (qids[1], lq))
    conn.commit()
    return {"sid": sid, "qids": qids, "lf": lf, "lq": lq}


class LabelsTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()


class TestReviewMigration(LabelsTestBase):
    def test_fresh_db_already_has_column_and_migration_idempotent(self):
        # DDL 已含 review_status（新库）
        self.assertTrue(lbl.has_review_status_column(self.conn))
        self.assertEqual(lbl.ensure_review_status_column(self.conn), [])
        self.assertEqual(lbl.ensure_review_status_column(self.conn), [])

    def test_migrate_legacy_table_backfills_pending(self):
        # 模拟「旧库」：重建一个没有 review_status 的 question_labels
        self.conn.execute("DROP TABLE question_labels")
        self.conn.execute(
            "CREATE TABLE question_labels (question_id INTEGER, label_id INTEGER, source TEXT,"
            " PRIMARY KEY (question_id, label_id))")
        self.conn.execute("INSERT INTO question_labels(question_id, label_id) VALUES (1, 1)")
        self.conn.commit()
        self.assertFalse(lbl.has_review_status_column(self.conn))

        added = lbl.ensure_review_status_column(self.conn)
        self.assertEqual(added, ["question_labels.review_status"])
        self.assertTrue(lbl.has_review_status_column(self.conn))
        # 既有行被回填为「待复核」
        st = self.conn.execute("SELECT review_status FROM question_labels").fetchone()[0]
        self.assertEqual(st, lbl.REVIEW_PENDING)
        # 再次执行不报错、不重复加列
        self.assertEqual(lbl.ensure_review_status_column(self.conn), [])


class TestReviewSummary(LabelsTestBase):
    def test_summary_aggregates_by_label(self):
        _seed(self.conn)
        rows = lbl.review_summary(self.conn, status=lbl.REVIEW_PENDING)
        by_name = {r["label_name"]: r for r in rows}
        self.assertEqual(by_name["浮力"]["total"], 2)
        self.assertEqual(by_name["浮力"]["pending"], 2)
        self.assertEqual(by_name["压强"]["total"], 1)
        counts = lbl.status_counts(self.conn)
        self.assertEqual(counts[lbl.REVIEW_PENDING], 3)
        self.assertEqual(counts[lbl.REVIEW_CONFIRMED], 0)


class TestConfirmReject(LabelsTestBase):
    def setUp(self):
        super().setUp()
        self.ids = _seed(self.conn)

    def test_batch_confirm_all_pending(self):
        res = lbl.set_review_status(self.conn, label_name="浮力",
                                    decision=lbl.REVIEW_CONFIRMED)
        self.assertTrue(res["found"])
        self.assertEqual(res["updated"], 2)
        self.assertEqual(res["matched"], 2)
        counts = lbl.status_counts(self.conn)
        self.assertEqual(counts[lbl.REVIEW_CONFIRMED], 2)

    def test_batch_does_not_override_already_decided(self):
        lbl.set_review_status(self.conn, label_name="浮力", decision=lbl.REVIEW_CONFIRMED)
        # 再否决：默认只处理待复核 -> 不覆盖已确认
        res = lbl.set_review_status(self.conn, label_name="浮力", decision=lbl.REVIEW_REJECTED)
        self.assertEqual(res["updated"], 0)
        self.assertEqual(res["already_decided"], 2)
        self.assertEqual(lbl.status_counts(self.conn)[lbl.REVIEW_CONFIRMED], 2)
        # force=True 才允许改写
        res2 = lbl.set_review_status(self.conn, label_name="浮力",
                                     decision=lbl.REVIEW_REJECTED, force=True)
        self.assertEqual(res2["updated"], 2)
        self.assertEqual(lbl.status_counts(self.conn)[lbl.REVIEW_REJECTED], 2)

    def test_single_question_scope(self):
        qid = self.ids["qids"][0]
        res = lbl.set_review_status(self.conn, label_name="浮力", question_id=qid,
                                    decision=lbl.REVIEW_CONFIRMED)
        self.assertEqual(res["updated"], 1)
        # 另一题的「浮力」仍是待复核
        st = self.conn.execute(
            "SELECT review_status FROM question_labels ql JOIN labels l ON l.id=ql.label_id"
            " WHERE l.name='浮力' AND ql.question_id=?", (self.ids["qids"][1],)).fetchone()[0]
        self.assertEqual(st, lbl.REVIEW_PENDING)

    def test_unknown_label_reports_not_found(self):
        res = lbl.set_review_status(self.conn, label_name="不存在的标签",
                                    decision=lbl.REVIEW_CONFIRMED)
        self.assertFalse(res["found"])
        self.assertEqual(res["updated"], 0)

    def test_invalid_decision_raises(self):
        with self.assertRaises(ValueError):
            lbl.set_review_status(self.conn, label_name="浮力", decision="随便")


class TestExportImport(LabelsTestBase):
    def setUp(self):
        super().setUp()
        self.ids = _seed(self.conn)

    def test_export_columns_and_rows(self):
        out = self.dir / "review.csv"
        res = lbl.export_review(self.conn, out, status=lbl.REVIEW_PENDING)
        self.assertEqual(res["rows"], 3)
        import csv
        with out.open("r", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        self.assertEqual(rows[0], list(lbl.CSV_COLUMNS))
        self.assertEqual(len(rows), 4)                      # 表头 + 3 行
        self.assertTrue(all(len(r) == len(lbl.CSV_COLUMNS) for r in rows))
        names = {r[1] for r in rows[1:]}
        self.assertEqual(names, {"浮力", "压强"})

    def test_import_roundtrip_and_tolerance(self):
        out = self.dir / "review.csv"
        lbl.export_review(self.conn, out, status=lbl.REVIEW_PENDING)
        # 用导出的清单构造「老师填写版」：第一行确认，第二行否决，第三行填非法值
        import csv
        rows = list(csv.DictReader(out.read_text(encoding="utf-8-sig").splitlines()))
        fill = self.dir / "fill.csv"
        with fill.open("w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["label_id", "label_name", "question_id", "decision"])
            w.writerow([rows[0]["label_id"], rows[0]["label_name"], rows[0]["question_id"], "确认"])
            w.writerow([rows[1]["label_id"], rows[1]["label_name"], rows[1]["question_id"], "否决"])
            w.writerow(["", "", "", ""])                              # 空行
            w.writerow(["999999", "未知", "1", "确认"])                # 未知标签
            w.writerow([rows[2]["label_id"], rows[2]["label_name"], rows[2]["question_id"], "???"])
        res = lbl.import_review(self.conn, fill)
        self.assertEqual(res["applied"], 2)
        self.assertGreaterEqual(res["skipped"], 2)
        self.assertTrue(any("非法" in e for e in res["errors"]))
        self.assertTrue(any("未知" in e for e in res["errors"]))
        counts = lbl.status_counts(self.conn)
        self.assertEqual(counts[lbl.REVIEW_CONFIRMED], 1)
        self.assertEqual(counts[lbl.REVIEW_REJECTED], 1)
        self.assertEqual(counts[lbl.REVIEW_PENDING], 1)

    def test_import_does_not_override_decided_without_force(self):
        out = self.dir / "r.csv"
        lbl.export_review(self.conn, out, status=lbl.REVIEW_PENDING)
        import csv
        rows = list(csv.DictReader(out.read_text(encoding="utf-8-sig").splitlines()))
        row = rows[0]
        # 先确认
        self.conn.execute(
            "UPDATE question_labels SET review_status=? WHERE label_id=? AND question_id=?",
            (lbl.REVIEW_CONFIRMED, int(row["label_id"]), int(row["question_id"])))
        self.conn.commit()
        # 再用 import 尝试否决同一行 -> 默认不覆盖
        fill = self.dir / "f.csv"
        with fill.open("w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["label_id", "question_id", "decision"])
            w.writerow([row["label_id"], row["question_id"], "否决"])
        res = lbl.import_review(self.conn, fill)
        self.assertEqual(res["applied"], 0)
        self.assertEqual(res["skipped"], 1)
        st = self.conn.execute(
            "SELECT review_status FROM question_labels WHERE label_id=? AND question_id=?",
            (int(row["label_id"]), int(row["question_id"]))).fetchone()[0]
        self.assertEqual(st, lbl.REVIEW_CONFIRMED)


class TestSearchReviewFilter(LabelsTestBase):
    def setUp(self):
        super().setUp()
        self.ids = _seed(self.conn)

    def test_default_search_includes_unreviewed_labels(self):
        # 未复核的标签默认仍可命中（否则功能不可用）
        self.assertEqual(bq.search(self.conn, labels=["浮力"])["total"], 2)
        self.assertEqual(bq.search(self.conn, labels=["压强"])["total"], 1)

    def test_strict_filter_only_confirmed(self):
        # 未确认时，严格模式命中 0
        self.assertEqual(
            bq.search(self.conn, labels=["浮力"], label_review=lbl.REVIEW_CONFIRMED,
                      label_namespace=lbl.KNOWLEDGE_NAMESPACE)["total"], 0)
        # 确认「浮力」后，严格模式命中该标签的 2 题
        lbl.set_review_status(self.conn, label_name="浮力", decision=lbl.REVIEW_CONFIRMED)
        self.assertEqual(
            bq.search(self.conn, labels=["浮力"], label_review=lbl.REVIEW_CONFIRMED,
                      label_namespace=lbl.KNOWLEDGE_NAMESPACE)["total"], 2)
        # 只按状态（不限标签名）也生效
        self.assertEqual(
            bq.search(self.conn, label_review=lbl.REVIEW_CONFIRMED,
                      label_namespace=lbl.KNOWLEDGE_NAMESPACE)["total"], 2)

    def test_rejected_label_excluded_in_strict(self):
        qid = self.ids["qids"][0]
        lbl.set_review_status(self.conn, label_name="浮力", question_id=qid,
                              decision=lbl.REVIEW_REJECTED)
        # 严格模式只认已确认 -> 被否决的那条不命中
        self.assertEqual(
            bq.search(self.conn, labels=["浮力"], label_review=lbl.REVIEW_CONFIRMED,
                      label_namespace=lbl.KNOWLEDGE_NAMESPACE)["total"], 0)


if __name__ == "__main__":
    unittest.main()
