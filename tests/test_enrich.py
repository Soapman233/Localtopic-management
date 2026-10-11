"""enrich 模块测试：推断规则 / 迁移幂等 / 不覆盖 / 难度不猜 / 端到端补全。

用标准库 unittest，数据库用临时文件。
"""
# ---------------------------------------------------------------------------
# title: 元数据补全测试
# description: 覆盖 enrich 的推断规则、迁移幂等、不覆盖、难度不猜与端到端补全；含覆盖率题目级口径回归（grade/textbook 分母为题目数）。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import sqlite3 as bsql
import tempfile
import unittest
from pathlib import Path

from bank import db as bdb
from bank import enrich as be
from bank import importer as bimp
from bank import metadata as bmeta

# 一条 OK 公式，供 fixture 使用（保证 formulas 核心表非空）。
_OK_FORMULA = {"F1": {"id": "F1", "kind": "omml", "status": "OK", "latex": "\\alpha",
                      "progid": None, "part": None, "preview": None}}


def _q(number, text, *, section=None, start=0, end=1, formula_ids=None, images=None):
    return {
        "number": number, "label": "编号", "start_paragraph": start, "end_paragraph": end,
        "text": text, "formula_ids": formula_ids or [], "images": images or [],
        "section": section, "sub_question_count": 0,
    }


def _full_question():
    """带公式与图片的题目，保证 formulas / images 两张核心表非空。"""
    return _q("1", "1．物体受到的浮力 ⟦F1⟧", formula_ids=["F1"],
              images=["media/image1.png"])


def _write_fixture(dir_path: Path, name: str, questions: list, *,
                   source_path=None, formulas=None) -> Path:
    formulas = formulas or {}
    qj = {"path": source_path or "", "stats": {}, "questions": questions,
          "unassigned_before_first": [],
          "formula_index": {fid: {k: f.get(k) for k in ("kind", "status", "latex", "progid")}
                            for fid, f in formulas.items()}}
    scan = {"path": source_path or "", "stats": {}, "paragraphs": [],
            "formulas": formulas, "images": {}}
    qf = dir_path / f"{name}.questions.json"
    qf.write_text(json.dumps(qj, ensure_ascii=False), encoding="utf-8")
    (dir_path / f"{name}.scan.json").write_text(
        json.dumps(scan, ensure_ascii=False), encoding="utf-8")
    return qf


class TestInferenceRules(unittest.TestCase):
    def test_textbook_from_name_and_path(self):
        self.assertEqual(be.infer_textbook("9.4 浮力 苏科版物理八年级下册.docx", ""),
                         ("苏科版", "filename"))
        self.assertEqual(
            be.infer_textbook("练习.docx",
                              r"C:\物理\初中\2025苏科版物理八年级下册\练习.docx"),
            ("苏科版", "path"))
        # 江苏专用是地区，不是教材版本
        self.assertEqual(be.infer_textbook("2026年中考物理（江苏专用）.docx", ""),
                         (be.UNKNOWN, "unresolved"))
        self.assertEqual(be.infer_textbook("2026年中考物理二轮专题.docx", ""),
                         (be.UNKNOWN, "unresolved"))

    def test_grade_from_filename(self):
        self.assertEqual(be.infer_grade("苏科版物理八年级下册同步.docx", "", None),
                         ("八年级下册", "filename"))
        self.assertEqual(be.infer_grade("八年级上册 物理.docx", "", None),
                         ("八年级上册", "filename"))
        self.assertEqual(be.infer_grade("2025-2026学年苏州市八年级下学期物理.docx", "", None),
                         ("八年级下册", "filename"))
        self.assertEqual(be.infer_grade("高中物理 必修第一册.docx", "", None),
                         ("高中必修第一册", "filename"))
        self.assertEqual(be.infer_grade("高一物理.docx", "", None), ("高一", "filename"))

    def test_grade_from_chapter_map(self):
        # 人教版：第9章 -> 八年级下册
        self.assertEqual(be.infer_grade("人教版物理 第9章.docx", "", "9"),
                         ("八年级下册", "chapter_map"))
        # 苏科版：第13章 -> 九年级上册；第16章 -> 九年级下册
        self.assertEqual(be.infer_grade("苏科版物理 第13章.docx", "", "13"),
                         ("九年级上册", "chapter_map"))
        self.assertEqual(be.infer_grade("苏科版物理 第16章.docx", "", "16"),
                         ("九年级下册", "chapter_map"))

    def test_grade_chapter_map_requires_known_textbook(self):
        # 教材未知时不得用映射（避免张冠李戴）
        self.assertEqual(be.infer_grade("第13章 内能.docx", "", "13"),
                         (be.UNKNOWN, "unresolved"))

    def test_chapter(self):
        self.assertEqual(be.infer_chapter("9.4 浮力 同步练习.docx", None, None),
                         ("9.4", "filename"))
        self.assertEqual(be.infer_chapter("9.1.2 固体压强.docx", None, None),
                         ("9.1.2", "filename"))
        self.assertEqual(be.infer_chapter("课时10.1  走进分子世界.docx", None, None),
                         ("10.1", "filename"))
        self.assertEqual(be.infer_chapter("第7章 力.docx", None, None), ("7", "filename"))
        self.assertEqual(be.infer_chapter("第十章 从粒子到宇宙.docx", None, None),
                         ("10", "filename"))
        # 专题/专项不是教材章节
        self.assertEqual(be.infer_chapter("专题13 匀变速直线运动.docx", None, None),
                         (be.UNKNOWN, "unresolved"))
        self.assertEqual(be.infer_chapter("专项05 浮力综合.docx", None, None),
                         (be.UNKNOWN, "unresolved"))
        # section 兜底
        self.assertEqual(be.infer_chapter("练习.docx", "第九章 压强", "1．题干"),
                         ("9", "section"))

    def test_knowledge_points(self):
        kps = be.infer_knowledge_points(
            "9.4 浮力 同步练习", "一、单选题", "物体受到的浮力与排开液体体积有关")
        names = [n for n, _ in kps]
        srcs = dict(kps)
        self.assertIn("浮力", names)
        self.assertIn("排开液体", names)
        self.assertEqual(srcs["浮力"], "chapter_title")   # 来自章节标题词
        self.assertEqual(srcs["排开液体"], "dictionary")   # 来自词典
        # 单字概念词不入词典（避免误命中）
        self.assertNotIn("力", be.KNOWLEDGE_TERMS)
        self.assertNotIn("功", be.KNOWLEDGE_TERMS)
        self.assertTrue(all(len(t) >= 2 for t in be.KNOWLEDGE_TERMS))


class TestEnrichDb(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def test_ensure_columns_idempotent(self):
        added = be.ensure_provenance_columns(self.conn)
        self.assertIn("source_files.grade_source", added)
        self.assertIn("source_files.textbook_source", added)
        self.assertIn("questions.chapter_source", added)
        self.assertIn("question_labels.source", added)
        # 再次执行不新增、不报错
        self.assertEqual(be.ensure_provenance_columns(self.conn), [])

    def test_enrich_end_to_end_and_idempotent(self):
        # 文件 A：文件名已含教材/年级/章节（导入器会填），enrich 只补记来源 + 知识点
        a_src = str(self.dir / "9.4 浮力 同步练习-2025-2026学年苏科版物理八年级下册.docx")
        _write_fixture(self.dir, "9.4 浮力 同步练习-2025-2026学年苏科版物理八年级下册",
                       [_q("1", "1．物体受到的浮力与排开液体体积有关", section="一、单选题")],
                       source_path=a_src)
        # 文件 B：文件名无元数据，但源路径含教材/年级（enrich 从路径补全）
        b_src = (r"C:\Users\SOAP\Desktop\物理\初中"
                 r"\2025-2026学年苏科版物理八年级下册\第8章 力与运动（原卷版）.docx")
        _write_fixture(self.dir, "第8章 力与运动（原卷版）",
                       [_q("1", "1．某物体做匀速直线运动，其速度保持不变")],
                       source_path=b_src)
        bimp.import_path(self.conn, self.dir, verbose=False)

        before = be.coverage(self.conn)
        st = be.enrich(self.conn)
        after = be.coverage(self.conn)

        # 文件 B 的 grade/textbook 由 enrich 从路径补全
        row_b = self.conn.execute(
            "SELECT grade, grade_source, textbook, textbook_source FROM source_files"
            " WHERE file_name LIKE '%力与运动%'").fetchone()
        self.assertEqual(row_b["grade"], "八年级下册")
        self.assertEqual(row_b["grade_source"], "filename")   # 路径直接含年级，统一记 filename
        self.assertEqual(row_b["textbook"], "苏科版")
        self.assertEqual(row_b["textbook_source"], "path")
        self.assertEqual(st["grade"]["new"], 1)
        self.assertEqual(st["textbook"]["new"], 1)

        # 文件 A 的既有值不被覆盖，仅补记来源
        row_a = self.conn.execute(
            "SELECT grade, grade_source, textbook FROM source_files"
            " WHERE file_name LIKE '%浮力%'").fetchone()
        self.assertEqual(row_a["grade"], "八年级下册")
        self.assertEqual(row_a["grade_source"], be.IMPORTER_SOURCE)
        self.assertEqual(row_a["textbook"], "苏科版")

        # 知识点：命名空间 + 关联 + 来源
        ns = {r["namespace"] for r in self.conn.execute("SELECT DISTINCT namespace FROM labels")}
        self.assertIn("知识点", ns)
        self.assertGreater(st["knowledge"]["new_links"], 0)
        self.assertGreater(after["knowledge"]["n"], 0)

        # 难度绝不猜：全部保持 未标注
        self.assertEqual(st["difficulty_untouched"], 2)
        self.assertEqual(
            {r["difficulty"] for r in self.conn.execute("SELECT difficulty FROM questions")},
            {"未标注"})
        self.assertEqual(after["difficulty"]["n"], 0)

        # 覆盖率提升
        self.assertGreaterEqual(after["grade"]["n"], before["grade"]["n"])
        self.assertGreaterEqual(after["chapter"]["n"], before["chapter"]["n"])

        # 幂等：第二次执行无新增
        st2 = be.enrich(self.conn)
        self.assertEqual(st2["grade"]["new"], 0)
        self.assertEqual(st2["textbook"]["new"], 0)
        self.assertEqual(st2["chapter"]["new"], 0)
        self.assertEqual(st2["knowledge"]["new_links"], 0)
        self.assertEqual(st2["knowledge"]["new_labels"], 0)

    def test_coverage_uses_question_level_denominator(self):
        # F1 回归：grade/textbook 必须与其它维度一样用**题目级**分母，
        # 而不是 source_files 行数——否则「1 个有年级的文件 / 2 个文件 = 50%」
        # 会高估真正的题目级覆盖率（3 题有 / 4 题 = 75%）。
        _write_fixture(self.dir, "A 卷 物理八年级下册 苏科版",
                       [_q("1", "1．浮力题一", start=0),
                        _q("2", "2．浮力题二", start=1),
                        _q("3", "3．浮力题三", start=2)],
                       source_path=str(self.dir / "A.docx"))
        _write_fixture(self.dir, "B 卷",
                       [_q("1", "1．密度题", start=0)],
                       source_path=str(self.dir / "B.docx"))
        bimp.import_path(self.conn, self.dir, verbose=False)
        # 显式固定元数据（不依赖文件名推断）：A 有年级/教材，B 为空占位。
        self.conn.execute("UPDATE source_files SET grade='八年级下册', textbook='苏科版'"
                          " WHERE file_name LIKE 'A%'")
        self.conn.execute("UPDATE source_files SET grade=?, textbook=? WHERE file_name LIKE 'B%'",
                          (be.UNKNOWN, be.UNKNOWN))
        self.conn.commit()

        cov = be.coverage(self.conn)
        self.assertEqual(cov["source_files_total"], 2)
        self.assertEqual(cov["questions_total"], 4)
        # 所有维度的分母都等于题目数（口径统一）。
        for dim in ("grade", "textbook", "chapter", "qtype", "difficulty", "knowledge"):
            self.assertEqual(cov[dim]["total"], 4, dim)
        # A 来源的 3 题继承年级/教材；B 来源的 1 题为空 -> 3/4 = 75%。
        self.assertEqual(cov["grade"]["n"], 3)
        self.assertEqual(cov["textbook"]["n"], 3)
        self.assertEqual(cov["grade"]["pct"], 75.0)
        self.assertEqual(cov["textbook"]["pct"], 75.0)

    def test_dry_run_writes_nothing(self):
        _write_fixture(self.dir, "第8章 力与运动（原卷版）",
                       [_q("1", "1．某物体做匀速直线运动")],
                       source_path=r"C:\物理\初中\2025苏科版物理八年级下册\第8章 力与运动（原卷版）.docx")
        bimp.import_path(self.conn, self.dir, verbose=False)
        cols_before = {r["name"] for r in self.conn.execute("PRAGMA table_info(source_files)")}
        n_labels_before = self.conn.execute("SELECT COUNT(*) c FROM labels").fetchone()["c"]
        st = be.enrich(self.conn, dry_run=True)
        self.assertGreater(st["grade"]["new"], 0)          # 有统计
        cols_after = {r["name"] for r in self.conn.execute("PRAGMA table_info(source_files)")}
        self.assertEqual(cols_before, cols_after)          # 未加列
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) c FROM labels").fetchone()["c"],
            n_labels_before)                                # 未写标签

    def test_backup_and_verify(self):
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        self.assertTrue(bak.is_file())
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertTrue(v["ok"])
        self.assertTrue(v["structure_ok"])
        self.assertTrue(v["integrity_ok"])
        self.assertTrue(v["core_nonempty"])
        self.assertTrue(v["tables_equal"])
        self.assertTrue(v["rowcounts_equal"])

    def test_verify_backup_structure_ok_when_rowcounts_differ(self):
        """真实迁移前备份：核心表非空、仅标签行数不同 -> 仍 ok=True。"""
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        be.enrich(self.conn)                      # 主库新增标签，备份不含
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertTrue(v["ok"])
        self.assertTrue(v["structure_ok"])
        self.assertTrue(v["core_nonempty"])
        self.assertFalse(v["rowcounts_equal"])    # 行数不同属预期
        self.assertIn("迁移前", v["verdict"])

    def test_verify_backup_rejects_emptied_core_table(self):
        """核心表被清空（表在、数据没了）-> ok=False，verdict 不套用「属预期」。"""
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        c = bsql.connect(str(bak))
        c.execute("DELETE FROM images")
        c.commit()
        c.close()
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertFalse(v["ok"])
        self.assertTrue(v["structure_ok"])        # 结构没坏
        self.assertFalse(v["core_nonempty"])
        self.assertIn("images", v["core_empty"])
        self.assertIn("核心表", v["verdict"])
        self.assertNotIn("属预期", v["verdict"])

    def test_verify_backup_rejects_missing_table(self):
        """表结构缺失（DROP TABLE）-> ok=False。"""
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        c = bsql.connect(str(bak))
        c.execute("DROP TABLE images")
        c.commit()
        c.close()
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertFalse(v["ok"])
        self.assertFalse(v["structure_ok"])
        self.assertIn("表结构不一致", v["verdict"])

    def test_verify_backup_accepts_migration_preceding_backup(self):
        """迁移前的备份（备份少表，如阶段3 新增的 paper_sections）-> 仍 ok=True。

        备份是**较早的回滚点**：它可以是原库结构的**子集**，只要核心表齐全即可。
        """
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        # 把备份「退化」为迁移前状态：删掉阶段3 才新增的 paper_sections
        c = bsql.connect(str(bak))
        c.execute("DROP TABLE paper_sections")
        c.commit()
        c.close()
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertTrue(v["ok"])
        self.assertTrue(v["structure_ok"])
        self.assertTrue(v["core_nonempty"])
        self.assertFalse(v["tables_equal"])                    # 表集合并不完全相等
        self.assertIn("paper_sections", v["missing_tables"])   # 备份缺这张（属预期）
        self.assertEqual(v["extra_tables"], [])
        self.assertIn("结构子集", v["verdict"])

    def test_verify_backup_rejects_extra_table(self):
        """备份多出原库没有的表 -> 不是该库的回滚点 -> structure_ok=False。"""
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bak = be.backup_db(self.dir / "bank.db")
        c = bsql.connect(str(bak))
        c.execute("CREATE TABLE extra_table (id INTEGER PRIMARY KEY)")
        c.commit()
        c.close()
        v = be.verify_backup(self.dir / "bank.db", bak)
        self.assertFalse(v["ok"])
        self.assertFalse(v["structure_ok"])
        self.assertIn("extra_table", v["extra_tables"])
        self.assertIn("表结构不一致", v["verdict"])

    def test_verify_backup_corrupt_file_returns_false(self):
        """文件损坏/非数据库 -> ok=False 且带 error，不抛异常（契约一致）。"""
        _write_fixture(self.dir, "a", [_full_question()],
                       source_path=str(self.dir / "a.docx"), formulas=_OK_FORMULA)
        bimp.import_path(self.conn, self.dir, verbose=False)
        bad = self.dir / "corrupt.db"
        bad.write_bytes(b"this is not a sqlite database file " * 50)
        v = be.verify_backup(self.dir / "bank.db", bad)   # 不应抛异常
        self.assertFalse(v["ok"])
        self.assertIn("备份不可用", v["verdict"])

    def test_verify_backup_missing_file_returns_false(self):
        """备份文件不存在 -> ok=False 且带 error，不抛异常。"""
        v = be.verify_backup(self.dir / "bank.db", self.dir / "nope.db")
        self.assertFalse(v["ok"])
        self.assertIsNotNone(v["error"])
        self.assertIn("不存在", v["error"])


class TestDifficultyProtected(unittest.TestCase):
    """难度字段留空保护：源数据无标注，导入与 enrich 都**不得**写入非「未标注」值。

    用户明确要求难度暂时留空、暂不填写。这组测试锁住该约定，防止将来被"自动推断"。
    """

    #: 允许出现的难度取值集合（源数据无标注，只允许空占位）。
    ALLOWED = {"未标注", "NULL", ""}

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.conn = bdb.connect(self.dir / "bank.db")

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def _difficulty_values(self) -> set:
        return {r["difficulty"] for r in
                self.conn.execute("SELECT DISTINCT difficulty FROM questions")}

    def test_importer_writes_only_unmarked(self):
        """导入流程写入的难度恒为「未标注」。"""
        _write_fixture(self.dir, "9.4 浮力 苏科版物理八年级下册",
                       [_q("1", "1．物体受到的浮力"), _q("2", "2．压强计算")],
                       source_path=str(self.dir / "9.4 浮力 苏科版物理八年级下册.docx"))
        bimp.import_path(self.conn, self.dir, verbose=False)
        self.assertEqual(self._difficulty_values(), {"未标注"})
        # 导入器使用的是 metadata 的默认难度常量
        self.assertEqual(be.coverage(self.conn)["difficulty"]["n"], 0)
        self.assertEqual(bmeta.DEFAULT_DIFFICULTY, "未标注")

    def test_enrich_does_not_touch_difficulty(self):
        """enrich 执行前后难度取值集合不变，且仍全为「未标注」。"""
        _write_fixture(self.dir, "第8章 力与运动（原卷版）",
                       [_q("1", "1．某物体做匀速直线运动")],
                       source_path=r"C:\物理\初中\2025苏科版物理八年级下册\第8章 力与运动（原卷版）.docx")
        bimp.import_path(self.conn, self.dir, verbose=False)
        before = self._difficulty_values()
        st = be.enrich(self.conn)
        after = self._difficulty_values()
        self.assertEqual(before, after)
        self.assertEqual(after, {"未标注"})
        # enrich 明确把难度计入「未处理」而不是"已补全"
        self.assertGreater(st["difficulty_untouched"], 0)
        self.assertEqual(be.coverage(self.conn)["difficulty"]["n"], 0)

    def test_difficulty_value_domain_subset(self):
        """任何取值都必须落在 {未标注, NULL, ''} 内（防止编造难度）。"""
        _write_fixture(self.dir, "a", [_q("1", "1．题干")],
                       source_path=str(self.dir / "a.docx"))
        bimp.import_path(self.conn, self.dir, verbose=False)
        be.enrich(self.conn)
        for v in self._difficulty_values():
            self.assertIn(v if v is not None else "NULL", self.ALLOWED,
                          f"出现非预期难度值：{v!r}")


if __name__ == "__main__":
    unittest.main()
