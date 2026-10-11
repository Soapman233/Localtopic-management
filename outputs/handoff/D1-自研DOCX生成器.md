# 交接：Phase 1.3 / 开发（D1）— 自研 DOCX 生成器

> 日期：2026-10-11
> 角色：**D1 导出内核开发**
> 上游：`outputs/handoff/D1-LaTeX转OMML转换器.md`（Phase 1.2）
> 下游：Phase 1.4 版式坑清算 → 1.5 双端验证 → 1.6 新旧对照

---

## 我做了什么

1. 新增 `bank/docx_writer.py`：把「文档计划」（`build_document_plan` 的产出）直接渲染为 `.docx`，**不依赖 `editor_sdk` / Office**。
2. **复用既有 plan 契约**——`build_document_plan` 本就与桥接无关，因此**只替换渲染那一步**，无需改动上游。
3. 新增 `tests/test_docx_writer.py`：**13 个单元测试**，含 3 个**历史缺陷回归测试**。
4. 新增 `spike/docx_writer_smoke/`：合成样例冒烟 + **真实试卷端到端**（Word/WPS 双端）。
5. 实现期**发现并修复 1 个真实缺陷**（题号双重渲染），另**避开了 2 个历史坑**。

---

## 产出物

| 文件 | 说明 |
|---|---|
| `bank/docx_writer.py` | 生成器本体（**纯标准库**：`zipfile` + 字符串拼 XML） |
| `tests/test_docx_writer.py` | 13 个单元测试 |
| `spike/docx_writer_smoke/smoke.py` | 合成样例（公式/图片/制表位）+ 结构自检 + 双端 |
| `spike/docx_writer_smoke/verify_real_paper.py` | **真实试卷端到端**（只读交付库） |
| `spike/docx_writer_smoke/fixed_p1.png` / `fixed_p3.png` | 渲染目视证据 |

---

## 验收标准（给下一角色，**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 1) 单元测试（期望 13 tests, OK）
$PY -m unittest tests.test_docx_writer -v
# 2) 合成样例 + 双端（期望 全部 PASS）
$PY spike/docx_writer_smoke/smoke.py
# 3) 真实试卷端到端（期望 WORD: PASS / WPS: PASS）
$PY spike/docx_writer_smoke/verify_real_paper.py
# 4) 渲染目视
#    打开 spike/docx_writer_smoke/fixed_p1.png，确认无双重题号、公式为数学排版
```

---

## 实测证据

### 合成样例
```
parts: [..., 'word/media/image1.png']
[S1] 必需 part 齐全: PASS
[S2] 原生 OMML=4 无 OLE 嵌入: PASS
[S3] 图片 ['word/media/image1.png'] / graphicData 带 uri: PASS
[S4] 制表符为真 <w:tab/> 且无哨兵残留: PASS
[S5] 图片关系已声明: PASS
[word] OMaths=4(期望 4) | InlineShapes=1 | S6 PASS | S7 改字符重开 PASS
[wps]  OMaths=4(期望 4) | InlineShapes=1 | S6 PASS | S7 改字符重开 PASS
=== 结论：PASS ===
```

### 真实试卷（**最强证据**）
```
取用试卷 #1：八年级物理·浮力与压强单元测验
计划：2 个大题 / 10 道题 / 公式 65 / 图片 8
生成：real_paper_1.docx  (702,486 字节)
统计：段 78 / 公式 65 / 图片 8
  [word] 打开成功 | 页数=9 | OMaths=65 | InlineShapes=8 | 公式全为原生 PASS | 改字符重开 PASS
  [wps]  打开成功 | 页数=9 | OMaths=65 | InlineShapes=8 | 公式全为原生 PASS | 改字符重开 PASS
=== 结论：PASS ===
```

**渲染确认**（`fixed_p1.png` / `fixed_p3.png`）：标题带下框线、卷头信息行、大题标题、选项 TAB 对齐、图片居中比例正确、`【答案】/【解析】`、页脚「第 X 页 共 Y 页」；复杂公式如
`ρ_甲 = m_甲/V_甲 = 8g/1cm³ = 8g/cm³`、`p = F/S = G/S = mg/S = ρVg/S = ρLg` 全部为**正确的数学排版**（真分数线、上下标）。

### 全量后端回归
```
Ran 416 tests in 157.698s
FAILED (errors=2, skipped=1)
```
⚠️ **2 个 error 为既有问题**（`test_edition.TestAuthMiddleware`，与本次改动无关；Phase 1.2 已反证）。

---

## 实现期发现并修复的缺陷

### 缺陷 · 题号双重渲染（🔴 历史坑，本次再现）
- **现象**：导出件出现 `1．（3 分）1．（3 分）如图所示…`。
- **根因**：`build_document_plan` **已经把题号写进 `stem_lines` 首段**（通过 `text_to_lines(..., prefix=...)`），我在渲染层又加了一遍。
- **修复**：渲染层**不再添加题号**（`_render_question` 与 `_render_blocks` 均移除 prefix 参数）。
- **发现方式**：**渲染出来看**——单元测试测不出，因为「有题号」本身是符合预期的。
- **已加回归测试**：`TestQuestionNumbering`（覆盖两条渲染路径）。

---

## 主动避开的历史坑（**这些是设计时就防住的**）

| 坑 | 本实现如何避开 |
|---|---|
| **`<a:graphicData>` 缺 `uri`** → WPS 容忍但 **Word 报错打不开** | 显式写入 `uri="{...}/picture"`，并有 `TestImageGraphicDataUri` 回归测试守护 |
| **TAB 控制字符** → 桥接拒绝、曾致整卷导出中断 | **直接写 `<w:tab/>`**；因不走桥接，**哨兵绕行方案整体不再需要**（测试断言无 `U+E000` 残留） |
| **公式图片冒充** | 公式一律经 `latex2omml` 写原生 OMML；测试断言无 `word/media/`（无图时）与无 `embeddings` |

---

## 我没做 / 做不到的

1. **未替换生产链路**。`bank/export.py::render_plan_to_docx` 仍走 `editor_sdk`；新生成器目前由 CLI/探针调用。**接入属 Phase 1.4/1.6。**
2. **未做新旧导出件逐题对照**（Phase 1.6）。
3. **页眉/装订线视觉未逐项核对**（`gutter` 已写入 `pgMar`，但未目视确认装订线效果）。
4. **图片行内位置未还原**——现状仍是「统一居中附于题干后」（与桥接版一致），属 Phase 1.4 范围。
5. **未验证 MathType 路径**（`spawn` 多进程 + `freeze_support()`，Phase 3 打包前必须补）。

---

## 遗留风险

| 风险 | 说明 | 建议 |
|---|---|---|
| **`<w:tab/>` 无显式制表位** | 旧实现会 `_set_explicit_tab_stops()` 补停靠点；本实现依赖 Word 默认制表位 | 目视已确认选项对齐正常；若排版异常再补 `w:tabs` |
| **页码域未更新** | `PAGE`/`NUMPAGES` 是域，首次打开可能显示为未更新值 | Word 打开时自动更新；如需强制可在打开后调用 `Fields.Update()` |
| **图片 DPI 假设** | `_fit_image_cm` 按 96 DPI 估算自然尺寸；源图内嵌 DPI 不一致时可能与桥接版略有差异 | Phase 1.6 对照时核对 |
| **未测大批量性能** | 真实卷（10 题/65 公式）渲染正常，但**百题级耗时未测** | Phase 1.6 补 |

---

## 给下游（Phase 1.4）的输入摘要

`bank.docx_writer.write_plan(plan, path) -> stats` 已能把**真实试卷计划**渲染为双端可编辑的 DOCX（实测 10 题/65 公式/8 图，9 页，Word+WPS 全 PASS）。plan 契约未变，**下游只需处理版式细节**（图片行内位置、页眉、显式制表位），公式与题号两块已封口。
