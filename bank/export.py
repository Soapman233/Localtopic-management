"""试卷导出（阶段4）：把组卷 payload 渲染为 DOCX（原生 OMML 公式）+ PDF，并做双客户端可编辑性验证。

职责
----
* **数据准备（纯函数，可单测）**：把 :func:`bank.paper.build_export_payload` 的产出
  整理成「文档计划」（``plan``）——标题、卷头信息、按大题分组、题号连续编号、
  题干/答案/解析的**行-段**切分，以及 ``⟦Fn⟧`` 占位符到 LaTeX 公式的映射。
  本层**不依赖**任何 Office 组件，便于在无 Word/WPS 的环境下做单元测试。
* **渲染**：通过本地 editor_sdk 桥接脚本（``edsdk.py``）把计划逐段写入 DOCX；
  公式一律用 ``doc_insert_math``（LaTeX → **OMML 原生公式**），图片用 ``doc_insert_image``。
* **PDF**：用 ``win32com`` 打开导出的 DOCX 并 ``ExportAsFixedFormat`` 生成 PDF（供打印对照）。
* **双客户端验证**：在 **Microsoft Word** 与 **WPS** 中分别打开导出的 DOCX，
  统计 ``OMaths.Count``，并**逐个公式改一个内部字符 → 保存 → 关闭 → 重开 → 比对**，
  以证明公式是「可编辑的原生公式」而非图片。

硬性约束
--------
1. 公式必须是可编辑的 **OMML**（LaTeX → OMML 由桥接脚本完成），**不得用图片冒充**。
2. 兼容 **WPS** 与 **Microsoft Word**（:func:`verify_cross_client` 实测两端）。
3. 支持 **学生版**（不含答案）与 **答案解析版**（含答案与解析）。

关键实现约定（详见 :func:`build_document_plan`）
-----------------------------------------------
* **题干与答案分离**：阶段1 的题干 ``text`` 常把答案/解析内联在题尾
  （``…（　　）A．…【答案】C【详解】…``）。导出前用 :func:`bank.answers.split_inline`
  把 ``stem`` / ``answer`` / ``analysis`` 拆开，**学生版只渲染 stem**，绝不泄露答案。
* **公式占位符按 ``fid`` 精确映射**：题干/解析里的 ``⟦Fn⟧`` 按 ``fid`` 直接对应
  ``formulas`` 里的 LaTeX，**不按出现顺序**，因此不会串位。占位符找不到公式时
  **明确降级**（原样保留占位符文本并记 ``warning``），不静默丢弃。
* **公式符号还原**：桥接对 ``\\Delta``/``\\Omega``/``\\pm``/``\\leq`` 等一批命令会输出
  **HTML 实体名**（``&Delta;`` 等），被 Word/WPS 当字面文本显示。导出时先 :func:`sanitize_latex`
  **展开 ``\\rm{}`` 包装**，再在 :func:`postprocess_bridge_docx` 里把 ``<m:t>`` 的实体名
  还原为 Unicode（``&Delta;``→``Δ``），保持**原生 OMML 可编辑**。
* **原始题号剥离**：题干行首的原卷题号（``7．``）在导出时被 :func:`strip_original_number`
  去掉，避免与新连续题号叠成 ``1．（3 分）7．…``。
* **图片位置**：payload 只给 ``image_paths``（``media/imageN.png`` 这类**包内相对路径**），
  没有行内位置信息，故图片统一**居中附在题干之后**；实际文件从**源 DOCX 包内**
  按 ``word/<media_path>`` 取出（并校验 ``sha256``），缓存到 ``outputs/export/_media_cache``；
  取不到的在 ``warnings`` 中**明确列出缺失**。
* **模板差异**：见 :data:`TEMPLATE_SPECS`（标题字号 / 页边距 / 装订线 / 是否标分值 /
  大题是否分页 / 卷头信息行各有可观察差异）。
* **只读导出**：导出路径**不触发 schema 迁移或任何写操作**（``build_export_payload`` 仅在
  ``schema_ready`` 为假时才迁移；CLI 用 :func:`bank.db.connect_readonly` 打开只读连接），
  因此不会改动 ``bank.db``。

v0.2 修复（问题①样式抖动 / 问题②版式）
----------------------------------------
* **问题① 样式时有时无**：根因是 editor_sdk 在 ``create_doc`` 后**偶发**返回
  ``-32603 document is not open(ed)``（实测 6 次里约 4 次首次失败），而旧代码失败只记
  warning、不重试。现于 :func:`_mcp_rpc` 层对**瞬时错误**按指数退避自动重试
  （:data:`_RPC_MAX_ATTEMPTS` 次）；**确定性错误不重试**，避免掩盖真问题。
  同时把字体 + 行距 + 页边距**合并为一次** ``doc_set_document_style``（``page_style``），
  去掉原先独立、且最先失败的 ``doc_modify_section`` 页边距调用；``doc_modify_section``
  仅在有装订线（``gutter>0``）时保留一次。见 :meth:`EditorBridge.apply_style`。
* **问题② 版式不像试卷**：默认 **1.5 倍行距**（docDefaults）；大题标题段前 12pt / 段后
  6pt；**每题段后 8pt**；图片段落前后各 6pt；大题标题改为常见写法
  「一、选择题（本大题共 N 小题，每小题 X 分，共 T 分）」；页脚注入
  「第 X 页 共 Y 页」（PAGE + NUMPAGES 域，见 :func:`_inject_page_number_footer`）。
  版式间距常量见 :data:`SPACING_TITLE_AFTER` 等。

v0.3 修复（问题③图片尺寸自适应 / 图片与题干不分页拆散）
------------------------------------------------------
* **图片尺寸自适应**：桥接默认按「源图原始尺寸」插入，实测同一份卷里图片宽 6.85–15.88cm
  跨度极大（源 PNG 内嵌 pHYs 不一致：107/99/96 DPI）。现统一按「宽高比 + 页面可用文字
  宽度」计算显示尺寸并显式传 ``w``/``h``：宽幅（ratio>3.0）≤0.82×W、常规（1.2–3.0）
  ≤0.68×W、偏方/竖高（<1.2）≤0.55×W，高度上限 7cm、不放大、最小宽 4cm、绝不超可用宽。
  见 :func:`fit_image_size` 与常量 :data:`IMAGE_WIDTH_RATIO` 等。
* **图片不居中 / 与题干拆页（根因）**：桥接 ``doc_insert_image`` 会**先建一个空段**承载
  ``paragraph_property``（居中/间距/分页控制），再**另起一段**放图片。于是图片段自身
  没有 ``jc=center``（**图片左对齐**），且 ``keepNext`` 落在空段上、与图片段**断链**
  （**图片可与题干拆到两页**）。v0.3 在 :func:`postprocess_bridge_docx` 里把「空段 +
  紧随图片段」**合并为一段**（图片段继承居中/间距/``keepNext``），并在
  :func:`render_plan_to_docx` 中给每题各段（除末段）设 ``keep_with_next``、全部设
  ``keep_together``，使**题干与其配图保持在同一页**。见 :func:`_merge_image_paragraphs`。

v0.4 修复（问题④题目间距不合理 / 图片留白不足）
-----------------------------------------------
* **题与题间距偏小**：正文 12pt + 1.5 倍行距 → 单行高 18pt，而旧「每题段后 8pt」仅 0.44 行，
  题与题（尤其计算题末行与下一题首行）几乎贴在一起；图片前后 6pt 也让配图紧贴上下文字。
  现按国内试卷观感放大并集中到 :data:`SPACING_QUESTION_AFTER` 等常量：
  **每题段后 8→16pt**、**图片前后 6→10pt**、**大题标题段前 12→16pt / 段后 6→10pt**。
  实测同一份 6 页卷在 Word 渲染下页数不变（学生版 6→6、答案解析版 9→9）。
* **不做题型区分**：选择题与计算题**统一** 16pt；同一题内的小问（1)(2) **不加**额外间距
  （同属一题，1.5 倍行距已足够分行）。理由与边界见常量块注释。

v0.5 修复（问题⑤控制字符致整卷导出失败 / 问题⑥选项标签与配图拆页）
------------------------------------------------------------------
* **问题⑤ 控制字符致整卷导出失败（阻断级）**：桥接 ``doc_insert_text`` **拒绝**文本中的
  控制字符——实测 TAB（``\\x09``）在**段首/段中/段尾任意位置**都报
  ``-32603 ... control character (code=9)``，垂直制表（``\\x0b``）报 ``code=11``。
  真实样例卷里「选项行内公式后紧跟 TAB」（如 ``A．⟦F66⟧，⟦F67⟧\\tB．``）切段后
  会产生**以 TAB 开头的文本段**，经 :meth:`EditorBridge._insert_inline` 直送桥接即失败，
  **整卷导出/预览中断**。注意：``doc_insert_paragraph_with_text``（首段路径）**接受** TAB，
  只有内联续写路径拒绝——故此前只覆盖部分路径，问题被掩盖。
  修复：新增 :func:`bridge_safe_text` —— 送桥接前把 ``\\t`` 换成私用区哨兵
  :data:`BRIDGE_TAB_SENTINEL`（实测该码位可被桥接接受并原样落盘）、剔除其余控制字符；
  再由 :func:`_set_explicit_tab_stops` 在 OOXML 层把哨兵**还原为真正的 ``<w:tab/>``**
  并补 1/4、1/2、3/4 制表位停靠点（保留真实制表位语义，**不转成 4 个空格**）。
* **问题⑥ 选项标签与其配图被拆到两页**：选项标签判定原要求「整段全是纯文本」
  （``all(k==SEG_TEXT ...)``），但真实选项行常含行内公式 → 判定失效 → ``keep_with_next``
  未设置 → 标签与配图拆页。修复：抽出 :func:`is_option_label_segments`，改用「可见文本」
  判定（公式段以占位记号参与拼接），只看段尾是否为 ``A．``/``B.`` 形式标签。
"""

# ---------------------------------------------------------------------------
# title: 试卷导出
# description: EF01 已知空白清洗、未知私有字形警告与纯公式页脚关系命名空间修补。把组卷 payload 渲染为 DOCX（公式一律为可编辑的 OMML 原生公式）与 PDF；含模板规格（考试/测验/作业）、占位符按 fid 映射与降级、源 DOCX 包内图片按 sha256 解析，以及 Word/WPS 双客户端可编辑性验证；桥接经进程内 HTTP 直连复用（导出 82–165s → <5s）。v0.2：桥接调用对瞬时错误（-32603 document not open）自动重试修「样式时有时无」，改用 page_style 一次设好页边距，版式改为 1.5 倍行距 + 段间距 + 页脚「第 X 页 共 Y 页」。v0.3：图片按宽高比 + 可用宽度自适应尺寸（宽幅≤0.82W/常规≤0.68W/高≤0.55W，高≤7cm、不放大），并合并桥接多出的空段使图片段继承居中/间距/keepNext，修「图片不居中」与「图片与题干拆页」。v0.4：放大题间距与图片留白（每题段后 8→16pt、图片前后 6→10pt、大题标题段前 12→16pt/段后 6→10pt），修「题与题间隔不合理」；选择题与计算题统一、同题小问不加间距；同卷页数不变。v0.5：新增 bridge_safe_text 把 TAB 换哨兵、其余控制字符剔除（桥接 doc_insert_text 拒绝控制字符，code=9/11，曾致整卷导出失败），再由 _set_explicit_tab_stops 还原为真实 <w:tab/> 并补制表位停靠点；新增 is_option_label_segments 用「可见文本」判定选项标签（含行内公式也生效），修「选项标签与配图拆页」。
# author: 待补充
# version: 0.5.0
# category: 阶段4-导出
# ---------------------------------------------------------------------------


from __future__ import annotations

import hashlib
import html.entities
import json
import os
import re
import shutil
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import NamedTuple

from . import answers as _answers
from . import paper as _paper

# --------------------------------------------------------------------------- #
# 路径 / 外部工具
# --------------------------------------------------------------------------- #
#: 导出产物根目录。
EXPORT_DIR = Path("outputs/export")
#: 从源 DOCX 解出的图片缓存目录。
MEDIA_CACHE_DIR = EXPORT_DIR / "_media_cache"

#: 本地 editor_sdk 桥接脚本（LaTeX → OMML）。
DEFAULT_BRIDGE_SCRIPT = (
    "C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/"
    "workbuddy-builtin/skills/tencent-local-office-edit/edsdk.py"
)

#: 桥接脚本所需的解释器（可用环境变量 ``BANK_BRIDGE_PY`` 覆盖）。
_BRIDGE_PY_CANDIDATES: tuple[str, ...] = (
    os.environ.get("BANK_BRIDGE_PY", ""),
    "C:/Users/SOAP/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe",
)

#: ``⟦Fn⟧`` 占位符（捕获 fid，如 ``F48``）。
PLACEHOLDER_RE = re.compile(r"⟦(F\d+)⟧")

#: 题干**行首**的原始题号（如 ``7．`` / ``1.`` / ``12、``）。
_LEADING_NUMBER_RE = re.compile(r"^\s*(\d{1,3})\s*[．.、]\s*")

#: 段尾的**选项标签**（``A．`` / ``B.`` 等），要求位于段首或 TAB 之后。
#: 用于把「选项标签 + 其配图」保持在同页；含行内公式的选项行同样适用
#: （公式段以占位记号参与拼接，见 :func:`render_plan_to_docx`）。
_OPTION_LABEL_TAIL_RE = re.compile(r"(?:^|\t)\s*[A-D][．.]\s*$")

#: ``\text{[U+XXXX]}`` 形式的 CJK 转义（MTEF 产物）。
_TEXT_UPLUS_RE = re.compile(r"\\text\{\[U\+([0-9a-fA-F]{4})\]\}")
#: 裸 ``[U+XXXX]``（不在 ``\text{}`` 内）。
_UPLUS_RE = re.compile(r"\[U\+([0-9a-fA-F]{4})\]")

#: ``\rm{...}`` / ``\mathrm{...}`` 包装。桥接会丢弃其字体效果，**却会破坏内容里的
#: 希腊字母命令**——``\rm{ \Delta }`` 被解析成字面文本 ``\Deltap``。故导出前**展开**该包装，
#: 让 ``\Delta`` 回到顶层由桥接正常渲染（再经 :func:`_resolve_math_entities` 还原符号）。
_RM_WRAP_RE = re.compile(r"\\(?:mathrm|rm)\s*\{([^{}]*)\}")
#: 裸 ``\rm \Delta`` / ``\rm g``（无花括号）。
_RM_BARE_RE = re.compile(r"\\(?:mathrm|rm)\s+(?=[A-Za-z\\{])")

#: 文档计划里的段类型。
SEG_TEXT = "text"
SEG_MATH = "math"
SEG_IMAGE = "image"

# --------------------------------------------------------------------------- #
# 桥接文本安全化（控制字符）
# --------------------------------------------------------------------------- #
#: 桥接 ``doc_insert_text`` **拒绝**文本中的控制字符：实测 TAB（``\x09``）与垂直制表
#: （``\x0b``）在**段首/段中/段尾任意位置**均报 ``-32603 ... control character
#: (code=9/11)``，导致整卷导出失败（真实样例卷即因此不可导出）。
#:
#: 但「选项对齐」需要保留真实制表位语义，故不能简单丢弃。做法：
#: 送桥接前把 TAB 换成**私用区哨兵**（实测该码位可被桥接接受并原样落进
#: ``word/document.xml``），保存后再由 :func:`_set_explicit_tab_stops` 在 OOXML 层
#: 还原为真正的 ``<w:tab/>`` 并补 ``w:tabs`` 停靠点。
#:
#: 其余控制字符（``\x00-\x08\x0b-\x1f``、``\x7f``）无排版语义，直接剔除。
BRIDGE_TAB_SENTINEL = "\ue000"
#: 需要从送桥接文本中剔除的控制字符（TAB 单独走哨兵，不在此列）。
_BRIDGE_DROP_CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def bridge_safe_text(value: str) -> str:
    """把文本转成**桥接可接受**的形式（控制字符安全化）。

    * ``\\t`` → :data:`BRIDGE_TAB_SENTINEL`（保留制表位语义，后续还原为 ``<w:tab/>``）；
    * 其余控制字符（``\\x00-\\x08``、``\\x0b-\\x1f``、``\\x7f``）→ 直接剔除。

    非字符串入参原样返回（防御性：调用方可能传 ``None``）。
    """
    if not isinstance(value, str) or not value:
        return value
    if "\t" in value:
        value = value.replace("\t", BRIDGE_TAB_SENTINEL)
    if _BRIDGE_DROP_CTRL_RE.search(value):
        value = _BRIDGE_DROP_CTRL_RE.sub("", value)
    return value

# --------------------------------------------------------------------------- #
# 模板规格
# --------------------------------------------------------------------------- #
#: 正文默认行距（倍数，对应 ``line_spacing_rule=1``）。中文试卷常用 **1.5 倍**，
#: 单倍行距会让汉字「挤成一团」（问题②）。
DEFAULT_LINE_SPACING = 1.5

#: A4 纸张尺寸（pt）——国内试卷标准纸张。桥接 ``create_doc`` 默认给的是 **US Letter**
#: （612×792pt），与「常见试卷」不一致，故显式设为 A4（问题②）。
PAGE_SIZE_A4 = {"width": 595.3, "height": 841.9}

#: 版式间距（pt）——对齐「常见试卷」观感（问题② / 问题④）。
#: 标题→卷头、卷头→大题、大题标题段前后、每题段后、图片段落前后。
#:
#: **问题④（题与题间距不合理）**：正文 12pt + 1.5 倍行距 → 单行高 18pt。
#: 旧值「每题段后 8pt」仅 0.44 行，题与题之间看不出分界（尤其计算题末行与下一题首行几乎
#: 贴在一起）；图片前后 6pt 更让配图紧贴上下文字。现按国内试卷观感放大：
#:
#: * 每题段后 16pt（≈0.9 行）——题与题之间形成清晰空档，又不必整页翻倍；
#: * 图片前后各 10pt——配图与上下文字留出呼吸空间（图片为独立居中段，其上/下还会有
#:   相邻文本行自身的 18pt 行距，实际视觉间距约 28pt）；
#: * 大题标题段前 16pt / 段后 10pt——标题与上方内容、标题与首题各留一档空档。
#:
#: **不做区分**：选择题与计算题**统一**用 16pt（选择题各选项本就自成多行块，无需额外留白；
#: 分类型设不同间距会让版面不可预期）。同一题内的小问（1)(2) **不加**额外间距——它们同属
#: 一题，1.5 倍行距已足够分行，加空档反而会被误读成两道题。
SPACING_TITLE_AFTER = 6.0
SPACING_INFO_AFTER = 6.0
SPACING_SECTION_BEFORE = 16.0
SPACING_SECTION_AFTER = 10.0
SPACING_QUESTION_AFTER = 8.0
SPACING_IMAGE_AROUND = 4.0

# --------------------------------------------------------------------------- #
# 图片自适应尺寸（问题③）
# --------------------------------------------------------------------------- #
# 背景：桥接 ``doc_insert_image`` 不传 ``w``/``h`` 时按「源图原始尺寸」插入——等于源图
# 像素数按 **96 DPI**（或 PNG 内嵌 pHYs DPI）换算，实测同一份卷里图片宽 6.85–15.88cm
# 跨度极大（源 pHYs 不一致：107/99/96 DPI），大图几乎占满整行、个别图高达 9.9cm。
#
# 解决：**不沿用源尺寸**，改按「宽高比 + 页面可用文字宽度」计算显示尺寸，并显式传
# ``w``/``h``（桥接单位为 px@96DPI）。规则（对齐组卷网/学科网常见试卷观感）：
#
#   * 宽度档位按**宽高比**取「占可用宽度的比例」（见 :data:`IMAGE_WIDTH_RATIO`）；
#   * **高度上限** :data:`IMAGE_MAX_HEIGHT_CM`（防止单图占半页）；
#   * **不放大**：显示宽不超过「像素按 96DPI 反算的自然宽」（避免拉伸模糊）；
#   * **最小宽度** :data:`IMAGE_MIN_WIDTH_CM`（保可读，对极小图允许有限放大）；
#   * **绝不超出**可用文字宽度；保持宽高比、居中。
#
#: 宽高比阈值 → 目标宽度占可用宽度比例（**从大到小**匹配首个 ``ratio > 阈值``）。
IMAGE_WIDTH_RATIO: tuple[tuple[float, float], ...] = (
    (3.0, 0.82),      # 宽幅（实验装置、多图对比）：≤ 0.82×W ≈ 13.4cm
    (1.2, 0.68),      # 常规（受力分析、电路图）：  ≤ 0.68×W ≈ 11.2cm
    (0.0, 0.55),      # 偏方/竖高（坐标图）：       ≤ 0.55×W ≈ 9.0cm
)
#: 图片高度上限（cm）——超过则按高度反算宽度。
IMAGE_MAX_HEIGHT_CM = 7.0
#: 图片最小宽度（cm）——避免图小到看不清。
IMAGE_MIN_WIDTH_CM = 4.0
#: 极小图允许的最大放大倍数（相对 96DPI 自然尺寸），兼顾可读与清晰。
IMAGE_MAX_UPSCALE = 1.5
#: 计算「自然尺寸」的参考分辨率（DPI）。统一取 **96**，忽略源图内嵌 pHYs DPI
#: （源 pHYs 不一致，正是尺寸不一致的根因）。
IMAGE_REF_DPI = 96.0
#: 每厘米对应的 EMU（OOXML 长度单位）。
EMU_PER_CM = 360000.0


def _image_pixel_size(path: str | Path) -> tuple[int | None, int | None]:
    """读取图片**像素尺寸** ``(宽, 高)``；支持 PNG/JPEG/GIF/BMP，其余返回 ``(None, None)``。"""
    try:
        with open(path, "rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":                      # PNG（IHDR）
                return struct.unpack(">II", head[16:24])
            if head[:6] in (b"GIF87a", b"GIF89a"):                    # GIF
                return struct.unpack("<HH", head[6:10])
            if head[:2] == b"BM":                                     # BMP
                w, h = struct.unpack("<ii", head[18:26])
                return abs(w), abs(h)
            if head[:3] == b"\xff\xd8\xff":                           # JPEG（扫 SOFn 段）
                f.seek(2)
                while True:
                    b = f.read(1)
                    while b and b != b"\xff":
                        b = f.read(1)
                    marker = f.read(1)
                    while marker == b"\xff":
                        marker = f.read(1)
                    if not marker:
                        break
                    m = marker[0]
                    if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                             0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return w, h
                    seglen = struct.unpack(">H", f.read(2))[0]
                    f.seek(seglen - 2, 1)
                return None, None
    except (OSError, struct.error):
        pass
    return None, None


def fit_image_size(px_w: int | None, px_h: int | None,
                   avail_cm: float) -> tuple[float, float] | None:
    """按宽高比与可用宽度计算图片**显示尺寸（cm）**，返回 ``(宽, 高)`` 或 ``None``。

    规则见本段注释；``px_w``/``px_h`` 缺失或 ``avail_cm`` 非正时返回 ``None``（调用方回退原尺寸）。
    """
    if not px_w or not px_h or px_w <= 0 or px_h <= 0 or avail_cm <= 0:
        return None
    ratio = px_w / px_h
    factor = next(f for th, f in IMAGE_WIDTH_RATIO if ratio > th)
    target = factor * avail_cm
    natural = px_w / IMAGE_REF_DPI * 2.54                      # 96DPI 自然宽
    width = min(target, natural)                               # 不放大
    if width < IMAGE_MIN_WIDTH_CM:                             # 最小宽度（有限放大）
        width = min(IMAGE_MIN_WIDTH_CM, natural * IMAGE_MAX_UPSCALE)
    width = min(width, avail_cm)                               # 绝不超可用宽度
    height = width / ratio
    if height > IMAGE_MAX_HEIGHT_CM:                           # 高度上限
        height = IMAGE_MAX_HEIGHT_CM
        width = height * ratio
    return round(width, 2), round(height, 2)


def _cm_to_px(cm: float) -> int:
    """厘米 → 像素（96 DPI，桥接 ``w``/``h`` 的单位）。"""
    return max(1, round(cm / 2.54 * IMAGE_REF_DPI))

#: 三种模板的可观察差异（长度单位统一为 **pt**；字号为 pt）。
#:
#: * ``title_size``      试卷标题字号（考试=小二18 / 测验=三号16 / 作业=四号14）；
#: * ``margins``         页边距（考试 2.54/2.6/2.0cm；测验 2.0cm；作业 1.5cm）；
#: * ``gutter``          **装订线**宽度（仅「考试」非零；经 ``doc_modify_section.gutter`` 设置）；
#: * ``show_score``      是否在题号后标注分值（考试/测验=是，作业=否）；
#: * ``page_break_sections``  大题之间是否分页（考试/测验=是，作业=否）；
#: * ``line_spacing``    正文行距倍数（三模板统一 1.5）；
#: * ``info_line``       卷头信息行文本。
TEMPLATE_SPECS: dict[str, dict] = {
    "考试": {
        "label": "考试",
        "title_size": 18.0,
        "title_font": "黑体",
        "section_size": 14.0,
        "body_size": 12.0,
        "body_font": "宋体",
        "line_spacing": DEFAULT_LINE_SPACING,
        "margins": {"top": 72.0, "bottom": 72.0, "left": 73.7, "right": 56.7},
        "gutter": 28.35,
        "show_score": True,
        "page_break_sections": True,
        "info_line": "班级：__________　姓名：__________　学号：__________　成绩：______",
        "title_border": True,
    },
    "测验": {
        "label": "测验",
        "title_size": 16.0,
        "title_font": "黑体",
        "section_size": 12.0,
        "body_size": 12.0,
        "body_font": "宋体",
        "line_spacing": DEFAULT_LINE_SPACING,
        "margins": {"top": 56.7, "bottom": 56.7, "left": 56.7, "right": 56.7},
        "gutter": 0.0,
        "show_score": True,
        "page_break_sections": True,
        "info_line": "班级：__________　姓名：__________",
        "title_border": False,
    },
    "作业": {
        "label": "作业",
        "title_size": 14.0,
        "title_font": "黑体",
        "section_size": 12.0,
        "body_size": 12.0,
        "body_font": "宋体",
        "line_spacing": DEFAULT_LINE_SPACING,
        "margins": {"top": 42.5, "bottom": 42.5, "left": 42.5, "right": 42.5},
        "gutter": 0.0,
        "show_score": False,
        "page_break_sections": False,
        "info_line": "姓名：__________　班级：__________",
        "title_border": False,
    },
}


class ExportError(RuntimeError):
    """导出过程中的不可恢复错误（参数非法 / 桥接不可用 / 保存失败等）。"""


# --------------------------------------------------------------------------- #
# 通用小工具
# --------------------------------------------------------------------------- #
def _fmt_num(x) -> str:
    """把分值格式化成人类可读字符串（``3.0 -> "3"``，``2.5 -> "2.5"``）。"""
    if x is None:
        return ""
    f = float(x)
    return str(int(f)) if f == int(f) else f"{f:g}"


def _unwrap_rm(s: str) -> str:
    """展开 ``\\rm{...}`` / ``\\mathrm{...}`` 包装（见 :data:`_RM_WRAP_RE` 说明）。

    桥接对 ``\\rm`` 的字体效果**无感**（``\\rm{g}`` 与 ``g`` 渲染一致），但 ``\\rm{ \\Delta }``
    会退化成字面文本，故统一展开。展开对普通字母是**无损**的，只修正希腊字母命令。
    """
    for _ in range(4):
        new = _RM_WRAP_RE.sub(r"\1", s)
        if new == s:
            break
        s = new
    return _RM_BARE_RE.sub("", s)


def sanitize_latex(latex: str | None) -> str | None:
    """把 payload 里的 LaTeX 清洗成桥接脚本可直接渲染的形式。

    处理项：

    * 去掉外层 ``$…$``；
    * ``\\text{[U+XXXX]}`` / 裸 ``[U+XXXX]`` → ``\\text{对应汉字}``
      （**在已有 ``\\text{}`` 内替换**，不重复套一层，否则渲染器报 ``ToCommands refused``）；
    * EF01 已知空白标记去除；未知私有字形显式用 □ 占位，文档计划另给核对警告；
    * ``\\text{<U+FFFD>}``（MTEF 解码失败产生的替换字符）→ ``\\text{□}``，避免乱码；
    * **展开** ``\\rm{...}`` / ``\\mathrm{...}`` 包装（见 :func:`_unwrap_rm`）——
      否则 ``\\rm{ \\Delta }`` 会被桥接解析成字面文本；
    * 折叠多余空白、``{ x } -> {x}``、去掉起始 ``~``。

    返回 ``None`` 表示清洗后为空（调用方应降级处理）。
    """
    if latex is None:
        return None
    s = str(latex).strip()
    s = re.sub(r"^\$+", "", s)
    s = re.sub(r"\$+$", "", s)
    s = _TEXT_UPLUS_RE.sub(lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", s)
    s = _UPLUS_RE.sub(lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", s)
    from .latexnorm import sanitize_glyphs
    s = sanitize_glyphs(s)
    s = s.replace("\\text{\ufffd}", "\\text{□}")
    s = _unwrap_rm(s)
    s = re.sub(r"^[~]+", "", s.strip())
    s = re.sub(r"\s+", " ", s).strip()
    for _ in range(4):
        s = s.replace("{ ", "{").replace(" }", "}")
    return s or None


#: 裸多字母标识符（如单位 ``cm`` / ``kg``）：不被反斜杠或字母紧邻。
_BARE_LETTERS_RE = re.compile(r"(?<![\\A-Za-z])([A-Za-z]{2,})(?![A-Za-z])")
#: 需要保护的「命令 + 内容」组（其内容不参与裸标识符包裹）。
_PROTECT_CMD_RE = re.compile(r"\\(?:text|rm|mathrm|operatorname|mbox)\{[^{}]*\}")
#: MTEF 产生的**波浪号命令**（「范围号 / 约等号 ~」），桥接无法渲染：
#:   ``\tilde{\ }`` / ``\tilde{}`` / ``\tilde{\}``（如 ``0\tilde{\ }0.6``）、
#:   ``\mathrm{\~{}}``（如 ``t_{1}\mathrm{\~{}}t_{2}``）。
#: 实测全库 54 条公式（26 题）因此报 ``ToCommands returned empty``，统一归一为 ``\sim``。
#: 注意：``sanitize_latex`` 会去掉 ``\tilde{\ }`` 内部空格，故花括号内**只允许**
#: 空白、反斜杠与波浪号。
_TILDE_CMD_RE = re.compile(
    r"\\tilde\s*\{\s*[\\~\s]*\}"               # \tilde{} / \tilde{\ } / \tilde{\} / \tilde{\~}
    r"|\\mathrm\s*\{\s*\\~?\s*\{\s*\}\s*\}"    # \mathrm{\~{}} / \mathrm{{}}
    r"|\\~\{\s*\}"                             # 裸 \~{}（如 ``18℃\~{}30℃``）
)
#: ``\rm{{}^\text{3}}`` —— MTEF 表达**单位上标**（如 ``m³``）的写法。
#: ``\rm{}`` 的展开规则要求花括号内无嵌套，此处含嵌套故漏网；桥接同样无法渲染。
#: 归一为 ``^{\text{3}}``（上标文本）。
_RM_SUPERSCRIPT_RE = re.compile(
    r"\\rm\s*\{\s*\{\s*\}\s*\^\s*\\text\s*\{\s*([^{}]*?)\s*\}\s*\}"
)


def repair_latex(latex: str | None) -> str | None:
    """对渲染失败的 LaTeX 做保守修复。

    规则一：把**裸多字母标识符**用花括号包起来。
    背景：桥接的 LaTeX→OMML 解析器对 ``数字+多字母标识符+上下标``（如 ``4cm^{3}``）
    会返回 ``ToCommands returned empty``。实测 ``4{cm}^{3}`` 可正常渲染。
    ``\\text{}`` / ``\\rm{}`` 等命令的内容**不参与**包裹（先保护再还原），避免二次包裹。

    规则二：把**波浪号命令**归一为 ``\\sim``。
    背景：MTEF 把「范围号 / 约等号 ~」转成 ``\\tilde{\\ }``（如 ``0\\tilde{\\ }0.6``）
    或 ``\\mathrm{\\~{}}``（如 ``t_{1}\\mathrm{\\~{}}t_{2}``），桥接渲染同样报
    ``ToCommands returned empty``。**全库实测 54 条公式（26 题）因此无法渲染**，
    导出会降级为「（公式）」占位。统一归一为可渲染的关系符 ``\\sim``。
    """
    if not latex:
        return latex
    # 规则二先行：这些命令内部含 ``\`` 与空花括号，先归一避免干扰规则一的包裹逻辑。
    latex = _TILDE_CMD_RE.sub(r"\\sim", latex)
    latex = _RM_SUPERSCRIPT_RE.sub(r"^{\\text{\1}}", latex)
    protected: list[str] = []

    def _protect(m):
        protected.append(m.group(0))
        return f"\x00{len(protected) - 1}\x00"

    tmp = _PROTECT_CMD_RE.sub(_protect, latex)
    tmp = _BARE_LETTERS_RE.sub(lambda m: "{" + m.group(1) + "}", tmp)
    tmp = re.sub(r"\x00(\d+)\x00", lambda m: protected[int(m.group(1))], tmp)
    return tmp


def iter_placeholders(text: str | None) -> list[str]:
    """按出现顺序返回文本里的 ``⟦Fn⟧`` 占位符 fid 列表（如 ``["F48", "F49"]``）。"""
    return PLACEHOLDER_RE.findall(text or "")


def strip_original_number(text: str | None, number=None) -> str | None:
    """去掉题干**行首**的原始题号（导出会重新连续编号，原题号是冗余的）。

    阶段1 的题干把**原卷题号**也保留了下来（如 ``7．如图所示…``），若不清除，
    导出渲染时会在前面再拼一个新题号，得到 ``1．（3 分）7．如图所示…`` 的双重题号。

    * 只处理文本**开头**的题号（即题干首行），正文中间的数字一律不动；
    * 分隔符限定 ``．.、``，故 ``（1）`` 这类小题号不会被误伤；
    * 传入 ``number``（原题号）时**必须与行首数字一致才剥离**——不一致说明该数字是
      正文内容（如 ``3．14 是圆周率``），此时保持原样，宁可留冗余也不误删。
    """
    if not text:
        return text
    m = _LEADING_NUMBER_RE.match(text)
    if not m:
        return text
    if number is not None:
        want = re.sub(r"\D", "", str(number))
        if want and m.group(1) != want:
            return text                       # 行首数字与原题号不符 → 视为正文，不剥离
    return text[m.end():]


def _line_to_segments(line: str, fid_latex: dict, ctx: dict) -> list[tuple[str, str]]:
    """把一行文本按占位符切成 ``(kind, value)`` 段序列。

    * 普通文本 → ``("text", 文本)``；
    * ``⟦Fn⟧`` 且 ``fid_latex`` 中有 ``Fn`` → ``("math", 清洗后的 LaTeX)``，
      并累加 ``ctx["formulas"]``；
    * ``⟦Fn⟧`` 找不到公式 → **降级**：保留占位符字面文本并记 ``warning``。
    """
    segs: list[tuple[str, str]] = []
    parts = PLACEHOLDER_RE.split(line)
    # re.split 只带一个捕获组：奇数下标为捕获到的 fid。
    for j, part in enumerate(parts):
        if j % 2 == 1:
            fid = part
            raw = fid_latex.get(fid)
            from .latexnorm import unknown_private_glyphs
            unknown = unknown_private_glyphs(raw)
            if unknown:
                ctx['warnings'].append(f"公式 ⟦{fid}⟧（题目 {ctx.get('qid')}）含未识别字形 {', '.join(unknown)}，已用 □ 占位，需对照原图核对")
            latex = sanitize_latex(raw)
            if latex:
                segs.append((SEG_MATH, latex))
                ctx["formulas"] += 1
            else:
                segs.append((SEG_TEXT, "⟦" + fid + "⟧"))
                ctx["warnings"].append(
                    f"占位符 ⟦{fid}⟧ 无可用公式（题目 {ctx.get('qid')}），已降级为字面文本")
        elif part:
            segs.append((SEG_TEXT, part))
    return segs


def text_to_lines(text: str | None, fid_latex: dict, ctx: dict,
                  *, prefix: str = "") -> list[list[tuple[str, str]]]:
    """把多行文本转成「行-段」结构；``prefix`` 只加在第一行最前面。

    * 按 ``\\n`` 分行、逐行去首尾空白；**行内 ``\\t`` 原样保留**（用于选项对齐，
      由 :func:`bridge_safe_text` 送桥接前换成哨兵、再在 OOXML 层还原为 ``<w:tab/>``
      并补制表位停靠点；不转成 4 个空格）；
    * 空行丢弃；每行转成段序列（见 :func:`_line_to_segments`）。
    """
    lines: list[list[tuple[str, str]]] = []
    for raw in (text or "").replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        segs = _line_to_segments(line, fid_latex, ctx)
        if segs:
            lines.append(segs)
    if not lines:
        lines = [[(SEG_TEXT, "")]]
    if prefix:
        first = lines[0]
        if first and first[0][0] == SEG_TEXT:
            first[0] = (SEG_TEXT, prefix + first[0][1])
        else:
            lines[0] = [(SEG_TEXT, prefix)] + first
    return lines


# --------------------------------------------------------------------------- #
# 图片解析：从源 DOCX 包内按 sha256 取出
# --------------------------------------------------------------------------- #
def resolve_media(conn, source_id, media_path: str | None, sha256: str | None,
                  *, cache_dir: Path = MEDIA_CACHE_DIR) -> tuple[Path | None, str | None]:
    """把 ``media/imageN.png`` 解析为本地文件路径。

    返回 ``(路径, 原因)``；成功时原因为 ``None``，失败时路径为 ``None`` 且给出原因：

    * ``source_id_missing``   payload 未带来源 id；
    * ``source_file_missing`` 来源记录不存在或路径为空；
    * ``source_docx_absent``  来源 DOCX 文件不在磁盘；
    * ``member_not_found``    源包内找不到该图片；
    * ``sha256_mismatch``     找到同名成员但内容哈希不符（宁可缺失也不张冠李戴）；
    * ``zip_error``           源文件不是合法 zip。
    """
    if source_id is None:
        return None, "source_id_missing"
    row = conn.execute("SELECT path FROM source_files WHERE id = ?", (source_id,)).fetchone()
    if row is None or not row["path"]:
        return None, "source_file_missing"
    src = Path(row["path"])
    if not src.exists():
        return None, "source_docx_absent"

    member = "word/" + (media_path or "").replace("\\", "/")
    try:
        with zipfile.ZipFile(src) as z:
            names = z.namelist()
            candidate = member if member in names else None
            if candidate is None and media_path:
                base = Path(media_path).name
                for n in names:
                    if n.startswith("word/media/") and Path(n).name == base:
                        candidate = n
                        break
            data = None
            if candidate is not None:
                blob = z.read(candidate)
                if sha256 and hashlib.sha256(blob).hexdigest() != sha256:
                    data = None                       # 同名不同内容 → 不采用
                else:
                    data = blob
            if data is None and sha256:
                for n in names:
                    if n.startswith("word/media/"):
                        blob = z.read(n)
                        if hashlib.sha256(blob).hexdigest() == sha256:
                            data, candidate = blob, n
                            break
            if data is None:
                return None, "sha256_mismatch" if candidate else "member_not_found"
    except zipfile.BadZipFile:
        return None, "zip_error"

    cache_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(candidate).suffix or ".png"
    name = (sha256[:16] if sha256 else Path(candidate).stem) + ext
    out = (cache_dir / name).resolve()          # 桥接要求**绝对路径**
    # 缓存文件名只是定位提示；每次核验完整字节，防止同前缀/污染文件串入答案图。
    expected = hashlib.sha256(data).hexdigest()
    if not out.is_file() or hashlib.sha256(out.read_bytes()).hexdigest() != expected:
        out.write_bytes(data)
    if hashlib.sha256(out.read_bytes()).hexdigest() != expected:
        return None, "cache_sha256_mismatch"
    return out, None


# --------------------------------------------------------------------------- #
# 文档计划（纯函数，可单测）
# --------------------------------------------------------------------------- #
def _section_header(name: str, questions: list[dict], spec: dict) -> str:
    """拼大题标题，采用**常见试卷写法**，如
    ``一、选择题（本大题共 6 小题，每小题 3 分，共 18 分）``。

    * 各小题分值一致 → 「本大题共 N 小题，每小题 X 分，共 T 分」；
    * 分值不一致 / 模板不标分 → 「本大题共 N 小题，共 T 分」；
    * 完全没有分值 → 仅大题名。
    """
    scores = [q["score"] for q in questions if q.get("score") is not None]
    if not scores:
        return name
    subtotal = sum(scores)
    count = len(scores)
    if spec["show_score"] and len(set(scores)) == 1:
        return (f"{name}（本大题共 {count} 小题，每小题 {_fmt_num(scores[0])} 分，"
                f"共 {_fmt_num(subtotal)} 分）")
    return f"{name}（本大题共 {count} 小题，共 {_fmt_num(subtotal)} 分）"


def _question_prefix(number: int, score, spec: dict) -> str:
    """题号前缀：``1．`` 或（模板显示分值时）``1．（3 分）``。"""
    if spec["show_score"] and score is not None:
        return f"{number}．（{_fmt_num(score)} 分）"
    return f"{number}．"


def build_document_plan(payload: dict, *, template: str | None = None,
                        media_resolver=None) -> dict:
    """把导出 payload 转成「文档计划」（纯数据，供 :func:`render_plan_to_docx` 消费）。

    参数
    ----
    payload         :func:`bank.paper.build_export_payload` 的产出。
    template        模板名（省略时取 ``payload["paper"]["template"]``）。
    media_resolver  可调用 ``(source_id, media_path, sha256) -> (Path|None, reason|None)``；
                    省略时不解析图片（图片标记为未解析）。

    返回结构::

        {
          "paper": {...}, "template": "考试", "spec": {...},
          "title": "...", "info_line": "...",
          "sections": [
            {"name": "...", "header": "...", "questions": [
               {"number": 1, "seq": 1, "score": 3.0, "prefix": "1．（3 分）",
                "stem_lines": [[seg,...],...],          # 题干（已去答案）
                "answer_lines": [...] | None,           # 【答案】…
                "analysis_lines": [...] | None,         # 【解析】…
                "images": [{"media_path":..., "sha256":..., "path":..., "reason":...}],
                "source": {...}}
            ]}
          ],
          "answer_mode": "学生版",
          "audit": {"payload_formulas": n, "rendered_formulas": n,
                    "payload_images": n, "resolved_images": n, "missing_images": n},
          "warnings": [...]
        }
    """
    from . import export_content as content
    if payload.get('diagnostics') is not None:
        content.require_export_allowed(payload['diagnostics'], payload.get('answer_mode') or '学生版')
    paper = payload.get("paper") or {}
    tpl = template or paper.get("template") or _paper.DEFAULT_TEMPLATE
    if tpl not in TEMPLATE_SPECS:
        raise ExportError(f"未知模板：{tpl!r}（可选 {tuple(TEMPLATE_SPECS)}）")
    spec = TEMPLATE_SPECS[tpl]

    ctx: dict = {"warnings": [], "formulas": 0, "qid": None}
    number = 0
    payload_formulas = 0
    payload_images = 0
    resolved_images = 0
    missing_images = 0
    sections_out: list[dict] = []

    for sec in payload.get("sections") or []:
        qs_out: list[dict] = []
        for q in sec.get("questions") or []:
            number += 1
            ctx["qid"] = f"#{q.get('item_id')}(题号{q.get('number')})"
            fid_latex = {f.get("fid"): f.get("latex") for f in (q.get("formulas") or [])}
            payload_formulas += len(q.get("latex_list") or [])

            # 1) 题干与内联答案分离（学生版绝不泄露答案）。
            stem, inline_ans, inline_ana = _answers.split_inline(q.get("text") or "")

            # 1b) 去掉题干行首的**原始题号**，避免与新连续题号叠成「1．（3 分）7．…」。
            stem = strip_original_number(stem, q.get("number"))

            # 2) 题干行-段。
            stem_lines = text_to_lines(stem, fid_latex, ctx,
                                       prefix=_question_prefix(number, q.get("score"), spec))

            # 3) 答案 / 解析行（是否渲染由 payload 的 show_* 决定）。
            answer_lines = None
            analysis_lines = None
            if q.get("show_answer"):
                ans_text = q.get("answer") if q.get("answer") is not None else inline_ans
                if ans_text:
                    answer_lines = text_to_lines("【答案】" + str(ans_text).strip(),
                                                 fid_latex, ctx)
            if q.get("show_analysis"):
                ana_text = q.get("analysis") if q.get("analysis") is not None else inline_ana
                if ana_text:
                    analysis_lines = text_to_lines("【解析】" + str(ana_text).strip(),
                                                   fid_latex, ctx)

            # 4) 图片：从源 DOCX 包内解析。
            imgs_out: list[dict] = []
            src = q.get("source") or {}
            for im in (q.get("images") or []):
                payload_images += 1
                media_path = im.get("media_path")
                sha = im.get("sha256")
                entry = {**im, "media_path": media_path, "sha256": sha, "path": None, "reason": None}
                if media_resolver is not None:
                    try:
                        path, reason = media_resolver(src.get("source_id"), media_path, sha)
                    except Exception as exc:                       # noqa: BLE001 - 记录而非中断
                        path, reason = None, f"resolver_error:{exc}"
                    if path is not None:
                        entry["path"] = str(path)
                        resolved_images += 1
                    else:
                        entry["reason"] = reason
                        missing_images += 1
                        ctx["warnings"].append(
                            f"图片缺失：{media_path}（题目 {ctx['qid']}，原因 {reason}）")
                else:
                    entry["reason"] = "resolver_absent"
                    missing_images += 1
                imgs_out.append(entry)

            qs_out.append({
                "number": number,
                "seq": q.get("seq"),
                "item_id": q.get("item_id"),
                "question_id": q.get("question_id"),
                "score": q.get("score"),
                "qtype": q.get("qtype"),
                "prefix": _question_prefix(number, q.get("score"), spec),
                "stem_lines": stem_lines,
                "answer_lines": answer_lines,
                "analysis_lines": analysis_lines,
                "images": imgs_out,
                "source": src,
            })
            if 'content_blocks' in q:
                ordered=[]; first_stem=True; seen_branches=set()
                lookup={im.get('instance_id'):im for im in imgs_out}
                for block in q['content_blocks']:
                    branch=block['branch']
                    if block['kind']=='image':
                        im=lookup.get(block['instance_id'])
                        if im and im.get('path'):ordered.append(('image',im,branch))
                    else:
                        text=block['text'];prefix=None
                        if branch=='stem' and first_stem:
                            text=strip_original_number(text,q.get('number'));prefix=_question_prefix(number,q.get('score'),spec);first_stem=False
                        elif branch not in seen_branches and branch in ('answer','analysis'):
                            text=('【答案】' if branch=='answer' else '【解析】')+text
                        # 旧兼容行已计数，此处用独立ctx避免重复计量。
                        local={'warnings':[],'formulas':0,'qid':ctx['qid']}
                        ordered.extend(('para',line,branch) for line in text_to_lines(text,fid_latex,local,prefix=prefix))
                        seen_branches.add(branch)
                qs_out[-1]['render_blocks']=ordered
        sections_out.append({
            "name": sec.get("name"),
            "header": _section_header(sec.get("name") or "", qs_out, spec),
            "subtotal": sec.get("subtotal"),
            "questions": qs_out,
        })

    return {
        "paper": paper,
        "template": tpl,
        "spec": spec,
        "title": paper.get("title") or "试卷",
        "info_line": spec["info_line"],
        "sections": sections_out,
        "answer_mode": payload.get("answer_mode"),
        "audit": {
            "payload_formulas": payload_formulas,
            "rendered_formulas": ctx["formulas"],
            "payload_images": payload_images,
            "resolved_images": resolved_images,
            "missing_images": missing_images,
        },
        "warnings": ctx["warnings"],
    }


# --------------------------------------------------------------------------- #
# 桥接脚本封装
# --------------------------------------------------------------------------- #
def _bridge_python() -> str:
    """选择桥接脚本所需的解释器（优先环境变量，其次内置路径，最后当前解释器）。"""
    for cand in _BRIDGE_PY_CANDIDATES:
        if cand and Path(cand).exists():
            return cand
    return sys.executable


def _bridge_script() -> str:
    return os.environ.get("BANK_BRIDGE_SCRIPT", DEFAULT_BRIDGE_SCRIPT)


# --------------------------------------------------------------------------- #
# editor_sdk MCP 直连（P2 性能优化）
# --------------------------------------------------------------------------- #
# 背景：旧实现每次 ``call()`` 都 ``subprocess.run([python, edsdk.py, "call", ...])``——
# 即**每段文字 / 公式 / 图片都新起一个 Python 解释器进程**（实测 ≈472ms/次），
# 一份卷数百次调用 → 导出 82–165s。
#
# 而 ``edsdk.py`` 本身只是**本地 editor_sdk MCP 服务**（``http://127.0.0.1:<port>/mcp``）
# 的极薄 HTTP 包装。因此这里**直接在本进程内发 JSON-RPC HTTP 请求**，
# 彻底省掉每次的进程启动开销（实测 ≈64ms/次），语义与 edsdk.py 完全一致。
#
# 端点发现规则与 edsdk.py 对齐：``editor_sdk_port`` 环境变量优先，否则从 39099 起
# 依次探测 10 个端口；鉴权用 ``editor_sdk_token``；本地直连**绕过代理**。
_MCP_DEFAULT_PORT = 39099
_MCP_PORT_SCAN = 10
#: 已发现的端点（模块级缓存：同一进程内多次导出复用，只探测一次）。
_MCP_ENDPOINT_CACHE: str | None = None
#: 本地直连，绕开环境里的 http_proxy/HTTP_PROXY/all_proxy（等价 curl --noproxy）。
_MCP_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# --------------------------------------------------------------------------- #
# 瞬时错误重试（问题①修复）
# --------------------------------------------------------------------------- #
# 背景（实测）：editor_sdk 在 ``create_doc`` 之后**偶发**返回
#   ``-32603 ... SetDocDefaults failed: document is not opened``
#   ``-32603 ... DocEditor::GetLastOperablePos: document is not open``
# 同一调用**重试即可成功**（连续 6 次探测中约 2/3 首次失败）。这是**瞬时**抖动，
# 不是确定性错误，故按指数退避自动重试。
#
# ⚠️ 只对「瞬时」错误重试：JSON-RPC 错误码 ``-32603`` 且消息命中「文档未打开」特征。
# 确定性错误（LaTeX 非法、参数非法、未知工具等）**一律不重试**，直接抛出，避免掩盖真问题。
_TRANSIENT_RPC_CODE = -32603
#: 瞬时错误消息特征（文档尚未打开 / 尚未就绪）。
_TRANSIENT_MSG_RE = re.compile(
    r"document\s+is\s+not\s+open(?:ed)?|document\s+not\s+open", re.I)
#: 瞬时错误最大尝试次数（含首次）与指数退避基数（秒）：0.35s → 0.70s。
_RPC_MAX_ATTEMPTS = 3
_RPC_BACKOFF_BASE = 0.35


def _is_transient_rpc_error(code, message) -> bool:
    """判断 JSON-RPC 错误是否为**可重试的瞬时错误**（见本段说明）。"""
    if code != _TRANSIENT_RPC_CODE:
        return False
    return bool(_TRANSIENT_MSG_RE.search(message or ""))


class BridgeUnreachable(RuntimeError):
    """editor_sdk 服务**不可达**（未运行 / 端口探测失败 / 连接中断）。

    与「工具调用本身失败」区分：前者说明桥接环境不可用，后者是具体工具的报错。
    两者最终都会由 :class:`EditorBridge` 转成 :class:`ExportError`。
    """


class TransientBridgeError(ExportError):
    """editor_sdk 的**瞬时**错误（如「文档尚未打开」）：语义上可安全重试。

    仅在 :func:`_mcp_rpc_once` 命中 :func:`_is_transient_rpc_error` 时抛出；
    由 :func:`_mcp_rpc` 捕获并按指数退避重试。重试耗尽后仍抛出（子类仍是
    :class:`ExportError`，调用方无需特殊处理）。
    """


def _mcp_post(endpoint: str, method: str, params: dict, *, timeout: float = 60.0) -> dict:
    """向 MCP 端点发一条 JSON-RPC 请求，返回解析后的响应字典。"""
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params or {}}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = os.environ.get("editor_sdk_token", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
    with _MCP_OPENER.open(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _mcp_endpoint() -> str:
    """发现并缓存 editor_sdk 的 JSON-RPC 端点（与 edsdk.py 同规则）。"""
    global _MCP_ENDPOINT_CACHE
    if _MCP_ENDPOINT_CACHE:
        return _MCP_ENDPOINT_CACHE
    configured = os.environ.get("editor_sdk_port", "").strip()
    if configured:
        ports = [int(configured)]
    else:
        ports = list(range(_MCP_DEFAULT_PORT, _MCP_DEFAULT_PORT + _MCP_PORT_SCAN))
    last_err: Exception | None = None
    for port in ports:
        endpoint = f"http://127.0.0.1:{port}/mcp"
        try:
            obj = _mcp_post(endpoint, "tools/list", {}, timeout=2.0)
        except Exception as exc:  # noqa: BLE001 — 探测阶段逐个端口吞掉异常继续
            last_err = exc
            continue
        result = obj.get("result") if isinstance(obj, dict) else None
        if isinstance(result, dict) and isinstance(result.get("tools"), list):
            _MCP_ENDPOINT_CACHE = endpoint
            return endpoint
    raise BridgeUnreachable(
        f"editor_sdk 服务不可达（已探测端口 {ports[0]}-{ports[-1]}）：{last_err}")


def _mcp_rpc(method: str, params: dict | None = None, *, attempts: int | None = None) -> dict:
    """发一条 JSON-RPC 请求并返回 ``result``；**对瞬时错误自动重试**（问题①修复）。

    实测 editor_sdk 在 ``create_doc`` 之后偶发返回 ``-32603 document is not open(ed)``，
    同一调用重试即可成功，故对 :class:`TransientBridgeError` 按指数退避重试
    ``_RPC_MAX_ATTEMPTS`` 次；其余错误（连接失败 / 参数非法 / LaTeX 非法等）
    **不重试**，立即抛出。
    """
    attempts = attempts or _RPC_MAX_ATTEMPTS
    last_exc: TransientBridgeError | None = None
    for i in range(attempts):
        try:
            return _mcp_rpc_once(method, params)
        except TransientBridgeError as exc:
            last_exc = exc
            if i == attempts - 1:
                break
            time.sleep(_RPC_BACKOFF_BASE * (2 ** i))       # 0.35s → 0.70s
    assert last_exc is not None
    raise last_exc


def _mcp_rpc_once(method: str, params: dict | None = None) -> dict:
    """发一条 JSON-RPC 请求并返回 ``result``；失败按类型抛异常（单次，不重试）。"""
    endpoint = _mcp_endpoint()
    try:
        obj = _mcp_post(endpoint, method, params or {}, timeout=60.0)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise ExportError("editor_sdk 401 未授权：请设置环境变量 editor_sdk_token")
        raise ExportError(f"editor_sdk HTTP {exc.code} {exc.reason}")
    except urllib.error.URLError as exc:
        raise BridgeUnreachable(f"连接失败（editor_sdk 是否在 {endpoint} 运行？）: {exc.reason}")
    except (TimeoutError, ConnectionError) as exc:
        raise BridgeUnreachable(f"连接超时/中断（editor_sdk 是否在 {endpoint} 运行？）: {exc}")
    except json.JSONDecodeError as exc:
        raise ExportError(f"editor_sdk 响应解析失败：{exc}")
    if isinstance(obj, dict) and obj.get("error"):
        err = obj["error"]
        code = err.get("code")
        message = err.get("message") or ""
        if _is_transient_rpc_error(code, message):
            raise TransientBridgeError(
                f"editor_sdk JSON-RPC 瞬时错误 {code}: {message}")
        raise ExportError(f"editor_sdk JSON-RPC 错误 {code}: {message}")
    return obj.get("result") or {}


class ParagraphHandle(NamedTuple):
    """一个已写入段落的句柄。

    * ``position``：段落**文本末尾**的 GCP 坐标（段落分隔符之前），用于内联续写/加边框；
    * ``paragraph_id``：段落 ID（来自 ``doc_insert_paragraph_with_text`` 回包），
      可直接传给 ``doc_modify_paragraph(paragraph_id=...)`` 精确定位（无坐标漂移问题）。
    """

    position: int
    paragraph_id: str | None


class EditorBridge:
    """本地 editor_sdk 的极薄封装（LaTeX → OMML 等），**进程内 HTTP 直连**（P2）。

    为兼容既有调用保留 ``script`` / ``python`` 参数（HTTP 直连后不再需要子进程，
    二者仅作记录，不再校验其存在性）。
    """

    def __init__(self, *, script: str | None = None, python: str | None = None):
        self.script = script or _bridge_script()
        self.python = python or _bridge_python()
        self.fid: str | None = None
        self.errors: list[str] = []
        self.warnings: list[str] = []
        #: 页面**可用文字宽度**（cm），由 :meth:`apply_style` 依页面尺寸与页边距算出；
        #: 用于图片自适应尺寸（问题③）。
        self.avail_width_cm: float | None = None
        #: 实际写入图片的尺寸记录（问题③，供导出报告核对）。
        self.image_sizes: list[dict] = []

    # -- 原始调用 ---------------------------------------------------------- #
    def call(self, tool: str, **args):
        """调用一个桥接工具，返回解析后的 JSON（或原始文本）。

        与旧实现（子进程调 ``edsdk.py call``）**语义一致**：把 MCP ``tools/call``
        返回的文本内容拼接后尝试 ``json.loads``，失败则返回原始文本；任何错误都抛
        :class:`ExportError`（桥接不可达 → 也抛 ``ExportError``，**不误报成功**）。
        """
        try:
            result = _mcp_rpc("tools/call", {"name": tool, "arguments": args})
        except BridgeUnreachable as exc:
            raise ExportError(f"桥接调用失败 {tool}: {exc}")
        texts = [c.get("text", "") for c in (result.get("content") or [])
                 if isinstance(c, dict) and c.get("type") == "text"]
        out = ("\n".join(texts) if texts
               else json.dumps(result, ensure_ascii=False, indent=2)).strip()
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return out

    @staticmethod
    def _file_id(result) -> str:
        m = re.search(r"file_id=([^,\s}]+)", str(result))
        if not m:
            raise ExportError(f"无法从 create_doc 结果解析 file_id：{result!r}")
        return m.group(1)

    # -- 文档生命周期 ------------------------------------------------------ #
    def create_doc(self) -> str:
        """新建空白文档并记住 ``file_id``。"""
        self.fid = self._file_id(self.call("create_doc"))
        return self.fid

    def save(self, path: Path | str) -> None:
        # 桥接的 save_file 要求**绝对路径**（相对路径会报 "Export directory is not writable"）。
        self.call("save_file", file_id=self.fid, file_path=str(Path(path).resolve().as_posix()))

    def close(self) -> None:
        try:
            self.call("close_file", file_id=self.fid)
        except ExportError:
            pass

    # -- 页面 / 样式 ------------------------------------------------------- #
    def apply_style(self, spec: dict) -> None:
        """应用模板规格：默认字体 + 默认行距 + 页边距（一次调用）+ 装订线（按需）。

        本次修复（问题①）：

        * **合并为一次** ``doc_set_document_style``：同时传 ``default_text_style``
          （字体/字号）、``default_paragraph_style``（行距）、``page_style``（页边距）。
          原先独立的 ``doc_modify_section`` 页边距调用**已去掉**——它正是抖动时
          最先失败的那个调用，而 ``page_style`` 覆盖了它除装订线外的全部能力。
        * ``doc_modify_section`` **仅在模板装订线 > 0 时**保留一次（``page_style``
          无 ``gutter`` 字段），因此「考试」模板的装订线仍然生效。
        * ``page_style`` 同时显式设定 **A4** 纸张（桥接默认 Letter）。
        * 所有调用经 ``call`` → :func:`_mcp_rpc` 的**瞬时错误自动重试**，消除抖动。
          重试耗尽后仍失败才记 warning，不中断导出。
        """
        margins = spec.get("margins") or {}
        size = spec.get("page_size") or PAGE_SIZE_A4
        page_style = {"page_width": size["width"], "page_height": size["height"]}
        page_style.update({f"{k}_margin": margins[k]
                           for k in ("top", "bottom", "left", "right")
                           if margins.get(k) is not None})
        # 可用文字宽度（cm）= 页宽 − 左右页边距；供图片自适应尺寸使用（问题③）。
        self.avail_width_cm = max(
            1.0, (size["width"] - (margins.get("left") or 0.0)
                  - (margins.get("right") or 0.0)) / 72.0 * 2.54)
        try:
            self.call("doc_set_document_style", file_id=self.fid,
                      default_text_style={
                          "font_family": spec["body_font"],
                          "font_east_asia": spec["body_font"],
                          "font_size": spec["body_size"],
                      },
                      default_paragraph_style={
                          "line_spacing": spec.get("line_spacing", 1.5),
                          "line_spacing_rule": 1,
                      },
                      page_style=page_style or None)
        except ExportError as exc:
            self.warnings.append(f"设置文档默认样式失败：{exc}")
        gutter = spec.get("gutter") or 0
        if gutter > 0:
            try:
                self.call("doc_modify_section", file_id=self.fid, section_index=0,
                          gutter=gutter)
            except ExportError as exc:
                self.warnings.append(f"设置装订线失败：{exc}")

    # -- 内容写入 ---------------------------------------------------------- #
    def last_pos(self) -> int:
        res = self.call("doc_get_last_operable_pos", file_id=self.fid)
        return int(res["position"])

    def insert_page_break(self) -> int:
        pos = self.last_pos()
        res = self.call("doc_insert_page_break", file_id=self.fid, idx=pos)
        return int(res.get("position", pos))

    def _insert_inline(self, cur: int, kind: str, value: str) -> int:
        """在 ``cur`` 处内联插入一段文本 / 公式 / 图片，返回新的插入位置。"""
        if kind == SEG_TEXT:
            res = self.call("doc_insert_text", file_id=self.fid, idx=cur,
                            text=bridge_safe_text(value))
            return int(res.get("position", cur))
        if kind == SEG_MATH:
            try:
                res = self.call("doc_insert_math", file_id=self.fid, idx=cur, latex=value)
                return int(res.get("position", cur))
            except ExportError as exc:
                # 解析器对个别 LaTeX（如 `4cm^{3}`）会失败：先尝试保守修复再降级。
                fixed = repair_latex(value)
                if fixed and fixed != value:
                    try:
                        res = self.call("doc_insert_math", file_id=self.fid, idx=cur,
                                        latex=fixed)
                        self.warnings.append(f"公式经修复后写入：{value[:40]!r} -> {fixed[:40]!r}")
                        return int(res.get("position", cur))
                    except ExportError:
                        pass
                self.errors.append(f"公式插入失败（{value[:40]}）：{exc}")
                fallback = self.call("doc_insert_text", file_id=self.fid, idx=cur,
                                     text="（公式）")
                return int(fallback.get("position", cur))
        if kind == SEG_IMAGE:
            return self._insert_image(cur, value)
        raise ExportError(f"未知段类型：{kind}")

    def _insert_image(self, cur: int, path: str) -> int:
        """插入一张图片，按 :func:`fit_image_size` **自适应尺寸**（问题③），返回新位置。

        显式传 ``w``/``h``（px@96DPI）避免沿用源图原始尺寸（可能过大/不一致）；
        无法读取像素尺寸时退回桥接默认（原尺寸），并在报告中如实记录。
        """
        resolved = str(Path(path).resolve())
        kwargs: dict = {"file_id": self.fid, "idx": cur, "image_path": resolved}
        px_w, px_h = _image_pixel_size(resolved)
        size = fit_image_size(px_w, px_h, self.avail_width_cm or 0.0)
        extent=getattr(self,'source_image_extent',None)
        if size and extent and extent[0] and extent[1]:
            width=min(size[0],extent[0]/360000,self.avail_width_cm or size[0])
            height=width*extent[1]/extent[0]
            if height>IMAGE_MAX_HEIGHT_CM:width*=IMAGE_MAX_HEIGHT_CM/height;height=IMAGE_MAX_HEIGHT_CM
            size=(width,height)
        if size:
            kwargs["w"] = _cm_to_px(size[0])
            kwargs["h"] = _cm_to_px(size[1])
        try:
            res = self.call("doc_insert_image", **kwargs)
        except ExportError as exc:
            self.errors.append(f"图片插入失败（{path}）：{exc}")
            return cur
        self.image_sizes.append({"path": resolved, "px": [px_w, px_h],
                                 "cm": list(size) if size else None})
        return int(res.get("position", cur))

    def add_paragraph(self, segments: list[tuple[str, str]], *,
                      text_format: dict | None = None,
                      paragraph_property: dict | None = None) -> ParagraphHandle:
        """写入一个段落；``segments[0]`` 可为文本（含空串）或图片/公式，其余内联追加。

        返回该段的 :class:`ParagraphHandle`（含文本末尾坐标与段落 ID）。
        """
        # 首段若为文本，用「段落+文本」一次写入；否则写入空段落再内联补齐。
        if segments and segments[0][0] == SEG_TEXT:
            first_text = segments[0][1]
            rest = list(segments[1:])
        else:
            first_text = ""
            rest = list(segments)
        kwargs: dict = {"file_id": self.fid, "idx": self.last_pos(),
                        "text": bridge_safe_text(first_text)}
        if text_format:
            kwargs["text_format"] = text_format
        if paragraph_property:
            kwargs["paragraph_property"] = paragraph_property
        res = self.call("doc_insert_paragraph_with_text", **kwargs)
        rng = res.get("range") or {}
        if first_text:
            # 非空段落：range.end 即该段文本末尾（段落分隔符之前），可内联续写。
            cur = int(rng.get("end", rng.get("begin", 0)))
        else:
            # 空段落（如「仅图片」段）：range 退化为零长度且指向段落分隔符本身，
            # 在该处插图片会被丢弃；改用文档末尾可写位置（实测可正确嵌入）。
            cur = self.last_pos()
        for kind, value in rest:
            if kind == SEG_TEXT and not value:
                continue
            cur = self._insert_inline(cur, kind, value)
        return ParagraphHandle(cur, res.get("paragraph_id"))

    def set_keep(self, handle: ParagraphHandle, *, keep_with_next: bool,
                 keep_together: bool = True) -> None:
        """设置段落分页控制：``keep_with_next``（与下段同页）/ ``keep_together``（段中不分页）。

        用于让「题目文字 + 配图」不被分页拆散（问题③）。失败只记 warning，不中断导出。
        """
        if not handle.paragraph_id:
            return
        try:
            self.call("doc_modify_paragraph", file_id=self.fid,
                      paragraph_id=handle.paragraph_id,
                      keep_with_next=bool(keep_with_next),
                      keep_together=bool(keep_together))
        except ExportError as exc:
            self.warnings.append(f"设置段落分页控制失败：{exc}")

    def set_paragraph_border(self, idx: int) -> None:
        """给 ``idx`` 所在段落加底部边框（分隔线）。失败只记 warning。"""
        try:
            self.call("doc_insert_border", file_id=self.fid, idx=idx)
        except ExportError as exc:
            self.warnings.append(f"分隔线插入失败：{exc}")


# --------------------------------------------------------------------------- #
# 渲染
# --------------------------------------------------------------------------- #
def render_plan_to_docx(bridge: EditorBridge, plan: dict, out_path: Path | str) -> dict:
    """按文档计划渲染 DOCX，返回实际写入统计。

    版式（问题② / 问题④，对齐「常见试卷」观感）：

    * **行距 1.5 倍**——由 :meth:`EditorBridge.apply_style` 的 ``default_paragraph_style``
      写入文档默认基底（docDefaults），全文生效；
    * **大题标题** 段前 16pt、段后 10pt（与上方内容拉开、与题干留一档空档）；
    * **每题段后 16pt**——只加在该题**最后一个段落**上（题干/选项之间不额外留白）；
    * **图片段落** 前后各 10pt（末段时其后为 16pt）；图片尺寸自适应（见 :func:`fit_image_size`）；
    * 标题、卷头信息行沿用居中 + 段后间距。

    间距常量见 :data:`SPACING_QUESTION_AFTER` 等（问题④ 已按国内试卷观感放大，
    选择题与计算题统一，小问之间不加额外间距）。

    分页控制（问题③）：大题标题设 ``keep_with_next``；每题各段（除末段）设
    ``keep_with_next``、全部设 ``keep_together``，使**题目文字与其配图不被拆到两页**。
    """
    spec = plan["spec"]
    body_fmt = {"font_family": spec["body_font"], "font_size": spec["body_size"]}

    bridge.create_doc()
    bridge.apply_style(spec)

    # 标题（居中、加粗、字号大于正文）。
    bridge.add_paragraph(
        [(SEG_TEXT, plan["title"])],
        text_format={"font_family": spec["title_font"], "font_size": spec["title_size"],
                     "bold": True},
        paragraph_property={"jc": "center", "spacing_after": SPACING_TITLE_AFTER})

    # 卷头信息行（与大题标题之间由大题自带的段前 12pt 拉开）。
    info_handle = None
    if plan.get("info_line"):
        info_handle = bridge.add_paragraph(
            [(SEG_TEXT, plan["info_line"])],
            text_format={"font_family": spec["body_font"], "font_size": spec["body_size"]},
            paragraph_property={"jc": "center", "spacing_after": SPACING_INFO_AFTER})
    if spec.get("title_border") and info_handle is not None:
        bridge.set_paragraph_border(info_handle.position)

    formulas_written = 0
    images_written = 0
    for si, sec in enumerate(plan["sections"]):
        if si > 0 and spec.get("page_break_sections"):
            bridge.insert_page_break()
        header_handle = bridge.add_paragraph(
            [(SEG_TEXT, sec["header"])],
            text_format={"font_family": spec["body_font"], "font_size": spec["section_size"],
                         "bold": True},
            paragraph_property={"spacing_before": SPACING_SECTION_BEFORE,
                                "spacing_after": SPACING_SECTION_AFTER})
        # 大题标题与紧随其后的第一题同页，避免标题孤立在页尾。
        bridge.set_keep(header_handle, keep_with_next=True)
        for q in sec["questions"]:
            # 汇总该题要渲染的全部段落（题干 + 图片 + 答案 + 解析），
            # 「段后间距」只加在最后一段上，避免题干与选项之间被拉开。
            blocks: list[tuple[str, object]] = [("para", ln) for ln in q["stem_lines"]]
            for im in q["images"]:
                if im.get("path"):
                    blocks.append(("image", im))
            blocks += [("para", ln) for ln in (q.get("answer_lines") or [])]
            blocks += [("para", ln) for ln in (q.get("analysis_lines") or [])]
            if 'render_blocks' in q:
                ordered=q['render_blocks']
            else:
                ordered=[(kind,payload,'stem') for kind,payload in blocks]
            handles: list[ParagraphHandle] = []
            short=(not q['images'] and not q.get('answer_lines') and not q.get('analysis_lines') and not any(k==SEG_MATH for line in q['stem_lines'] for k,_ in line) and len(q['stem_lines'])<=4 and sum(len(v) for line in q['stem_lines'] for k,v in line)<=180)
            for idx, (kind, payload, branch) in enumerate(ordered):
                is_last = idx == len(ordered) - 1
                if kind == "para":
                    formulas_written += sum(1 for k, _ in payload if k == SEG_MATH)
                    props = {"spacing_after": SPACING_QUESTION_AFTER} if is_last else None
                    handles.append(bridge.add_paragraph(payload, text_format=body_fmt,
                                                        paragraph_property=props))
                else:
                    image=payload if isinstance(payload,dict) else {'path':payload}
                    bridge.source_image_extent=(image.get('source_width_emu'),image.get('source_height_emu'))
                    props = {"jc": "center", "spacing_before": SPACING_IMAGE_AROUND,
                             "spacing_after": (SPACING_QUESTION_AFTER if is_last
                                               else SPACING_IMAGE_AROUND)}
                    handles.append(bridge.add_paragraph([(SEG_IMAGE, image['path'])],
                                                        paragraph_property=props))
                    images_written += 1
            # 让该题各段（含配图）尽量留在同一页（问题③）。
            for i, handle in enumerate(handles):
                same=i+1<len(ordered) and ordered[i][2]==ordered[i+1][2]
                first_in_branch=i==0 or ordered[i-1][2]!=ordered[i][2]
                # 独立或TAB分隔的段尾选项标签连紧随图片；不建立整题长链。
                #
                # 注意：选项行**常常含行内公式**（如 ``A．⟦F66⟧，⟦F67⟧\tB．``），
                # 故不能用「整段全是 SEG_TEXT」作前置条件——那会让含公式的选项行
                # 判定失效，选项标签与其配图仍被拆到两页。
                option_label=(ordered[i][0]=='para'
                              and i+1<len(ordered) and ordered[i+1][0]=='image'
                              and is_option_label_segments(ordered[i][1]))
                bridge.set_keep(handle, keep_with_next=bool(same and (short or first_in_branch or ordered[i][0]=='image' or option_label)))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bridge.save(out_path)
    bridge.close()
    return {"formulas_written": formulas_written, "images_written": images_written,
            "image_sizes": list(bridge.image_sizes)}


#: 图片的 ``a:graphicData`` 必需命名空间 URI。
_PICTURE_GRAPHICDATA_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture"

#: OMML 文本运行（桥接把公式文字写进 ``<m:t>``）。
_MATH_TEXT_RE = re.compile(r"<m:t>(.*?)</m:t>", re.S)
#: HTML 实体名（如 ``Delta`` / ``pm`` / ``leq``）。
_MATH_ENTITY_RE = re.compile(r"&([a-zA-Z][a-zA-Z0-9]*);")


def _resolve_math_entities(xml: str) -> tuple[str, int]:
    """把 OMML ``<m:t>`` 里的 **HTML 实体名**还原为 Unicode 字符，返回 ``(新 xml, 处数)``。

    背景（实测）：桥接的 LaTeX→OMML 解析器对**一批符号命令**会输出 HTML 实体名而非
    对应 Unicode——如 ``\\Delta``→``&Delta;``、``\\Omega``→``&Omega;``、``\\pm``→``&pm;``、
    ``\\leq``→``&leq;``、``\\approx``→``&approx;`` 等（小写希腊字母与多数关系符正常）。
    这些实体落在 ``<m:t>`` 文本里会被 **Word/WPS 当字面字符串显示**（如 ``&Delta;``），
    对物理卷（``Δp``）不可接受。

    修复方式：只在 ``<m:t>`` 文本上做「XML 反转义 → 实体名查 :data:`html.entities.html5`
    → 还原为字符 → 重新转义」的往返。查表命中才替换，故不会误伤合法文本；命中的字符
    仍是 **OMML 文本**（非图片），公式保持**原生可编辑**。
    """
    count = 0

    def _fix_mt(m: re.Match) -> str:
        nonlocal count
        inner = m.group(1)
        real = (inner.replace("&lt;", "<").replace("&gt;", ">")
                     .replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&"))

        def _rep(em: re.Match) -> str:
            nonlocal count
            ch = html.entities.html5.get(em.group(1) + ";")
            if ch is None:
                return em.group(0)
            count += 1
            return ch

        real2 = _MATH_ENTITY_RE.sub(_rep, real)
        if real2 == real:
            return m.group(0)
        enc = real2.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return "<m:t>" + enc + "</m:t>"

    return _MATH_TEXT_RE.sub(_fix_mt, xml), count


# --------------------------------------------------------------------------- #
# 页脚页码（「第 X 页 共 Y 页」）——postprocess 注入
# --------------------------------------------------------------------------- #
# 桥接的 ``doc_set_page_number`` 只能插单个 PAGE 域、且与 ``doc_insert_footer`` 互斥，
# 无法直接产出「第 X 页 共 Y 页」。故在 postprocess 阶段**直接向 DOCX 包注入**页脚部件
# （PAGE + NUMPAGES 两个域）——确定性、无桥接抖动，且不影响公式（不触碰 OMML）。
_FOOTER_PART = "word/footer1.xml"
_FOOTER_RID = "rIdFooterPageNum"
_FOOTER_CONTENT_TYPE = ("application/vnd.openxmlformats-officedocument."
                        "wordprocessingml.footer+xml")
_REL_TYPE_FOOTER = ("http://schemas.openxmlformats.org/officeDocument/2006/"
                    "relationships/footer")


def _build_footer_xml(font: str = "宋体", size_pt: float = 9.0) -> str:
    """构造「第 X 页 共 Y 页」页脚部件 XML（居中，含 PAGE / NUMPAGES 域）。"""
    sz = int(round(size_pt * 2))                       # w:sz 单位为半磅
    rpr = (f'<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" '
           f'w:eastAsia="{font}"/><w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/></w:rPr>')

    def _field(instr: str) -> str:
        """一个简单域（begin → instrText → separate → 占位文本 → end）。"""
        return (f'<w:r>{rpr}<w:fldChar w:fldCharType="begin"/></w:r>'
                f'<w:r>{rpr}<w:instrText xml:space="preserve"> {instr} </w:instrText></w:r>'
                f'<w:r>{rpr}<w:fldChar w:fldCharType="separate"/></w:r>'
                f'<w:r>{rpr}<w:t>1</w:t></w:r>'
                f'<w:r>{rpr}<w:fldChar w:fldCharType="end"/></w:r>')

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<w:p><w:pPr><w:jc w:val="center"/>{rpr}</w:pPr>'
        f'<w:r>{rpr}<w:t xml:space="preserve">第 </w:t></w:r>'
        + _field("PAGE")
        + f'<w:r>{rpr}<w:t xml:space="preserve"> 页 共 </w:t></w:r>'
        + _field("NUMPAGES")
        + f'<w:r>{rpr}<w:t xml:space="preserve"> 页</w:t></w:r>'
        '</w:p></w:ftr>')


def _inject_page_number_footer(items: dict, *, font: str = "宋体",
                               size_pt: float = 9.0) -> bool:
    """向 DOCX 部件字典注入「第 X 页 共 Y 页」页脚；返回是否注入（幂等）。

    ``items`` 为 ``{部件名: (ZipInfo|None, bytes)}``，按插入顺序写出。注入三处：

    1. ``word/document.xml``：在 ``<w:sectPr>`` 起始处插入 ``<w:footerReference>``
       （OOXML 规定 footerReference 必须排在 pgSz/pgMar **之前**）；兼容自闭合
       ``<w:sectPr/>``；
    2. ``word/_rels/document.xml.rels``：补 footer 关系；
    3. ``[Content_Types].xml``：补 footer 部件 Override；
    4. 新增 ``word/footer1.xml`` 部件。

    已有 ``footerReference`` 时直接跳过（幂等）。
    """
    doc_name = "word/document.xml"
    if doc_name not in items:
        return False
    info, data = items[doc_name]
    xml = data.decode("utf-8")
    if "footerReference" in xml:
        return False
    m = re.search(r"<w:sectPr\b[^>]*?(/?)>", xml)
    if m is None:
        return False
    # 纯文字/公式 DOCX 可能没有图片，因此根节点未声明 r；关系前缀须自带作用域。
    ref = (f'<w:footerReference xmlns:r="http://schemas.openxmlformats.org/'
           f'officeDocument/2006/relationships" w:type="default" r:id="{_FOOTER_RID}"/>')
    if m.group(1) == "/":                                  # 自闭合 <w:sectPr/>
        xml = xml[:m.start()] + f"<w:sectPr>{ref}</w:sectPr>" + xml[m.end():]
    else:
        xml = xml[:m.end()] + ref + xml[m.end():]
    items[doc_name] = (info, xml.encode("utf-8"))

    rels_name = "word/_rels/document.xml.rels"
    if rels_name in items:
        ri, rd = items[rels_name]
        rxml = rd.decode("utf-8")
        if _FOOTER_RID not in rxml and "</Relationships>" in rxml:
            rel = (f'<Relationship Id="{_FOOTER_RID}" Type="{_REL_TYPE_FOOTER}" '
                   f'Target="footer1.xml"/>')
            rxml = rxml.replace("</Relationships>", rel + "</Relationships>")
            items[rels_name] = (ri, rxml.encode("utf-8"))

    ct_name = "[Content_Types].xml"
    if ct_name in items:
        ci, cd = items[ct_name]
        cxml = cd.decode("utf-8")
        if "/word/footer1.xml" not in cxml and "</Types>" in cxml:
            override = (f'<Override PartName="/word/footer1.xml" '
                        f'ContentType="{_FOOTER_CONTENT_TYPE}"/>')
            cxml = cxml.replace("</Types>", override + "</Types>")
            items[ct_name] = (ci, cxml.encode("utf-8"))

    items[_FOOTER_PART] = (None, _build_footer_xml(font, size_pt).encode("utf-8"))
    return True


#: 段落匹配：``<w:p ...>...</w:p>`` 或自闭合 ``<w:p/>``（非贪婪；段落内不存在嵌套的 ``</w:p>``）。
_W_PARA_RE = re.compile(r"<w:p\b[^>]*/>|<w:p\b.*?</w:p>", re.S)


def is_option_label_segments(segments: list[tuple[str, str]]) -> bool:
    """判断一个段落是否为「段尾是选项标签」的段落（用于与紧随配图保持同页）。

    选项行**常常含行内公式**（如 ``A．⟦F66⟧，⟦F67⟧\\tB．``），故不能要求整段
    都是纯文本——那会让含公式的选项行判定失效。此处以「可见文本」判定：公式段
    以占位记号参与拼接，只看段尾是否为 ``A．`` / ``B.`` 形式的选项标签。

    例：``[("text","A．"),("math","F66"),("text","，"),("math","F67"),
    ("text","\\tB．")]`` → ``True``。
    """
    if not segments:
        return False
    visible = "".join(v if k == SEG_TEXT else "\u2b1a" for k, v in segments)
    return _OPTION_LABEL_TAIL_RE.search(visible) is not None


def _set_explicit_tab_stops(xml: str) -> tuple[str, int]:
    """保留真实TAB并在其段落设置版心1/4、1/2、3/4左停靠点。

    送桥接前 TAB 已被替换为 :data:`BRIDGE_TAB_SENTINEL`（桥接拒绝 ``\\t``），
    此处把它还原为真正的 ``<w:tab/>``；同时兼容 XML 中直接存在 ``\\t`` 的情况。
    """
    page=re.search(r'<w:pgSz\b[^>]*w:w="(\d+)"',xml)
    margins=re.search(r'<w:pgMar\b[^>]*/>',xml)
    available=int(page.group(1)) if page else 11906
    if margins:
        for key in ('left','right','gutter'):
            value=re.search(r'w:'+key+r'="(\d+)"',margins.group(0))
            if value:available-=int(value.group(1))
    tabs='<w:tabs>'+''.join(f'<w:tab w:val="left" w:pos="{round(available*n/4)}"/>' for n in (1,2,3))+'</w:tabs>'
    count=0
    def _tab_run(match):
        inner=match.group(2)
        if '\t' not in inner and BRIDGE_TAB_SENTINEL not in inner:
            return match.group(0)
        inner=inner.replace(BRIDGE_TAB_SENTINEL,'\t').replace('\t','</w:t><w:tab/><w:t xml:space="preserve">')
        return match.group(1)+inner+match.group(3)
    def fix(match):
        nonlocal count
        paragraph=match.group(0)
        if '<w:tab' not in paragraph and '\t' not in paragraph and BRIDGE_TAB_SENTINEL not in paragraph:
            return paragraph
        paragraph=re.sub(r'(<w:t\b[^>]*>)(.*?)(</w:t>)',_tab_run,paragraph,flags=re.S)
        paragraph=re.sub(r'<w:tabs\b[^>]*>.*?</w:tabs>|<w:tabs\b[^>]*/>','',paragraph,flags=re.S)
        if '<w:pPr>' in paragraph:paragraph=paragraph.replace('<w:pPr>','<w:pPr>'+tabs,1)
        elif '<w:pPr/>' in paragraph:paragraph=paragraph.replace('<w:pPr/>','<w:pPr>'+tabs+'</w:pPr>',1)
        else:paragraph=re.sub(r'(<w:p\b[^>]*>)',r'\1<w:pPr>'+tabs+'</w:pPr>',paragraph,count=1)
        count+=1;return paragraph
    return _W_PARA_RE.sub(fix,xml),count


def _paragraph_body(para_xml: str) -> str:
    """取出一个 ``<w:p>`` 段落中 ``<w:pPr>`` 之后的**内容**（运行 / 公式 / 书签等）。

    兼容自闭合 ``<w:pPr/>``；无 ``<w:pPr>`` 时取开标签 ``>`` 之后的部分；空段返回空串。
    """
    if para_xml.rstrip().endswith("/>"):
        return ""
    m = re.search(r"<w:pPr\b[^>]*/>|<w:pPr>.*?</w:pPr>", para_xml, re.S)
    start = m.end() if m else para_xml.index(">") + 1
    return para_xml[start:para_xml.rfind("</w:p>")]


def _merge_image_paragraphs(xml: str) -> tuple[str, int]:
    """把「空段 + 紧随的图片段」合并为一段，返回 ``(新 xml, 合并处数)``。

    背景（实测，问题③ 根因）：桥接 ``doc_insert_image`` 会**先建一个空段**承载
    ``paragraph_property``（居中 / 间距 / 分页控制），再**另起一段**放图片。后果有二：

    * 图片段自身没有 ``jc=center`` → **图片左对齐、并不居中**（实测已复现）；
    * 分页控制 ``keepNext`` 落在空段上，图片段与其**断链** → 图片可与题干拆到两页。

    本函数把图片段的运行并入**前置空段**（继承其 ``jc`` / ``spacing`` / ``keepNext``），
    再删除该空段。仅当「前置段**正文确为空**（无运行 / 公式 / 图片 / sectPr）」且
    「后置段含 ``<w:drawing>``（且自身不含 sectPr）」时合并；否则原样保留。

    「正文为空」用 :func:`_paragraph_body` 判定（而非简单查 ``<w:t``），以免把
    **纯公式段**（只有 ``<m:oMath>``、无 ``<w:t>``）误判为空段而并进图片。
    """
    paras = [(m.start(), m.end(), m.group(0)) for m in _W_PARA_RE.finditer(xml)]
    if not paras:
        return xml, 0
    out: list[str] = []
    cursor = 0
    merged = 0
    i = 0
    while i < len(paras):
        s, e, para = paras[i]
        nxt = paras[i + 1] if i + 1 < len(paras) else None
        is_empty = _paragraph_body(para).strip() == ""
        if (is_empty and nxt is not None and "<w:drawing" in nxt[2]
                and "<w:sectPr" not in nxt[2]):
            body = _paragraph_body(nxt[2])
            merged_para = para[:para.rfind("</w:p>")] + body + "</w:p>"
            out.append(xml[cursor:s])
            out.append(merged_para)
            cursor = nxt[1]
            i += 2
            merged += 1
        else:
            out.append(xml[cursor:e])
            cursor = e
            i += 1
    out.append(xml[cursor:])
    return "".join(out), merged


def postprocess_bridge_docx(path: Path | str, dst: Path | str | None = None) -> dict:
    """修补桥接产出的 DOCX（单趟完成四件事），返回修补计数 ``dict``。

    1. **图片 graphicData uri**：桥接 ``doc_insert_image`` 生成的 ``<a:graphicData>``
       **缺少必需 ``uri``**；WPS 容忍，**Microsoft Word 直接报错打不开**。补上
       ``drawingml/2006/picture`` 的 ``uri`` 后 Word 可正常打开（实测 ``OMaths`` /
       ``InlineShapes`` 与 WPS 一致）。
    2. **OMML 符号实体**：见 :func:`_resolve_math_entities`（``&Delta;`` → ``Δ`` 等）。
    3. **图片空段合并**：见 :func:`_merge_image_paragraphs`（让图片段继承居中 / 间距 /
       分页控制，修「图片不居中」与「图片与题干拆页」）。
    4. **页脚页码**：注入「第 X 页 共 Y 页」（见 :func:`_inject_page_number_footer`）。

    ``dst`` 省略时原地修补；**桥接写出的文件会被编辑器池持有句柄**（可改名、不可覆盖），
    因此 :func:`export_paper_docx` 会让桥接写到临时 ``raw`` 路径，再经 ``dst`` 写出最终文件。
    返回 ``{"graphic_data": n, "math_entities": m, "image_merge": k, "footer": bool}``。
    """
    path = Path(path)
    dst = Path(dst) if dst else path
    items: dict[str, tuple[zipfile.ZipInfo | None, bytes]] = {}
    with zipfile.ZipFile(path) as zin:
        for info in zin.infolist():
            items[info.filename] = (info, zin.read(info.filename))
    graphic_fixes = 0
    entity_fixes = 0
    image_merges = 0
    tab_fixes = 0
    doc_name = "word/document.xml"
    if doc_name in items:
        info, data = items[doc_name]
        s = data.decode("utf-8")
        n = s.count("<a:graphicData>")
        if n:
            s = s.replace("<a:graphicData>",
                          f'<a:graphicData uri="{_PICTURE_GRAPHICDATA_URI}">')
            graphic_fixes = n
        s, entity_fixes = _resolve_math_entities(s)
        s, image_merges = _merge_image_paragraphs(s)
        s, tab_fixes = _set_explicit_tab_stops(s)
        items[doc_name] = (info, s.encode("utf-8"))
    footer_added = _inject_page_number_footer(items)
    if not graphic_fixes and not entity_fixes and not image_merges and not footer_added and not tab_fixes:
        if dst != path:                       # 无修补时仍需把 raw 内容落到目标路径
            shutil.copyfile(path, dst)
        return {"graphic_data": 0, "math_entities": 0, "image_merge": 0, "footer": False}
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.docx")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, (info, data) in items.items():
            zout.writestr(info if info is not None else name, data)
    # 目标路径可能被编辑器池持有句柄（可删除/改名，但不可被覆盖），先删除再落盘。
    last_exc = None
    for _ in range(40):
        try:
            if dst.exists():
                dst.unlink()
            os.replace(tmp, dst)
            last_exc = None
            break
        except OSError as exc:                                   # noqa: PERF203
            last_exc = exc
            time.sleep(0.5)
    if last_exc is not None:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise ExportError(f"无法写出修补后的 DOCX（文件被占用）：{dst}（{last_exc}）")
    return {"tab_stops": tab_fixes, "graphic_data": graphic_fixes, "math_entities": entity_fixes,
            "image_merge": image_merges, "footer": footer_added}


def make_docx_word_compatible(path: Path | str, dst: Path | str | None = None) -> int:
    """（兼容入口）只补齐图片 ``a:graphicData`` 的 ``uri``，返回修补处数。

    等价于 :func:`postprocess_bridge_docx` 的 ``graphic_data`` 计数；完整修补请直接用
    :func:`postprocess_bridge_docx`（它还还原 OMML 符号实体）。
    """
    return postprocess_bridge_docx(path, dst)["graphic_data"]


def export_paper_docx(conn, paper_id: int, out_path: Path | str, *,
                      answer_mode: str | None = None, template: str | None = None,
                      bridge: EditorBridge | None = None,
                      media_cache: Path = MEDIA_CACHE_DIR) -> dict:
    """把试卷导出为 DOCX（原生 OMML 公式），返回导出报告。

    只读操作：不改题库、不改阶段1 JSON、不改 payload。
    """
    payload = _paper.build_export_payload(conn, paper_id, answer_mode=answer_mode, template=template)

    def _resolver(source_id, media_path, sha256):
        return resolve_media(conn, source_id, media_path, sha256, cache_dir=media_cache)

    plan = build_document_plan(payload, template=template, media_resolver=_resolver)
    bridge = bridge or EditorBridge()

    out_path = Path(out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # 桥接写出的文件会被编辑器池持有句柄（可改名、不可覆盖），故先写 raw 再修补到最终路径。
    raw = out_path.with_name(out_path.name + ".__raw__.docx")
    written = render_plan_to_docx(bridge, plan, raw)
    # CLI也可能在桥接渲染期间遇到来源/快照变化；发布最终件前重新核对。
    from . import export_content as content
    current = _paper.build_export_payload(conn, paper_id, answer_mode=answer_mode, template=template)
    if current['content_digest'] != payload['content_digest']:
        raise content.ExportEvidenceStale(current['diagnostics'])
    content.require_export_allowed(current['diagnostics'], current['answer_mode'])
    fixes = postprocess_bridge_docx(raw, dst=out_path)
    for _ in range(20):                       # 清理中间文件（句柄释放后即可删除）
        try:
            raw.unlink()
            break
        except OSError:
            time.sleep(0.5)

    return {
        "paper_id": paper_id,
        "title": plan["title"],
        "template": plan["template"],
        "answer_mode": plan["answer_mode"],
        "docx": str(out_path),
        "size_bytes": out_path.stat().st_size if out_path.exists() else 0,
        "question_count": sum(len(s["questions"]) for s in plan["sections"]),
        "section_count": len(plan["sections"]),
        "formulas_written": written["formulas_written"],
        "images_written": written["images_written"],
        "image_sizes": written.get("image_sizes", []),
        "word_compat_fixes": fixes["graphic_data"],
        "math_entity_fixes": fixes["math_entities"],
        "image_paragraph_merges": fixes.get("image_merge", 0),
        "footer_added": fixes.get("footer", False),
        "audit": plan["audit"],
        "warnings": plan["warnings"],
        "bridge_warnings": bridge.warnings,
        "bridge_errors": bridge.errors,
    }


# --------------------------------------------------------------------------- #
# PDF
# --------------------------------------------------------------------------- #
def export_pdf(docx_path: Path | str, pdf_path: Path | str | None = None) -> dict:
    """用 COM 打开 DOCX 并 ``ExportAsFixedFormat`` 生成 PDF（优先 Word，回退 WPS）。"""
    docx_path = Path(docx_path).resolve()
    pdf_path = Path(pdf_path).resolve() if pdf_path else docx_path.with_suffix(".pdf")
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:                                   # pragma: no cover
        return {"ok": False, "error": f"pywin32 不可用：{exc}"}

    pythoncom.CoInitialize()
    last_err = None
    try:
        for key, progid in (("word", "Word.Application"), ("wps", "KWPS.Application")):
            app = None
            doc = None
            try:
                app = win32com.client.DispatchEx(progid)
                try:
                    app.Visible = False
                except Exception:                                # noqa: BLE001
                    pass
                try:
                    app.AutomationSecurity = 3
                except Exception:                                # noqa: BLE001
                    pass
                doc = app.Documents.Open(str(docx_path), ReadOnly=True, AddToRecentFiles=False)
                doc.ExportAsFixedFormat(str(pdf_path), 17)       # 17 = wdExportFormatPDF
                doc.Close(False)
                doc = None
                if key == "word":
                    app.Quit()
                app = None
                return {"ok": True, "pdf": str(pdf_path), "client": key,
                        "size_bytes": pdf_path.stat().st_size if pdf_path.exists() else 0}
            except Exception as exc:                             # noqa: BLE001
                last_err = f"{progid}: {exc}"
            finally:
                if doc is not None:
                    try:
                        doc.Close(False)
                    except Exception:                            # noqa: BLE001
                        pass
                if app is not None and key == "word":
                    try:
                        app.Quit()
                    except Exception:                            # noqa: BLE001
                        pass
    finally:
        pythoncom.CoUninitialize()
    return {"ok": False, "error": str(last_err)}


# --------------------------------------------------------------------------- #
# 双客户端可编辑性验证
# --------------------------------------------------------------------------- #
def _edit_and_verify(app, src: Path, tag: str, workdir: Path) -> dict:
    """在客户端 ``app`` 中：打开 → 统计公式 → 逐个改字符 → 保存 → 重开 → 比对。"""
    import traceback

    row: dict = {"tag": tag, "source": str(src)}
    doc = None
    try:
        doc = app.Documents.Open(str(src), ReadOnly=True, AddToRecentFiles=False)
        row["maths"] = int(doc.OMaths.Count)
        row["inline_shapes"] = int(doc.InlineShapes.Count)
        row["pages"] = int(doc.ComputeStatistics(2))
        row["texts_before"] = [re.sub(r"[\r\x07]", "", doc.OMaths.Item(i).Range.Text)
                               for i in range(1, row["maths"] + 1)]
        if row["maths"] == 0:
            row["status"] = "NOT_APPLICABLE_NO_EQUATION"
            doc.Close(False)
            return row
        workdir.mkdir(parents=True, exist_ok=True)
        edited = workdir / f"{tag}_edited.docx"
        edits = []
        # 从后往前改，避免坐标漂移。
        for i in range(row["maths"], 0, -1):
            eq = doc.OMaths.Item(i)
            rng = eq.Range
            char = None
            for j in range(rng.Characters.Count, 0, -1):
                c = rng.Characters.Item(j)
                if len(c.Text) == 1 and c.Text.isalnum():
                    char = c
                    break
            if char is None:
                edits.append({"index": i, "status": "NO_LEAF"})
                continue
            old = char.Text
            new = "8" if old != "8" else "7"
            char.Text = new
            edits.append({"index": i, "status": "EDITED", "old": old, "new": new,
                          "after": re.sub(r"[\r\x07]", "", doc.OMaths.Item(i).Range.Text)})
        expected = [re.sub(r"[\r\x07]", "", doc.OMaths.Item(i).Range.Text)
                    for i in range(1, row["maths"] + 1)]
        doc.SaveAs2(str(edited), 12)                             # 12 = wdFormatXMLDocument
        doc.Close(False)
        doc = None
        doc = app.Documents.Open(str(edited), ReadOnly=True, AddToRecentFiles=False)
        actual = [re.sub(r"[\r\x07]", "", doc.OMaths.Item(i).Range.Text)
                  for i in range(1, int(doc.OMaths.Count) + 1)]
        doc.Close(False)
        doc = None
        row["edits"] = edits
        row["reopened_maths"] = len(actual)
        row["edit_persistence"] = expected == actual
        row["all_edited"] = bool(edits) and all(e["status"] == "EDITED" for e in edits)
        row["edited_path"] = str(edited)
        row["status"] = ("PASS" if row["edit_persistence"] and row["all_edited"]
                         else "PARTIAL")
    except Exception as exc:                                     # noqa: BLE001
        row.update({"status": "ERROR", "error": str(exc),
                    "traceback": traceback.format_exc()})
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:                                    # noqa: BLE001
                pass
    return row


def verify_cross_client(docx_path: Path | str, *, out: Path | str | None = None,
                        workdir: Path | None = None) -> dict:
    """在 Word 与 WPS 中验证导出的 DOCX：``OMaths.Count`` + 改字符→保存→重开是否保留。"""
    docx_path = Path(docx_path).resolve()
    workdir = Path(workdir).resolve() if workdir else (EXPORT_DIR / "_verify").resolve()
    report: dict = {"file": str(docx_path),
                    "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "clients": {}}

    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:                                   # pragma: no cover
        report["error"] = f"pywin32 不可用：{exc}"
        return report

    pythoncom.CoInitialize()
    try:
        for key, progid in (("word", "Word.Application"), ("wps", "KWPS.Application")):
            app = None
            try:
                app = win32com.client.DispatchEx(progid)
                try:
                    app.Visible = False
                except Exception:                                # noqa: BLE001
                    pass
                try:
                    app.AutomationSecurity = 3
                except Exception:                                # noqa: BLE001
                    pass
                report["clients"][key] = _edit_and_verify(
                    app, docx_path, f"{docx_path.stem}_{key}", workdir)
            except Exception as exc:                             # noqa: BLE001
                report["clients"][key] = {"status": "ERROR", "error": str(exc)}
            finally:
                # 仅退出 Word；WPS 可能是用户会话的单例，不 Quit（见 .workbuddy-ai/wps_validation.py）。
                if app is not None and key == "word":
                    try:
                        app.Quit()
                    except Exception:                            # noqa: BLE001
                        pass
    finally:
        pythoncom.CoUninitialize()

    if out:
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


__all__ = [
    "EXPORT_DIR", "MEDIA_CACHE_DIR", "TEMPLATE_SPECS", "ExportError",
    "TransientBridgeError", "BridgeUnreachable",
    "DEFAULT_LINE_SPACING", "PAGE_SIZE_A4", "SPACING_TITLE_AFTER", "SPACING_INFO_AFTER",
    "SPACING_SECTION_BEFORE", "SPACING_SECTION_AFTER", "SPACING_QUESTION_AFTER",
    "SPACING_IMAGE_AROUND", "IMAGE_WIDTH_RATIO", "IMAGE_MAX_HEIGHT_CM",
    "IMAGE_MIN_WIDTH_CM", "IMAGE_MAX_UPSCALE", "IMAGE_REF_DPI",
    "fit_image_size", "ParagraphHandle",
    "sanitize_latex", "repair_latex", "iter_placeholders", "strip_original_number",
    "text_to_lines", "resolve_media", "build_document_plan", "EditorBridge",
    "render_plan_to_docx", "postprocess_bridge_docx", "make_docx_word_compatible",
    "export_paper_docx", "export_pdf", "verify_cross_client",
]
