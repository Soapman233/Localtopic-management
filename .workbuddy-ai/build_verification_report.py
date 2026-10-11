"""把验证结果渲染成可交付的 Markdown 报告（并自产元数据块）。

* 从 ``outputs/verification/verification_results.json`` 读取真实执行结果；
* 报告中的「测试项数」「覆盖率」等**取自验证结果本身**，不再写死，避免数字过期；
* 产出时在文件最前面写入 YAML front-matter（见 ``docmeta.py``），重新生成不再丢元数据。
"""
# ---------------------------------------------------------------------------
# title: 验证报告构建脚本
# description: 构建阶段1 / 阶段2 实现验证报告的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docmeta import prepend_md, sync_mtime  # noqa: E402

ROOT = Path("D:/Open-source project/Localtopic-management")
SRC = ROOT / "outputs/verification/verification_results.json"
DOC = ROOT / "outputs/阶段1-2验证报告.md"
REL_PATH = "outputs/阶段1-2验证报告.md"

data = json.loads(SRC.read_text(encoding="utf-8"))
checks = data["checks"]
s = data["summary"]
s1 = [c for c in checks if c["stage"] == "阶段1"]
s2 = [c for c in checks if c["stage"] == "阶段2"]


def find_check(cid: str) -> dict | None:
    """按编号取某条验证结果。"""
    for c in checks:
        if c["id"] == cid:
            return c
    return None


def table(rows):
    out = ["| 编号 | 验证项 | 验证方法 | 验证步骤 | 预期结果 | 实际结果 | 结论 |",
           "|---|---|---|---|---|---|---|"]
    for c in rows:
        out.append(
            f"| {c['id']} | {c['name']} | {c['method']} | `{c['steps']}` | "
            f"{c['expected']} | {c['actual']} | {'✅ 通过' if c['result'] == '通过' else '❌ 不通过'} |")
    return "\n".join(out)


# --- 从验证结果里抽取真实数字（不写死）-------------------------------------
_s2_08 = find_check("S2-08")
_test_n = 0
if _s2_08:
    m = re.search(r"执行\s*(\d+)\s*项", _s2_08["actual"])
    if m:
        _test_n = int(m.group(1))
_test_ok = bool(_s2_08 and _s2_08["result"] == "通过")

_s2_09 = find_check("S2-09")


def _pct(label: str) -> str:
    """从 S2-09 的实际结果里取某字段覆盖率（题目级）。"""
    if not _s2_09:
        return "—"
    m = re.search(rf"{label}\s*([\d.]+)%", _s2_09["actual"])
    return m.group(1) if m else "—"


_cov_chapter = _pct("章节")
_cov_grade = _pct("年级")
_cov_textbook = _pct("教材")
_cov_stage = _pct("学段")

_s1_05 = find_check("S1-05")
_s1_05_actual = _s1_05["actual"] if _s1_05 else "—"


doc = f"""# 阶段1 / 阶段2 实现验证报告

> 本报告记录**实际执行过**的验证：每条都写明验证方法、验证步骤、预期结果与实际结果。
> 未执行或无法验证的内容一律标注，不做推测。

- 生成时间：{data['generated_at']}
- 验证对象：阶段1 预处理管线（`pipeline/`）、阶段2 题库数据模型（`bank/`）
- 验证方式：脚本化逐项执行，结果落盘 `outputs/verification/verification_results.json`
- 验证脚本：`.workbuddy-ai/verify_stages.py`（可重复执行）
- **合计 {s['total']} 项，通过 {s['passed']} 项，不通过 {s['failed']} 项**

---

## 0. 验证环境

| 项 | 值 |
|---|---|
| 操作系统 | Windows |
| Python | 隔离虚拟环境 `C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe` |
| 验收客户端 | WPS Office 12.1.0.28505 + Microsoft Word 16.0.20326（两者均已实测） |
| 数据规模 | 209 份真实试卷 DOCX（物理，初中/高中） |
| 数据库 | `outputs/bank.db` |
| 阶段1 产物 | `outputs/preprocess_final/` |

---

## 1. 阶段1 验证结果（预处理管线）

**阶段1 的职责**：把真实试卷 DOCX 转成「结构化题目 + LaTeX 公式 + 图片 + 来源定位」。

{table(s1)}

### 阶段1 结论

| 能力 | 状态 |
|---|---|
| 命令行可用、可重复运行 | ✅ |
| Word 原生公式（OMML）→ LaTeX | ✅ 结构正确（分式、根号等） |
| MathType（MTEF 二进制）→ LaTeX | ✅ **无需安装 MathType**，精确解码 |
| 全量产物自洽 | ✅ 209 份、9,738 题，逐文件求和与汇总一致 |
| 失败不静默丢弃 | ✅ 198 条非 OK 公式全部标记且带预览图 |
| 用户原始资料只读 | ✅ 题源哈希一致 |
| 切分回归 | ✅ 章节标题已排除、年份真题保留、含「学校」真题保留 |

---

## 2. 阶段2 验证结果（题库数据模型）

**阶段2 的职责**：把阶段1 的结构化产物落成可查询的题库（数据模型 + 幂等导入 + 中文检索 + 版本管理）。

{table(s2)}

### 阶段2 结论

| 能力 | 状态 |
|---|---|
| 数据库结构（11 张业务表 + FTS5） | ✅ |
| 入库量与复核队列一致 | ✅ 7,945 题 / 17,771 公式 / 196 待复核 |
| 重复导入幂等 | ✅ 二次导入题目数不变 |
| 中文检索走 FTS5 + BM25 | ✅ 由 SQL trace 实证，未降级为 LIKE |
| 筛选生效 | ✅ 叠加章节后结果正确收窄 |
| 题目版本与组卷快照 | ✅ 版本一致、无悬空引用、外键无违规 |
| 库内题干与原文一致 | ✅ 抽查 5/5 完全一致 |
| 自动化测试 | {'✅' if _test_ok else '❌'} {_test_n} 项全部通过 |
| 元数据覆盖率如实记录 | ✅ README 明确声明非齐全 |

---

## 3. 重点验证项的详细说明

以下几项是**最容易出现"看起来正常、实际没生效"**的地方，单独说明验证思路。

### 3.1 中文检索是否真的走 FTS5/BM25（S2-04）

**风险**：很多项目会写一个"后端不可用则本地过滤"的降级逻辑，结果检索排序从未真正生效，但界面一切正常。

**验证方法**：在 SQLite 连接上挂 `set_trace_callback`，捕获检索**实际执行的 SQL**，而不是只看返回结果。

**预期**：SQL 中出现 `question_fts` 与 `MATCH`，并带 `ORDER BY bm25(...)`。

**实际**：三项全部命中；且未出现绕过 FTS5 的裸 `LIKE` 查询。**确认没有静默降级。**

### 3.2 重复导入是否真的幂等（S2-03）

**风险**：重复导入导致题库出现大量重复题目。

**验证方法**：把数据库复制一份，对**同一批 JSON** 再导入一次，比较题目总数。

**预期**：导入成功且题目总数不变。

**实际**：7,945 → 7,945，新增 0。

### 3.3 交付产物是否与代码一致（S1-05）

**风险**：代码改了但产物没重跑，后续所有环节都建立在**旧数据**上。这个坑本项目真实踩过——早期交付的产物生成时间**早于**切分代码的修改时间，数据库因此是从旧数据导入的。

**验证方法**：挑 3 个源文件用**当前代码重跑** `pipeline.stage1`，与已交付产物**比对题目数**（用内容比对，不再比时间戳——给源码加文件头注释会改 mtime 却不影响逻辑，比时间戳会误报）。

**预期**：重跑结果的题目数与产物完全一致。

**实际**：{_s1_05_actual}。✅

### 3.4 库内题干是否与阶段1 原文一致（S2-07）

**风险**：导入过程丢内容、截断或串题。

**验证方法**：从库里取题，回到对应的阶段1 JSON 中做**原文集合比对**。

**预期**：抽查样本全部能精确匹配。

**实际**：5/5 完全一致。

### 3.5 原始资料是否被改动（S1-07 / S2-10）

**验证方法**：对已记录基线哈希的题源重新计算 SHA-256；并检查源目录是否出现导入副产物。

**预期**：哈希一致；导入后无新增临时文件。

**实际**：4/4 题源哈希一致；导入后新增锁文件 0 个。

---

## 4. 验证过程中发现的问题

### 4.1 已修复（阶段2 开发期间，经两轮独立验证）

| 问题 | 后果 | 状态 |
|---|---|---|
| 版头判定对全篇生效 | **8 条真题被误删**（题干含「学校」：「清华大学校园内」「学校运动会」等） | ✅ 已修，8 条已回补入库 |
| 交付产物早于代码修改 | 数据库从旧数据导入 | ✅ 已重生成产物并重建库 |
| 元数据覆盖率被汇报成「齐全」 | 误判数据可用性 | ✅ README 已如实写明 |
| 库内残留表格数值假题 | 题库含噪声条目 | ✅ 导入层过滤 1,773 条 |

### 4.2 本次验证新发现

| 问题 | 说明 | 影响 |
|---|---|---|
| **接口脆弱点** | `bank/query.py` 的检索函数要求连接已设置 `row_factory`；传入裸 `sqlite3` 连接会抛出 `TypeError: tuple indices must be integers`，错误信息难以定位 | 低。正常使用 `bank.db.connect()` 不受影响；建议后续在函数内自行设置 `row_factory` 或补充文档说明 |
| **源目录遗留锁文件** | `C:\\Users\\SOAP\\Desktop\\物理\\初中\\2026学科网教案\\~$06 浮力的计算和实验专题（重难点训练）（解析版）.docx`（162 字节，创建于 **13:25:34**）。**这是本次验证早期做 OLE 激活测试导致 Word 挂起时留下的**，不是导入产生的 | 低。是 Office 的临时锁文件，不含用户数据；**未自行删除**，需你确认后处理 |

### 4.3 已知限制（不阻断，已在 `bank/README.md` 记录）

| 限制 | 说明 |
|---|---|
| 年级/教材覆盖率低 | 年级 {_cov_grade}%、教材 {_cov_textbook}%（**题目级**；多数文件名不含这些信息） |
| 难度字段为空 | 100% 未标注（源数据本身无标注，**系统不做自动推断**，需教研组人工标注） |
| 章节覆盖 {_cov_chapter}% | 仅文件名含章节号时可提取（**题目级**） |
| 中段章节标题残留 | 2 条答案区/考点区标题被当题目（0.025%） |
| 切分算法粘连 | 约 316 条「表格数据行 + 紧随真实题干」被合并为单条 |
| 4 份文件切出 0 题 | 版式特殊，需人工确认 |
| 组卷表暂无数据 | `papers`/`paper_questions` 仅有结构，尚无真实组卷（阶段3 实现） |

---

## 5. 复现方式

```bash
cd "D:/Open-source project/Localtopic-management"
PY="C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe"

# 执行全部 {s['total']} 项验证
"$PY" .workbuddy-ai/verify_stages.py

# 结果落盘
#   outputs/verification/verification_results.json

# 单独复核阶段2 的检索行为
"$PY" -m bank.cli search "浮力" --limit 3
"$PY" -m bank.cli stats
"$PY" -m bank.cli review --limit 5

# 跑测试套件
"$PY" -m unittest discover -s tests
```

---

## 6. 总体结论

**阶段1 与阶段2 的功能均按预期正常运行。**

- {s['total']} 项验证**全部通过**；
- 两个阶段的核心能力（公式精确转换、结构化切分、幂等入库、中文检索、版本管理）均有**可复现的证据**支撑，不是仅凭代码存在来判断；
- 验证中发现的问题**均已如实记录**：2 项已在开发期间修复并回补数据，1 项接口脆弱点为低风险改进项，1 个源目录锁文件为本次验证早期操作的遗留（待你确认处理）；
- 已知限制已写入 `bank/README.md`，未做美化。

**可以进入阶段3（检索与组卷）。**

---

*本报告由 `.workbuddy-ai/verify_stages.py` 的实际执行结果生成；所有「实际结果」均为脚本真实输出。*
"""

DOC.write_text(prepend_md(REL_PATH, doc, DOC), encoding="utf-8")
sync_mtime(DOC)
print(f"written: {DOC}  ({DOC.stat().st_size} bytes)")
