"""SQLite 数据模型：schema、建库、连接、版本管理。

只用标准库 ``sqlite3``，不引入 ORM、不引入外部数据库。

表一览
------
* ``meta``              —— 库元信息（schema 版本、创建时间等）
* ``source_files``      —— 来源文件（路径、sha256、文件名、学段、学科、教材版本、章节）
* ``questions``         —— 题目（当前版本，含可空的 ``answer`` / ``analysis`` /
  ``answer_source`` 答案字段）
* ``question_versions`` —— 题目历史版本（不可变，组卷快照锁定版本用）
* ``formulas``          —— 公式（属于某道题）
* ``images``            —— 图片（属于某道题）
* ``labels`` / ``question_labels`` —— 标签（命名空间 + 名称）与题目多对多
* ``review_queue``      —— 待复核队列（非 OK 的公式）
* ``papers`` / ``paper_sections`` / ``paper_questions`` —— 试卷、大题分组与试卷题目
  （阶段3 组卷；记录题目版本并保存内容快照以锁定试卷内容）
* ``question_fts``      —— 题干中文检索（FTS5，双字切分后的倒排）

关键设计
--------
* 开启外键约束（``PRAGMA foreign_keys = ON``）。
* 幂等锚点：``source_files.sha256`` 唯一；``questions(source_id, content_hash)`` 唯一。
* 变更检测：``questions.version`` + ``question_versions`` 保留历史，
  ``paper_questions.question_version`` 记录组卷时锁定的版本。
"""
# ---------------------------------------------------------------------------
# title: SQLite 数据模型
# description: 定义题库 schema、建库、连接、外键约束与 schema 版本管理。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

SCHEMA_VERSION = 3

DEFAULT_DB_PATH = Path("outputs/bank.db")


# --------------------------------------------------------------------------- #
# DDL
# --------------------------------------------------------------------------- #
DDL = """
-- 元信息 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- 来源文件 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    path            TEXT NOT NULL,
    sha256          TEXT NOT NULL UNIQUE,      -- 幂等锚点（源文件内容指纹）
    file_name       TEXT NOT NULL,
    stage           TEXT,                      -- 学段：初中/高中
    grade           TEXT,                      -- 年级：八年级下册
    subject         TEXT,                      -- 学科：物理
    textbook        TEXT,                      -- 教材版本：苏科版
    chapter         TEXT,                      -- 章节号：10.3
    questions_count INTEGER NOT NULL DEFAULT 0,
    formulas_count  INTEGER NOT NULL DEFAULT 0,
    imported_at     TEXT
);

-- 题目（当前版本）----------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id          INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    number             TEXT NOT NULL,           -- 题号字符串
    label              TEXT,                    -- 编号识别方式：编号/例/第N题
    text               TEXT NOT NULL,           -- 题干（含 ⟦Fn⟧ 占位符）
    plain_text         TEXT NOT NULL,           -- 纯文本题干（去占位符，便于检索）
    section            TEXT,                    -- 所属大题（可能为空）
    chapter            TEXT,                    -- 章节号（由来源冗余，便于索引筛选）
    qtype              TEXT,                    -- 题型
    difficulty         TEXT NOT NULL DEFAULT '未标注',
    char_length        INTEGER NOT NULL DEFAULT 0,
    start_paragraph    INTEGER,
    end_paragraph      INTEGER,
    sub_question_count INTEGER NOT NULL DEFAULT 0,
    content_hash       TEXT NOT NULL,           -- 归一化题干 sha256
    version            INTEGER NOT NULL DEFAULT 1,
    answer             TEXT,                    -- 答案（NULL=未收录，绝不编造）
    analysis           TEXT,                    -- 解析/详解（同上）
    answer_source      TEXT,                    -- 来源：inline / paired_file / NULL
    created_at         TEXT,
    updated_at         TEXT,
    UNIQUE (source_id, content_hash)            -- 同一来源内按内容去重
);

-- 题目历史版本（不可变）----------------------------------------------------
CREATE TABLE IF NOT EXISTS question_versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    text         TEXT NOT NULL,
    plain_text   TEXT NOT NULL,
    char_length  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT,
    UNIQUE (question_id, version)
);

-- 公式 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formulas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id  INTEGER REFERENCES questions(id) ON DELETE CASCADE,
    source_id    INTEGER REFERENCES source_files(id) ON DELETE CASCADE,
    fid          TEXT,                          -- 阶段1 的公式 ID，如 F1
    seq          INTEGER NOT NULL DEFAULT 0,    -- 在题内的出现次序
    kind         TEXT,                          -- omml / mathtype / unknown
    status       TEXT,                          -- OK / EMPTY / FAIL / ...
    latex        TEXT,
    progid       TEXT,
    part         TEXT,
    preview      TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0
);

-- 图片 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
    source_id   INTEGER REFERENCES source_files(id) ON DELETE CASCADE,
    media_path  TEXT,
    sha256      TEXT
);

-- 标签（命名空间 + 名称）---------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,                    -- chapter / section / knowledge / custom
    name      TEXT NOT NULL,
    UNIQUE (namespace, name)
);

CREATE TABLE IF NOT EXISTS question_labels (
    question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    label_id      INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    review_status TEXT NOT NULL DEFAULT '待复核',  -- 知识点人工复核：待复核/已确认/已否决
    PRIMARY KEY (question_id, label_id)
);

-- 待复核队列（非 OK 的公式）------------------------------------------------
CREATE TABLE IF NOT EXISTS review_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
    status     TEXT,
    kind       TEXT,
    progid     TEXT,
    part       TEXT,
    preview    TEXT,
    reason     TEXT,
    resolved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    UNIQUE (formula_id)
);

-- 试卷 / 大题 / 试卷题目（阶段3）------------------------------------------
CREATE TABLE IF NOT EXISTS papers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    subject     TEXT,                            -- 学科：物理
    stage       TEXT,                            -- 学段：初中/高中
    grade       TEXT,                            -- 年级：八年级下册
    template    TEXT NOT NULL DEFAULT '考试',     -- 模板：考试/测验/作业
    answer_mode TEXT NOT NULL DEFAULT '学生版',   -- 答案显示方式：学生版/答案解析版/仅答案
    created_by  TEXT NOT NULL DEFAULT '待补充',   -- 作者类字段按要求留「待补充」
    status      TEXT NOT NULL DEFAULT '草稿',     -- 状态：草稿/定稿/已导出
    created_at  TEXT,
    updated_at  TEXT,
    meta        TEXT
);

CREATE TABLE IF NOT EXISTS paper_sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                   -- 大题名：一、选择题
    seq         INTEGER NOT NULL,                -- 大题顺序（从 1 起）
    description TEXT
);

CREATE TABLE IF NOT EXISTS paper_questions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id         INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    section_id       INTEGER REFERENCES paper_sections(id) ON DELETE SET NULL,
    question_id      INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    question_version INTEGER NOT NULL,          -- 组卷快照：锁定题目版本
    seq              INTEGER NOT NULL,          -- 题序（从 1 起，全卷连续）
    score            REAL,                      -- 分值（NULL = 未设分值，不计入总分）
    snapshot_json    TEXT,                      -- 组卷时锁定的内容快照（题干/公式/图片）
    added_at         TEXT,
    FOREIGN KEY (question_id, question_version)
        REFERENCES question_versions(question_id, version)
);

-- 索引 ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_src_stage    ON source_files(stage);
CREATE INDEX IF NOT EXISTS idx_src_subject  ON source_files(subject);
CREATE INDEX IF NOT EXISTS idx_src_grade    ON source_files(grade);
CREATE INDEX IF NOT EXISTS idx_src_textbook ON source_files(textbook);
CREATE INDEX IF NOT EXISTS idx_src_chapter  ON source_files(chapter);

CREATE INDEX IF NOT EXISTS idx_q_source   ON questions(source_id);
CREATE INDEX IF NOT EXISTS idx_q_chapter  ON questions(chapter);
CREATE INDEX IF NOT EXISTS idx_q_qtype    ON questions(qtype);
CREATE INDEX IF NOT EXISTS idx_q_diff     ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_q_hash     ON questions(content_hash);
CREATE INDEX IF NOT EXISTS idx_q_version  ON questions(version);
CREATE INDEX IF NOT EXISTS idx_q_section  ON questions(section);

CREATE INDEX IF NOT EXISTS idx_f_q       ON formulas(question_id);
CREATE INDEX IF NOT EXISTS idx_f_status  ON formulas(status);
CREATE INDEX IF NOT EXISTS idx_f_review  ON formulas(needs_review);
CREATE INDEX IF NOT EXISTS idx_img_q     ON images(question_id);
CREATE INDEX IF NOT EXISTS idx_lbl_ns    ON labels(namespace, name);
CREATE INDEX IF NOT EXISTS idx_rq_res    ON review_queue(resolved);
CREATE INDEX IF NOT EXISTS idx_ps_paper  ON paper_sections(paper_id);
CREATE INDEX IF NOT EXISTS idx_pq_paper  ON paper_questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_pq_q      ON paper_questions(question_id);
-- 注意：idx_pq_section 依赖 section_id 列，旧库尚未迁移时该列不存在，
-- 故由 bank/paper.py 的 ensure_paper_schema 负责创建，不放这里。

-- 题干检索（中文双字切分后交给 FTS5；详见 bank/textutil.py）-----------------
CREATE VIRTUAL TABLE IF NOT EXISTS question_fts USING fts5(
    tokens,
    question_id UNINDEXED,
    tokenize = 'unicode61'
);
"""


# --------------------------------------------------------------------------- #
# 连接 / 建库
# --------------------------------------------------------------------------- #
def connect(db_path: str | Path = DEFAULT_DB_PATH, *, create: bool = True) -> sqlite3.Connection:
    """打开数据库连接并开启外键约束。

    参数
    ----
    db_path 数据库文件路径；``":memory:"`` 表示内存库（测试用）。
    create  为 True 时，若库不存在会自动建表。
    """
    if db_path != ":memory:":
        db_path = Path(db_path)
        if create:
            db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if create:
        init_db(conn)
    return conn


def connect_readonly(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """以**只读**方式打开**已存在**的数据库（URI ``mode=ro``），不建表、不写任何内容。

    用于导出等只读流程：保证**不触发 schema 迁移或任何写操作**（不会改动 ``bank.db`` 的
    内容 / mtime）。库文件不存在时抛 :class:`FileNotFoundError`；对只读连接执行写操作
    会由 SQLite 抛 ``OperationalError: attempt to write a readonly database``。
    """
    if db_path == ":memory:":
        conn = sqlite3.connect(":memory:")
    else:
        p = Path(db_path).resolve()
        if not p.exists():
            raise FileNotFoundError(f"数据库不存在：{p}")
        conn = sqlite3.connect(f"{p.as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """建表 + 建索引（幂等），并写入 schema 版本。"""
    conn.executescript(DDL)
    cur = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'")
    row = cur.fetchone()
    if row is None:
        conn.execute("INSERT INTO meta(key, value) VALUES ('schema_version', ?)",
                     (str(SCHEMA_VERSION),))
        conn.execute("INSERT INTO meta(key, value) VALUES ('created_at', ?)",
                     (_now(),))
    conn.commit()


def schema_version(conn: sqlite3.Connection) -> int | None:
    """读取当前库的 schema 版本；库未初始化时返回 None。"""
    try:
        cur = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'")
    except sqlite3.OperationalError:
        return None
    row = cur.fetchone()
    return int(row["value"]) if row else None


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


__all__ = ["connect", "connect_readonly", "init_db", "schema_version", "SCHEMA_VERSION",
           "DEFAULT_DB_PATH", "DDL"]
