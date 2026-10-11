import type { ReactElement } from 'react'
import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom'
import App, { NAV_ITEMS } from './App'
import SearchPage from './pages/SearchPage'
import QuestionDetailPage from './pages/QuestionDetailPage'
import PaperBuilderPage from './pages/PaperBuilderPage'
import ExportPage from './pages/ExportPage'
import KnowledgeReviewPage from './pages/KnowledgeReviewPage'
import FormulaReviewPage from './pages/FormulaReviewPage'
import SourcesPage from './pages/SourcesPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'

// 使用 HashRouter：FastAPI StaticFiles 静态托管无需服务端 history fallback。
//
// T04 实现 4 个核心闭环页面（检索 / 组卷 / 导出 + 单题详情）；
// T05 实现 5 个治理与设置页面（知识点复核 / 待复核公式 / 来源文件 / 统计 / 设置），
// 至此 9 个页面全部接入真实实现（无占位页）。
//
// 阶段 1 信息架构重构（P0-4 / P1-6）：治理页统一迁到 /manage/* 子路径，
// 默认落地页由 /search 改为 /builder（老师最高频动作是组卷）。
const PAGES: Record<string, ReactElement> = {
  search: <SearchPage />,
  builder: <PaperBuilderPage />,
  export: <ExportPage />,
  'manage/knowledge': <KnowledgeReviewPage />,
  'manage/formula-review': <FormulaReviewPage />,
  'manage/sources': <SourcesPage />,
  'manage/stats': <StatsPage />,
  settings: <SettingsPage />,
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

const children = NAV_ITEMS.map((item) => ({
  path: item.path,
  element: PAGES[item.path] ?? <Navigate to={DEFAULT_LANDING_PATH} replace />,
}))

// 旧路径重定向：放在 NAV_ITEMS 路由之后、`*` 通配之前，确保旧链接仍可用。
const legacyChildren = Object.entries(LEGACY_REDIRECTS).map(([from, to]) => ({
  path: from,
  element: <Navigate to={to} replace />,
}))

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={DEFAULT_LANDING_PATH} replace /> },
      { path: 'question/:id', element: <QuestionDetailPage /> },
      ...children,
      ...legacyChildren,
      { path: '*', element: <Navigate to={DEFAULT_LANDING_PATH} replace /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
