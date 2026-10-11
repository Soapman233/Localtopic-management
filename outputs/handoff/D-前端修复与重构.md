---
title: "前端修复与重构交接（D）"
description: "前端 4 项 P0、6 项 P1 与 3 项重构的改前/改后/证据，含未做项与遗留风险。"
keywords: ["前端", "交接", "重构", "易用性"]
author: "待补充"
created: "2026-10-11T10:46:26.150680+08:00"
modified: "2026-10-11T10:46:26.150680+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# D-前端修复与重构（frontend-dev 交接）

> 范围：前端缺陷修复（P0-1..P0-4）+ 易用性改进（P1-1..P1-6）+ 重构（R1/R2/R3）。
> 铁律遵守：**未改动** `outputs/bank.db`、`outputs/preprocess_final/`、任何源 DOCX；**未改动**后端 `bank/`、`webui/` 业务契约；前端仅调用既有 API。
> 全部改动集中在 `frontend/`。构建产物输出到 `webui/static/`（既有约定，非后端业务代码）。

---

## 一、验收命令（真实输出）

```
$ cd frontend && npx tsc --noEmit
tsc exit: 0

$ npm test
# tests 26
# pass 26
# fail 0

$ npm run build
../webui/static/assets/index-7mXAGSFw.js   1,058.35 kB │ gzip: 331.08 kB
✓ built in 8.41s
build exit: 0
```

> 说明：build 输出体积告警（chunk > 500 kB）为**既有**现象，非本次引入；未做 code-split（不在本次范围）。

---

## 二、P0 缺陷（4 项）

### P0-1 破坏性操作无确认 / 无撤销
**改前**：删除试卷 / 删除大题单击即 `force` 执行，无确认、无撤销，误点即数据丢失。
**改后**：
- 删除试卷 → `ConfirmDialog`（`PaperBuilderPage.tsx:629-646`），显式展示 **将删除 N 道题**（`impactCount`），题目本身仍保留在题库。
- 删除大题 → `ConfirmDialog`（`PaperPanel.tsx:428-444`），展示 **大题内 N 道题** 且提示「题目不会丢失，将回到未分组」。
- 撤销入口：删除试卷成功后弹 Undo Toast（`PaperBuilderPage.tsx:252-269`），撤销动作 = `recreatePaperCopy(full)`（`api/paperRestore.ts`）重建**同内容副本**。因后端**无恢复接口**，文案如实标注为「副本（新 id）」，**不谎称可原样恢复**。移除单题亦有 5 秒 Undo（`:304-315`）。
**证据**：测试 `ok 6 recreatePaperCopy 按原大题/题序/分值/归属逐条重建`、`ok 7/8 护栏：删除必须经确认框（显示题数）`。

### P0-2 设置「假成功」开关
**改前**：`katex.throwOnError/strict`、`default_template` 无任何消费方；`KatexFormula.tsx` 硬编码 `throwOnError:true, strict:false`，改设置无效果。
**改后（接通，推荐路径）**：
- 新增 `store/settingsStore.ts`，`main.tsx:23-27` 在设置 query 变更时 `syncFrom(data)` 镜像到 store。
- `KatexFormula.tsx:62-63` 改为从 store 读取 `throwOnError/strict` 并传入 `katex.renderToString`。
- `default_template` 被建卷流程消费：`PaperBuilderPage.tsx:237`、`SearchPage` 建卷 mutation 读取 `useSettingsStore.getState().defaultTemplate`。
- 设置页补「保存后立即生效」说明文案，消除「假开关」观感。
**证据**：测试 `ok 4 syncFrom 把后端设置镜像到 store`、`ok 5 KatexFormula 从设置读取 throwOnError/strict`（含源码级护栏）。

### P0-3 来源文件串档（跨文件污染）
**改前**：`SourcesPage.tsx` 在**渲染期**做 `if (detail && !inited)` 赋值，且组件未按 `sourceId` 重挂载 → 打开第 2 个来源文件时 `inited` 仍为 true，年级/教材输入框**仍是上一个文件的值**，误保存写错文件。
**改后**：
- 回填改到 `useEffect`（`SourcesPage.tsx:88-94`），不在渲染期 setState。
- 详情组件按 `key={activeId ?? 'none'}` 重挂载（`:399`），打开新文件即重置 `inited`。
**证据**：测试 `ok 9 护栏：来源详情按 sourceId 重挂载，且回填在 effect 中`。

### P0-4 双导出门禁不一致 → 导出永久锁死
**改前**：`ExportPage.tsx` 仅识别 `Word|WPS`（漏 `editor_sdk`），`ExportDrawer.tsx` 两者都识别 → 在无 editor_sdk 环境下导出页**不出现降级入口**，DOCX 导出被永久锁死。
**改后**：抽出**唯一实现** `detectEnvFailure`（`hooks/exportGateShared.ts:17-22`，同时识别 `editor_sdk` 与 `Word/WPS`），抽屉与导出页经 `useExportGate` 共用。导出页旧布尔判定已删除。
**证据**：测试 `ok 1 detectEnvFailure 同时识别 editor_sdk 与 Word/WPS（P0-4 根因）`；`grep detectEnvFailure src/` 仅剩共享实现与其调用点。

---

## 三、P1 易用性（6 项）

| 编号 | 改前 → 改后 | 位置 | 证据 |
|---|---|---|---|
| P1-1 响应式 | 右栏固定 640/420px、侧栏固定 232px；1366×768 下结果区被挤到 ~166px。→ `<1440px` 右栏改为 `Drawer`、筛选栏折叠按钮、侧栏 <900px 改汉堡抽屉；`main` padding `xs:1.5/md:3` | `PaperBuilderPage.tsx:179-181,361,442-473,551-560`；`App.tsx:89-126,159` | 源码护栏 + 目标分辨率人工验收（见第五节） |
| P1-2 键盘可达 | 分值/删除仅 hover 可见；拖拽仅 `PointerSensor`。→ CSS 补 `:focus-within`/`:focus-visible`；补 `KeyboardSensor + sortableKeyboardCoordinates` | `livePreview.css:113,132,137-139`；`PaperBuilderPage.tsx:274-278` | 源码护栏 |
| P1-3 防抖/批量 | 组卷页搜索无防抖；加题按钮无 pending（双击重复）；8 题需 8 次点击。→ 300ms 防抖；`adding` 禁用；检索页多选 + 「加入所选（N）」批量加入（后端 `question_ids:number[]` 已支持） | `PaperBuilderPage.tsx:165,185-190`；`SearchPage.tsx:176-177,240-242,380-408`；`QuestionCard.tsx:24-28,89-92` | 源码护栏 |
| P1-4 筛选入 URL | 组卷页筛选仅本地 state，从详情页返回即丢。→ 与检索页统一走 `readFiltersFromUrl/writeFiltersToUrl` | `PaperBuilderPage.tsx:164-167,194`；`api/searchParams.ts` | 复用既有检索页逻辑 |
| P1-5 诊断术语 | 主导出流直曝 `scan index`/`snapshot_digest`。→ 先给教师可读摘要，技术细节折叠进 `<details>技术详情`（仍可展开/复制） | `ExportDiagnostics.tsx:15-23,99` | 源码 |
| P1-6 死代码/暗色硬编码 | `App.tsx` 的 `description` 定义未渲染；`lp-*` 暗色下硬编码浅色。→ 渲染 `description` 为副标题；补 `.lp-dark` 覆盖 + 画布底色随主题 | `App.tsx:143-150`；`livePreview.css:200-203`；`LivePreviewPanel.tsx` | 源码 |

---

## 四、重构（R1/R2/R3）

### R1 抽取共享导出门禁 hook（最高价值）
- 新增 `hooks/useExportGate.ts`（426 行）+ `hooks/exportGateShared.ts`（纯函数 52 行）。
- `ExportDrawer.tsx` 663 → **338 行**（仅保留抽屉 UI）；`ExportPage.tsx` 改用同一 hook（300 行）。
- 行为不变（原有 17 项预览/门禁测试全绿）；**P0-4 随之自然消解**。

### R2 拆分超大文件（保持对外导出不变）
- `api/types.ts` 755 → **11 行 barrel**，拆为 `types/core.ts`(220) / `paper.ts`(283) / `governance.ts`(261)。
- `PaperPanel.tsx` 600 → **449 行**；`SortableItemRow` + `isStale` 抽到 `PaperPanelItemRow.tsx`(193)。
- 新增 `components/ExportResultPanel.tsx`(60) 供抽屉/导出页共用结果展示。

### R3 前端测试
- 新增 `tests/frontend-fixes.test.cjs`（237 行，9 项），覆盖：门禁纯函数、设置 store、KaTeX 取设置、`recreatePaperCopy` 撤销重建、删除确认/来源重挂载护栏。
- `package.json` test 脚本显式列出两个测试文件（Node 22 不接受裸目录）。
- 合计 **26 项全绿**（原 17 + 新 9）。

---

## 五、未做 / 无法做 / 需人工验收（如实）

1. **浏览器实机验收未跑**：本环境无 GUI 浏览器，P1-1（1366×768 布局）、P1-2（Tab 键盘走查）、P1-3（防抖/批量交互手感）**仅完成源码级护栏与构建验证**，未做像素级人工确认。建议人工步骤：
   - 1366×768 打开组卷页 → 确认右栏收进「试卷面板」抽屉、结果区可读；
   - Tab 走到题卡手柄 → 空格拾起、方向键移动、空格放下；
   - 搜索框连打 → 确认 300ms 后才发请求；检索页勾选多题 → 一次「加入所选（N）」。
2. **KaTeX「关闭降级」分支未在 SSR 测试中断言**：zustand 在 `renderToStaticMarkup` 下用 `getInitialState` 作 getServerSnapshot，`setState` 不影响静态渲染；该分支由 store 行为测试 + 人工浏览器验收覆盖，测试文件中已注明。
3. **撤销为「重建副本」非原样恢复**：后端无恢复接口，删除试卷的撤销会生成**新 id 的同内容副本**，文案已如实标注，**未伪装成原样恢复**。
4. **未做 code-split**：build 的 chunk >500 kB 告警为既有现象，本次未处理（避免范围外改动）。

---

## 六、改动文件清单

**新增**：`hooks/useExportGate.ts`、`hooks/exportGateShared.ts`、`components/ExportResultPanel.tsx`、`components/PaperPanelItemRow.tsx`、`api/types/core.ts`、`api/types/paper.ts`、`api/types/governance.ts`、`api/searchParams.ts`、`api/paperRestore.ts`、`store/settingsStore.ts`、`tests/frontend-fixes.test.cjs`。

**修改**：`pages/PaperBuilderPage.tsx`、`pages/ExportPage.tsx`、`pages/SearchPage.tsx`、`pages/SourcesPage.tsx`、`pages/SettingsPage.tsx`、`components/ExportDrawer.tsx`、`components/PaperPanel.tsx`、`components/QuestionCard.tsx`、`components/KatexFormula.tsx`、`components/LivePreviewPanel.tsx`、`components/livePreview/ExportDiagnostics.tsx`、`components/livePreview/livePreview.css`、`App.tsx`、`main.tsx`、`api/types.ts`、`package.json`。

---

## 七、遗留风险

1. P1-1 断点取 `1439px`：若教师机为 1440×900，右栏**不折叠**（按需求以 1366 为主流设定）；如需覆盖 1440 请调整断点。
2. 批量加入依赖后端 `addQuestions` 接受 `question_ids:number[]`——已按既有契约调用，未改后端；若后端行为与假设不符需复核。
3. `recreatePaperCopy` 按旧→新 section id 映射重建，若删除后大题结构被并发改动，副本结构以删除时快照为准（符合预期）。
4. 暗色模式 `lp-dark` 仅覆盖已知硬编码类；新增未覆盖类需同步补色（低风险）。
