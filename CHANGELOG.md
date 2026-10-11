# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

> 说明：本文件在 `0.7.0` 时初始化，`0.1.0`–`0.6.0` 的条目依据项目内既有
> 验收报告与交接文档（`outputs/`、`AGENTS.md`）回溯整理，日期取对应工作阶段。

## [Unreleased]

### 新增（前端重构 · 阶段 2「设计系统统一」）

- **移除挂名的 Tailwind**：实测全库 **0 处**使用 Tailwind 工具类（所有 `className` 都是 `lp-*`
  自定义样式与 KaTeX），却带来第二套设计 token 与构建负担。已删除 `tailwind.config.js`、
  从依赖中移除 `tailwindcss`、清掉 `index.css` 的三段 `@tailwind` 指令
  （**保留 autoprefixer 与全部 KaTeX 样式**）。
  **CSS 产物 35,987 B → 32,834 B（−8.8%）；`--tw-` 出现次数 118 → 0。**
- **设计 token 收敛为单一来源**（`src/theme.ts`）：把原 `tailwind.config.js` 里
  「无消费方但语义正确」的 token 迁移进来并挂到 MUI 主题——难度色（易/中/难）、
  徽章色（复核/已确认/已否决/缺失）、8px 间距、圆角档位、字号 5 档、阴影 3 档。
  **刻意不覆写 MUI 的 typography 字号与 spacing**，以保证零视觉变化。
- **四态规范组件**：新增 `LoadingState` / `EmptyState` / `ErrorState` / `ProgressStages`，
  统一全站原本碎片化的四态（此前 `CircularProgress` 散在 13 个文件、`Skeleton` 仅 1 个文件、
  裸空态文案 7 处、长任务无阶段无上限）。`ErrorState` 走 `describeApiError()` 给教师可读文案，
  原始堆栈仅在 `?debug=1` 下可见；`ProgressStages` 给导出/预览这类 3–8 秒等待加**阶段 + 上限预期**。
  **横幅类 `Alert`（覆盖率、降级、内容守卫）保持不动**。
- 前端测试 **109 → 123 项**（vitest 83 → 97）。

### 新增（前端重构 · 阶段 1「术语与信息架构」）

- **术语中文化**（P0-1）：新增 `frontend/src/lib/glossary.ts` 作为术语映射的**唯一来源**，
  把暴露给老师的开发者术语全部翻译成教师语言：

  | 旧文案 | 新文案 |
  |---|---|
  | 快照锁定 | 本题在题库中已更新，本卷仍用加入时的版本（按钮：更新到最新） |
  | 降级解锁 / 已确认结构预览（降级解锁） | 当前电脑未安装 Word/WPS，已改用结构预览确认 |
  | 门禁已解锁（像素预览为当前内容） | 预览已确认，可以导出 |
  | 修订候选 | 导出前需要处理的问题 |
  | 提及口径 | 这是搜索线索，不代表本题考这个知识点 |
  | 技术详情 | 给技术人员的信息 |

  `scan index` / `snapshot_digest` / `evidence_digest` / `body_paragraph_number` /
  `instance_id` / `blocked_modes` 等**原始字段默认不再渲染**，仅在 `?debug=1` 或
  `localStorage.qb_debug=1` 下出现在「给技术人员的信息」折叠区。
- **导航分组与信息架构**（P0-4 / P1-6）：导航由扁平 8 项改为
  **「日常备课」（组卷工作台 / 找题 / 导出中心）+「数据治理」（知识点复核 / 公式复核 / 来源文件 / 题库统计）
  + 底部「系统设置」**；治理页统一迁到 `/manage/*`。
- **默认落地页**由 `/search` 改为 `/builder`（组卷是老师最高频动作）。
- **旧链接兼容**：`LEGACY_REDIRECTS` 把 `/#/knowledge` 等旧书签重定向到新路径，**不再 404**。
- **难度死功能处理**（P0-5）：`FilterSidebar` 新增通用判定——**任何**「无标注数据」的维度
  （items 为空）都标「暂不可用」、默认折叠、说明原因与出路，不再给一排点了筛不出结果的按钮；
  `CoverageBanner` 把覆盖率 0 的维度显示为**「未标注（N 题）」**而非「0%」。
- 顶部标题去掉技术词：`题库 Web 界面 · 初中物理` → **`初中物理 · 题库与组卷`**。
- 前端测试 **75 → 109 项**（vitest 49 → 83）。

### 新增（前端重构 · 阶段 0「护栏先行」）

**目标：不改视觉与功能，先建后续重构的安全网。**

- **vitest 组件测试基座**（此前最大风险：旧测试全是「源码字符串断言」，重构一改结构即失效）：
  `frontend/vitest.config.ts` + `tests/unit/setup.ts`（补齐 jsdom 缺失的 `matchMedia` /
  `ResizeObserver` / `IntersectionObserver` / `document.fonts`）+ `tests/unit/testUtils.tsx`。
  `npm test` 现同时跑 `node:test`（26 项）与 vitest；**vitest 49 项**。
- **页面级错误边界**（`components/ErrorBoundary.tsx`）：此前全站**无** ErrorBoundary，
  单页渲染异常即**整站白屏**。现顶层 + 页面级双层包裹，切换路由自动重置，兜底界面为中文教师语言，
  技术细节默认折叠。
- **统一反馈底座**（`lib/feedback.ts` + `components/NotifierBridge.tsx`）：接入 notistack，
  提供组件内 `useNotify()` 与组件外全局 `notify`；已接入两个真实消费方——
  检索页加入失败提示、以及 `MutationCache.onError` 对**无本地 onError 的 mutation** 的全局兜底。
- **契约收敛**：`api/errors.ts`（错误码常量 + `describeApiError` / `isContentGuardError` /
  `errorDataOf` 等语义函数）与 `api/queryKeys.ts`（`qk` 工厂）。
  **11 个文件的内联 queryKey 全部迁移**，残留 0；4 处错误码硬编码判断改为语义函数。
- **`webui/config.py` 支持 `QB_DB_PATH` / `QB_EXPORT_DIR`** 环境变量覆盖
  （此前 `editions/online/.env.example` 已承诺但未实现，线上版配置不自洽）。

### 修复

- **notistack 容器懒渲染**：容器仅在出现提示时进入 DOM——据此写「容器是否存在」的断言会误判。

### 变更

- 前端测试口径：**26 → 75 项**（26 `node:test` + 49 `vitest`）。
- 根目录 `启动题库.bat` 迁移至 `editions/local/启动题库.bat`（分类管理）。

### 新增（版本拆分）

- **两个版本（editions）与目录分类**：项目按运行形态拆分为
  **本地运行版**（`editions/local/`，仅 `127.0.0.1`，无鉴权）与
  **线上部署版**（`editions/online/`，`0.0.0.0` + nginx 访问控制）。
  二者**共享同一套内核**（`bank/` `pipeline/` `webui/` `frontend/`），业务代码零分叉；
  版本差异收敛到 `webui/edition.py`。新增 `editions/README.md`（分类总览）、
  两个版本的 README、`nginx.conf` / `Dockerfile` / `docker-compose.yml` / `.env.example`。
- `webui/edition.py`：版本配置（`QB_EDITION` / `QB_HOST` / `QB_PORT` / `QB_AUTH_TOKEN`），
  以及**默认关闭**的 `/api/*` Bearer 鉴权中间件（不设令牌时与历史行为完全一致）。
- `editions/local/启动题库.bat`：**可移植**的一键启动（`BANK_PY` > `.venv` > `PATH` 自动探测，
  启动前自检依赖），取代原先硬编码解释器路径的根目录脚本。
- 前端开发素材库（为重构做准备）：`vitest` + `@testing-library/react` + `jsdom`（测试基座）、
  `notistack`（全局 toast）、`react-error-boundary`（错误边界）、`zod`（运行时校验）。
- 补 **14 项**版本/鉴权回归测试（`tests/test_edition.py`）。

### 文档

- `deliverables/前端完整分析与重构方案-2026-10-11.md`：前端完整分析与六阶段重构方案。
- `deliverables/上线就绪度评估-2026-10-11.md`：上线缺口评估（两种口径）。

## [0.7.1] - 2026-10-11

### 修复

- **部分公式无法渲染（全库回归发现）**。导出时公式会**降级为「（公式）」占位**。
  全库逐条实测后定位到 4 类 MTEF 残留写法，均在 `bank/export.py::repair_latex`
  归一化处理：

  | 形态 | 语义 | 处理 |
  |---|---|---|
  | `0\tilde{\ }0.6` / `t_{1}\mathrm{\~{}}t_{2}` / `18℃\~{}30℃` | 范围号 / 约等号 ~ | → `\sim` |
  | `m\rm{{}^\text{3}}` | 单位上标（m³） | → `^{\text{N}}` |
  | `\rho _{ & x } =` | MTEF 表格残留对齐符 | 剔除（`\begin{array}` 内保留） |
  | `F_{{\rm{{\text{浮}}}}}` / `\xrightarrow{\mathrm{...}}` | `\rm` 内含嵌套花括号 | 展开 `\rm` 外壳 |
  | `\sqrt[]{\frac{...}}` | 根号的空可选参数 | → `\sqrt{...}`（`\sqrt[3]{x}` 保留） |

  **修复前 54 条公式（26 题）不可渲染 → 修复后 0 条**；回归中失败的三卷重导后
  桥接错误 0、降级占位 0（948 个公式）。补 **11 项**回归测试。

  **已知限制**：`\begin{array}...\end{array}` 环境（全库 1 条）桥接不支持，
  导出降级为「（公式）」并记录 warning，**不静默丢弃**。

### 新增

- 仓库工程化：`.gitignore` / `.gitattributes`（强制 `*.bat` CRLF）/ `README.md` /
  `CHANGELOG.md` / `requirements.txt` / GitHub Actions CI。
- 验证脚本：浏览器实机验收（Playwright）、全库 TAB 导出回归、Word/WPS 像素级页审计、
  LibreOffice 第三渲染器对比。

## [0.7.0] - 2026-10-11

### 修复

- **导出：控制字符致整卷导出失败（阻断级）**。桥接 `doc_insert_text` 拒绝文本中的
  控制字符（TAB 报 `code=9`、垂直制表 `code=11`），而「选项行内公式后紧跟 TAB」
  （如 `A．⟦F66⟧，⟦F67⟧\tB．`）切段后会产生以 TAB 开头的文本段 → **整卷导出中断**。
  新增 `bridge_safe_text()` 把 `\t` 换成哨兵并剔除其余控制字符，再由
  `_set_explicit_tab_stops()` 在 OOXML 层还原为**真正的 `<w:tab/>`** 并补制表位停靠点。
- **导出：选项标签与其配图被拆到两页**。选项标签判定原要求「整段全是纯文本」，
  含行内公式即失效；改为按「可见文本」判定（`is_option_label_segments`）。
- **前端：删除试卷 / 删除大题无确认、无撤销** → 接入确认框（显示影响题数）+ 撤销入口。
- **前端：设置项「假成功」**（KaTeX 开关与默认模板保存后无消费方）→ 新增 `settingsStore`
  并接通消费方。
- **前端：来源文件跨文件串值** → 按 `sourceId` 重挂载，表单不再残留上一个文件的值。
- **前端：两处导出门禁判定不一致**（导出页漏判 `editor_sdk`，会导致 DOCX 导出永久锁死）
  → `detectEnvFailure` 收敛为唯一实现。

### 变更

- **前端重构**：抽出共享导出门禁 `useExportGate` + `exportGateShared`（`ExportDrawer`
  663 → 338 行）；`api/types.ts` 755 → 11 行 barrel；`PaperPanel` 600 → 449 行。
- **前端易用性**：窄屏（<1440px）右栏转抽屉、键盘可达（`:focus-within` + `KeyboardSensor`）、
  搜索 300ms 防抖、批量加题、组卷页筛选写入 URL、导出诊断技术细节折叠。
- **构建**：新增 `prune-stale-assets.mjs` 并接入 `npm run build`，清理累积的过期入口包。

### 文档

- 校正 `AGENTS.md` 与使用说明中的测试数、交付库哈希与 API 端点数（此前与实际不符）。
- 新增导出 P0 阶段收口索引与前端修复交接文档。

## [0.6.0] - 2026-10-10

### 新增

- **导出内容守卫（P0）**：识别整卷答案区，误切条目阻断出卷并给出逐条诊断；
  按来源证据恢复图片分支实例（题干 / 答案 / 解析）；提供「查看修订候选 → 创建修订卷」
  的显式闭环；缓存与预览绑定内容指纹，旧缓存不可旁路。

### 修复

- 媒体缓存可能把答案图冒充题干图；编号阅读材料被误判为整卷答案并吞掉后续真题；
  物理数值/纯文字答案无诊断地再次成题。

## [0.5.0] - 2026-10-09

### 新增

- **Web 界面**：检索 / 单题详情 / 组卷工作台 / 导出中心 / 知识点复核 / 待复核公式 /
  来源文件 / 题库统计 / 系统设置，共 9 个页面。
- **双层预览与强制门禁**：前端结构预览 + 后端像素预览；内容变更即重新锁定导出。

## [0.4.0] - 2026-10-07

### 修复

- 题与题间距偏小、图片留白不足（每题段后 8→16pt、图片前后 6→10pt）。

## [0.3.0] - 2026-10-07

### 修复

- 图片尺寸不一致（按宽高比 + 可用宽度自适应，不放大）；图片左对齐与图片/题干被拆页。

## [0.2.0] - 2026-10-06

### 修复

- 导出样式时有时无（桥接瞬时错误自动重试）；版式改为 A4 + 1.5 倍行距 + 页脚页码。

## [0.1.0] - 2026-10-05

### 新增

- **阶段1 预处理**：DOCX 扫描、MathType MTEF → LaTeX 精确解码、题目切分。
- **阶段2 题库**：SQLite（11 表 + FTS5）、中文 bigram 检索、幂等导入、题目版本。
- **阶段3 组卷**：试卷 CRUD、加题重排、分值、大题分组、快照锁定。
- **阶段4 导出**：学生版 / 答案解析版 DOCX + PDF，公式为**原生 OMML**，
  Word 与 WPS 双端可编辑。
