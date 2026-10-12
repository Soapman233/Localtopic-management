import { lazy, type ReactElement } from 'react'
import { Navigate, RouterProvider, createHashRouter, useLocation } from 'react-router-dom'
import App from './App'
import RequireAuth from './app/auth/RequireAuth'
import LoginLoadBoundary from './components/LoginLoadBoundary'

/** 登录页（阶段 4）。同样走懒加载——本地版永远不会访问它。 */
const LoginPage = lazy(() => import('./pages/LoginPage'))

// 使用 HashRouter：FastAPI StaticFiles 静态托管无需服务端 history fallback。
//
// T04 实现 4 个核心闭环页面（检索 / 组卷 / 导出 + 单题详情）；
// T05 实现 5 个治理与设置页面（知识点复核 / 待复核公式 / 来源文件 / 统计 / 设置），
// 至此 9 个页面全部接入真实实现（无占位页）。
//
// 阶段 1 信息架构重构（P0-4 / P1-6）：治理页统一迁到 /manage/* 子路径，
// 默认落地页由 /search 改为 /builder（老师最高频动作是组卷）。
//
// 阶段 5 性能优化（P5-1）——**路由级代码分割**
// ------------------------------------------------
// 改前：9 个页面全部**同步 import**，入口 chunk 单文件达 1.12 MB；首屏必须下载并
// 解析**全部页面**（含 4 个低频治理页）的代码，Vite 持续告警「Some chunks are
// larger than 500 kB」。
// 改后：每个页面改用 `React.lazy` 动态 `import()`，各自产出独立 chunk，
// **仅在访问对应路由时才下载**（老师 90% 时间只在组卷 / 找题 / 导出之间切换，
// 治理页代码不再进首屏）。加载态的呈现由 `App.tsx` 中包裹 `<Outlet/>` 的
// `<Suspense>` 统一负责（fallback 复用全站统一的 `LoadingState`），此处无需重复处理。
const SearchPage = lazy(() => import('./pages/SearchPage'))
const QuestionDetailPage = lazy(() => import('./pages/QuestionDetailPage'))
const PaperBuilderPage = lazy(() => import('./pages/PaperBuilderPage'))
const ExportPage = lazy(() => import('./pages/ExportPage'))
const KnowledgeReviewPage = lazy(() => import('./pages/KnowledgeReviewPage'))
const FormulaReviewPage = lazy(() => import('./pages/FormulaReviewPage'))
const SourcesPage = lazy(() => import('./pages/SourcesPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const DataMaintenancePage = lazy(() => import('./pages/DataMaintenancePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export const PAGES: Record<string, ReactElement> = {
  search: <SearchPage />,
  builder: <PaperBuilderPage />,
  export: <ExportPage />,
  'manage/knowledge': <KnowledgeReviewPage headingLevel={2} />,
  'manage/formula-review': <FormulaReviewPage headingLevel={2} />,
  'manage/sources': <SourcesPage headingLevel={2} />,
  'manage/stats': <StatsPage headingLevel={2} />,
  settings: <SettingsPage />,
  'question/:id': <QuestionDetailPage />,
}

/** 默认落地页：组卷工作台（`index` 与 `*` 通配都指向它）。 */
export const DEFAULT_LANDING_PATH = '/builder'

/**
 * 旧路径 → 新路径重定向表（**HashRouter 旧书签兼容**）。
 *
 * 老师可能把治理页存成了旧书签（如 `#/knowledge`），迁移后不能让它们 404。
 * 抽成可导出常量，便于 `tests/unit/Navigation.test.ts` 校验映射存在且指向正确。
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  knowledge: '/manage/knowledge',
  'formula-review': '/manage/formula-review',
  sources: '/manage/sources',
  stats: '/manage/stats',
}

/** 路由全集独立于侧栏；导出辅助页与维护子页不因隐藏导航而失效。 */
export const ROUTE_PATHS = [...Object.keys(PAGES), 'manage']

/** 兼容旧书签和维护默认页时保留查询串与来源 state，替换历史避免来回重定向。 */
export function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={to + location.search} state={location.state} replace />
}

const children: import('react-router-dom').RouteObject[] = Object.entries(PAGES)
  .filter(([path]) => !path.startsWith('manage/'))
  .map(([path, element]) => ({ path, element }))
children.push({
  path: 'manage',
  element: <DataMaintenancePage />,
  children: [
    { index: true, element: <LegacyRedirect to="/manage/knowledge" /> },
    ...Object.entries(PAGES).filter(([path]) => path.startsWith('manage/'))
      .map(([path, element]) => ({ path: path.slice('manage/'.length), element })),
  ],
})

const legacyChildren = Object.entries(LEGACY_REDIRECTS).map(([from, to]) => ({
  path: from,
  element: <LegacyRedirect to={to} />,
}))

const router = createHashRouter([
  // 登录页**不套 RequireAuth**（否则未登录时跳登录页会无限重定向）。
  // ⚠️ 因此"本地版访问 /login 要透传"**不能**依赖下面的 RequireAuth——它是顶层路由，
  // 根本走不到 RequireAuth。真正的兜底在 `LoginPage` 内部：本地版（auth_enabled=false）
  // 会自行 `<Navigate>` 回默认落地页。局部边界独立负责登录模块延迟与加载失败。
  { path: '/login', element: <LoginLoadBoundary><LoginPage /></LoginLoadBoundary> },
  {
    path: '/',
    // 阶段 4：线上版未登录 → 跳 `/login`；**本地版恒真透传**（见 RequireAuth 注释）。
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={DEFAULT_LANDING_PATH} replace /> },
      ...children,
      ...legacyChildren,
      { path: '*', element: <Navigate to={DEFAULT_LANDING_PATH} replace /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
