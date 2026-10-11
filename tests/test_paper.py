"""组卷测试：迁移幂等 / 题序连续 / 快照锁定 / 分值 / 大题分组 / 导出数据 / 级联清理。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 组卷测试
# description: 覆盖 schema 迁移幂等、题序连续、快照锁定、分值合计、大题分组、导出数据与级联清理。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import paper as bp
from bank import textutil as btu
from tests.export_source_fixture import materialize_source


def _add_question(conn, sid, number, text, *, section=None, start=0, version=1,
                  formulas=(), images=()):
    """插入一道题 + 版本行 + 公式/图片，返回 question_id。"""
    plain = btu.strip_placeholders(text)
    chash = btu.content_hash(text)
    cur = conn.execute(
        "INSERT INTO questions(source_id, number, text, plain_text, content_hash, difficulty,"
        " char_length, version, section, start_paragraph, end_paragraph)"
        " VALUES (?,?,?,?,?, '未标注', ?, ?, ?, ?, ?)",
        (sid, number, text, plain, chash, len(plain), version, section, start, start + 1))
    qid = cur.lastrowid
    conn.execute(
        "INSERT INTO question_versions(question_id, version, content_hash, text, plain_text,"
        " char_length, created_at) VALUES (?,?,?,?,?,?, '2026-01-01T00:00:00')",
        (qid, version, chash, text, plain, len(plain)))
    for i, latex in enumerate(formulas):
        conn.execute(
            "INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex)"
            " VALUES (?,?,?,?, 'omml', 'OK', ?)", (qid, sid, f"F{qid}_{i}", i + 1, latex))
    for i, path in enumerate(images):
        conn.execute("INSERT INTO images(question_id, source_id, media_path, sha256)"
                     " VALUES (?,?,?, 'abc')", (qid, sid, path))
    return qid


def _seed(conn, specs) -> dict:
    """specs: list of dicts {number, text, section, formulas, images}. 返回 {sid, qids}。

    复用已存在的来源文件（同一测试内多次调用 _seed 不重复插入）。
    """
    row = None  # 每次seed使用不可变的新源，不能改变已有锁定快照的SHA。
    if row is None:
        cur = conn.execute(
            "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
            " VALUES ('p', ?, 'f.docx', '初中', '物理', '八年级下册', '苏科版')", ('seed-'+str(conn.execute('SELECT COUNT(*) FROM source_files').fetchone()[0]),))
        sid = cur.lastrowid
    else:
        sid = row["id"]
    qids = []
    for i, sp in enumerate(specs):
        qids.append(_add_question(
            conn, sid, sp.get("number", str(i + 1)), sp["text"],
            section=sp.get("section"), start=sp.get("start", i * 3),
            formulas=sp.get("formulas", ()), images=sp.get("images", ())))
    conn.commit()
    materialize_source(conn,sid)
    return {"sid": sid, "qids": qids}


class PaperTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def seqs(self, paper_id):
        return [it["seq"] for it in bp.list_items(self.conn, paper_id)]


# --------------------------------------------------------------------------- #
# 迁移
# --------------------------------------------------------------------------- #
class TestMigration(PaperTestBase):
    def test_fresh_schema_idempotent(self):
        self.assertTrue(bp.schema_ready(self.conn))
        self.assertEqual(bp.ensure_paper_schema(self.conn), [])
        self.assertEqual(bp.ensure_paper_schema(self.conn), [])

    def test_legacy_tables_migrated_preserving_rows(self):
        seed = _seed(self.conn, [{"text": "1．浮力 ⟦F1⟧", "formulas": ["F_b"]}])
        qid = seed["qids"][0]
        # 模拟旧库：papers 缺元数据列、paper_questions 用 position 且无 section_id/snapshot
        self.conn.execute("DROP TABLE paper_questions")
        self.conn.execute("DROP TABLE paper_sections")
        self.conn.execute("DROP TABLE papers")
        self.conn.execute("CREATE TABLE papers (id INTEGER PRIMARY KEY AUTOINCREMENT,"
                          " title TEXT NOT NULL, created_at TEXT, meta TEXT)")
        self.conn.execute("INSERT INTO papers(title, created_at) VALUES ('旧卷', '2026-01-01T00:00:00')")
        self.conn.execute(
            "CREATE TABLE paper_questions (id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " paper_id INTEGER NOT NULL, question_id INTEGER NOT NULL,"
            " question_version INTEGER NOT NULL, position INTEGER NOT NULL, score REAL,"
            " UNIQUE(paper_id, position))")
        self.conn.execute(
            "INSERT INTO paper_questions(paper_id, question_id, question_version, position, score)"
            " VALUES (1, ?, 1, 1, 5.0)", (qid,))
        self.conn.commit()

        changed = bp.ensure_paper_schema(self.conn)
        self.assertIn("paper_questions(重建)", changed)
        self.assertIn("paper_sections(新建)", changed)
        self.assertIn("papers.template", changed)
        self.assertTrue(bp.schema_ready(self.conn))

        # 旧卷保留，新列取默认值
        row = self.conn.execute("SELECT * FROM papers WHERE id = 1").fetchone()
        self.assertEqual(row["title"], "旧卷")
        self.assertEqual(row["template"], bp.DEFAULT_TEMPLATE)
        self.assertEqual(row["answer_mode"], bp.DEFAULT_ANSWER_MODE)
        self.assertEqual(row["created_by"], bp.DEFAULT_AUTHOR)
        self.assertEqual(row["status"], bp.DEFAULT_STATUS)
        # paper_questions 数据保留，position -> seq
        pq = self.conn.execute("SELECT * FROM paper_questions WHERE id = 1").fetchone()
        self.assertEqual(pq["seq"], 1)
        self.assertEqual(pq["score"], 5.0)
        self.assertIsNone(pq["section_id"])
        self.assertIsNone(pq["snapshot_json"])
        # 再次迁移为幂等
        self.assertEqual(bp.ensure_paper_schema(self.conn), [])
        # schema_version 已更新
        self.assertEqual(bdb.schema_version(self.conn), bdb.SCHEMA_VERSION)


# --------------------------------------------------------------------------- #
# 试卷 CRUD
# --------------------------------------------------------------------------- #
class TestCrud(PaperTestBase):
    def test_create_and_get(self):
        p = bp.create_paper(self.conn, "初二物理周末练习", subject="物理", stage="初中",
                            grade="八年级下册", template="考试", answer_mode="学生版")
        self.assertEqual(p["title"], "初二物理周末练习")
        self.assertEqual(p["created_by"], bp.DEFAULT_AUTHOR)
        self.assertEqual(p["status"], bp.DEFAULT_STATUS)
        got = bp.get_paper(self.conn, p["id"])
        self.assertEqual(got["id"], p["id"])
        self.assertEqual(got["items"], [])
        self.assertIsNone(bp.get_paper(self.conn, 99999))

    def test_validation(self):
        with self.assertRaises(ValueError):
            bp.create_paper(self.conn, "   ")
        with self.assertRaises(ValueError):
            bp.create_paper(self.conn, "x", template="乱写")
        with self.assertRaises(ValueError):
            bp.create_paper(self.conn, "x", answer_mode="乱写")

    def test_list_papers(self):
        bp.create_paper(self.conn, "A", subject="物理")
        bp.create_paper(self.conn, "B", subject="数学")
        self.assertEqual(len(bp.list_papers(self.conn)), 2)
        self.assertEqual(len(bp.list_papers(self.conn, subject="物理")), 1)

    def test_delete_requires_force_when_nonempty(self):
        seed = _seed(self.conn, [{"text": "1．浮力"}])
        p = bp.create_paper(self.conn, "卷")
        bp.add_questions(self.conn, p["id"], seed["qids"])
        res = bp.delete_paper(self.conn, p["id"])
        self.assertFalse(res["deleted"])
        res = bp.delete_paper(self.conn, p["id"], force=True)
        self.assertTrue(res["deleted"])
        self.assertIsNone(bp.get_paper(self.conn, p["id"]))


# --------------------------------------------------------------------------- #
# 题序连续
# --------------------------------------------------------------------------- #
class TestSeq(PaperTestBase):
    def setUp(self):
        super().setUp()
        self.seed = _seed(self.conn, [{"text": f"{i}．第{i}题", "number": str(i)}
                                      for i in range(1, 7)])
        self.pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_questions(self.conn, self.pid, self.seed["qids"])

    def test_append_seq_contiguous(self):
        self.assertEqual(self.seqs(self.pid), [1, 2, 3, 4, 5, 6])

    def test_move_to_front_and_back(self):
        items = bp.list_items(self.conn, self.pid)
        last = items[-1]["id"]
        bp.move_question(self.conn, self.pid, last, 1)
        self.assertEqual(self.seqs(self.pid), [1, 2, 3, 4, 5, 6])
        self.assertEqual(bp.list_items(self.conn, self.pid)[0]["id"], last)
        # 移到末尾
        bp.move_question(self.conn, self.pid, last, 99)
        self.assertEqual(bp.list_items(self.conn, self.pid)[-1]["id"], last)
        self.assertEqual(self.seqs(self.pid), [1, 2, 3, 4, 5, 6])

    def test_remove_keeps_contiguous(self):
        mid = bp.list_items(self.conn, self.pid)[2]["id"]
        bp.remove_question(self.conn, self.pid, mid)
        self.assertEqual(self.seqs(self.pid), [1, 2, 3, 4, 5])
        self.assertNotIn(mid, [it["id"] for it in bp.list_items(self.conn, self.pid)])

    def test_insert_at_position(self):
        newq = _seed(self.conn, [{"text": "99．新题", "number": "99"}])["qids"][0]
        bp.add_questions(self.conn, self.pid, [newq], position=3)
        self.assertEqual(self.seqs(self.pid), [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(bp.list_items(self.conn, self.pid)[2]["question_id"], newq)

    def test_duplicate_question_allowed(self):
        q = self.seed["qids"][0]
        bp.add_questions(self.conn, self.pid, [q, q])   # 同题加两次
        items = bp.list_items(self.conn, self.pid)
        self.assertEqual(sum(1 for it in items if it["question_id"] == q), 3)
        self.assertEqual(self.seqs(self.pid), list(range(1, 9)))


# --------------------------------------------------------------------------- #
# 快照锁定
# --------------------------------------------------------------------------- #
class TestSnapshotLock(PaperTestBase):
    def test_paper_content_frozen_after_question_modified(self):
        seed = _seed(self.conn, [{
            "text": "1．浮力 ⟦F1⟧ 与密度 ⟦F2⟧ 的关系",
            "formulas": ["F=mg", "\\rho=m/V"], "images": ["word/media/image1.png"]}])
        qid = seed["qids"][0]
        pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_questions(self.conn, pid, [qid])

        before = bp.build_export_payload(self.conn, pid)
        q_before = before["sections"][0]["questions"][0] if before["sections"] else None
        # 未分组时在 sections 末尾的「未分组」组
        if q_before is None:
            q_before = before["sections"][-1]["questions"][0]
        self.assertEqual(q_before["question_version"], 1)
        self.assertIn("⟦F1⟧", q_before["text"])
        self.assertEqual(q_before["latex_list"], ["F=mg", "\\rho=m/V"])
        self.assertEqual(q_before["image_paths"], ["word/media/image1.png"])

        # 修改题目：文本变更 + version=2 + 公式/图片被替换（模拟 importer 的更新行为）
        self.conn.execute(
            "UPDATE questions SET text=?, plain_text=?, version=2, content_hash=? WHERE id=?",
            ("1．改写后的题干 ⟦F9⟧", "1．改写后的题干", "newhash", qid))
        self.conn.execute(
            "INSERT INTO question_versions(question_id, version, content_hash, text, plain_text,"
            " char_length, created_at) VALUES (?,2,'newhash','1．改写后的题干 ⟦F9⟧',"
            "'1．改写后的题干', 8, '2026-02-01T00:00:00')", (qid,))
        self.conn.execute("DELETE FROM formulas WHERE question_id=?", (qid,))
        self.conn.execute("DELETE FROM images WHERE question_id=?", (qid,))
        self.conn.execute("INSERT INTO formulas(question_id, source_id, fid, seq, kind, status,"
                          " latex) VALUES (?,?, 'F9', 1, 'omml', 'OK', 'E=mc^2')", (qid, seed["sid"]))
        self.conn.commit()

        # 试卷内容与导出数据不变（仍为 v1 快照）
        after = bp.build_export_payload(self.conn, pid)
        q_after = after["sections"][-1]["questions"][0]
        self.assertEqual(q_after["question_version"], 1)
        self.assertEqual(q_after["text"], q_before["text"])
        self.assertEqual(q_after["latex_list"], ["F=mg", "\\rho=m/V"])
        self.assertEqual(q_after["image_paths"], ["word/media/image1.png"])
        # 题库里的题确实已变（佐证「变了但不影响试卷」）
        cur = self.conn.execute("SELECT version FROM questions WHERE id=?", (qid,)).fetchone()
        self.assertEqual(cur["version"], 2)


# --------------------------------------------------------------------------- #
# 分值
# --------------------------------------------------------------------------- #
class TestScores(PaperTestBase):
    def setUp(self):
        super().setUp()
        self.seed = _seed(self.conn, [{"text": f"{i}．题{i}", "number": str(i)}
                                      for i in range(1, 4)])
        self.pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_questions(self.conn, self.pid, self.seed["qids"])
        self.items = bp.list_items(self.conn, self.pid)

    def test_total_excludes_unset(self):
        bp.set_score(self.conn, self.pid, self.items[0]["id"], 3)
        bp.set_score(self.conn, self.pid, self.items[1]["id"], 4.5)
        s = bp.paper_summary(self.conn, self.pid)
        self.assertEqual(s["total_score"], 7.5)
        self.assertEqual(s["scored_count"], 2)
        self.assertEqual(s["unscored_count"], 1)
        self.assertFalse(s["score_complete"])

    def test_batch_and_clear(self):
        bp.set_scores(self.conn, self.pid, {it["id"]: 2 for it in self.items})
        s = bp.paper_summary(self.conn, self.pid)
        self.assertEqual(s["total_score"], 6.0)
        self.assertTrue(s["score_complete"])
        # 清除一道
        bp.set_score(self.conn, self.pid, self.items[0]["id"], None)
        s = bp.paper_summary(self.conn, self.pid)
        self.assertEqual(s["total_score"], 4.0)
        self.assertEqual(s["unscored_count"], 1)


# --------------------------------------------------------------------------- #
# 大题分组
# --------------------------------------------------------------------------- #
class TestSections(PaperTestBase):
    def setUp(self):
        super().setUp()
        self.seed = _seed(self.conn, [{"text": f"{i}．题{i}", "number": str(i)}
                                      for i in range(1, 5)])
        self.pid = bp.create_paper(self.conn, "卷")["id"]
        self.s1 = bp.add_section(self.conn, self.pid, "一、选择题")
        self.s2 = bp.add_section(self.conn, self.pid, "二、填空题")
        bp.add_questions(self.conn, self.pid, self.seed["qids"][:2], section_id=self.s1["id"])
        bp.add_questions(self.conn, self.pid, self.seed["qids"][2:], section_id=self.s2["id"])

    def test_subtotals(self):
        items = bp.list_items(self.conn, self.pid)
        for it in items[:2]:
            bp.set_score(self.conn, self.pid, it["id"], 3)
        for it in items[2:]:
            bp.set_score(self.conn, self.pid, it["id"], 4)
        s = bp.paper_summary(self.conn, self.pid)
        secs = {x["name"]: x for x in s["sections"]}
        self.assertEqual(secs["一、选择题"]["item_count"], 2)
        self.assertEqual(secs["一、选择题"]["subtotal"], 6.0)
        self.assertEqual(secs["二、填空题"]["subtotal"], 8.0)
        self.assertEqual(s["total_score"], 14.0)

    def test_move_section_reorders_blocks(self):
        res = bp.move_section(self.conn, self.pid, self.s2["id"], 1)
        self.assertEqual(res["position"], 1)
        items = bp.list_items(self.conn, self.pid)
        self.assertEqual([it["section_id"] for it in items], [self.s2["id"]] * 2 + [self.s1["id"]] * 2)
        self.assertEqual([it["seq"] for it in items], [1, 2, 3, 4])

    def test_rename_and_delete_section(self):
        bp.rename_section(self.conn, self.pid, self.s1["id"], "一、单选题")
        secs = {x["id"]: x for x in bp.paper_summary(self.conn, self.pid)["sections"]}
        self.assertEqual(secs[self.s1["id"]]["name"], "一、单选题")
        # 非空大题需 force
        self.assertFalse(bp.delete_section(self.conn, self.pid, self.s1["id"])["deleted"])
        self.assertTrue(bp.delete_section(self.conn, self.pid, self.s1["id"], force=True)["deleted"])
        items = bp.list_items(self.conn, self.pid)
        self.assertEqual(sum(1 for it in items if it["section_id"] is None), 2)
        self.assertEqual([it["seq"] for it in items], [1, 2, 3, 4])

    def test_section_by_name_autocreate(self):
        q = _seed(self.conn, [{"text": "88．新题", "number": "88"}])["qids"][0]
        bp.add_questions(self.conn, self.pid, [q], section="三、实验探究题")
        names = [x["name"] for x in bp.paper_summary(self.conn, self.pid)["sections"]]
        self.assertIn("三、实验探究题", names)


# --------------------------------------------------------------------------- #
# 导出数据
# --------------------------------------------------------------------------- #
class TestExportPayload(PaperTestBase):
    def test_structure(self):
        seed = _seed(self.conn, [
            {"text": "1．浮力 ⟦F1⟧", "number": "1", "formulas": ["F=\\rho g V"],
             "images": ["word/media/image1.png"]},
            {"text": "2．密度 ⟦F2⟧", "number": "2", "formulas": ["\\rho=m/V"]}])
        pid = bp.create_paper(self.conn, "物理卷", subject="物理", stage="初中",
                              template="测验", answer_mode="学生版")["id"]
        sec = bp.add_section(self.conn, pid, "一、选择题")
        bp.add_questions(self.conn, pid, seed["qids"], section_id=sec["id"], score=3)
        payload = bp.build_export_payload(self.conn, pid, answer_mode="答案解析版")

        self.assertEqual(payload["answer_mode"], "答案解析版")
        self.assertEqual(payload["paper"]["template"], "测验")
        self.assertEqual(len(payload["sections"]), 1)
        s = payload["sections"][0]
        self.assertEqual(s["name"], "一、选择题")
        self.assertEqual(s["item_count"], 2)
        self.assertEqual(s["subtotal"], 6.0)
        q0 = s["questions"][0]
        for key in ("item_id", "seq", "question_id", "question_version", "text", "plain_text",
                    "formulas", "latex_list", "images", "image_paths", "score", "source",
                    "answer", "analysis"):
            self.assertIn(key, q0)
        self.assertIn("⟦F1⟧", q0["text"])
        self.assertEqual(q0["latex_list"], ["F=\\rho g V"])
        self.assertEqual(q0["image_paths"], ["word/media/image1.png"])
        self.assertEqual(q0["score"], 3)
        self.assertEqual(q0["source"]["file_name"], "f.docx")
        self.assertTrue(q0["show_answer"])
        self.assertTrue(q0["show_analysis"])
        # JSON 可序列化
        json.dumps(payload, ensure_ascii=False)

    def test_invalid_answer_mode(self):
        pid = bp.create_paper(self.conn, "卷")["id"]
        with self.assertRaises(ValueError):
            bp.build_export_payload(self.conn, pid, answer_mode="乱写")


# --------------------------------------------------------------------------- #
# 答案随快照锁定 + 导出按 answer_mode 体现
# --------------------------------------------------------------------------- #
class TestAnswerInSnapshot(PaperTestBase):
    def _seed_with_answer(self):
        seed = _seed(self.conn, [{"text": "1．题干⟦F1⟧", "number": "1",
                                  "formulas": ["F=ma"]}])
        qid = seed["qids"][0]
        self.conn.execute(
            "UPDATE questions SET answer='A', analysis='解析正文', answer_source='inline'"
            " WHERE id=?", (qid,))
        self.conn.commit()
        pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_questions(self.conn, pid, [qid])
        return qid, pid

    def test_snapshot_includes_answer(self):
        qid, pid = self._seed_with_answer()
        snap = bp.list_items(self.conn, pid)[0]["snapshot"]
        self.assertEqual(snap["answer"], "A")
        self.assertEqual(snap["analysis"], "解析正文")
        self.assertEqual(snap["answer_source"], "inline")

    def test_export_answer_mode(self):
        qid, pid = self._seed_with_answer()
        # 学生版：不含答案与解析
        p = bp.build_export_payload(self.conn, pid, answer_mode="学生版")
        q = p["sections"][-1]["questions"][0]
        self.assertIsNone(q["answer"])
        self.assertIsNone(q["analysis"])
        self.assertFalse(q["show_answer"])
        self.assertFalse(q["show_analysis"])
        # 仅答案：只有答案
        p = bp.build_export_payload(self.conn, pid, answer_mode="仅答案")
        q = p["sections"][-1]["questions"][0]
        self.assertEqual(q["answer"], "A")
        self.assertIsNone(q["analysis"])
        self.assertTrue(q["show_answer"])
        self.assertFalse(q["show_analysis"])
        # 答案解析版：答案 + 解析
        p = bp.build_export_payload(self.conn, pid, answer_mode="答案解析版")
        q = p["sections"][-1]["questions"][0]
        self.assertEqual(q["answer"], "A")
        self.assertEqual(q["analysis"], "解析正文")
        self.assertTrue(q["show_answer"])
        self.assertTrue(q["show_analysis"])

    def test_answer_locked_after_question_changed(self):
        qid, pid = self._seed_with_answer()
        # 出卷后改答案 -> 已出卷导出不变（仍取快照）
        self.conn.execute("UPDATE questions SET answer='Z' WHERE id=?", (qid,))
        self.conn.commit()
        p = bp.build_export_payload(self.conn, pid, answer_mode="答案解析版")
        self.assertEqual(p["sections"][-1]["questions"][0]["answer"], "A")
        # 题库确实已变
        self.assertEqual(self.conn.execute("SELECT answer FROM questions WHERE id=?",
                                           (qid,)).fetchone()["answer"], "Z")

    def test_refresh_snapshots_backfills_answer(self):
        qid, pid = self._seed_with_answer()
        # 模拟「旧快照」：把答案字段从快照里去掉
        snap = bp.list_items(self.conn, pid)[0]["snapshot"]
        for k in ("answer", "analysis", "answer_source"):
            snap.pop(k, None)
        self.conn.execute("UPDATE paper_questions SET snapshot_json=? WHERE paper_id=?",
                          (json.dumps(snap, ensure_ascii=False), pid))
        self.conn.commit()
        self.assertIsNone(bp.build_export_payload(
            self.conn, pid, answer_mode="答案解析版")["sections"][-1]["questions"][0]["answer"])
        # 刷新后答案回到快照（F6：按试卷刷新，需显式传 paper_id）
        res = bp.refresh_snapshots(self.conn, pid)
        self.assertEqual(res["refreshed"], 1)
        self.assertEqual(res["skipped_version_changed"], 0)
        q = bp.build_export_payload(
            self.conn, pid, answer_mode="答案解析版")["sections"][-1]["questions"][0]
        self.assertEqual(q["answer"], "A")
        self.assertEqual(q["analysis"], "解析正文")


# --------------------------------------------------------------------------- #
# 跨题共用材料（按 来源 + 大题 聚合）
# --------------------------------------------------------------------------- #
class TestMaterialGroup(PaperTestBase):
    def test_group_expands_and_stays_adjacent(self):
        seed = _seed(self.conn, [
            {"text": "1．材料题甲", "number": "1", "section": "三、实验探究题", "start": 10},
            {"text": "2．材料题乙", "number": "2", "section": "三、实验探究题", "start": 11},
            {"text": "3．材料题丙", "number": "3", "section": "三、实验探究题", "start": 12},
            {"text": "4．独立题", "number": "4", "section": "一、选择题", "start": 1}])
        group = bp.question_group(self.conn, seed["qids"][1])
        self.assertEqual(group, seed["qids"][:3])
        # 只加中间一道，开启整组 -> 三题一并加入且相邻
        pid = bp.create_paper(self.conn, "卷")["id"]
        res = bp.add_questions(self.conn, pid, [seed["qids"][1]], keep_material_together=True)
        self.assertTrue(res["expanded"])
        self.assertEqual([a["question_id"] for a in res["added"]], seed["qids"][:3])
        self.assertEqual([it["question_id"] for it in bp.list_items(self.conn, pid)],
                         seed["qids"][:3])

    def test_sectionless_is_singleton(self):
        seed = _seed(self.conn, [{"text": "1．独立题", "number": "1"}])
        self.assertEqual(bp.question_group(self.conn, seed["qids"][0]), seed["qids"])


# --------------------------------------------------------------------------- #
# 级联清理
# --------------------------------------------------------------------------- #
class TestCascade(PaperTestBase):
    def test_delete_paper_leaves_no_orphans(self):
        seed = _seed(self.conn, [{"text": f"{i}．题{i}", "number": str(i)} for i in range(1, 4)])
        pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_section(self.conn, pid, "一、选择题")
        bp.add_questions(self.conn, pid, seed["qids"])
        bp.delete_paper(self.conn, pid, force=True)
        self.assertEqual(bp.orphans(self.conn), {"paper_questions": 0, "paper_sections": 0})
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM paper_questions").fetchone()[0], 0)
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM paper_sections").fetchone()[0], 0)

    def test_delete_question_cascades_item(self):
        seed = _seed(self.conn, [{"text": "1．浮力"}])
        qid = seed["qids"][0]
        pid = bp.create_paper(self.conn, "卷")["id"]
        bp.add_questions(self.conn, pid, [qid])
        self.assertEqual(len(bp.list_items(self.conn, pid)), 1)
        self.conn.execute("DELETE FROM questions WHERE id = ?", (qid,))
        self.conn.commit()
        self.assertEqual(len(bp.list_items(self.conn, pid)), 0)


if __name__ == "__main__":
    unittest.main()
