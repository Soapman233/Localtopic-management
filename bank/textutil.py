"""文本工具：占位符剥离、内容哈希、中文双字切分（bigram）。

为什么需要它
------------
SQLite 内置的 FTS5 ``unicode61`` 分词器把连续汉字视为**一个** token，
因此 ``阿基米德原理浮力`` 只能整段命中，搜 ``浮力`` 命中不了。
中文检索必须自己分词。这里采用**双字滑窗（bigram）**方案：

* 建索引时把题干切成相邻两字组成的词元（``探索更小的微粒`` -> ``探索 索更 更小 小的 微粒``），
  以空格连接后交给 FTS5（unicode61 会把每个 bigram 当成一个 token）；
* 查询时用同样的方式切分查询串，词元之间是隐式 AND，再交给 ``MATCH``。

选择理由（对比 trigram / 自建倒排）：

1. **不用 trigram**：FTS5 的 ``trigram`` 分词器要求查询串至少 3 个字符，而物理题库里
   ``浮力``、``压强``、``密度`` 都是 2 字词，trigram 直接失效。
2. **不用自建倒排表**：双字切分后直接复用 FTS5 的倒排与 BM25 排序，代码更少、更快，
   也不必自己维护词表。
3. **召回足够**：bigram AND 语义等价于「这些相邻两字都出现过」，对中文短语召回高；
   单字查询（如 ``力``）退化为 ``LIKE`` 兜底，保证可用。

本模块只依赖标准库。
"""
# ---------------------------------------------------------------------------
# title: 文本工具
# description: 占位符剥离、内容哈希、中文双字切分与 LIKE 通配符转义（escape_like）等文本处理工具。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import re

# 阶段1 的公式占位符，如 ⟦F12⟧。
# 注意：**必须带捕获组**（``(F\d+)``）——``bank/edit.py`` 用 ``findall`` 取「裸 fid」
# 与公式 fid 集合比对；若无捕获组，``findall`` 返回带括号的 ``⟦F12⟧``，永远匹配不上。
# ``sub`` 消费点（``strip_placeholders``）不受影响：替换串为 ``""`` 时仍替换整个匹配。
PLACEHOLDER_RE = re.compile(r"⟦(F\d+)⟧")

# 连续汉字 / 连续字母数字（用于切分）。
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
_ALNUM_RE = re.compile(r"[A-Za-z0-9]+")

# 任意汉字 / 连续 3 个及以上英文字母 / 任意数字。
_CJK_ANY_RE = re.compile(r"[\u4e00-\u9fff]")
_LETTER_RUN_RE = re.compile(r"[A-Za-z]{3,}")
_DIGIT_RE = re.compile(r"\d")

# 空白（含全角空格与不换行空格）。
_WS_RE = re.compile(r"[\s\u3000\xa0]+")

# 纯数值「题目」的最大长度（超过则不再当垃圾）。
_NUMERIC_JUNK_MAX_LEN = 24

# 以小数开头、且汉字不超过此数的题干，视为「表格数据块被误切」。
_DATA_BLOCK_MAX_CJK = 4

# 以「数字.数字」开头（如 0.30 / 2.5 / 20.0）。
_DECIMAL_START_RE = re.compile(r"^\s*\d{1,3}\.\d")

# 单个汉字（计数用）。
_CJK_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")


def strip_placeholders(text: str | None) -> str:
    """去掉题干里的公式占位符 ⟦Fn⟧，保留其余文字。"""
    return PLACEHOLDER_RE.sub("", text or "")


def normalize_text(text: str | None) -> str:
    """归一化：去占位符 + 去所有空白。用于内容哈希与去重比较。"""
    return _WS_RE.sub("", strip_placeholders(text))


def content_hash(text: str | None) -> str:
    """题干内容哈希（sha256 of 归一化后的纯文本）。用于识别重复与变更。"""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def bigram_tokens(text: str | None) -> list[str]:
    """把文本切成检索词元：汉字用双字滑窗，字母数字用整词（小写）。

    * 长度 ≥ 2 的汉字串：所有相邻 bigram；长度 1 的汉字串：单字本身。
    * 字母/数字串：整体作为一个小写 token。
    """
    t = strip_placeholders(text)
    tokens: list[str] = []
    for run in _CJK_RUN_RE.findall(t):
        if len(run) == 1:
            tokens.append(run)
        else:
            for i in range(len(run) - 1):
                tokens.append(run[i:i + 2])
    for word in _ALNUM_RE.findall(t):
        tokens.append(word.lower())
    return tokens


def tokenized_text(text: str | None) -> str:
    """把文本转成 FTS5 索引列的内容（词元以空格分隔）。"""
    return " ".join(bigram_tokens(text))


def build_match_query(query: str) -> tuple[str, list[str]]:
    """把用户查询转成 FTS5 MATCH 表达式。

    返回 ``(match_expr, tokens)``。``tokens`` 为空表示查询里没有任何可检索字符
    （调用方应回退到 LIKE 或返回空结果）。
    """
    seen: set[str] = set()
    tokens: list[str] = []
    for tok in bigram_tokens(query):
        if tok not in seen:
            seen.add(tok)
            tokens.append(tok)
    # 每个词元用双引号包裹，避免 FTS5 语法字符（-、:、* 等）报错；空格即隐式 AND。
    expr = " ".join('"%s"' % t.replace('"', '""') for t in tokens)
    return expr, tokens


#: LIKE 转义符。与 SQL 里的 ``ESCAPE '\'`` 必须一致。
LIKE_ESCAPE_CHAR = "\\"


def escape_like(text: str | None) -> str:
    """转义 LIKE 模式里的通配符，使其按**字面**匹配。

    SQLite 的 ``LIKE`` 把 ``%``（任意串）与 ``_``（任意单字符）当通配符，
    用户搜 ``50%``、``a_b`` 会被当成模式串，命中全表或错误结果。
    这里把通配符（以及转义符本身）用 ``\\`` 前缀转义；调用方必须在 SQL 里
    显式写 ``LIKE :param ESCAPE '\\'``，否则转义符只是普通字符、转义不生效。

    转义顺序：**先转义符本身**，再转义 ``%``、``_``，避免二次转义。
    例：``50%`` -> ``50\\%``；``a_b`` -> ``a\\_b``；``C:\\tmp`` -> ``C:\\\\tmp``。
    """
    s = text or ""
    s = s.replace(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR)
    s = s.replace("%", LIKE_ESCAPE_CHAR + "%")
    s = s.replace("_", LIKE_ESCAPE_CHAR + "_")
    return s


def is_numeric_junk(text: str | None) -> bool:
    """判断是不是「表格数值被误切成题目」的垃圾题干。

    命中任一即视为垃圾：

    (a) **纯数值/单位行**：不含汉字、长度很短、至少含一个数字、且没有 3 个及以上连续英文字母
        （后者用于放过 ``1. What is 2+2?`` 这类真英文题）。
        例：``0.30``、``66.7%``、``0.6A×5Ω=3V``、``2.0×105Pa``。
    (b) **以小数开头的表格数据块**：整段以 ``数字.数字`` 开头且汉字极少（≤4 个）。
        例：``2.5\\n3\\n温度/℃\\n99…``、``0.30\\n正常发光\\n3``、``1.5格\\n2\\n较强``。

    注意 (b) 依赖「汉字极少」这一条件，因此不会误伤以数字开头正文的真题
    （如 ``27.2018年5月13日…中国首艘国产航母…`` 汉字很多）。
    """
    t = (text or "").strip()
    if not t:
        return False
    # (a) 纯数值/单位行
    if (len(t) <= _NUMERIC_JUNK_MAX_LEN and not _CJK_ANY_RE.search(t)
            and _DIGIT_RE.search(t) and not _LETTER_RUN_RE.search(t)):
        return True
    # (b) 以小数开头的表格数据块（汉字极少）
    if _DECIMAL_START_RE.match(t) and len(_CJK_CHAR_RE.findall(t)) <= _DATA_BLOCK_MAX_CJK:
        return True
    return False


# 题号后紧跟「章节号形状」= 标题被误切成题目的痕迹（如 题号"10" + "10.3探索…"）。
# 与 pipeline/segment.py 的判定一致：``数字.数字[.数字]`` 且末段后不再跟数字，
# 因此 ``27.2018年5月13日…``（27.20 后还有数字 1）不会被误判。
_TITLE_ARTIFACT_RE = re.compile(r"^\s*(\d{1,3})\.\d{1,2}(?:\.\d{1,2})?(?!\d)")


def is_title_artifact(number, text: str | None) -> bool:
    """判断题目是不是「文档标题（章节号）被误切」产生的假题目。

    阶段1 旧版切分把 ``10.3探索更小的微粒`` 这类标题切成了「第 10 题」：
    此时题号 ``10`` 后面紧跟 ``.`` 和数字 ``3``。命中即视为假题目。

    仅看首行的「章节号形状」；调用方通常再叠加「位于文档头部」的位置约束，避免误伤。
    """
    first_line = (text or "").split("\n", 1)[0]
    m = _TITLE_ARTIFACT_RE.match(first_line)
    return bool(m) and m.group(1) == str(number).strip()
