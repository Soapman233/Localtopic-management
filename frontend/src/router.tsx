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
const PAGES: Record<string, ReactElement> = {
  search: <SearchPage />,
  builder: <PaperBuilderPage />,
  export: <ExportPage />,
  knowledge: <KnowledgeReviewPage />,
  'formula-review': <FormulaReviewPage />,
  sources: <SourcesPage />,
  stats: <StatsPage />,
  settings: <SettingsPage />,
}

const children = NAV_ITEMS.map((item) => ({
  path: item.path,
  element: PAGES[item.path] ?? <Navigate to="/search" replace />,
}))

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      { path: 'question/:id', element: <QuestionDetailPage /> },
      ...children,
      { path: '*', element: <Navigate to="/search" replace /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
