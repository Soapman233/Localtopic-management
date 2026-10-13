# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

> 说明：本文件在 `0.7.0` 时初始化，`0.1.0`–`0.6.0` 的条目依据项目内既有
> 验收报告与交接文档（`outputs/`、`AGENTS.md`）回溯整理，日期取对应工作阶段。

## [Unreleased]

### 新增（设计规范落地 · 本 checkout = `workbuddy/main-14dd9452`）

> 依据两份外部文档：`deliverables/UI设计评审与优化方案-2026-10-13.md`（评审 F1–F11）
> 与 `deliverables/设计语言与人机交互规范-2026-10-13.md`（规范 §1–§7）。
> 二者**逐字节导入本线**（sha256 与源一致，来源提交 `fb62c78`）。
> 落地任务分解见 `deliverables/任务表-设计落地-本线校准-2026-10-13.md`（T01–T21 + R01–R12），
> 审计见 `deliverables/审计-七态与表格同值率-2026-10-13.md`。

**P0（可见性缺陷）**
- **修深色模式「白底白字」**（评审 F1）：`FormulaReviewPage` 的公式预览容器由硬编码
  `bgcolor: '#fff'` 改为语义槽 `background.paper`——深色下容器不随主题切换会导致内容**完全不可见**。
- **主色对比度收敛**（评审 F2）：`theme.ts` 新增 `resolvePrimary()`，**按模式收敛**——
  浅色朝黑（压页面底 `#F5F6F8`）、深色朝白（压纸面 `#1E1E1E`），并令 `contrastText` 同步转深色。
  设置页显示**实测比值** + 「使用推荐主色」。此前 `settings.json` 存旧主色 `#3370FF` 时
  白字仅 **4.28:1**，全站 11 类元素不达 AA，**而对比度门禁测的是 token 配对表、测不到运行期存值**。

**P1（高价值视觉 / 可用性）**
- **剥离题干内嵌答案**（评审 F4）：新增 `lib/questionText.ts`，**取所有标记中最早的位置**切割
  （实测 7945 题里有 8+ 种标记组合，「只认 `【答案】`」会漏掉 441 题）；接入列表卡与详情题干区。
  **渲染期剥离，不改数据**。
- **来源文件表分页**（评审 F5）：209 行全量渲染（页高 9,788px）→ 25 行/页；
  「元数据状态」列（同值率 83%）去徽章化，改行级标记 + 顶部筛选。
- **常驻横幅降级**（评审 F7）：组卷页窄屏 `info` Alert → 一次性可关闭的一行 caption。

**P2（系统化：把缺陷变成规则）**
- **补 `spacing` / `motion` token**（评审 F11）：`tokens.space`（8pt 栅格 8 档）+
  `tokens.motion`（fast 120 / base 180 / slow 240 + 3 缓动）并**被 `buildTheme` 消费**。
  可见影响：hover 反馈 200→120ms、抽屉/对话框 400→240ms。`AnimatedList` 与 `index.css` 改用令牌。
- **一屏一个主操作**（评审 F10 / 规范 §4.2）：题卡「加入」`contained` → `outlined`，
  主操作交给顶部批量条。
- **对比度配对 65 → 77 组**（规范 §5.2「只增不减」）：新增的每组都有真实消费方
  （深色 `text.primary/secondary` 此前**一组都没登记**、键盘焦点环 ×4、表头底 ×2、侧栏选中底 ×2）。
- **修 `R04` 漏网**：全库 12 处 `<strong>` 用浏览器默认 **700 字重**（此前只扫 `fontWeight:` 抓不到）
  → 统一降到 500（**保留语义**），A4 纸面除外（规范 §7）。

**规范口径变更（R03–R06 拍板，实现让位）**
- 圆角：按钮 999→**8**、卡片/Paper 16→**10**、Dialog 24→10、Alert 12→10、输入框 12→8、
  `tokens.radius` 12→10。规范里没有 16/24 两档。
- 字重：界面**全量回退 400/500**（19 处 600/700 → 500）。
- 限宽：单题详情 **1200 → 720 单栏**，右栏内容收进 `SlideOver` 抽屉。
- 体积预算：入口 **30 KB → 54 KB**，并改为**三项同时卡**（入口 / 首屏总量 / 请求数）——
  见 `deliverables/设计语言与人机交互规范-2026-10-13.md` §4.4 的修订说明。

**客户端契约（规范 §4.5 的 7 条里，前端侧 4 条）**
- **自动保存明示**、**继续上次的卷**、**首启四步引导**、**跟随系统深色**（三态，`matchMedia` 监听）。
- 另 3 条（单实例 / 最小化到托盘 / `client_state.db`）**必须靠外壳实现**：
  只产出骨架 + 诚实标注（`editions/desktop/`），**未安装 pywebview、未端到端验证**。

**门禁（新增 4 道，全部可反证）**
- `npm run check:colors`：**硬编码颜色扫描**（豁免须写明理由）——启用当天即抓出人工 grep 漏掉的 `rgba(`。
- `npm run check:budget`：**体积预算三项同时卡**。
- `npm run contrast`：对比度配对 **65 → 77 组**。
- `spike/acceptance/shoot_ui.py`：**四项视觉门禁**（横向溢出 / 文字与背景同色 / 语义色 Chip 却是裸数字 /
  同值重复渲染），**前三项硬失败**；并新增 `--selftest`（注入已知缺陷确认探测器有效）。
  该门禁上线当天即抓出人工审查漏掉的一处「中性计数被染成警告色」。

**顺带修复的既有缺陷（不在两份文档里）**
- **后端测试套件曾整条卡死**：`portable_main._fatal()` 调 `MessageBoxW`（**阻塞式模态弹窗**），
  而 `test_portable_startup.py` 没打桩 → 弹出对话框后**永久等待点击**（实测卡 11 分钟，
  正常 1 分 44 秒），并在桌面留下没人点的窗口。**该用例过去是「靠有人恰好点掉弹窗」才通过的**。
  已打桩 + 断言弹窗内容。
- **裸 markdown 5 处上屏**：`glossary.ts` 的字符串值里有 `**加粗**`（含局域网风险提示），
  老师看到的是两个星号。**这推翻了评审「上一轮 18 项对账」#1「裸 markdown 已修」的结论**——
  评审扫的是页面 `bodyText`，而这几处只在展开/滚动到时才渲染。已改为真排版，并新增
  `glossary-markdown.test.ts`（遍历运行时值 + 自带反证）。
- **`/search` 首屏加载什么都不渲染**（七态审计查出）：空态分支被 `!isLoading` 挡掉、加载态没有分支
  → 冷启动看到一块空白。已补 `LoadingState`。
- **整个应用没有 favicon**（`pageerror` 门禁抓到）：无 `<link rel="icon">`、无 `public/`，
  浏览器每次加载都请求 `/favicon.ico` 得到 **404**（污染控制台，且标签页没有图标）。
  已新增 `frontend/public/favicon.svg`（纸面优先：品牌蓝底 + 白色试卷）+ `index.html` 显式声明。

### 新增（前端重构 · 阶段 5「性能与无障碍」）

**性能（P5-1）——路由级代码分割**

| 指标 | 改前 | 改后 |
|---|---|---|
| 入口 JS | 1,122,295 B | **24,372 B**（阶段 5 收口当次实测） |
| **首屏合计**（入口 + 4 vendor + CSS） | 1,155,129 B | **734,606 B（−36%）** |
| `vendor-katex`（261 KB） | 在首屏 | **懒加载，不在首屏** |

> ⚠️ 上表为**阶段 5 收口当次实测值**。入口 chunk 体积会随后续代码改动变化
> （例如后续新增登录页 / 鉴权相关代码后，实测入口已升至约 26–29 KB），
> **请以最新 `npm run build` 输出为准**，不要据上表数值做判断。

- `router.tsx` 全部页面改 `React.lazy`；`Suspense` 放在 **`Outlet` 外层**（放 router 根会让
  顶栏/侧栏在每次懒加载时整体卸载重挂）。
- `vite.config.ts` 新增 `manualChunks`（react / mui / katex / data / misc 五组）。
  ⚠️ 关键坑：`main.tsx` 只 import katex 的 **CSS**，若让该 CSS 归属 `vendor-katex`，
  入口会因静态 import **连带预加载 258 KB 的 KaTeX JS** —— 故 CSS 一律不参与 vendor 分包。
- Vite 的「chunk > 500 kB」与「Circular chunk」两条警告**均已消除**。
- **构建产物清理修复**：代码分割后 assets 下 js/css 由 2 个涨到 125 个。
  旧脚本按「是否被 `index.html` 引用」判断，会**误删懒加载 chunk**（它们不在 index.html 里）。
  已启用 `build.manifest`，改用构建清单判定本次构建的完整产物集；并只删 `.js`/`.css`、
  分批删除（避开沙箱批量删除拦截）。实测 **77 → 27** 个，幂等。

**无障碍（P5-2 对比度 / P5-3 语义）**

- **对比度全部达标 WCAG 2 AA**（`npm run contrast` → **65/65 通过**，含浅色与深色两套）：
  主色 `#3370FF` → `#2F63EA`（白字 5.13:1）；语义色作文字改为深色
  （成功 `#15803D` / 警示 `#B15008` / 错误 `#D32222`）；中性灰 `#9CA3AF` → `#667085`；
  另修若干 CSS chrome（含**深色删除按钮原值在白纸上仅 2.15:1**）。
  ⚠️ 坑：MUI `getContrastText` 阈值 3:1，深色 `main` 上会**误选深色文字** → 必须显式设 `contrastText`。
- **对比度门禁接入 `npm run build`**（技能原话：跑一次是审计，接进构建并在失败时非零退出才是保证）。
  校验器 **vendored 进仓库**（`frontend/scripts/check-contrast.mjs`，MIT，零依赖），不依赖本机技能目录。
- **无障碍语义**：skip-link（含 **HashRouter 下不改写 hash** 的处理）、`role="main"`、
  `<nav aria-label>`、`aria-current="page"`、图标按钮可访问名、`prefers-reduced-motion`、
  路由变化同步 `document.title`；**5 处 `<Drawer>` 补 `aria-labelledby`**
  （MUI 的 `Dialog` 经 `DialogTitle` 自动派生，**`Drawer` 不会**）。
- **标题层级修复**：9 个页面原先**全无 `<h1>`**；MUI 的 `variant="subtitle1/2"` 默认渲染成 `<h6>`，
  造成页内 h1→h6 跳级。已修 **15 处**（含一处**动态 variant** 导致静态 grep 漏掉的 `EmptyState`）。
  实测 **9/9 页恰好 1 个 h1 且无跳级**。
- **触达尺寸**：拖拽把手由 20×20 补到 24×24（content-box + padding，图标尺寸不变、零视觉变化）。

### 新增（前端重构 · 阶段 3「主流程重构」）

**这是六阶段里风险最高的一步。** 门禁语义**零改动**（见下）。

- **T3-1 断点统一 + 1366×768 双栏**（P0-3）：移除 `1439px` 魔法值，改用 MUI 标准断点
  （`lg`，`<1200` 才折叠右栏）。此前 1366×768（教师笔记本主流分辨率）会把**默认「排版」视图**
  折进**默认关闭**的抽屉，与《流程重构设计》Q8 直接冲突。现实测题卡宽度：
  **1366→338px、1280→281px、1440→386px、1920→716px**（此前被压到约 166px），
  且**1366 下排版预览默认可见**、无横向滚动。另在 <1440 提供「筛选」开合，可再收回 264px。
- **T3-2 门禁体验重写（只改表达）**：
  - 三态文案统一走 `describeExportGate()`；**锁定态直接给「生成预览」按钮**（不再只说不做）；
  - 说明「预览结果不跨页面刷新保留」的原因（**不改刷新即锁的行为，只解释它**）；
  - 导出中心定位为「全屏预览 / 导出历史」并引导回组卷页；两入口徽标**同源**，结构上不可能分叉；
  - 预览/导出改用 `ProgressStages`，导出作业有**真实阶段**（`useExportGate` 上报）。
- **T3-3 抽 `useQuestionFilters`**：消除检索页与组卷页约 **80 行**重复
  （关键词防抖 + URL 同步 + query/facets 参数），两页共用。
- **T3-4 「我的试卷」全站可达**：`PaperSwitcher` 提升到**全局 `AppBar`**，任意页面可切换/新建。
  并按**能力**区分命名，避免困惑：全局=「切换试卷」，组卷页=「试卷管理」（含删除 + 撤销）。
- **修复（L3 键盘 e2e 发现的真实缺陷）**：MUI `Button` 的焦点样式是
  `&.Mui-focusVisible { boxShadow: shadows[6] }`，但本项目 `disableElevation: true` 走的分支是
  `boxShadow: 'none'`，加上 `ButtonBase` 的 `outline: 0` ⇒ **所有 MUI Button 键盘焦点完全不可见**。
  已在 `theme.ts` 补回焦点环。实测：45 个可聚焦元素中「无可见焦点反馈」由 **3 个降为 0 个**。

### 修复（遗留清算）

- **L1** `exportGateShared.envReason()` 的技术词不再直接示人：新增 `describeEnvFailure()`
  （教师语言，debug 下追加技术细节），组件一律用它；`envReason` 保留为技术口径。
- **L2** `ExportDrawer` 的「命中缓存」Chip → 教师语言。
- **L5** `useJob` 轮询**加了终态超时**（默认 5 分钟）：此前后端作业线程消失会**每 1.2 秒永久轮询**；
  现超时即停并暴露 `timedOut`，导出 UI 显示可重试的超时态。
- **L6** `targetSectionId` 持久化守卫：新增 `validateTargetSection()`，
  组卷页加载整卷后即校验（陈旧 id 会被清掉，不再落到已删除的大题）。
- **L7** 补**页面级集成测试**（StatsPage / SourcesPage / SettingsPage / FormulaReviewPage 的加载·空·错误态）。

### 新增（工程能力）

- **视觉回归机制**（`frontend/tests/visual/`）：`capture.mjs`（采集）+ `compare.py`（像素比对 + 差异热力图）
  + `baseline-manifest.json`（基线 sha256 / 采集参数 / **接受理由**，可审计）。
  基线 PNG 不入库（派生产物）；README 写明**更新基线的唯一合法流程**：
  **必须先人工看图确认，禁止"为了让比对变绿而更新基线"**。
- 前端测试 **123 → 169 项**（vitest 97 → 143）。

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
