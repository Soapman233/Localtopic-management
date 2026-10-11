"""从文件名与题干提取元数据：学段 / 年级 / 教材版本 / 章节号 / 学科 / 题型。

阶段1 的 JSON 只有路径、段落与题目，没有教学元数据。这里用「文件名优先、
文档标题兜底」的策略推断，规则保守（宁可留空，不硬猜）。
"""
# ---------------------------------------------------------------------------
# title: 元数据提取
# description: 从文件名 / 标题 / 路径提取学段、年级、教材、章节、学科与题型。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import re

# 学段关键词。
_SENIOR_KEYS = ("高中", "高考", "高一", "高二", "高三")
_JUNIOR_KEYS = ("初中", "中考", "初一", "初二", "初三", "七年级", "八年级", "九年级")

# 教材版本（越具体的放前面，避免「人教版」误吃「苏教版」之类）。
_TEXTBOOKS = (
    "苏科版", "苏教版", "人教版", "北师大版", "沪科版", "沪粤版", "粤沪版",
    "鲁教版", "教科版", "华师大版", "华东师大版", "湘教版", "冀教版", "京改版",
    "北京版", "外研版", "译林版", "牛津版", "鲁科版", "人教新目标",
)

# 学科。
_SUBJECTS = ("物理", "化学", "数学", "生物", "地理", "历史", "政治", "道德与法治", "英语", "语文")

# 年级：捕获「八」+「下」，或「高 一」之类。
_GRADE_RE = re.compile(r"([七八九]|高[一二三]|初[一二三])\s*年级?\s*([上下])?\s*册?")

# 章节号：如 10.3 / 9.1.2 / 8.3（文件名开头或标题开头）。
_CHAPTER_RE = re.compile(r"(?<![\d.])(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])")

# 大题标题 -> 题型。顺序重要：先匹配更具体的。
_SECTION_TYPE_RULES = (
    (("单项选择", "单选题"), "选择题"),
    (("多项选择", "多选题", "不定项"), "多选题"),
    (("选择",), "选择题"),
    (("填空",), "填空题"),
    (("实验", "探究"), "实验探究题"),
    (("计算", "解答", "综合应用"), "计算解答题"),
    (("作图", "画图", "识图"), "作图题"),
    (("简答",), "简答题"),
    (("判断",), "判断题"),
)

DEFAULT_DIFFICULTY = "未标注"

# 苏科版初中物理章节 -> 年级（用于文件名未标注年级时兜底；保守起见仅在教材版本=苏科版时启用）。
#   八上：第1~5章（声/物态变化/光/透镜/运动）
#   八下：第6~10章（物质属性/力/力与运动/压强浮力/粒子到宇宙）
#   九上：第11~14章（简单机械和功/内能/电路初探/欧姆定律）
#   九下：第15~18章（电功和电热/电磁转换/电磁波/能源）
_SUKE_GRADE_RANGES = ((6, 7, "八年级上册"), (8, 10, "八年级下册"),
                      (11, 14, "九年级上册"), (15, 18, "九年级下册"))


def _sources(name: str, title: str, source_path: str) -> list[str]:
    """按「文件名 -> 标题 -> 源路径」的顺序作为文本来源（越靠前越可信）。"""
    return [name or "", title or "", source_path or ""]


def _first_match(text: str, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        if k in text:
            return k
    return None


def detect_stage(name: str, title: str = "", source_path: str = "") -> str | None:
    """学段：初中 / 高中。文件名、标题、源路径依次尝试（源路径常含 ``\\物理\\初中\\``）。"""
    for src in _sources(name, title, source_path):
        if not src:
            continue
        if any(k in src for k in _SENIOR_KEYS):
            return "高中"
        if any(k in src for k in _JUNIOR_KEYS):
            return "初中"
    return None


def detect_grade(name: str, title: str = "") -> str | None:
    """年级：如「八年级下册」「高一」。"""
    for src in _sources(name, title, ""):
        if not src:
            continue
        m = _GRADE_RE.search(src)
        if m:
            base = m.group(1)
            term = m.group(2)
            if base.startswith(("高", "初")):
                return base + "年级"
            return f"{base}年级" + (f"{term}册" if term else "")
    return None


def grade_from_suke_chapter(chapter: str | None) -> str | None:
    """苏科版：由章节号推断年级（仅作兜底）。"""
    if not chapter:
        return None
    try:
        major = int(chapter.split(".")[0])
    except (ValueError, IndexError):
        return None
    for lo, hi, grade in _SUKE_GRADE_RANGES:
        if lo <= major <= hi:
            return grade
    return None


def detect_textbook(name: str, title: str = "") -> str | None:
    """教材版本：如「苏科版」。"""
    for src in _sources(name, title, ""):
        if not src:
            continue
        hit = _first_match(src, _TEXTBOOKS)
        if hit:
            return hit
    return None


def detect_subject(name: str, title: str = "", source_path: str = "") -> str | None:
    """学科：默认「物理」（本项目语料为物理）。"""
    for src in _sources(name, title, source_path):
        if not src:
            continue
        hit = _first_match(src, _SUBJECTS)
        if hit:
            return hit
    return "物理"


def detect_chapter(name: str, title: str = "", head_text: str = "") -> str | None:
    """章节号：如 10.3 / 9.1.2。文件名开头优先，其次标题开头。"""
    for src in (name, title, head_text):
        if not src:
            continue
        m = _CHAPTER_RE.search(src)
        if m:
            return m.group(1)
    return None


def detect_qtype(section: str | None, text: str = "") -> str:
    """题型：由大题标题推断，推断不出再按题干特征兜底。"""
    if section:
        for keys, qtype in _SECTION_TYPE_RULES:
            if any(k in section for k in keys):
                return qtype
    # 兜底：含四个选项标记 A．B．C．D． 视为选择题；含连续下划线视为填空题。
    if text:
        if all(mark in text for mark in ("A．", "B．", "C．")) or \
           all(mark in text for mark in ("A.", "B.", "C.")):
            return "选择题"
        if "____" in text or "____" in text.replace("_", "_"):
            return "填空题"
    return "未分类"


def extract(name: str, title: str = "", head_text: str = "",
            source_path: str = "") -> dict:
    """一次性提取全部元数据。

    参数
    ----
    name        文件名（不含扩展名）
    title       文档首个非空段落（标题）
    head_text   文档头部区块拼接文本（兜底用）
    source_path 原始 DOCX 的完整路径（其中常含 ``\\物理\\初中\\`` 等，用于补全学段/学科）

    返回 ``{"stage","grade","subject","textbook","chapter"}``。
    """
    textbook = detect_textbook(name, title)
    chapter = detect_chapter(name, title, head_text)
    grade = detect_grade(name, title)
    if grade is None and textbook == "苏科版":
        grade = grade_from_suke_chapter(chapter)
    return {
        "stage": detect_stage(name, title, source_path),
        "grade": grade,
        "subject": detect_subject(name, title, source_path),
        "textbook": textbook,
        "chapter": chapter,
    }
