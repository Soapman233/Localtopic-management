# 导出 P0 收尾 + 前端缺陷修复与重构 · 交付报告

**日期**：2026-10-11
**场景**：全流程交付（Codex 中断项补齐 → HCI 行动清单落实 → 前端重构 → 独立验收）
**参与成员**：主理人（后端/导出收尾 + 汇编）· 前端开发 · 独立验收员
**验收环境**：本机 WPS 12.1.0.28505 与 Microsoft Word 16.0.20326；Python `envs/kb` venv；Node 22

---

## 📌 TL;DR

- **整体结论**：🟢 **通过**（个人本地口径）
- **阻塞项数量**：**0**（上一轮 4 条阻塞项全部消除或闭环）
- **核心成果**：交付样例卷 #1 从「**预览与导出双双失败**」变为「**三模式导出成功 + Word/WPS 逐页渲染一致 + 公式双端可编辑**」；前端 4 项 P0 缺陷修复、6 项易用性改进、3 项重构完成。
- **关键数字**：后端 **360 项**测试（359 通过 / 1 skip）、前端 **26 项**全绿；交付库 sha256 `6905955734953c6c…` **全程未变**。
- **下一步**：浏览器实机视觉验收（响应式/键盘/防抖手感）需人工在 1366×768 上走一遍。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| **Go / No-Go** | 🟢 **Go**（个人本地知识库组卷系统口径） |
| **严重度分布** | 🔴 0 / 🟠 0 / 🟡 4 / 🟢 2 |
| **关键行动项** | 6 条（无 P0） |
| **建议负责人** | 教研组（人工视觉验收）→ 前端（code-split 可选） |
| **独立验收** | G3 独立验证 **11 项断言全部通过**，含自建反证 |

---

## 1. 各成员核心结论

### 🧭 主理人（后端 / 导出收尾）
- **核心判断**：Codex 中断时留下的**最关键缺陷不是「选项标签分拆」而是「控制字符致整卷导出失败」**——交付自带样例卷 #1 根本导不出来。探针查明根因：桥接 `doc_insert_text` **在任意位置拒绝 TAB**（`code=9`），而 `doc_insert_paragraph_with_text` **接受** TAB，所以此前只覆盖了部分路径、问题被掩盖。
- **关键动作**：新增 `bridge_safe_text()`（TAB→哨兵、剔除其余控制字符）+ 在 OOXML 层把哨兵还原为**真正的 `<w:tab/>`** 并补制表位停靠点；修复选项标签判定（原要求「整段纯文本」，含行内公式即失效）。

### 💻 前端开发
- **核心判断**：前端缺陷集中在「**防错**」与「**诚实性**」两类——删卷/删大题单击即 force 执行；设置项保存成功但无消费方（假开关）；来源文件跨文件串值；两处导出门禁判定不一致会把 DOCX 导出**永久锁死**。
- **关键动作**：全部修复；并把导出门禁抽成**唯一实现**（`useExportGate` + `exportGateShared`），`ExportDrawer` 663→338 行，两入口行为不一致自然消解。

### ✅ 独立验收员（G3）
- **核心判断**：**有条件通过**——A 组（导出）5 项、B 组（前端）6 项断言全部通过；核心反证用「直连桥接 SDK + 真实渲染」双重坐实。
- **关键动作**：**自己构造**极端控制字符（段中 TAB + `\x0b` + `\x00` + 占位符后 TAB）走真实渲染，确认不再报错且零残留；**绕过** `bridge_safe_text` 直连 SDK，**复现** `code=9/11/0` 拒绝，坐实根因。
- **发现**：构建漂移（`SettingsPage.tsx` 在实现者构建后被改动）——已由主理人以当前源码重建消除。

---

## 2. 综合审查发现（按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题 | 处置 |
|---|--------|------|------|------|------|
| 1 | 🔴→✅ | 导出健壮性 | `bank/export.py` `_insert_inline` / `add_paragraph` | 控制字符致**整卷导出失败**（样例卷 #1 命中 2 题；全库 89 题必失败、1,393 题含 TAB） | **已修复**：`bridge_safe_text` + 哨兵还原为 `<w:tab/>` |
| 2 | 🟠→✅ | 排版 | `render_plan_to_docx` | 选项标签判定要求「整段纯文本」→ 含行内公式的选项行失效 → 标签与配图拆页 | **已修复**：`is_option_label_segments` 改用「可见文本」判定 |
| 3 | 🔴→✅ | 数据安全/防错 | `PaperBuilderPage.tsx` / `PaperPanel.tsx` | 删卷、删大题单击即 `force` 执行，无确认无撤销 | **已修复**：`ConfirmDialog` 显示影响题数 + 撤销（如实标注为「重建副本」） |
| 4 | 🔴→✅ | 交互诚实性 | `SettingsPage.tsx` / `KatexFormula.tsx` | KaTeX 开关与 `default_template` 保存后无消费方（假成功） | **已修复**：新增 `settingsStore`，两处真实消费 |
| 5 | 🔴→✅ | 数据正确性 | `SourcesPage.tsx` | 未按 `sourceId` 重挂载 → 打开第 2 个来源文件时表单仍是上一个的值 | **已修复**：`key={activeId}` + 回填移入 `useEffect` |
| 6 | 🟠→✅ | 可用性阻断 | `ExportPage.tsx` vs `ExportDrawer.tsx` | 导出页漏判 `editor_sdk` → 缺该服务时 DOCX 导出**永久锁死** | **已修复**：`detectEnvFailure` 收敛为唯一实现 |
| 7 | 🟠→✅ | 响应式 | `PaperBuilderPage.tsx` / `App.tsx` | 无任何 `@media`；1366×768 结果区仅 ≈166px | **已修复**：<1440px 右栏转 Drawer、筛选折叠、<900px 汉堡抽屉 |
| 8 | 🟠→✅ | 可访问性 | `livePreview.css` / `PaperBuilderPage.tsx` | 改分/删除 hover-only、拖拽仅 `PointerSensor` → 键盘不可达 | **已修复**：`:focus-within` + `KeyboardSensor` |
| 9 | 🟠→✅ | 性能/交互 | `PaperBuilderPage.tsx` / `SearchPage.tsx` | 组卷页搜索无防抖；加题无 pending；8 题需 8 次点击 | **已修复**：300ms 防抖 + `adding` 禁用 + 批量「加入所选（N）」 |
| 10 | 🟠→✅ | 文档可信度 | `AGENTS.md` / `使用说明.md` | 测试数、库哈希、端点数全面失真 | **已修复**：按实测校正（360 / `690595…` / 43 路径·49 操作 / 前端 26） |
| 11 | 🟡→✅ | 构建产物 | `webui/static/assets` | 17 个旧 hash 入口包堆积（`emptyOutDir:false` 的代价） | **已修复**：新增 `prune-stale-assets.mjs` 接入 build，82→61 文件 |
| 12 | 🟡→✅ | 工具脆弱点 | `.workbuddy-ai/embed_metadata.py` | `insert_html` 按大写 `<!DOCTYPE html>` 查找，Vite 产物是小写 → 重嵌元数据报错 | **已修复**：改大小写不敏感 + 跳过 `webui/static/` 构建产物 |
| 13 | 🟡 | 前端架构 | `ExportDrawer` / `ExportPage` | 门禁逻辑重复约 400 行（已致行为不一致） | **已重构**：抽共享 hook；`api/types.ts` 755→11 行 barrel；`PaperPanel` 600→449 |
| 14 | 🟡 | 性能 | `vite.config.ts` | 单 JS chunk 1,058 kB 无代码分割 | **未处理**（既有现象，范围外；建议后续路由级懒加载） |
| 15 | 🟡 | 交互 | `PaperBuilderPage.tsx` | 窄屏（<1440px）右栏入抽屉后，库→卷**拖拽**不实用 | **未处理**（「加入」按钮路径仍在，非硬回归） |
| 16 | 🟢 | 一致性 | `validateLatex()` | 仍硬编码 katex 选项（属校验语义，可接受） | 记录，不改 |
| 17 | 🟢 | 已知局限 | 选项标签判定 | 沿用 `[A-D]` 英文字母，不含中文「甲/乙/丙/丁」 | 记录（与修改前一致，未扩大范围） |

---

## 3. 交付清单

### 3.1 代码变更

**后端（`bank/`）**
| 文件 | 变更 |
|---|---|
| `bank/export.py` | 新增 `bridge_safe_text()`、`BRIDGE_TAB_SENTINEL`、`_BRIDGE_DROP_CTRL_RE`、`is_option_label_segments()`、`_OPTION_LABEL_TAIL_RE`；`_insert_inline`/`add_paragraph` 接入安全化；`_set_explicit_tab_stops` 支持哨兵还原；修正 `text_to_lines` 失实 docstring；版本 0.4.0→**0.5.0** |

**后端（测试）**
| 文件 | 变更 |
|---|---|
| `tests/test_export.py` | 新增 3 个测试类共 **14 项**：`TestBridgeSafeText`(6)、`TestExplicitTabStops`(2)、`TestOptionLabelSegments`(6) |

**前端（`frontend/`）**
- 新增 11：`hooks/useExportGate.ts`、`hooks/exportGateShared.ts`、`components/ExportResultPanel.tsx`、`components/PaperPanelItemRow.tsx`、`api/types/{core,paper,governance}.ts`、`api/searchParams.ts`、`api/paperRestore.ts`、`store/settingsStore.ts`、`tests/frontend-fixes.test.cjs`、`scripts/prune-stale-assets.mjs`
- 修改 16：`PaperBuilderPage.tsx`、`ExportPage.tsx`、`SearchPage.tsx`、`SourcesPage.tsx`、`SettingsPage.tsx`、`ExportDrawer.tsx`、`PaperPanel.tsx`、`QuestionCard.tsx`、`KatexFormula.tsx`、`LivePreviewPanel.tsx`、`livePreview/ExportDiagnostics.tsx`、`livePreview/livePreview.css`、`App.tsx`、`main.tsx`、`api/types.ts`、`package.json`

**工具与文档**
- `.workbuddy-ai/embed_metadata.py`（doctype 大小写 + 跳过构建产物）、`.workbuddy-ai/build_asset_manifest.py`（+16 条资产、export.py 关键词）
- `AGENTS.md`（基线数字校正 + 新增 §12）、`outputs/webui/使用说明.md`、`outputs/handoff/D-导出P0最终交接.md`、`outputs/handoff/D-前端修复与重构.md`、`outputs/handoff/T-本轮独立验收.md`、`outputs/export-upgrade-20261010/README.md`

### 3.2 测试覆盖

| 层 | 命令 | 结果 |
|---|---|---|
| 后端全量 | `python -m unittest discover -s tests` | **Ran 360 tests — OK (skipped=1)** |
| 后端导出专项 | `python -m unittest tests.test_export` | 70 项 OK |
| 前端全量 | `cd frontend && npm test` | **26 项 / 0 失败** |
| 类型检查 | `npx tsc --noEmit` | exit 0 |
| 生产构建 | `npm run build` | ✓ 8.2s，产物入 `webui/static/`，并清理过期入口包 |

### 3.3 发布检查清单

| 检查项 | 结果 |
|---|---|
| 交付库 `outputs/bank.db` 未被污染 | ✅ sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（64,815,104 B），本轮**全程未变** |
| 源 DOCX / `preprocess_final/` 未改 | ✅ |
| 样例卷 #1 三模式导出 | ✅ 学生 706,246B / 教师 708,754B / 仅答案 706,299B |
| 公式为**原生 OMML** | ✅ `<m:oMath>`=24/65，`<w:object>`=0，embeddings=0 |
| 制表符为**真实 `<w:tab/>`** | ✅ 9 处，哨兵残留 0、裸 TAB 残留 0 |
| Word/WPS 双端可编辑 | ✅ `export verify`：学生 24 式、教师 65 式，改字符保存重开**均保留** |
| Word/WPS 渲染一致 | ✅ 页数与公式数一致（4/6/4 页） |
| 内容守卫生效 | ✅ 卷3：8 blocker / 6 warning，HTTP 409 / code 40904，CLI 退出 3 |
| 修订闭环（副本） | ✅ 原卷 23 行字节不变 → 新卷 15 条 blocker 归零 |
| Web HTTP 端到端 | ✅ 卷1 预览 4 页 + 导出成功；卷3 正确拦截 |
| 资产清单 | ✅ 164 条，0 缺失 |
| 静态产物整洁 | ✅ `webui/static/assets` 82→61 文件，仅 1 个入口包 |

### 3.4 回滚预案

- **代码回滚**：本轮改动集中在 `bank/export.py`（导出器）与 `frontend/`。回退导出器即恢复旧行为（但会**重新引入**样例卷不可导出，**不建议**）。
- **数据回滚**：**无需**——本轮未写交付库。可用备份点 `outputs/bank.backup-20261010-162607-rdt.db`（若需）。
- **前端回滚**：`npm run build` 产物可重建；旧产物已在清理中移除，回退需从源码重建。
- **注意**：内容守卫（`export-content-p0-v5`）与两 revision 校验**不应回退**——回退会重新打开「答案泄漏 / 旧缓存旁路」风险。

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 在 **1366×768** 实机走查：组卷页右栏是否收进抽屉、结果区是否可读 | 教研组 | P1 | 交付前 |
| 2 | 实机键盘走查：Tab 到题卡手柄 → 空格拾起 → 方向键移动 → 空格放下 | 教研组 | P1 | 交付前 |
| 3 | 实机确认：搜索 300ms 后才发请求；检索页多选「加入所选（N）」可用 | 教研组 | P1 | 交付前 |
| 4 | 人工肉眼核对 Word/WPS 渲染的选项对齐与图文分页（本次已看学生版前 2 页） | 教研组 | P1 | 交付前 |
| 5 | 把「哨兵残留 == 0」固化为常规回归断言 | 开发 | P2 | 下轮 |
| 6 | 路由级 code-split（chunk 1,058 kB） | 开发 | P2 | 可选 |

---

## ⚠️ 待完善 / 已知局限

**验证的局限（如实声明）**
- **浏览器实机验收未跑**：本环境无 GUI。P1-1（响应式）、P1-2（键盘）、P1-3（防抖/批量手感）**仅完成源码级护栏 + 构建验证**，未做像素级人工确认。
- 未对全库 **1,393 道含 TAB** 的题做全量导出回归（覆盖：样例卷 #1 + 布局探针 + 14 项单测 + 验收员反例）。
- 未人工逐页核对 Word/WPS 全部页面（验收员的 `export verify` 为程序化 PASS）。
- 无 git，未做前后端 diff；门禁语义等价依赖既有 uiStore 测试 + 源码阅读。
- LibreOffice 未提供，用原生 Word/WPS 导 PDF 逐页核验替代，**不宣称 LibreOffice 通过**。

**产品自身的已知欠账（不构成新缺陷）**
- 难度 **100% 为空**（刻意不自动推断）；年级/教材 **82% 缺失** → 按维度筛题长期不可用，只能靠关键词。
- 知识点为「**提及**」口径而非「考查」；答案覆盖 50%；132 条公式待复核。
- 导出依赖 `editor_sdk` + Word/WPS；缺失时降级为仅 DOCX（现在**两个入口**都能正确降级）。
- 撤销为「**重建副本**（新 id）」而非原样恢复——因后端无恢复接口，界面已如实标注。

**遗留风险**
1. 哨兵 `U+E000` 依赖 OOXML 后处理还原；任何漏做后处理的环节都会残留豆腐块 → 已断言「残留==0」，建议固化。
2. 响应式断点 1439px：1440×900 机型右栏**不折叠**（按 1366 主流设定）。
3. 窄屏下「库→卷拖拽」不实用（「加入」按钮路径仍在）。
4. 选项标签判定限 `[A-D]` 英文。

---

## 📚 成员产出索引

- **主理人（后端/导出）**：`outputs/handoff/D-导出P0最终交接.md`；探针 `.tmp_verify/{probe_tab_bridge,probe_sentinel,probe_layout_keep,export_and_render,revision_flow,web_flow}.py`；阶段索引 `outputs/export-upgrade-20261010/README.md`。
- **前端开发**：`outputs/handoff/D-前端修复与重构.md`（P0×4 / P1×6 / 重构×3，含改前→改后→证据）。
- **独立验收员**：`outputs/handoff/T-本轮独立验收.md`；探针 `.tmp_verify/T_probe_{a1c_controlchar,a2_docx,a3_extreme,a3b_bridge_boundary}.py`；产物 `.tmp_verify/T_out/`。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
