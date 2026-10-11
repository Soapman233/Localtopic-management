"""答案 / 解析抽取测试：内联拆分 / 配对文件对齐 / 迁移幂等 / 不覆盖 / 不编造。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 答案抽取测试
# description: 覆盖 answers 的内联拆分、配对对齐、题号路径内容佐证、可疑答案复核、幂等迁移、不覆盖已有值与保守跳过。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bank import answers as ba
from bank import db as bdb
from bank import textutil as btu


# --------------------------------------------------------------------------- #
# 路径 A：内联拆分（纯函数）
# --------------------------------------------------------------------------- #
class TestSplitInline(unittest.TestCase):
    def test_answer_then_analysis(self):
        stem, ans, ana = ba.split_inline("1．题干⟦F1⟧（  ）\nA．甲\n【答案】A\n【详解】因为所以⟦F2⟧")
        self.assertEqual(stem, "1．题干⟦F1⟧（  ）\nA．甲")
        self.assertEqual(ans, "A")
        self.assertEqual(ana, "因为所以⟦F2⟧")

    def test_answer_only(self):
        stem, ans, ana = ba.split_inline("1．题干\n【答案】B   ")
        self.assertEqual(stem, "1．题干")
        self.assertEqual(ans, "B")
        self.assertIsNone(ana)

    def test_analysis_only(self):
        stem, ans, ana = ba.split_inline("1．题干\n【解析】解析正文")
        self.assertEqual(stem, "1．题干")
        self.assertIsNone(ans)
        self.assertEqual(ana, "解析正文")

    def test_no_marker(self):
        stem, ans, ana = ba.split_inline("1．没有标记的题干")
        self.assertEqual(stem, "1．没有标记的题干")
        self.assertIsNone(ans)
        self.assertIsNone(ana)

    def test_various_analysis_markers(self):
        for mk in ("【详解】", "【解析】", "【解答】", "【分析】", "【点评】"):
            _, ans, ana = ba.split_inline(f"1．题干\n【答案】C\n{mk}正文")
            self.assertEqual(ans, "C", mk)
            self.assertEqual(ana, "正文", mk)

    def test_answer_marker_variants(self):
        for mk in ("【答案】", "【参考答案】"):
            _, ans, _ = ba.split_inline(f"1．题干\n{mk}D")
            self.assertEqual(ans, "D", mk)

    def test_answer_and_analysis_combined_marker(self):
        # 【答案与解析】只作为解析标记（不作为逐题答案标记），答案保持 None
        stem, ans, ana = ba.split_inline("1．题干\n【答案与解析】正文")
        self.assertEqual(stem, "1．题干")
        self.assertIsNone(ans)
        self.assertEqual(ana, "正文")

    def test_placeholder_preserved_in_stem(self):
        stem, ans, _ = ba.split_inline("1．质量与⟦F1⟧、⟦F2⟧有关\n【答案】A")
        self.assertIn("⟦F1⟧", stem)
        self.assertIn("⟦F2⟧", stem)

    def test_empty_stem_is_not_split(self):
        # 原文以标记开头 -> 无题干可保留 -> 整体放弃（不制造空题干）
        stem, ans, ana = ba.split_inline("【答案】A\n【详解】正文")
        self.assertEqual(stem, "【答案】A\n【详解】正文")
        self.assertIsNone(ans)
        self.assertIsNone(ana)

    def test_reference_answer_table_not_treated_as_answer(self):
        # 裸「参考答案」（整卷答案表）不作为逐题答案标记
        stem, ans, ana = ba.split_inline("1．题干\n参考答案\n题号\n1\n答案\nA")
        self.assertIsNone(ans)
        self.assertIsNone(ana)


# --------------------------------------------------------------------------- #
# 路径 B：配对与对齐（纯函数）
# --------------------------------------------------------------------------- #
class TestPairHelpers(unittest.TestCase):
    def test_canonical_name(self):
        self.assertEqual(
            ba.canonical_name("11.5 机械效率（重难点专练）（原卷版）.docx"),
            ba.canonical_name("11.5 机械效率（重难点专练）（解析版）.docx"))
        self.assertEqual(
            ba.canonical_name("专题17 电学实验专题（ 共35题）原卷版.docx"),
            ba.canonical_name("专题17 电学实验专题（ 共35题）解析版.docx"))

    def test_parse_answer_key(self):
        self.assertEqual(ba._parse_answer_key("1．C"), "C")
        self.assertEqual(ba._parse_answer_key("13．  扩散  分子"), "扩散  分子")
        self.assertEqual(ba._parse_answer_key("2．A\n题型02 活动"), "A")
        self.assertIsNone(ba._parse_answer_key("没有题号"))
        self.assertIsNone(ba._parse_answer_key("1．" + "长" * 200))

    def test_compatible(self):
        self.assertTrue(ba._compatible("1．物体受到的浮力", "1．物体受到的浮力"))
        # 前缀关系（解析版题干多了一段被误并的章节标题）也算兼容
        self.assertTrue(ba._compatible("1．物体受到的浮力", "1．物体受到的浮力\n第二卷"))
        self.assertFalse(ba._compatible("1．物体受到的浮力", "2．完全不同的另一道题"))
        self.assertFalse(ba._compatible("", "1．物体受到的浮力"))

    def test_answer_key_stem(self):
        self.assertEqual(ba._answer_key_stem("2．A"), "")
        self.assertEqual(ba._answer_key_stem("2．A\n题型02 活动"), "题型02 活动")
        self.assertEqual(ba._answer_key_stem("9. （1）分子，空隙；"), "")

    def test_number_corroborated(self):
        # 纯「编号+答案」无残留 -> 无法佐证
        self.assertFalse(ba._number_corroborated("2．A", "2．沙子是____（连续的/不连续的）"))
        # 残留是章节标题、与原题开头不重叠 -> 无法佐证
        self.assertFalse(ba._number_corroborated("2．A\n题型02 活动：收集分子运动的证据",
                                                 "2．沙子是____（连续的/不连续的）"))
        # 残留是**章节标题**、恰好出现在原题**尾部**（入库时被并进上一题）-> 仍不算佐证
        self.assertFalse(ba._number_corroborated(
            "10．B\n二、填空题(共12分。)",
            "10．如图所示，将量杯放在水平地面上。二、填空题(共12分。)"))
        # 残留带原题题干开头 -> 佐证通过
        self.assertTrue(ba._number_corroborated("1．A\n物体受到的浮力与排开液体体积有关",
                                                "1．物体受到的浮力与排开液体体积有关"))
        # 短残留（< 8 字）不算佐证
        self.assertFalse(ba._number_corroborated("1．A\n如图", "1．如图所示的电路中"))


# --------------------------------------------------------------------------- #
# 数据库测试基类
# --------------------------------------------------------------------------- #
def _src(conn, name, stage="初中", subject="物理"):
    cur = conn.execute(
        "INSERT INTO source_files(path, sha256, file_name, stage, subject, grade, textbook)"
        " VALUES (?,?,?,?,?, '八年级下册', '苏科版')",
        (name, "sha-" + name, name, stage, subject))
    return cur.lastrowid


def _q(conn, sid, number, text, *, section=None, start=0, formulas=(), images=()):
    plain = btu.strip_placeholders(text)
    chash = btu.content_hash(text)
    cur = conn.execute(
        "INSERT INTO questions(source_id, number, text, plain_text, content_hash, difficulty,"
        " char_length, version, section, start_paragraph, end_paragraph)"
        " VALUES (?,?,?,?,?, '未标注', ?, 1, ?, ?, ?)",
        (sid, number, text, plain, chash, len(plain), section, start, start + 1))
    qid = cur.lastrowid
    conn.execute(
        "INSERT INTO question_versions(question_id, version, content_hash, text, plain_text,"
        " char_length, created_at) VALUES (?,1,?,?,?,?, '2026-01-01T00:00:00')",
        (qid, chash, text, plain, len(plain)))
    for i, latex in enumerate(formulas):
        conn.execute("INSERT INTO formulas(question_id, source_id, fid, seq, kind, status, latex)"
                     " VALUES (?,?,?,?, 'omml', 'OK', ?)", (qid, sid, f"F{qid}_{i}", i + 1, latex))
    for p in images:
        conn.execute("INSERT INTO images(question_id, source_id, media_path, sha256)"
                     " VALUES (?,?,?, 'abc')", (qid, sid, p))
    return qid


class AnswersDbBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()


# --------------------------------------------------------------------------- #
# 迁移 / 路径 A 落库
# --------------------------------------------------------------------------- #
class TestExtractInline(AnswersDbBase):
    def test_ensure_columns_present_and_idempotent(self):
        # 新库的 DDL 已含答案列 -> 迁移无新增；且重复调用幂等
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(questions)")}
        self.assertTrue({"answer", "analysis", "answer_source"} <= cols)
        self.assertEqual(ba.ensure_answer_columns(self.conn), [])
        self.assertEqual(ba.ensure_answer_columns(self.conn), [])

    def test_ensure_columns_migrates_legacy_table(self):
        # 模拟旧库：手工建一张缺列的 questions 表 -> ALTER 补齐，且幂等
        import sqlite3
        legacy = sqlite3.connect(":memory:")
        legacy.row_factory = sqlite3.Row
        legacy.execute("CREATE TABLE questions (id INTEGER PRIMARY KEY, text TEXT)")
        added = ba.ensure_answer_columns(legacy)
        self.assertIn("questions.answer", added)
        self.assertIn("questions.analysis", added)
        self.assertIn("questions.answer_source", added)
        self.assertEqual(ba.ensure_answer_columns(legacy), [])
        legacy.close()

    def test_inline_writes_answer_and_analysis(self):
        sid = _src(self.conn, "a.docx")
        qid = _q(self.conn, sid, "1", "1．题干⟦F1⟧\n【答案】A\n【详解】因为所以",
                 formulas=["F=ma"])
        self.conn.commit()
        st = ba.extract_inline(self.conn)
        self.assertEqual(st["answer"], 1)
        self.assertEqual(st["analysis"], 1)
        row = self.conn.execute("SELECT answer, analysis, answer_source, text FROM questions"
                                " WHERE id=?", (qid,)).fetchone()
        self.assertEqual(row["answer"], "A")
        self.assertEqual(row["analysis"], "因为所以")
        self.assertEqual(row["answer_source"], ba.SOURCE_INLINE)
        # 题干与公式未被动过
        self.assertIn("⟦F1⟧", row["text"])
        n_f = self.conn.execute("SELECT COUNT(*) c FROM formulas WHERE question_id=?",
                                (qid,)).fetchone()["c"]
        self.assertEqual(n_f, 1)

    def test_inline_idempotent(self):
        sid = _src(self.conn, "a.docx")
        _q(self.conn, sid, "1", "1．题干\n【答案】A")
        self.conn.commit()
        ba.extract_inline(self.conn)
        st2 = ba.extract_inline(self.conn)
        self.assertEqual(st2["answer"], 0)
        self.assertEqual(st2["kept_existing"], 1)

    def test_dry_run_writes_nothing(self):
        sid = _src(self.conn, "a.docx")
        _q(self.conn, sid, "1", "1．题干\n【答案】A")
        self.conn.commit()
        cols_before = {r["name"] for r in self.conn.execute("PRAGMA table_info(questions)")}
        st = ba.extract_inline(self.conn, dry_run=True)
        self.assertEqual(st["answer"], 1)                        # 有统计
        cols_after = {r["name"] for r in self.conn.execute("PRAGMA table_info(questions)")}
        self.assertEqual(cols_before, cols_after)                # 未加列

    def test_does_not_overwrite_existing(self):
        ba.ensure_answer_columns(self.conn)
        sid = _src(self.conn, "a.docx")
        qid = _q(self.conn, sid, "1", "1．题干\n【答案】A")
        self.conn.execute("UPDATE questions SET answer='旧值', answer_source='paired_file'"
                          " WHERE id=?", (qid,))
        self.conn.commit()
        ba.extract_inline(self.conn)
        row = self.conn.execute("SELECT answer, answer_source FROM questions WHERE id=?",
                                (qid,)).fetchone()
        self.assertEqual(row["answer"], "旧值")
        self.assertEqual(row["answer_source"], "paired_file")


# --------------------------------------------------------------------------- #
# 路径 B 落库
# --------------------------------------------------------------------------- #
class TestExtractPaired(AnswersDbBase):
    def _build_groups(self):
        # 组 A：原卷版 + 解析版（按题干对齐）
        so = _src(self.conn, "9.4 浮力（同步练习）（原卷版）.docx")
        sa = _src(self.conn, "9.4 浮力（同步练习）（解析版）.docx")
        q1 = _q(self.conn, so, "1", "1．物体受到的浮力与排开液体体积有关", start=1)
        q2 = _q(self.conn, so, "2", "2．下列说法正确的是（  ）\nA．甲\nB．乙", start=3)
        # 解析版题干与原卷版逐字一致，尾部多了答案/解析
        _q(self.conn, sa, "1", "1．物体受到的浮力与排开液体体积有关\n【答案】A\n【详解】解析一",
           start=1)
        _q(self.conn, sa, "2", "2．下列说法正确的是（  ）\nA．甲\nB．乙\n【答案】B\n【解析】解析二",
           start=3)
        # 组 B：原卷版 + 答案版（按题号对齐）
        so2 = _src(self.conn, "第8章 力与运动（原卷版）.docx")
        sb2 = _src(self.conn, "第8章 力与运动（答案版）.docx")
        q3 = _q(self.conn, so2, "1", "1．某物体做匀速直线运动，其速度保持不变", start=1)
        q4 = _q(self.conn, so2, "2", "2．关于惯性，下列说法正确的是", start=3)
        _q(self.conn, sb2, "1", "1．C", start=1)
        _q(self.conn, sb2, "2", "2．D", start=3)
        self.conn.commit()
        return q1, q2, q3, q4

    def test_pair_source_files(self):
        self._build_groups()
        groups = ba.pair_source_files(self.conn)
        self.assertEqual(len(groups), 2)
        kinds = {k for v in groups.values() for k in v}
        self.assertIn(ba.ORIGINAL_KIND, kinds)
        self.assertIn("解析版", kinds)
        self.assertIn("答案版", kinds)

    def test_extract_paired_aligns(self):
        q1, q2, q3, q4 = self._build_groups()
        st = ba.extract_paired(self.conn)
        # 解析版按内容对齐 2 题；答案版是纯「题号+答案」，无题干佐证 -> 全部跳过
        self.assertEqual(st["matched"], 2)
        self.assertEqual(st["match_stem"], 2)
        self.assertEqual(st["match_number"], 0)
        self.assertEqual(st["skipped"]["no_corroboration"], 2)
        rows = {r["id"]: r for r in self.conn.execute(
            "SELECT id, answer, analysis, answer_source FROM questions")}
        self.assertEqual(rows[q1]["answer"], "A")
        self.assertEqual(rows[q1]["analysis"], "解析一")
        self.assertEqual(rows[q1]["answer_source"], ba.SOURCE_PAIRED)
        self.assertEqual(rows[q2]["answer"], "B")
        # 无佐证的题号路径不得写入（宁可少写，也不能写错）
        self.assertIsNone(rows[q3]["answer"])
        self.assertIsNone(rows[q4]["answer"])
        # 原卷版题干未被改动
        self.assertIn("排开液体体积", self.conn.execute(
            "SELECT text FROM questions WHERE id=?", (q1,)).fetchone()["text"])

    def test_number_path_requires_corroboration(self):
        # 答案版只有「编号+答案」-> 无法佐证题号与原题对应 -> 不写
        so = _src(self.conn, "卷（原卷版）.docx")
        sb = _src(self.conn, "卷（答案版）.docx")
        q1 = _q(self.conn, so, "1", "1．甲题内容", start=1)
        _q(self.conn, sb, "1", "1．A", start=1)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["matched"], 0)
        self.assertEqual(st["skipped"]["no_corroboration"], 1)
        self.assertIsNone(self.conn.execute("SELECT answer FROM questions WHERE id=?",
                                            (q1,)).fetchone()["answer"])

    def test_number_path_writes_when_stem_corroborates(self):
        # 答案版条目除「编号+答案」外还带与原题重叠的题干 -> 佐证通过，才写入
        so = _src(self.conn, "卷（原卷版）.docx")
        sb = _src(self.conn, "卷（答案版）.docx")
        q1 = _q(self.conn, so, "1", "1．物体受到的浮力与排开液体体积有关", start=1)
        _q(self.conn, sb, "1", "1．A\n物体受到的浮力与排开液体体积有关", start=1)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["matched"], 1)
        self.assertEqual(st["match_number"], 1)
        self.assertEqual(self.conn.execute("SELECT answer FROM questions WHERE id=?",
                                           (q1,)).fetchone()["answer"], "A")

    def test_numbering_mismatch_no_wrong_answer(self):
        # 回归：答案版题号与原卷版**不一致**（复刻 id=2919 场景）。
        # 原卷版 #2 是填空题（答案为文本），答案版 #2 却是某选择题的「A」；
        # 无题干佐证 -> 必须跳过，绝不能把 'A' 写到填空题上。
        so = _src(self.conn, "一、走进分子世界（原卷版）.docx")
        sb = _src(self.conn, "一、走进分子世界（答案版）.docx")
        _q(self.conn, so, "1", "1．酒精与水混合后体积变小（  ）\nA．分子间有空隙", start=1)
        q2 = _q(self.conn, so, "2",
                "2．小华看见沙子流下时是连续的，放大后发现沙子是____（连续的/不连续的）",
                start=3)
        _q(self.conn, sb, "1", "1．C", start=1)
        _q(self.conn, sb, "2", "2．A", start=3)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["matched"], 0)
        self.assertEqual(st["match_number"], 0)
        self.assertGreaterEqual(st["skipped"]["no_corroboration"], 1)
        row = self.conn.execute("SELECT answer, answer_source FROM questions WHERE id=?",
                                (q2,)).fetchone()
        self.assertIsNone(row["answer"])
        self.assertIsNone(row["answer_source"])

    def test_idempotent_no_double_write(self):
        # 幂等守卫读当前库值：同组内 解析版 先写 answer_source 后，答案版不得再写
        so = _src(self.conn, "卷（原卷版）.docx")
        sa = _src(self.conn, "卷（解析版）.docx")
        sb = _src(self.conn, "卷（答案版）.docx")
        q1 = _q(self.conn, so, "1", "1．物体受到的浮力与排开液体体积有关", start=1)
        # 解析版只给解析（无答案），但会写 answer_source -> 答案版必须被挡下
        _q(self.conn, sa, "1", "1．物体受到的浮力与排开液体体积有关\n【解析】解析一", start=1)
        _q(self.conn, sb, "1", "1．A\n物体受到的浮力与排开液体体积有关", start=1)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["match_stem"], 1)
        self.assertEqual(st["match_number"], 0)                 # 已被解析版占用 -> 不写
        self.assertGreaterEqual(st["skipped"]["kept_existing"], 1)
        row = self.conn.execute("SELECT answer, analysis, answer_source FROM questions"
                                " WHERE id=?", (q1,)).fetchone()
        self.assertIsNone(row["answer"])                        # 解析版无答案
        self.assertEqual(row["analysis"], "解析一")
        self.assertEqual(row["answer_source"], ba.SOURCE_PAIRED)

    def test_extract_paired_idempotent(self):
        self._build_groups()
        ba.extract_paired(self.conn)
        st2 = ba.extract_paired(self.conn)
        self.assertEqual(st2["matched"], 0)
        self.assertGreater(st2["skipped"]["kept_existing"], 0)

    def test_ambiguous_number_skipped(self):
        # 原卷版有两道同题号的题 -> 答案版按题号无法唯一对齐 -> 跳过，不错配
        so = _src(self.conn, "卷（原卷版）.docx")
        sb = _src(self.conn, "卷（答案版）.docx")
        qa = _q(self.conn, so, "1", "1．甲题", start=1)
        qb = _q(self.conn, so, "1", "1．乙题", start=3)
        _q(self.conn, sb, "1", "1．A", start=1)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["matched"], 0)
        self.assertEqual(st["skipped"]["ambiguous_number"], 1)
        for qid in (qa, qb):
            self.assertIsNone(self.conn.execute("SELECT answer FROM questions WHERE id=?",
                                                (qid,)).fetchone()["answer"])

    def test_no_stem_match_skipped(self):
        so = _src(self.conn, "卷（原卷版）.docx")
        sa = _src(self.conn, "卷（解析版）.docx")
        qa = _q(self.conn, so, "1", "1．甲题内容", start=1)
        _q(self.conn, sa, "1", "1．完全不同的另一道题\n【答案】A", start=1)
        self.conn.commit()
        st = ba.extract_paired(self.conn)
        self.assertEqual(st["matched"], 0)
        self.assertEqual(st["skipped"]["no_stem"], 1)
        self.assertIsNone(self.conn.execute("SELECT answer FROM questions WHERE id=?",
                                            (qa,)).fetchone()["answer"])


# --------------------------------------------------------------------------- #
# 可疑答案复核
# --------------------------------------------------------------------------- #
class TestSuspicious(AnswersDbBase):
    def test_single_letter_on_blank_flagged(self):
        ba.ensure_answer_columns(self.conn)
        sid = _src(self.conn, "a.docx")
        qid = _q(self.conn, sid, "1", "1．沙子是____（连续的/不连续的）")
        self.conn.execute("UPDATE questions SET answer='A', answer_source='paired_file'"
                          " WHERE id=?", (qid,))
        self.conn.commit()
        found = ba.find_suspicious_answers(self.conn)
        self.assertEqual([f["id"] for f in found], [qid])
        self.assertEqual(found[0]["reason"], "single_letter_on_blank")

    def test_mcq_and_lowercase_blank_not_flagged(self):
        ba.ensure_answer_columns(self.conn)
        sid = _src(self.conn, "a.docx")
        # 选择题：单字母答案正常
        q1 = _q(self.conn, sid, "1", "1．下列说法正确的是（  ）\nA．甲\nB．乙\nC．丙\nD．丁")
        # 填空题但答案为小写字母（选填 a/b/c）-> 不算可疑
        q2 = _q(self.conn, sid, "2", "2．小球将沿____条路线运动。（选填“a”“b”“c”或“d”）")
        self.conn.execute("UPDATE questions SET answer='A', answer_source='inline' WHERE id=?",
                          (q1,))
        self.conn.execute("UPDATE questions SET answer='c', answer_source='inline' WHERE id=?",
                          (q2,))
        self.conn.commit()
        self.assertEqual(ba.find_suspicious_answers(self.conn), [])


# --------------------------------------------------------------------------- #
# 端到端
# --------------------------------------------------------------------------- #
class TestExtractEndToEnd(AnswersDbBase):
    def test_extract_and_coverage(self):
        sid = _src(self.conn, "a.docx")
        _q(self.conn, sid, "1", "1．题干\n【答案】A\n【详解】解析")
        _q(self.conn, sid, "2", "2．没有答案的题干")
        self.conn.commit()
        before = ba.coverage(self.conn)
        self.assertEqual(before["with_answer"], 0)
        res = ba.extract(self.conn)
        self.assertFalse(res["dry_run"])
        self.assertEqual(res["after"]["with_answer"], 1)
        self.assertEqual(res["after"]["with_analysis"], 1)
        self.assertEqual(res["after"]["by_source"][ba.SOURCE_INLINE], 1)
        # 无标记的题保持 NULL（绝不编造）
        row = self.conn.execute(
            "SELECT answer, analysis FROM questions WHERE number='2'").fetchone()
        self.assertIsNone(row["answer"])
        self.assertIsNone(row["analysis"])


if __name__ == "__main__":
    unittest.main()
