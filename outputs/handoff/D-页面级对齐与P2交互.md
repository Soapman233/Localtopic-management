# 交接：页面级对齐（P0–P2）与视觉验证能力升级

> 角色：D（开发）/ 主控 + 4 个并行 agent
> 日期：2026-10-13
> 依据：`deliverables/设计规范-对齐参考截图-2026-10-12.md` 第四节（P0–P2 清单）

---

## 一、我做了什么

### 1. P0 基建（4 项，主控实现）

| 交付 | 文件 | 说明 |
|---|---|---|
| 页面标题区 | `frontend/src/components/PageHeader.tsx` | 统一「大标题 + 灰色元信息行 + 右侧操作区」。`level="page"`→h5/`<h1>`；`level="section"`→h6/`<h2>`（Tab 子页） |
| 面包屑条 | `frontend/src/components/BreadcrumbBar.tsx` | 由路由派生（`deriveCrumbs`），**是真 `<a href="#/path">`** 而非按钮（右键新标签、读屏播报依赖它）；`href` 可复制、点击走 `useAppNavigate`（带过渡与减少动效降级），**只拦截无修饰键的左键点击** |
| 分区卡片 | `frontend/src/components/SectionCard.tsx` | 「标题行 + 右侧元信息 + 内容」。`variant="card"`（默认）/ `"plain"`（仅标题行+分隔线，用于避免卡片套卡片） |
| 内容限宽 | `frontend/src/lib/routeMeta.ts` + `App.tsx` | 正文类（设置/导入 **1100**、详情 **1200**）限宽居中；工具类（组卷/找题/导出/维护）全宽 |

**顺带做的重构**：把 `BASE_TITLE` / `ROUTE_TITLES` / `normalizePath` / `documentTitleForPath` 从 `App.tsx` 抽到 `lib/routeMeta.ts`（`App.tsx` 保留同名 re-export，既有测试与调用方零改动）。
**原因**：面包屑与限宽都要按 pathname 派生；若留在外壳里，页面组件就得反向 import `App.tsx`，形成依赖倒置。

### 2. P1 页面级对齐（4 个 agent 分工，文件集互不重叠）

| 批次 | 页面 | 主要改动 |
|---|---|---|
| A | 找题 / 单题详情 | 找题：`PageHeader` + 元信息摘要；**窄屏筛选栏改可折叠**；题卡元信息统一 `Chip`。详情：`PageHeader` + `currentLabel`（面包屑「找题 › 题 9」）+ **右侧可折叠「来源 / 历史」上下文面板**（对齐参考截图 1 的右栏），窄屏上下堆叠 |
| B | 组卷 / 导出 | 组卷：`PageHeader`；右栏改两张 `SectionCard`（试卷设置 / 内容检查）；顶部工具条并入 `actions`。导出：两处**互斥**分支都换 `PageHeader`（面包屑自动「组卷工作台 › 导出中心」）；去掉硬写的 `maxWidth`，留白收紧 |
| C | 维护父页 + 4 Tab 子页 | 父页 `PageHeader level="page"`；4 子页 `level="section"`（h2）；来源页表头加底色；统计页 KPI 卡片化 + 语义色；**修两个移动端溢出缺陷**（见下） |
| D | 设置 / 导入 | 设置：三分支（加载/错误/正常）各换 `PageHeader`；常用/高级改 `SectionCard`，内部小节用 `plain`；**修「默认模板」下拉框移动端溢出**；导入：`PageHeader`，流程与 40010/40011 未动 |

### 3. P2 交互增强（主控实现）

| 项 | 文件 | 说明 |
|---|---|---|
| 右侧滑出面板 | `frontend/src/components/SlideOver.tsx` | 新建试卷改走滑出面板（保留背景上下文）；**破坏性确认仍用 `ConfirmDialog`**（语气不同） |
| ⌘K 全局快速跳转 | `frontend/src/components/CommandPalette.tsx` | ARIA 1.2 combobox（`aria-activedescendant` 指向 `role="option"`）；↑↓ 选择 / Enter 打开 / Esc 关闭；输入非空时首项是「搜索题目「x」」→ `/search?keyword=x` |
| 顶栏入口 | `App.tsx` | **必须有一个可点击入口**——⌘K 在手机上不存在，只给快捷键等于移动端没这功能 |
| 关键词入参 | `pages/SearchPage.tsx` | 消费 `?keyword=`（找题页 hook 的既有 URL 契约，**没有自造 `?q=`**） |

**两个面板都做了懒加载**（`lazy(() => import(...))` + 条件挂载）：它们只在被打开时才需要，
而 `App.tsx` 属于**入口 chunk**，静态引入会把约 3.3 KB 直接压进首屏。
实测入口 **49,052 → 45,770 字节**。
⚠️ 代价：首次打开多一次本地 chunk 拉取（可忽略），且因条件挂载**没有关闭动画**。
⚠️ 两个浮层的 `<Suspense>` 必须放在 **JSX 最后**：`CodeSplitting.test.tsx` 断言
App.tsx 里**第一个** `<Suspense>` 是包住 `<Outlet/>` 的路由加载态（实测踩过，放前面会打挂该不变量）。

### 4. 🔴 视觉验证能力升级（本轮最关键的基础设施）

`spike/acceptance/shoot_ui.py` 修了**三个让早期验证结论失效的缺陷**：

| 缺陷 | 后果 | 修法 |
|---|---|---|
| 用**独立空库**起服务 | 所有截图都是「题库为空」的引导态——**题干/公式/图片/题目卡片一个都没被验证过**，等于没验证 | 把真实交付库**复制**到临时数据根（`QB_DB_PATH` 指向副本，源 DOCX 只读），绝不指向交付库本体 |
| 两个 hash 之间 `goto` **不重载文档** | React 状态（侧栏折叠分组）从上一页**泄漏**到下一页，拍出的不是「直接打开该页」的样子 | 每次导航带递增 query 强制真实导航 |
| 逐元素溢出取样**未排除不可见元素** | 关闭态的右侧滑出面板停在 `translateX(100%)`，天然「右边界越界」→ 每页稳定 21 个**假阳性**，把真实信号淹掉 | 跳过 `visibility:hidden` / `display:none` / `[aria-hidden=true]` 祖先内的元素 |

新增 `--dark` 模式（写服务端 settings 的 `theme.dark=true` 后重拍），并纳入 `/export` 与 `/question/<真实 id>` 两页。

---

## 二、产出物

**新增组件（4）**：`PageHeader.tsx`、`BreadcrumbBar.tsx`、`SectionCard.tsx`、`SlideOver.tsx`、`CommandPalette.tsx`
**新增模块（1）**：`frontend/src/lib/routeMeta.ts`
**新增测试（6 文件）**：`routeMeta.test.ts`、`PageHeader.test.tsx`、`SectionCard.test.tsx`、`CommandPalette.test.tsx`、`SlideOver.test.tsx`、`pages/SearchPage.test.tsx`、`pages/QuestionDetailPage.test.tsx`、`BuilderExportPages.test.tsx`
**新增验收脚本（1）**：`spike/acceptance/verify_p2_interactions.py`（真实浏览器验 P2 交互）
**截图（40 张）**：`spike/acceptance/_shots/`（浅色 20 + 深色 20，桌面 1440 / 移动 390）
**报告**：`_shots/overflow-report.json`、`_shots/overflow-report-dark.json`

---

## 三、验收标准（可执行）

```bash
cd frontend
npx tsc --noEmit      # 期望 0 错误
npm run contrast      # 期望 all 65 pairs pass
npx vitest run        # 期望 44 文件 / 341 测试全过
npm run build         # 期望成功

cd ..
python -m unittest discover -s tests                 # 期望 543 项、2 failures（既有）
python spike/acceptance/shoot_ui.py                   # 期望「横向溢出页面：0 / 20」
python spike/acceptance/shoot_ui.py --dark            # 期望同样 0 / 20
python spike/acceptance/verify_p2_interactions.py     # 期望 6/6 PASS（⌘K / 顶栏入口 / 滑出面板）
python spike/acceptance/verify_portable_detached.py   # 期望 7/7 PASS（双击可用）
```

**实测结果**：以上全部符合期望。

---

## 四、我在真机截图里发现并修掉的缺陷（空库时代查不出来）

| # | 缺陷 | 证据 | 修法 |
|---|---|---|---|
| 1 | `/manage/knowledge` 移动端**文档宽 446 > 视口 390** | 真实库 + 390px 实测 | 双栏窄屏堆叠 + 内层 Tabs 补 `scrollable`。**真因不是 Tab 本身**：`MuiTab-root` 只是被裁切内容的包围盒（假阳性），真正撑宽的是右栏被挤到 ~2px 后其内容最小宽度溢出 |
| 2 | `/manage/formula` 移动端 **430 > 390** | 同上 | 同上 |
| 3 | `/settings` 移动端 **403 > 390** | 越界元素 `MuiSelect-select` right=403 | 根因是 `sx={{display:'block', minWidth:200}}` 把 Select 根由 `inline-flex` 改成 `block`，内部 content-box 撑满父宽后再加自身 46px padding → 改 `fullWidth` |
| 4 | 维护页出现**两条一模一样的面包屑** | 截图直接可见（父页 + Tab 子页各派生一次） | `PageHeader`：`level="section"` **默认不派生面包屑**（父页已给过），仍可用 `breadcrumbs` 显式覆盖 |
| 5 | 筛选栏**仍是「五张浮空小卡片」** | 截图直接可见 | `FilterSidebar` 把边框/圆角/外边距写在**每个** Accordion 上，**组件级 `sx` 优先级高于主题 `styleOverrides`**，把主题的修复整个盖掉了。改为外层一层 `Paper` 提供边框，Accordion 只保留主题的分隔线 |
| 6 | `SectionCard.disablePadding` **声明了但没使用** | agent 实测发现（传了没反应，只能各自用 `contentSx={{p:0}}` 绕过） | 真的接上，并补一条 computed-style 断言防回归 |

> **#5 的教训值得单记**：上一轮我改了主题层，并「基于设计原则」宣布筛选栏碎片化已修复——
> 但组件级 `sx` 把它盖掉了，实际没生效。**只看被改的那一层代码，会得出「已修好」的错误结论。**

---

## 五、我没做 / 做不到的

| 项 | 说明 |
|---|---|
| **未做真实手机验证** | 全部是 Chrome 桌面内核 + 390px 视口模拟；**触屏手势、iOS Safari 的 `100vh`/软键盘行为、真实 DPR 未验** |
| **组卷页拖拽在触屏上未验** | 手机上双栏必然降单栏，DnD 是否可用未实测 |
| **入口 JS 仍超门禁** | 见下节 |
| **未做键盘全站走查** | 焦点顺序、焦点环在真实 Tab 序列下的表现只靠单测与静态检查 |
| **表格移动端未卡片化** | 仍依赖 `TableContainer` 横向滚动（`docW` 不超视口，可接受但不优雅） |
| **`/manage` 侧栏「数据维护」出现两行同名** | 折叠分组头（`数据维护 ⌄`）+ 唯一子项（`数据维护`）同名。这是 B1 方案既定结构（分组默认折叠），**不是本轮引入**；建议下轮把分组标签改名或单项目分组不折叠 |

---

## 六、遗留风险

1. **入口 JS = 45,770 字节**，仍超实施方案设定的 30,800 字节门禁（**+48.6%**）。
   已做一次收敛：把 P2 两个全局面板改为懒加载，**49,052 → 45,770**（−3.3 KB）。
   **建议**：该门禁基于重构前的代码设定，与「IA 精简 + M3 主题 + 动效 + 全局面板」的范围存在结构性张力。
   再往下压只能继续拆（导航/侧栏/主题都懒加载），代价是首帧闪烁与侧栏延迟——**收益是零**（本地 HTTP，本机加载）。
   我倾向**重新评估门禁本身**（或改为「首屏预加载总量」口径，实测首屏 5 个 chunk 合计约 1.0 MB，其中 vendor-mui 326 KB 是主要成本）。
2. **`PageHeader` 的 `level="section"` 不派生面包屑**是一条**隐式约定**。若将来有页面独立使用 `section` 级标题（父页不存在），会「没有面包屑」而看不出原因。已在组件与测试里写明。
3. **`?keyword=` 的消费 effect 依赖「应用后值相等」来防回环**。若将来 `useQuestionFilters` 的 URL 契约从 `keyword` 改名，这里会静默失效（表现为「⌘K 搜了但条件没带上」）。测试里钉了 `not.toContain('?q=')`，但**没钉住 hook 侧的参数名**——建议给 hook 补一条「URL 参数名」的断言。
