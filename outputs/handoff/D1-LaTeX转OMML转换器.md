# 交接：Phase 1.2 / 开发（D1）— LaTeX → OMML 转换器

> 日期：2026-10-11
> 角色：**D1 导出内核开发**
> 上游：`outputs/handoff/R-公式符号频次.md`（Phase 1.1，决定覆盖范围）
> 下游：Phase 1.3 DOCX 生成器 → 1.4 版式坑 → 1.5 双端验证

---

## 我做了什么

1. 新增 `bank/latex2omml.py`（约 380 行）：LaTeX → OMML 的**纯函数转换器**，与既有的 `pipeline/omml.py`（OMML→LaTeX）互为逆运算。
2. 覆盖范围由 Phase 1.1 的真实语料统计决定：**Top-15 命令 + 结构 + 特殊字符**（不拍脑袋）。
3. 新增 `tests/test_latex2omml.py`：**18 个单元测试**，含 2 个**回归测试**（见下）。
4. 新增端到端探针 `spike/latex2omml_smoke/`：真实语料 → 转换 → 生成 DOCX → **Word/WPS 双端验证 + 渲染目视**。
5. 实现过程中**发现并修复 3 个真实缺陷**（全部有回归测试或实证）。

---

## 产出物

| 文件 | 说明 |
|---|---|
| `bank/latex2omml.py` | 转换器本体（仅标准库 `re` + `xml.sax.saxutils`） |
| `tests/test_latex2omml.py` | 18 个单元测试 |
| `spike/latex2omml_smoke/smoke.py` | 17 个冒烟用例（真实语料样本） |
| `spike/latex2omml_smoke/verify_real_docx.py` | 真实语料端到端 + Word/WPS 双端验证 |
| `spike/latex2omml_smoke/render_v3.png` | 渲染目视证据 |

---

## 验收标准（给下一角色，**可执行**）

### 1. 单元测试
```bash
C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe -m unittest tests.test_latex2omml -v
```
**期望：18 tests, OK**

### 2. 真实语料端到端 + 双端可编辑
```bash
C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe \
    spike/latex2omml_smoke/verify_real_docx.py --n 60 --engine both
```
**期望：`WORD: PASS` 与 `WPS: PASS`**，且 `OMaths=60`、`InlineShapes=0`。

### 3. 渲染目视（项目铁律：改排版必须渲染出来看）
打开 `spike/latex2omml_smoke/render_v3.png`，确认分式有分数线、上下标位置正确、中文正常。

---

## 实测证据

### 单元测试
```
Ran 18 tests in 0.042s
OK
```
含真实语料抽样 300 条：**XML 全部合法、反斜杠残留率 < 2%**。

### 端到端（60 条真实公式，含最复杂 30 条 + 均匀抽样 30 条）
```
[word] 打开成功 | OMaths=60 (期望 60) | InlineShapes=0
[word] H5 原生公式: PASS
[word] H6 改字符 '𝐹'->'Z' 重开: PASS (OMaths=60)
[wps]  打开成功 | OMaths=60 (期望 60) | InlineShapes=0
[wps]  H5 原生公式: PASS
[wps]  H6 改字符 '𝐹'->'Z' 重开: PASS (OMaths=60)
=== 结论 ===
  WORD: PASS
  WPS: PASS
```

### 全量后端测试（回归检查）
```
Ran 405 tests in 268.301s
FAILED (errors=2, skipped=1)
```
⚠️ **2 个 error 为既有问题，与本次改动无关**——已反证：把 `tests/test_latex2omml.py` 临时移开后，387 个测试**同样**出现这 2 个 error（均在 `test_edition.TestAuthMiddleware`，属环境相关）。

---

## 实现期发现并修复的 3 个真实缺陷（**重要，均已成回归测试**）

### 缺陷 1 · MathType 填充空格泄漏
- **现象**：`{ \rm{ k } }{ \rm{ g } }` 渲染成 `k g` 而非 `kg`。
- **根因**：MathType 风格把每个字符单独包裹并加填充空格（这是**记号分隔符**，不是真实空格），我最初原样保留。
- **修复**：`\rm`/`\mathrm`/`\text` 内容剥除首尾空白（保留内部，以免破坏 `\text{a b}`）。
- **发现方式**：**渲染出来看**（单元测试测不出视觉缺陷）。

### 缺陷 2 · `^` 错误绑定到空格
- **现象**：`{ \rm{ 1 } }{ \rm{ 0 } } ^ { 3 }` 产出 `sSup(e=空格, sup=空格)` + 游离的 `3`，`10³` 丢失。
- **根因**：MathType 风格在 `}` 与 `^` 之间插入空格（`} ^ {`），解析器把空格当成原子，`^` 便绑定到了空格。
- **修复**：**LaTeX 数学模式中空白不显著**——`parse_row`/`parse_atom`/`parse_script_arg` 统一跳过纯空白 token。
- **发现方式**：dump 实际 OMML 对比。

### 缺陷 3 · 单字符脚标贪婪吞掉后续 `^`
- **现象**：`x_i^2` 产出 `sSub(x, sSup(i,2))` 而非 `sSubSup(x,i,2)`。
- **根因**：`parse_script_arg` 的无花括号分支用了 `parse_atom()`，它会贪婪吞掉紧随的 `^`。
- **修复**：改用 `parse_base()`（只取一个基）。
- **发现方式**：**单元测试**。

> **共同教训**：三个缺陷都不是"逻辑写错"，而是**对真实输入形态的假设错了**。语料是脏的（MathType 风格、损坏字符、非常规写法），**必须用真实数据测，不能只用自己构造的干净样例**。

---

## 设计要点（供下游复用）

| 点 | 说明 |
|---|---|
| **永不抛异常** | 顶层 `try/except` 兜底，降级为「把原 LaTeX 当文本输出」。历史教训：一个异常节点曾导致**整卷导出中断**。 |
| **纯函数、无第三方依赖** | 只用 `re` + `xml.sax.saxutils`。**为轻量打包服务**（不引入 lxml 等）。 |
| **正体样式** | `m:rPr/m:sty val="p"`。用于 `\rm`/`\mathrm`/`\text`（含中文）。 |
| **`\rm` 内容按语法解析** | 真实语料有 `{ \rm{ {}^\text{3} } }`（`\rm` 内嵌上标），**不能当纯文本读**；解析后再统一 `_uprightify`。 |
| **无需实现数学环境** | 语料中 `&` 仅 3 次、`\\` 为 0、`\begin/\end` 各 1 次 → **align/array/cases 全部不需要**。 |

---

## 我没做 / 做不到的

1. **未接入生产导出链路**。`bank/export.py` 仍走 `editor_sdk`；本模块目前只被探针调用。接入属 Phase 1.3/1.4。
2. **未处理图片与版式**（`<a:graphicData>` 缺 `uri`、TAB 控制字符、制表位、题号双重渲染）——这些是 Phase 1.4 的范围。
3. **未覆盖长尾命令**：`\underset \xrightarrow \begin/\end \propto \equiv \parallel` 等（各 ≤2 次）降级为文本。
4. **未处理 PUA 字符**：`U+EF01`(132 次)、`U+EF0A`(5 次) 无法可靠映射，按原样输出（会显示为豆腐块）。
5. **未验证 MathType 路径的整体流程**（那是 Phase 2.1 指出的 `spawn` 多进程风险）。

---

## 遗留风险

| 风险 | 说明 | 建议 |
|---|---|---|
| **XML 转义边界** | 文本经 `xml.sax.saxutils.escape` 处理；但若源 LaTeX 含 `]]>` 等极端序列，未单独测试 | 补边界用例 |
| **空基上下标** | `{}^3` 会产生 `<m:e/>` 空基。渲染正常（见 `[10819]`），但**未在 Word 里单独确认**空基公式的可编辑性 | Phase 1.5 补 |
| **性能未测** | 单条转换耗时未实测；60 条生成 DOCX 很快，但**万级公式的批量耗时未知** | Phase 1.6 补 |
| **长尾降级为文本** | 约 1% 的式子会因未识别命令降级，**内容是保住的，但结构丢失** | 可接受；如需覆盖再补 |

---

## 给下游（Phase 1.3）的输入摘要

`bank/latex2omml.latex_to_omath(latex) -> str` 返回可直接嵌入 `w:p` 的 `<m:oMath>` 元素，**已验证在 Word/WPS 双端被识别为原生公式且可编辑**。下一步 DOCX 生成器只需负责段落、图片、制表位与页面设置；**公式这一块可以直接调用本模块**。
