/**
 * 路由元数据（**纯函数，无 React 依赖**）。
 *
 * 为什么单独成模块
 * ----------------
 * 文档标题、面包屑、内容限宽三件事**都只由 pathname 决定**。若把它们散在
 * `App.tsx` 里，页面组件要用面包屑就得反向 import `App.tsx`（外壳），
 * 既造成依赖倒置，也会让懒加载页面的 chunk 多拽一份外壳依赖。
 * 抽成纯模块后：组件 → `lib/routeMeta`，依赖方向单向、可单测、可 tree-shake。
 *
 * ⚠️ `selectedNavPathFor` **不在这里**：它需要 `NAV_ITEMS`（侧栏定义），
 * 而侧栏是外壳的一部分，仍留在 `App.tsx`。
 */

/** 站点基础标题（与 `index.html` 的 `<title>` 一致）。 */
export const BASE_TITLE = '初中物理 · 题库与组卷'

/**
 * **独立的路由标题表**（B1 硬性要求 6）。
 *
 * 为什么不复用导航项：导航项只覆盖侧栏 5 项，但文档标题还要覆盖**不在侧栏**的页面
 * （题目详情、导出中心）与**维护子页**（/manage/* 四个具体页）。
 * 前缀按**由长到短**排列，`find` 首个命中即为最具体匹配（`manage/stats` 不会退化成 `manage`）。
 */
export const ROUTE_TITLES: ReadonlyArray<{ prefix: string; title: string }> = [
  { prefix: 'manage/knowledge', title: '知识点复核' },
  { prefix: 'manage/formula-review', title: '公式复核' },
  { prefix: 'manage/sources', title: '来源文件' },
  { prefix: 'manage/stats', title: '题库统计' },
  { prefix: 'manage', title: '数据维护' },
  { prefix: 'question', title: '题目详情' },
  { prefix: 'import', title: '导入试卷' },
  { prefix: 'builder', title: '组卷工作台' },
  { prefix: 'search', title: '找题' },
  { prefix: 'export', title: '导出中心' },
  { prefix: 'settings', title: '系统设置' },
]

/** 归一化路径：去掉首尾斜杠，便于「完整路径 / 分段前缀」比较。 */
export function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 由路由路径推导**文档标题**（P5-3：路由变化时同步 `document.title`）。
 *
 * 本函数是**纯函数、无副作用**，导出以便单测（不变量：已知路由 → 「页面名 · 初中物理题库」；
 * 维护子页显示具体标题，如「公式复核 · 初中物理题库」；未知 → 基础标题）。
 * 标题来源是**独立的路由标题表** `ROUTE_TITLES`，不依赖导航项。
 */
export function documentTitleForPath(pathname: string): string {
  const clean = normalizePath(pathname)
  const hit = ROUTE_TITLES.find((r) => clean === r.prefix || clean.startsWith(`${r.prefix}/`))
  return hit ? `${hit.title} · 初中物理题库` : BASE_TITLE
}

/** 一个面包屑节点。 */
export interface Crumb {
  /** 显示文案。 */
  label: string
  /**
   * 点击跳转路径（以 `/` 开头）。**省略即为纯文本**（通常是末级「当前页」）。
   *
   * 首级「数据维护」不省略 `to`：虽然 `/manage` 会重定向到默认 Tab，
   * 但显式给出 `/manage/knowledge` 可少一次重定向跳转。
   */
  to?: string
}

/**
 * 由 pathname 派生**面包屑**（纯函数，便于单测）。
 *
 * 设计取舍——**只给「侧栏说不清位置」的页面渲染面包屑**：
 * - 侧栏可见的顶层页（组卷 / 找题 / 导入 / 设置）返回 `[]`。它们的层级只有一级，
 *   渲染「组卷工作台」这样一个节点的面包屑是**纯噪音**（侧栏已高亮当前位置）；
 * - `question/:id`、`export` 不在侧栏（或选中态归到别的导航项），需要面包屑交代来路；
 * - `manage/<tab>` 是嵌套层级，面包屑能表达「数据维护 › 公式复核」。
 *
 * 返回 `[]` 时 `BreadcrumbBar` 不渲染任何东西，因此调用方可无条件使用。
 *
 * @param pathname 当前路径（含或不含前导斜杠均可）。
 * @param opts.currentLabel 覆盖**末级**文案——详情页用它把「题目详情」换成「题 123」
 *   （题号来自数据，纯路由推导不出来）。
 */
export function deriveCrumbs(pathname: string, opts?: { currentLabel?: string }): Crumb[] {
  const clean = normalizePath(pathname)
  const tail = opts?.currentLabel?.trim()

  // 单题详情：来路是「找题」（`selectedNavPathFor` 也把 /question/* 归到找题）。
  if (clean === 'question' || clean.startsWith('question/')) {
    return [{ label: '找题', to: '/search' }, { label: tail || '题目详情' }]
  }

  // 导出中心：选中态归到「组卷工作台」，故面包屑也指向它，保持两处口径一致。
  if (clean === 'export' || clean.startsWith('export/')) {
    return [{ label: '组卷工作台', to: '/builder' }, { label: tail || '导出中心' }]
  }

  // 维护子页：两级。
  if (clean.startsWith('manage/')) {
    const hit = ROUTE_TITLES.find((r) => r.prefix === clean)
    return [
      { label: '数据维护', to: '/manage/knowledge' },
      { label: tail || hit?.title || '数据维护' },
    ]
  }

  return []
}

/**
 * 内容区**最大宽度**（像素）。返回 `null` 表示不限宽（工具类页面全宽）。
 *
 * 依据（设计规范 §4.1 布局表）：
 * - **阅读型**（单题详情）→ 内容居中，**`maxWidth: 720`**；
 * - **工具型**（组卷 / 找题 / 维护）→ 全宽，`padding: 24px`，**不设 maxWidth**。
 *
 * ⚠️ 2026-10-13（R05 = ③ 单栏 720 + 右栏改抽屉）：
 * 详情页原为 **1200**（当时是「正文 + 右侧来源/历史两列」）；改为
 * **单栏 720**，右栏内容收进**抽屉**（由页面右上角按钮打开）。
 * 设置 / 导入两页规范未分类，暂沿用 1100（**已登记为待定项**，见任务表）。
 */
export function contentMaxWidthFor(pathname: string): number | null {
  const clean = normalizePath(pathname)
  if (clean === 'settings' || clean === 'import') return 1100
  if (clean === 'question' || clean.startsWith('question/')) return 720
  return null
}
