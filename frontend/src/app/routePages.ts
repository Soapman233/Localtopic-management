/** 二层按需入口：默认builder不下载其他路由的预加载映射、加载登记或VT样式。 */
import { markRouteWarm } from './routeTransitions'
const loaders = {
  SearchPage: () => import('../pages/SearchPage').then(module => { markRouteWarm('/search'); return module }),
  QuestionDetailPage: () => import('../pages/QuestionDetailPage').then(module => { markRouteWarm('/question/:id'); return module }),
  ExportPage: () => import('../pages/ExportPage').then(module => { markRouteWarm('/export'); return module }),
  KnowledgeReviewPage: () => import('../pages/KnowledgeReviewPage').then(module => { markRouteWarm('/manage/knowledge'); return module }),
  FormulaReviewPage: () => import('../pages/FormulaReviewPage').then(module => { markRouteWarm('/manage/formula-review'); return module }),
  SourcesPage: () => import('../pages/SourcesPage').then(module => { markRouteWarm('/manage/sources'); return module }),
  StatsPage: () => import('../pages/StatsPage').then(module => { markRouteWarm('/manage/stats'); return module }),
  DataMaintenancePage: () => import('../pages/DataMaintenancePage').then(module => { markRouteWarm('/manage'); return module }),
  SettingsPage: () => import('../pages/SettingsPage').then(module => { markRouteWarm('/settings'); return module }),
  LoginPage: () => import('../pages/LoginPage').then(module => { markRouteWarm('/login'); return module }),
}
export type DeferredPage = keyof typeof loaders
export function loadPage(name: DeferredPage) { return loaders[name]() }
