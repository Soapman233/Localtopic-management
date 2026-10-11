"""Split a scanned document into questions.

Chinese exam papers number their questions in a small number of ways.  We detect the
question starts, then group everything between one start and the next into a single
question - keeping formulas, images and source anchors attached.

Sub-questions (（1）（2）（3）) stay inside their parent question: they are not separate
questions and must travel together.

切分缺陷修复（阶段2）
--------------------
1. **小数/章节号误判**：文档标题常写成 ``10.3探索更小的微粒``、``9.1.2固体压强`` 之类，
   其中半角点号 ``.`` 会被旧正则当作题号分隔符，于是标题被切成了「第 10 题」。
   现在规定：**半角点号作为分隔符、且整行以「章节号形状」（形如 ``数字.数字[.数字]``
   且末段后不再跟数字）开头时，视为小数/章节号而非题号**。这样 ``10.3探索``、``9.1.2固体``
   被正确剔除，而 ``27.2018年5月13日…``（题号 27 + 正文以年份开头）因 ``27.20`` 后还有数字而保留。
   全角句点 ``．`` 与顿号 ``、`` 不参与判定，因为 ``16．1910年…``、``9、2023年…`` 这类真题的
   正文本身就可能以数字开头。
2. **头部区块不参与切分**：``学校:`` ``姓名`` ``班级`` ``考号`` ``密封线`` ``装订线`` 等
   版头段落一律不作为题目起点；文档头部（首个真题之前）里的小数/章节号标题也一律跳过。
   **版头判定只作用于「首个真题之前」的头部区块**——真题正文里也常出现「学校」等词
   （如「清华大学校园内…」「学校运动会…」），全篇生效会把真题整段丢掉。
3. **表格纯数值行（可选）**：见 ``FILTER_TABLE_NUMERIC``。
"""
# ---------------------------------------------------------------------------
# title: 题目切分
# description: 按题号把文档切分为结构化题目，识别章节号伪题与表格数据块。
# author: 待补充
# version: 0.1.0
# category: 阶段1-预处理
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict

from .docx_scan import ScannedDoc, PLACEHOLDER_RE
from .answer_regions import find_answer_regions

# A question start: optional bracket label, then a number, then a separator.
#   "1．"  "12."  "3、"  "【例1】"  "第1题"  "(1)"  "（1）"
# 第 4 个分组是数字分支捕获到的分隔符，供小数/章节号守卫使用。
Q_START = re.compile(
    r"^\s*(?:"
    r"【(?:例|例题|变式|练习)\s*(\d{1,3})】"      # 【例1】
    r"|第\s*(\d{1,3})\s*题"                        # 第1题
    r"|(\d{1,3})\s*([．.、,，])\s*"                # 1． 1. 1、 1，
    r")"
)

# Sub-question markers that must NOT start a new question.
SUB_Q = re.compile(r"^\s*[（(]\s*\d{1,2}\s*[)）]")

# Section headings that reset or precede a question block.
SECTION = re.compile(r"^\s*(?:[一二三四五六七八九十]+\s*[、.]|第\s*[一二三四五六七八九十]+\s*[部分节]|"
                     r"(?:单选题|多选题|填空题|实验题|探究题|计算题|作图题|简答题|解答题))")

# 文档版头/卷头关键词：出现这些词的行属于版头区块，绝不作为题目起点。
HEADER = re.compile(r"(学校|姓名|班级|考号|学号|密封线|装订线|座位号|考场|考试时间|满分|考生)")

# 小数 / 章节号形状：``10.3``、``9.1.2``、``4.2``、``0.5``、``1.5`` …
# 各数字段为 1~2 位，且最后一段后不能紧跟数字。
# 关键：``27.2018年5月13日`` 这种真题（题号 27 + 正文以年份开头）因为 ``27.20`` 后面还有数字
# ``1`` 而不匹配，从而不会被误杀；而 ``10.3探索`` 的 ``10.3`` 后面是汉字，正确判为章节号。
_DECIMAL_SECTION = re.compile(r"^\s*\d{1,2}\.\d{1,2}(?:\.\d{1,2})?(?!\d)")

# 含汉字即认为不是「纯数值行」。
_CJK = re.compile(r"[\u4e00-\u9fff]")

# 「纯数值行」的最大长度（如 ``0.5``、``66.7%``、``0.6A×5Ω=3V``、``2.0×105Pa``）。
_BARE_NUMERIC_MAX_LEN = 24

# 是否额外过滤「表格单元格里的纯数值行」。
#
# 阶段1 的题号正则同样会把表格数据（如实验数据表的 ``0.30``、``0.28``）误判为题目。
# 打开本开关可一并修掉，全量 209 份文件实测会少约 1865 个「假题目」（全部是数值单元格，
# 无一是真题）。为遵守「修复后正常文件题目数不应显著变化」的约束，**默认关闭**；
# 需要更干净的题库时把 ``--filter-table-numeric`` 打开即可（见 stage1.py）。
FILTER_TABLE_NUMERIC = False


@dataclass
class Question:
    number: str
    label: str
    start_paragraph: int
    end_paragraph: int
    text: str
    formula_ids: list = field(default_factory=list)
    images: list = field(default_factory=list)
    section: str | None = None
    sub_question_count: int = 0

    @property
    def char_length(self) -> int:
        return len(PLACEHOLDER_RE.sub("", self.text))


@dataclass
class SegmentResult:
    path: str
    questions: list
    unassigned_before_first: list
    stats: dict
    answer_regions: list = field(default_factory=list)


def _label_of(match) -> tuple[str, str]:
    for i, name in enumerate(("例", "第N题", "编号")):
        g = match.group(i + 1)
        if g:
            return g, name
    return match.group(0).strip(), "编号"


def is_decimal_start(text: str, match, in_head: bool = False,
                     is_table_cell: bool = False) -> bool:
    """判断一个匹配是否是「小数/章节号」而非题号。

    需要同时满足：

    1. 分隔符是半角点号 ``.``（全角句点 ``．``、顿号 ``、`` 不参与判定）；
    2. 整行以「章节号形状」开头（见 ``_DECIMAL_SECTION``）；
    3. 命中以下任一情形：

       * 位于**文档头部区块**（首个真题之前，如文档标题 ``10.3探索更小的微粒``）；
       * 位于**表格单元格**且是**纯数值行**（很短且不含汉字，如 ``0.30``、``0.5``、``66.7%``）。

    这样：

    * ``10.3探索更小的微粒`` / ``9.1.2固体压强的比较与计算`` / ``8.3力与运动的关系`` -> 标题，跳过；
    * 表格里的 ``0.30`` / ``0.28`` / ``0.5`` / ``66.7%`` -> 数据，跳过；
    * ``13.6：1先增大后减小再不变 解析：…``（解析版真题，含汉字）-> 保留；
    * ``27.2018年5月13日…`` / ``10.2025年5月1日…`` -> 真题，保留；
    * ``1．2025年…``（全角句点）/ ``1.一个质量…``（点号后是汉字）-> 保留。
    """
    if match.group(4) != ".":
        return False
    if not _DECIMAL_SECTION.match(text):
        return False
    if in_head:
        return True
    if not is_table_cell:
        return False
    stripped = text.strip()
    return len(stripped) <= _BARE_NUMERIC_MAX_LEN and not _CJK.search(stripped)


def looks_like_header(text: str) -> bool:
    """版头行（学校/姓名/班级/考号/密封线…）。

    注意：**只在文档头部区块（首个真题之前）生效**。真题正文里也常出现「学校」等词
    （如「清华大学校园内…」「学校运动会…」），若全篇生效会把真题整段丢掉。
    调用方负责用 ``seen_first_question`` 限定作用域。
    """
    t = text.strip()
    if not t or len(t) > 80:
        return False
    return bool(HEADER.search(t))


def segment(doc: ScannedDoc) -> SegmentResult:
    paragraphs = doc.paragraphs
    answer_regions = find_answer_regions(paragraphs)
    from .answer_regions import is_confirmed_region
    confirmed = [region for region in answer_regions if is_confirmed_region(region)]
    answer_start = confirmed[0]['start_scan_index'] if confirmed else len(paragraphs)
    starts = []
    current_section = None

    for p in paragraphs:
        if p.index >= answer_start:
            continue
        text = p.text
        if not text.strip():
            continue
        if SUB_Q.match(text):
            continue
        # 版头判定只在「首个真题之前」的头部区块生效，避免误伤正文含「学校」等词的真题。
        if not starts and looks_like_header(text):
            continue
        if SECTION.match(text) and not Q_START.match(text):
            current_section = text.strip()[:40]
            continue
        m = Q_START.match(text)
        if m:
            cell = FILTER_TABLE_NUMERIC and bool(getattr(p, "is_table_cell", False))
            if is_decimal_start(text, m, in_head=not starts, is_table_cell=cell):
                # 小数/章节号标题（或表格数值行），例如 "10.3探索更小的微粒"、"0.30"，跳过。
                continue
            num, kind = _label_of(m)
            starts.append((p.index, num, kind, current_section))

    questions = []
    for i, (idx, num, kind, section) in enumerate(starts):
        end = min(starts[i + 1][0] - 1 if i + 1 < len(starts) else len(paragraphs) - 1, answer_start - 1)
        body = [p for p in paragraphs if idx <= p.index <= end]
        text = "\n".join(p.text for p in body if p.text.strip())
        formula_ids = []
        for p in body:
            formula_ids.extend(PLACEHOLDER_RE.findall(p.text))
        imgs = [img for img, pi in doc.images.items() if idx <= pi <= end]
        sub_count = sum(1 for p in body if SUB_Q.match(p.text))
        questions.append(Question(
            number=num, label=kind, start_paragraph=idx, end_paragraph=end,
            text=text, formula_ids=formula_ids, images=imgs,
            section=section, sub_question_count=sub_count,
        ))

    first_start = starts[0][0] if starts else len(paragraphs)
    head = [p.text for p in paragraphs[:first_start] if p.text.strip()]

    stats = {
        "questions": len(questions),
        "with_formulas": sum(1 for q in questions if q.formula_ids),
        "with_images": sum(1 for q in questions if q.images),
        "with_sub_questions": sum(1 for q in questions if q.sub_question_count),
        "total_formula_refs": sum(len(q.formula_ids) for q in questions),
        "median_length": sorted(q.char_length for q in questions)[len(questions) // 2] if questions else 0,
        "unassigned_paragraphs": len(head),
    }
    return SegmentResult(path=doc.path, questions=questions, unassigned_before_first=head, stats=stats, answer_regions=answer_regions)


def to_dict(result: SegmentResult, doc: ScannedDoc | None = None) -> dict:
    out = {
        "path": result.path,
        "stats": result.stats,
        "questions": [asdict(q) for q in result.questions],
        "unassigned_before_first": result.unassigned_before_first,
        "answer_regions": result.answer_regions,
    }
    if doc is not None:
        out["formula_index"] = {
            fid: {"kind": f.kind, "status": f.status, "latex": f.latex, "progid": f.progid}
            for fid, f in doc.formulas.items()
        }
    return out
