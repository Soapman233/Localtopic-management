"""题库元数据补全：保守推断 + 来源留痕（provenance）。

背景
----
阶段1/阶段2 导入后，题目的教学元数据覆盖率偏低（年级 11%、教材 11%、章节 21%），
且源数据**完全没有难度标注**。本模块在**不编造、不覆盖**的前提下，从文件名、
源路径、章节号与题干里尽可能**保守**地补全可推断的字段，并为每个值记录来源。

核心原则（违反即不合格）
------------------------
1. **绝不编造**：没有依据的字段一律写 :data:`UNKNOWN`（``待补充``）。尤其难度
   （difficulty）——源数据完全无标注，本模块**不猜、不写**，一律保持 ``未标注``。
2. **记录来源**：每个推断值都带 provenance，取值见下表。
3. **不覆盖**：已经是非空（且非占位符）的字段不动。
4. **改库前先备份**：见 :func:`backup_db` / :func:`verify_backup`。

provenance 取值
---------------
* grade    : ``filename``（文件名/路径直接含年级）/ ``chapter_map``（按章节号区间映射）/ ``unresolved``
* textbook : ``filename`` / ``path`` / ``unresolved``
* chapter  : ``filename`` / ``section`` / ``text`` / ``unresolved``
* knowledge: ``chapter_title``（来自章节标题词）/ ``dictionary``（词典命中）

章节号 → 年级 映射表（**需人工确认**，见 ``bank/README.md``）
--------------------------------------------------------------
仅当**教材已知**时才使用；教材未知时**不用**，避免张冠李戴。
"""
# ---------------------------------------------------------------------------
# title: 元数据补全
# description: 保守推断 grade / textbook / chapter / 知识点并记录 provenance；含幂等迁移与备份校验；覆盖率统计统一为题目级口径（grade/textbook 与其它维度一致，修正文件级分母导致的高估）。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
import shutil
import sqlite3
import time
from pathlib import Path

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 无法推断时的占位值（明确表达「待补充」，而不是编一个值）。
UNKNOWN = "待补充"
#: 来源标记：未能解析。
UNRESOLVED = "unresolved"

#: 被视为「空」的占位符集合（覆盖统计与「不覆盖」判断都据此排除）。
PLACEHOLDERS = frozenset({UNKNOWN, "未标注", "未分类", UNRESOLVED, ""})

#: 教材版本关键词。**顺序即优先级**；``江苏专用``/``全国通用``/``北京专用`` 等
#: 只是地区范围，**不是**教材版本，故不列入。
TEXTBOOKS: tuple[str, ...] = (
    "人教版", "苏科版", "粤沪版", "北师大版", "沪科版", "教科版",
    "鲁教版", "沪粤版", "湘教版",
)

#: 人教版初中物理：章节号 → 年级。**需人工确认**。
RENJIAO_GRADE_RANGES: tuple[tuple[int, int, str], ...] = (
    (1, 6, "八年级上册"),
    (7, 12, "八年级下册"),
    (13, 22, "九年级全一册"),
)

#: 苏科版初中物理：章节号 → 年级。**需人工确认**。
SUKE_GRADE_RANGES: tuple[tuple[int, int, str], ...] = (
    (1, 5, "八年级上册"),
    (6, 10, "八年级下册"),
    (11, 14, "九年级上册"),
    (15, 18, "九年级下册"),
)

#: 教材版本 → 章节号区间映射表。
TEXTBOOK_GRADE_MAPS: dict[str, tuple[tuple[int, int, str], ...]] = {
    "人教版": RENJIAO_GRADE_RANGES,
    "苏科版": SUKE_GRADE_RANGES,
}

#: 物理知识点词典（**只收 ≥2 字的概念词**；单字如「力」「功」不收，避免误命中）。
#: 覆盖初中物理主要概念与部分高中概念。
KNOWLEDGE_TERMS: tuple[str, ...] = (
    # 力学 · 基本相互作用
    "重力", "弹力", "摩擦力", "静摩擦力", "滑动摩擦力", "二力平衡", "平衡力",
    "相互作用力", "受力分析", "力的示意图", "力的作用是相互的", "牛顿第一定律",
    "惯性", "力的合成", "力的分解",
    # 压强与浮力
    "压强", "固体压强", "液体压强", "气体压强", "大气压强", "大气压", "流体压强",
    "浮力", "阿基米德原理", "物体的浮沉条件", "浮沉条件", "排开液体",
    "帕斯卡原理", "连通器",
    # 功与机械
    "功", "功率", "机械效率", "有用功", "额外功", "总功", "简单机械", "杠杆",
    "滑轮", "定滑轮", "动滑轮", "滑轮组", "斜面", "机械能", "动能", "势能",
    "重力势能", "弹性势能", "机械能守恒",
    # 运动与测量
    "机械运动", "参照物", "运动的描述", "匀速直线运动", "平均速度", "速度",
    "长度", "时间", "质量", "密度", "天平", "量筒", "密度的测量",
    # 热学
    "内能", "热量", "比热容", "热值", "热传递", "做功改变内能", "分子热运动",
    "分子动理论", "扩散现象", "分子间作用力", "物态变化", "熔化", "凝固",
    "汽化", "液化", "升华", "凝华", "蒸发", "沸腾", "熔点", "沸点", "温度",
    "温度计", "摄氏度",
    # 声学
    "声现象", "声音", "音调", "响度", "音色", "回声", "噪声", "超声波", "次声波",
    # 光学
    "光的反射", "光的折射", "光的直线传播", "平面镜成像", "光的色散",
    "凸透镜成像", "凸透镜", "凹透镜", "实像", "虚像", "焦距", "焦点",
    # 电学
    "电荷", "摩擦起电", "静电现象", "电流", "电压", "电阻", "导体", "绝缘体",
    "半导体", "超导", "欧姆定律", "串联", "并联", "电路", "电路故障", "短路",
    "断路", "电流表", "电压表", "滑动变阻器", "变阻器", "电功", "电功率",
    "焦耳定律", "额定功率", "家庭电路", "保险丝", "安全用电", "电能", "电热",
    "串并联电路", "伏安法",
    # 电与磁
    "电与磁", "磁场", "磁感线", "磁现象", "电磁铁", "电磁继电器", "通电导线",
    "电磁感应", "发电机", "电动机", "通电螺线管", "磁生电",
    # 粒子与宇宙
    "分子", "原子", "电子", "原子核", "宇宙探秘", "日心说", "太阳系",
    "走进分子世界", "从粒子到宇宙", "粒子", "宇宙", "能量转化", "能量守恒定律",
    # 信息与能源
    "电磁波", "信息传递", "能源", "核能", "太阳能", "可再生能源",
    # 高中物理
    "匀变速直线运动", "自由落体", "竖直上抛", "追及相遇", "位移", "加速度",
    "速度图像", "牛顿运动定律", "牛顿第二定律", "牛顿第三定律", "超重失重",
    "曲线运动", "平抛运动", "圆周运动", "向心力", "万有引力", "天体运动",
    "动能定理", "机械能守恒定律", "动量", "冲量", "动量定理", "动量守恒",
    "碰撞", "反冲", "简谐运动", "单摆", "机械波", "波的干涉", "波的衍射",
    "多普勒效应", "电场", "电场强度", "电势", "电势差", "电容", "电容器",
    "带电粒子", "电场线", "安培力", "洛伦兹力", "磁通量", "楞次定律",
    "法拉第电磁感应定律", "感应电动势", "自感", "涡流", "变压器", "交变电流",
    "热力学定律", "热力学第一定律", "热力学第二定律", "理想气体",
    "气体实验定律", "光的干涉", "光的衍射", "光的偏振", "全反射", "折射率",
    "双缝干涉", "光电效应", "光子", "波粒二象性", "原子结构", "玻尔模型",
    "能级", "氢原子", "天然放射现象", "核裂变", "核聚变", "质能方程", "半衰期",
)

# 去掉单字词（安全网）：词典里不应出现单字。
KNOWLEDGE_TERMS = tuple(t for t in KNOWLEDGE_TERMS if len(t) >= 2)

# --------------------------------------------------------------------------- #
# 正则
# --------------------------------------------------------------------------- #
_EXT_RE = re.compile(r"\.(docx|doc)$", re.IGNORECASE)

# 「课时10.1」——苏科版/教辅常见的课时编号（是教材章节，不是「第 N 课时」）。
_KESHI_RE = re.compile(r"课时\s*(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)")
# 「第9章」「第 9 章」——阿拉伯数字章号。
_CHAPTER_ARABIC_RE = re.compile(r"第\s*(\d{1,2})\s*章")
# 「第九章」——中文数字章号。
_CHAPTER_CHINESE_RE = re.compile(r"第\s*([一二三四五六七八九十]{1,3})\s*章")
# 行首章节号（如文件名 ``9.4 浮力`` / ``9.1.2 固体压强``）。
_LEADING_CHAPTER_RE = re.compile(r"^\s*(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?![\d.])")

# 年级（初中）：七/八/九年级，可选 上/下（册/学期）。
_JUNIOR_GRADE_RE = re.compile(r"([七八九])年级")
# 年级（高中）：高一/高二/高三。
_SENIOR_GRADE_RE = re.compile(r"高\s*([一二三])")
# 高中「必修第X册」/「必修X」/「选择性必修」。
_XBXK_RE = re.compile(r"选择性必修")
_BX_CE_RE = re.compile(r"必修\s*第?\s*([一二三1-3])\s*册")
_BX_RE = re.compile(r"必修\s*([一二三1-3])")

_CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9}


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def _stem(file_name: str | None) -> str:
    """去掉扩展名，返回文件名主体。"""
    return _EXT_RE.sub("", file_name or "").strip()


def _is_blank(value: str | None) -> bool:
    """判断字段是否「空」（None / 空白 / 占位符）。"""
    return (value or "").strip() in PLACEHOLDERS


def _cn_to_int(text: str) -> int | None:
    """中文数字（一~二十二）转 int；无法解析返回 None。"""
    if not text:
        return None
    if text == "十":
        return 10
    if "十" in text:
        left, _, right = text.partition("十")
        tens = _CN_DIGITS.get(left, 1) if left else 1
        ones = _CN_DIGITS.get(right, 0) if right else 0
        return tens * 10 + ones
    return _CN_DIGITS.get(text)


def _cn_num(digit: str) -> str:
    """``1/2/3`` 或 ``一/二/三`` 统一成中文数字。"""
    return {"1": "一", "2": "二", "3": "三"}.get(digit, digit)


# --------------------------------------------------------------------------- #
# (a) 教材版本
# --------------------------------------------------------------------------- #
def infer_textbook(file_name: str | None, path: str | None) -> tuple[str, str]:
    """推断教材版本。

    规则：先文件名、后源路径匹配 :data:`TEXTBOOKS`；``江苏专用`` 等地区标签**不算**教材。
    匹配不到返回 ``(待补充, unresolved)``。
    """
    name = file_name or ""
    for tb in TEXTBOOKS:
        if tb in name:
            return tb, "filename"
    p = path or ""
    for tb in TEXTBOOKS:
        if tb in p:
            return tb, "path"
    return UNKNOWN, UNRESOLVED


# --------------------------------------------------------------------------- #
# (b) 年级
# --------------------------------------------------------------------------- #
def _grade_from_text(text: str | None) -> str | None:
    """从一段文本（文件名或路径）里提取年级并归一化。"""
    if not text:
        return None
    # 高中：选择性必修
    if _XBXK_RE.search(text):
        m = _BX_CE_RE.search(text)
        if m:
            return "高中选择性必修第" + _cn_num(m.group(1)) + "册"
        return "高中选择性必修"
    # 高中：必修第一册 / 必修一
    m = _BX_CE_RE.search(text)
    if m:
        return "高中必修第" + _cn_num(m.group(1)) + "册"
    m = _BX_RE.search(text)
    if m:
        return "高中必修" + _cn_num(m.group(1))
    # 高中：高一/高二/高三
    m = _SENIOR_GRADE_RE.search(text)
    if m:
        return "高" + m.group(1)
    # 初中：七八九年级（可选上/下）
    m = _JUNIOR_GRADE_RE.search(text)
    if m:
        base = m.group(1)
        tail = text[m.end(): m.end() + 6]
        term = None
        tm = re.match(r"\s*(上|下)(?!海)", tail)
        if tm:
            term = tm.group(1)
        else:
            tm2 = re.search(r"(上|下)\s*(?:册|学期)", tail)
            if tm2:
                term = tm2.group(1)
        return f"{base}年级" + (f"{term}册" if term else "")
    return None


def _grade_from_chapter_map(textbook: str, chapter: str | None) -> str | None:
    """按教材的章节号区间映射年级（仅在教材已知时可用）。"""
    ranges = TEXTBOOK_GRADE_MAPS.get(textbook)
    if not ranges or not chapter:
        return None
    m = re.match(r"(\d{1,2})", str(chapter))
    if not m:
        return None
    major = int(m.group(1))
    for lo, hi, grade in ranges:
        if lo <= major <= hi:
            return grade
    return None


def infer_grade(file_name: str | None, path: str | None,
                chapter: str | None) -> tuple[str, str]:
    """推断年级。

    两个来源，优先文件名/路径直接标注；否则在**教材已知**时按章节号区间映射。
    都推不出返回 ``(待补充, unresolved)``。
    """
    g = _grade_from_text(file_name)
    if g:
        return g, "filename"
    g = _grade_from_text(path)
    if g:
        return g, "filename"  # 路径直接含年级，按规格统一记 filename
    textbook, _ = infer_textbook(file_name, path)
    if textbook in TEXTBOOK_GRADE_MAPS:
        g = _grade_from_chapter_map(textbook, chapter)
        if g:
            return g, "chapter_map"
    return UNKNOWN, UNRESOLVED


# --------------------------------------------------------------------------- #
# (c) 章节号
# --------------------------------------------------------------------------- #
def _chapter_from_text(text: str | None, *, allow_leading_number: bool) -> str | None:
    """从一段文本里提取章节号。

    * ``课时X.Y`` / ``第X章``（阿拉伯或中文）——显式章节标记，任何来源都允许；
    * 行首 ``X.Y`` / ``X.Y.Z``——仅在文件名（``allow_leading_number=True``）时启用，
      避免把题干里的 ``1.5``（如 ``1.5米``）误当章节号。
    ``专题13``/``专项05``/``压轴05`` 等**不是**教材章节，天然不匹配。
    """
    if not text:
        return None
    m = _KESHI_RE.search(text)
    if m:
        return m.group(1)
    m = _CHAPTER_ARABIC_RE.search(text)
    if m:
        return m.group(1)
    m = _CHAPTER_CHINESE_RE.search(text)
    if m:
        n = _cn_to_int(m.group(1))
        if n:
            return str(n)
    if allow_leading_number:
        m = _LEADING_CHAPTER_RE.match(text)
        if m:
            return m.group(1)
    return None


def infer_chapter(file_name: str | None, section: str | None,
                  text: str | None) -> tuple[str, str]:
    """推断章节号。

    优先文件名里的章节号（如 ``9.4 浮力`` → ``9.4``，``第9章`` → ``9``）；
    其次从 ``section`` 或题干首个标题行提取。都推不出返回 ``(待补充, unresolved)``。
    """
    ch = _chapter_from_text(_stem(file_name), allow_leading_number=True)
    if ch:
        return ch, "filename"
    ch = _chapter_from_text(section, allow_leading_number=False)
    if ch:
        return ch, "section"
    first_line = (text or "").split("\n", 1)[0]
    ch = _chapter_from_text(first_line, allow_leading_number=False)
    if ch:
        return ch, "text"
    return UNKNOWN, UNRESOLVED


# --------------------------------------------------------------------------- #
# (d) 知识点
# --------------------------------------------------------------------------- #
def _match_dictionary(text: str | None) -> list[str]:
    """在文本里匹配物理知识点词典，按「长词优先」排序返回命中的概念词。"""
    if not text:
        return []
    hits = [term for term in KNOWLEDGE_TERMS if term in text]
    hits.sort(key=lambda x: (-len(x), x))
    return hits


def infer_knowledge_points(chapter: str | None, section: str | None,
                           plain_text: str | None) -> list[tuple[str, str]]:
    """保守提取知识点，返回 ``[(名称, source)]``。

    * ``chapter`` 为**章节上下文文本**（通常是含章节号与标题词的文件名主体，
      如 ``9.4 浮力 同步练习``）：词典命中记 ``chapter_title``。
    * ``section`` 与 ``plain_text``：词典命中记 ``dictionary``。

    只匹配词典里的 ≥2 字概念词，宁可少不可错。
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for name in _match_dictionary(chapter):
        if name not in seen:
            seen.add(name)
            out.append((name, "chapter_title"))
    for src in (section or "", plain_text or ""):
        for name in _match_dictionary(src):
            if name not in seen:
                seen.add(name)
                out.append((name, "dictionary"))
    return out


# --------------------------------------------------------------------------- #
# 数据库迁移（幂等）
# --------------------------------------------------------------------------- #
#: 需要新增的 provenance 列：表 -> [(列名, 类型)]。
PROVENANCE_COLUMNS: dict[str, tuple[tuple[str, str], ...]] = {
    "source_files": (("grade_source", "TEXT"), ("textbook_source", "TEXT")),
    "questions": (("chapter_source", "TEXT"),),
    "question_labels": (("source", "TEXT"),),
}


def ensure_provenance_columns(conn: sqlite3.Connection) -> list[str]:
    """幂等地新增 provenance 列；已存在则跳过。返回本次实际新增的列（``表.列``）。"""
    added: list[str] = []
    for table, columns in PROVENANCE_COLUMNS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for col, coltype in columns:
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
                added.append(f"{table}.{col}")
    conn.commit()
    return added


# --------------------------------------------------------------------------- #
# 备份 / 校验
# --------------------------------------------------------------------------- #
def backup_db(db_path: str | Path, *, backup_dir: str | Path | None = None) -> Path:
    """把数据库复制到 ``<库名>.backup-<时间戳>.db``，返回备份路径。"""
    db_path = Path(db_path)
    target_dir = Path(backup_dir) if backup_dir else db_path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = target_dir / f"{db_path.stem}.backup-{stamp}.db"
    shutil.copy2(db_path, out)
    return out


#: 判定备份「核心表非空」时要求的表（本语料四张表均有数据）。
CORE_TABLES: tuple[str, ...] = ("source_files", "questions", "formulas", "images")


def _snapshot(p: str | Path) -> tuple[set[str], dict[str, int], bool]:
    """读取一个库的**表集合**、**逐表行数**、**integrity_check 是否通过**。

    无法读取（文件损坏 / 非数据库）时抛出 :class:`sqlite3.Error`，由调用方统一兜底。
    """
    c = sqlite3.connect(str(p))
    c.row_factory = sqlite3.Row
    try:
        tables = {r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
        counts: dict[str, int] = {}
        for t in sorted(tables):
            if t.startswith("sqlite_"):
                continue
            counts[t] = c.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()["c"]
        integ = str(c.execute("PRAGMA integrity_check").fetchone()[0]).strip().lower()
        return tables, counts, integ == "ok"
    finally:
        c.close()


def _result(*, ok, structure_ok, integrity_ok, core_nonempty, core_empty, error,
            tables, rowcounts, backup_rowcounts, verdict,
            missing_tables=None, extra_tables=None,
            rowcounts_equal: bool = False, tables_equal: bool = False) -> dict:
    """构造统一的校验结果字典（契约稳定：永远返回 dict，不抛异常）。"""
    return {
        "ok": bool(ok),
        "structure_ok": bool(structure_ok),
        "integrity_ok": bool(integrity_ok),
        "core_nonempty": bool(core_nonempty),
        "core_empty": list(core_empty),
        "error": error,
        "tables_equal": bool(tables_equal),        # 表集合是否**完全相等**（参考指标）
        "missing_tables": list(missing_tables or []),  # 原库有、备份没有的表
        "extra_tables": list(extra_tables or []),      # 备份有、原库没有的表
        "rowcounts_equal": bool(rowcounts_equal),
        "tables": tables,
        "rowcounts": rowcounts,
        "backup_rowcounts": backup_rowcounts,
        "verdict": verdict,
    }


def verify_backup(original: str | Path, backup: str | Path) -> dict:
    """校验备份是否为**合格回滚点**（永远返回 dict，不抛异常）。

    ``ok`` 需**同时**满足三个条件：

    1. ``structure_ok``：备份是原库的**结构子集**且**核心表齐全**——
       即 ``备份表集合 ⊆ 原库表集合``（备份可以**少**表，代表它是**较早**的回滚点，
       例如阶段3 迁移前还没有 ``paper_sections``）**且** :data:`CORE_TABLES`
       （``source_files`` / ``questions`` / ``formulas`` / ``images``）在备份里都在；
       但备份**不能多出**原库没有的表（多出说明它不是原库的回滚点）。
    2. ``integrity_ok``：备份 ``PRAGMA integrity_check`` 返回 ``ok``；
    3. ``core_nonempty``：**核心表**行数均 **> 0**。

    另给出两个**独立**参考指标（**不参与** ``ok``）：

    * ``missing_tables``：原库有、备份没有的表（如迁移新增的表，属预期）；
    * ``extra_tables``：备份有、原库没有的表（**结构子集**条件会因此不成立）；
    * ``rowcounts_equal``：逐表行数是否相同。备份是**迁移前**状态，enrich 之后主库新增了
      标签数据，``labels`` / ``question_labels`` 行数不同属**预期**；但**核心表被清空**
      （如 ``DELETE FROM images``）**绝不**算预期，会令 ``core_nonempty=False``、
      ``ok=False``，且 verdict 明确写「核心表 X 为空」，**不会**套用「属预期」的说法。

    文件不存在 / 损坏 / 非数据库时，返回 ``ok=False`` 并带 ``error`` 字段，**不抛异常**，
    以保证调用方拿到一致的契约。
    """
    bak_path = Path(backup)
    if not bak_path.is_file():
        return _result(ok=False, structure_ok=False, integrity_ok=False,
                       core_nonempty=False, core_empty=[],
                       error=f"备份文件不存在：{bak_path}", tables=[],
                       rowcounts={}, backup_rowcounts={},
                       verdict=f"备份不可用：文件不存在（{bak_path}）")

    try:
        orig_tables, orig_counts, _ = _snapshot(original)
    except sqlite3.Error as exc:
        return _result(ok=False, structure_ok=False, integrity_ok=False,
                       core_nonempty=False, core_empty=[],
                       error=f"原库无法读取：{exc}", tables=[], rowcounts={},
                       backup_rowcounts={}, verdict=f"无法校验：原库读取失败（{exc}）")

    try:
        bak_tables, bak_counts, bak_integ = _snapshot(bak_path)
    except sqlite3.Error as exc:
        return _result(ok=False, structure_ok=False, integrity_ok=False,
                       core_nonempty=False, core_empty=[],
                       error=f"备份无法读取：{exc}", tables=sorted(orig_tables),
                       rowcounts=orig_counts, backup_rowcounts={},
                       verdict=f"备份不可用：无法读取（{exc}）")

    missing_tables = sorted(orig_tables - bak_tables)     # 原库有、备份没有（较早回滚点）
    extra_tables = sorted(bak_tables - orig_tables)       # 备份有、原库没有（不是该库的回滚点）
    subset_ok = bak_tables <= orig_tables
    core_missing = [t for t in CORE_TABLES if t not in bak_tables]
    structure_ok = subset_ok and not core_missing
    integrity_ok = bool(bak_integ)
    core_empty = [t for t in CORE_TABLES if bak_counts.get(t, 0) <= 0]
    core_nonempty = not core_empty
    counts_ok = orig_counts == bak_counts
    tables_equal = orig_tables == bak_tables
    ok = structure_ok and integrity_ok and core_nonempty

    if not structure_ok:
        if core_missing:
            verdict = (f"备份不可用：表结构不一致——缺少核心表 {core_missing}；"
                       f"缺失表 {missing_tables or '无'}，多出表 {extra_tables or '无'}")
        else:
            verdict = (f"备份不可用：表结构不一致（多出原库没有的表 {extra_tables or '无'}）")
    elif not integrity_ok:
        verdict = "备份不可用：integrity_check 未通过（数据库可能损坏）"
    elif not core_nonempty:
        verdict = f"备份不可用：核心表 {core_empty} 为空，无法用于回滚"
    elif tables_equal and counts_ok:
        verdict = "合格回滚点：结构一致、integrity ok、核心表非空、行数一致"
    elif not missing_tables and not counts_ok:
        verdict = ("合格回滚点：结构一致、integrity ok、核心表非空；"
                   "行数不同——备份为迁移前状态，enrich 新增的标签数据不在其中，属预期")
    else:
        verdict = ("合格回滚点：备份为原库的结构子集（较早回滚点，"
                   f"缺失表 {missing_tables or '无'}）、integrity ok、核心表非空"
                   + ("；行数不同属预期" if not counts_ok else ""))

    return _result(ok=ok, structure_ok=structure_ok, integrity_ok=integrity_ok,
                   core_nonempty=core_nonempty, core_empty=core_empty, error=None,
                   tables=sorted(orig_tables), rowcounts=orig_counts,
                   backup_rowcounts=bak_counts, verdict=verdict,
                   missing_tables=missing_tables, extra_tables=extra_tables,
                   rowcounts_equal=counts_ok, tables_equal=tables_equal)


# --------------------------------------------------------------------------- #
# 覆盖率
# --------------------------------------------------------------------------- #
def coverage(conn: sqlite3.Connection) -> dict:
    """统计各字段覆盖率（占位符不计入）。

    **口径统一为题目级**：分母一律取 ``questions`` 行数 ``n_q``，六个维度
    （grade/textbook/chapter/qtype/difficulty/knowledge）全部按「题目」计数，
    避免混用文件级/题目级分母造成的**覆盖率虚高**（早期版本 grade/textbook 用
    ``source_files`` 行数作分母，209 个文件里 44 个有年级 = 21.1%，
    但真正的题目级覆盖率只有 1396/7945 = 17.6%，明显高估）。

    * grade/textbook 来自题目所属来源文件（``questions`` JOIN ``source_files``），
      逐题统计——一道题继承其来源文件的年级/教材；
    * chapter/qtype/difficulty 取 ``questions`` 自身字段；
    * knowledge 取题目关联的「知识点」命名空间标签去重计数。
    """
    def pct(n: int, d: int) -> float:
        return round(100.0 * n / d, 1) if d else 0.0

    # 文件级总数仅作信息展示（保留键，避免下游 KeyError）。
    n_src = conn.execute("SELECT COUNT(*) FROM source_files").fetchone()[0]

    # 题目级：JOIN 来源文件以取回 grade/textbook（LEFT JOIN 保证孤儿题也计入分母）。
    qs = conn.execute(
        "SELECT q.chapter, q.qtype, q.difficulty, s.grade, s.textbook"
        " FROM questions q LEFT JOIN source_files s ON s.id = q.source_id"
    ).fetchall()
    n_q = len(qs)
    grade_ok = sum(1 for r in qs if not _is_blank(r["grade"]))
    textbook_ok = sum(1 for r in qs if not _is_blank(r["textbook"]))
    chapter_ok = sum(1 for r in qs if not _is_blank(r["chapter"]))
    qtype_ok = sum(1 for r in qs if not _is_blank(r["qtype"]))
    difficulty_ok = sum(1 for r in qs if not _is_blank(r["difficulty"]))

    knowledge_ok = conn.execute(
        "SELECT COUNT(DISTINCT ql.question_id) AS c FROM question_labels ql"
        " JOIN labels l ON l.id = ql.label_id WHERE l.namespace = '知识点'"
    ).fetchone()["c"]

    return {
        "source_files_total": n_src,
        "questions_total": n_q,
        "grade": {"n": grade_ok, "total": n_q, "pct": pct(grade_ok, n_q)},
        "textbook": {"n": textbook_ok, "total": n_q, "pct": pct(textbook_ok, n_q)},
        "chapter": {"n": chapter_ok, "total": n_q, "pct": pct(chapter_ok, n_q)},
        "qtype": {"n": qtype_ok, "total": n_q, "pct": pct(qtype_ok, n_q)},
        "difficulty": {"n": difficulty_ok, "total": n_q, "pct": pct(difficulty_ok, n_q)},
        "knowledge": {"n": knowledge_ok, "total": n_q, "pct": pct(knowledge_ok, n_q)},
    }


# --------------------------------------------------------------------------- #
# 标签辅助
# --------------------------------------------------------------------------- #
def _get_or_create_label(conn: sqlite3.Connection, namespace: str,
                         name: str) -> tuple[int, bool]:
    """取或建标签，返回 ``(label_id, created)``；``created`` 表示本次是否新建。"""
    cur = conn.execute("INSERT OR IGNORE INTO labels(namespace, name) VALUES (?, ?)",
                       (namespace, name))
    created = cur.rowcount > 0
    row = conn.execute("SELECT id FROM labels WHERE namespace = ? AND name = ?",
                       (namespace, name)).fetchone()
    return row["id"], created


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """判断某表是否有某列（只读 PRAGMA，不写库）。"""
    return column in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
KNOWLEDGE_NAMESPACE = "知识点"
#: 预置值（阶段2 导入器写入）的来源标记。
IMPORTER_SOURCE = "importer"


def _empty_stats(dry_run: bool) -> dict:
    return {
        "dry_run": dry_run,
        "grade": {"new": 0, "marked_preexisting": 0, "sources": {}},
        "textbook": {"new": 0, "marked_preexisting": 0, "sources": {}},
        "chapter": {"new": 0, "marked_preexisting": 0, "sources": {}},
        "knowledge": {"new_links": 0, "new_labels": 0, "questions": 0, "sources": {}},
        "difficulty_untouched": 0,
    }


def enrich(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:
    """执行元数据补全，返回统计。

    参数
    ----
    dry_run  为 True 时**只统计不写库**（也不做迁移）。

    幂等性
    ------
    以 provenance 列（``grade_source`` 等）是否已填写作为「是否已处理」的锚点：
    第二次执行时所有字段都已有来源标记，因此新增数为 0，不重复写、不重复建标签。
    未覆盖已非空字段；不触碰 difficulty（源数据无标注，保持 ``未标注``）。
    """
    if not dry_run:
        ensure_provenance_columns(conn)

    stats = _empty_stats(dry_run)

    def _bump(bucket: dict, key: str) -> None:
        bucket[key] = bucket.get(key, 0) + 1

    # provenance 列可能尚不存在（如 dry-run 于全新库）——用字面量 NULL 兜底，避免写库。
    g_src = "grade_source" if _has_column(conn, "source_files", "grade_source") else "NULL"
    t_src = "textbook_source" if _has_column(conn, "source_files", "textbook_source") else "NULL"
    c_src = "chapter_source" if _has_column(conn, "questions", "chapter_source") else "NULL"

    # --- 文件级：grade / textbook ------------------------------------------
    sfs = conn.execute(
        f"SELECT id, file_name, path, grade, {g_src} AS grade_source,"
        f" textbook, {t_src} AS textbook_source FROM source_files ORDER BY id"
    ).fetchall()
    for sf in sfs:
        chapter_ctx, _ = infer_chapter(sf["file_name"], None, None)

        if sf["grade_source"] is None:
            if _is_blank(sf["grade"]):
                value, source = infer_grade(sf["file_name"], sf["path"], chapter_ctx)
                stats["grade"]["new"] += 1
                _bump(stats["grade"]["sources"], source)
                if not dry_run:
                    conn.execute(
                        "UPDATE source_files SET grade = ?, grade_source = ? WHERE id = ?",
                        (value, source, sf["id"]))
            else:
                # 已存在的值（阶段2 导入器写入）：只补记来源，不改值。
                stats["grade"]["marked_preexisting"] += 1
                if not dry_run:
                    conn.execute(
                        "UPDATE source_files SET grade_source = ? WHERE id = ?",
                        (IMPORTER_SOURCE, sf["id"]))

        if sf["textbook_source"] is None:
            if _is_blank(sf["textbook"]):
                value, source = infer_textbook(sf["file_name"], sf["path"])
                stats["textbook"]["new"] += 1
                _bump(stats["textbook"]["sources"], source)
                if not dry_run:
                    conn.execute(
                        "UPDATE source_files SET textbook = ?, textbook_source = ? WHERE id = ?",
                        (value, source, sf["id"]))
            else:
                stats["textbook"]["marked_preexisting"] += 1
                if not dry_run:
                    conn.execute(
                        "UPDATE source_files SET textbook_source = ? WHERE id = ?",
                        (IMPORTER_SOURCE, sf["id"]))

    # --- 题目级：chapter / 知识点 ------------------------------------------
    qs = conn.execute(
        f"SELECT q.id, q.section, q.plain_text, q.chapter, {c_src} AS chapter_source,"
        " q.difficulty, s.file_name AS file_name"
        " FROM questions q JOIN source_files s ON s.id = q.source_id ORDER BY q.id"
    ).fetchall()

    # 预载已存在的知识点关联，保证重复执行时「新增数」为 0。
    existing_kp = {
        (r["qid"], r["name"]) for r in conn.execute(
            "SELECT ql.question_id AS qid, l.name AS name FROM question_labels ql"
            " JOIN labels l ON l.id = ql.label_id WHERE l.namespace = ?",
            (KNOWLEDGE_NAMESPACE,))
    }

    kp_questions: set[int] = set()
    new_labels: set[str] = set()
    for q in qs:
        if q["chapter_source"] is None:
            if _is_blank(q["chapter"]):
                value, source = infer_chapter(q["file_name"], q["section"], q["plain_text"])
                stats["chapter"]["new"] += 1
                _bump(stats["chapter"]["sources"], source)
                if not dry_run:
                    conn.execute(
                        "UPDATE questions SET chapter = ?, chapter_source = ? WHERE id = ?",
                        (value, source, q["id"]))
            else:
                stats["chapter"]["marked_preexisting"] += 1
                if not dry_run:
                    conn.execute(
                        "UPDATE questions SET chapter_source = ? WHERE id = ?",
                        (IMPORTER_SOURCE, q["id"]))

        # 知识点（来源：章节标题词 / 词典）
        points = infer_knowledge_points(_stem(q["file_name"]), q["section"], q["plain_text"])
        if points:
            kp_questions.add(q["id"])
        for name, source in points:
            if (q["id"], name) in existing_kp:
                continue  # 已存在，跳过（幂等）
            stats["knowledge"]["new_links"] += 1
            _bump(stats["knowledge"]["sources"], source)
            new_labels.add(name)
            if not dry_run:
                label_id, created = _get_or_create_label(conn, KNOWLEDGE_NAMESPACE, name)
                if created:
                    stats["knowledge"]["new_labels"] += 1
                conn.execute(
                    "INSERT OR IGNORE INTO question_labels(question_id, label_id, source)"
                    " VALUES (?, ?, ?)", (q["id"], label_id, source))

        # difficulty：源数据无标注，明确不处理（保持 未标注）。
        if _is_blank(q["difficulty"]):
            stats["difficulty_untouched"] += 1

    if dry_run:
        stats["knowledge"]["new_labels"] = len(new_labels)
    stats["knowledge"]["questions"] = len(kp_questions)

    if not dry_run:
        conn.commit()
    return stats


def format_coverage_table(before: dict, after: dict) -> str:
    """把补全前后的覆盖率渲染成 Markdown 表格（口径均为题目级）。"""
    rows = (
        ("grade 年级（题目级）", "grade"),
        ("textbook 教材（题目级）", "textbook"),
        ("chapter 章节（题目级）", "chapter"),
        ("qtype 题型（题目级）", "qtype"),
        ("difficulty 难度（题目级）", "difficulty"),
        ("知识点（题目级）", "knowledge"),
    )
    lines = ["| 字段 | 补全前 | 补全后 |", "|---|---|---|"]
    for label, key in rows:
        b, a = before[key], after[key]
        lines.append(
            f"| {label} | {b['n']}/{b['total']} ({b['pct']}%) |"
            f" {a['n']}/{a['total']} ({a['pct']}%) |")
    return "\n".join(lines)


__all__ = [
    "UNKNOWN", "UNRESOLVED", "PLACEHOLDERS", "TEXTBOOKS",
    "RENJIAO_GRADE_RANGES", "SUKE_GRADE_RANGES", "TEXTBOOK_GRADE_MAPS",
    "KNOWLEDGE_TERMS", "KNOWLEDGE_NAMESPACE", "CORE_TABLES",
    "infer_textbook", "infer_grade", "infer_chapter", "infer_knowledge_points",
    "ensure_provenance_columns", "backup_db", "verify_backup",
    "coverage", "enrich", "format_coverage_table",
]
