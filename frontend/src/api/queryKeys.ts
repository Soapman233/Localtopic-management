/** react-query 的 **queryKey 工厂**：全部键的唯一来源。
 *
 * 背景（前端重构方案 §4.2.3）
 * -------------------------
 * queryKey 此前分散在各页面/组件内联书写（如 `['paper', id]`），
 * mutation 失效时靠手写字符串（如 `invalidateQueries({ queryKey: ['papers'] })`）。
 * 一处新增键、一处改前缀，就可能导致**该刷新的没刷新**。
 * 本模块把键集中定义，失效统一走工厂方法。
 *
 * 用法
 * ----
 * ```ts
 * // 查询
 * useQuery({ queryKey: qk.paper(id), queryFn: ... })
 * // 失效（传前缀即可命中该域全部查询）
 * qc.invalidateQueries({ queryKey: qk.papers() })
 * qc.invalidateQueries({ queryKey: qk.exportDataRoot() })
 * ```
 */
import type { SearchParams } from './search'

/** 键前缀常量（避免手写字符串拼错）。 */
export const ROOT = {
  health: 'health',
  settings: 'settings',
  authMe: 'auth-me',
  search: 'search',
  facets: 'facets',
  coverage: 'coverage',
  question: 'question',
  questionVersion: 'question-version',
  paper: 'paper',
  papers: 'papers',
  exportData: 'export-data',
  job: 'job',
  labels: 'labels',
  review: 'review',
  sources: 'sources',
  source: 'source',
  stats: 'stats',
  importStatus: 'import-status',
  networkStatus: 'network-status',
} as const

export const qk = {
  // ---- 全局 ----
  health: () => [ROOT.health] as const,
  settings: () => [ROOT.settings] as const,
  /** 当前鉴权状态与用户（阶段 4）。 */
  authMe: () => [ROOT.authMe] as const,

  // ---- 检索 ----
  search: (params: SearchParams) => [ROOT.search, params] as const,
  facets: (params: SearchParams) => [ROOT.facets, params] as const,
  coverage: () => [ROOT.coverage] as const,
  /** 检索域前缀（失效全部检索查询）。 */
  searchRoot: () => [ROOT.search] as const,
  /** 筛选域前缀。 */
  facetsRoot: () => [ROOT.facets] as const,

  // ---- 题目 ----
  question: (id: number) => [ROOT.question, id] as const,
  questionRoot: () => [ROOT.question] as const,
  questionVersion: (questionId: number, version: number) =>
    [ROOT.questionVersion, questionId, version] as const,

  // ---- 试卷 / 组卷 ----
  paper: (id: number | null) => [ROOT.paper, id] as const,
  paperRoot: () => [ROOT.paper] as const,
  papers: () => [ROOT.papers] as const,
  /** 导出数据域根前缀（失效整域）。 */
  exportDataRoot: () => [ROOT.exportData] as const,
  /** 某一试卷的导出数据前缀（失效该卷全部模式/模板组合）。 */
  exportDataForPaper: (paperId: number) => [ROOT.exportData, paperId] as const,
  exportData: (paperId: number | null, answerMode: string | null | undefined, template: string | null | undefined) =>
    [ROOT.exportData, paperId, answerMode, template] as const,

  // ---- 异步作业 ----
  job: (jobId: string | null) => [ROOT.job, jobId] as const,

  // ---- 治理：知识点 ----
  labelsRoot: () => [ROOT.labels] as const,
  labelsSummary: () => [ROOT.labels, 'summary'] as const,
  labelsItems: (selected: string | null | undefined, status: string, page: number) =>
    [ROOT.labels, 'items', selected, status, page] as const,

  // ---- 治理：待复核公式 ----
  reviewRoot: () => [ROOT.review] as const,
  reviewSummary: () => [ROOT.review, 'summary'] as const,
  reviewList: (tab: string, showResolved: boolean, page: number) =>
    [ROOT.review, 'list', tab, showResolved, page] as const,

  // ---- 治理：来源文件 ----
  sources: () => [ROOT.sources] as const,
  source: (id: number | null) => [ROOT.source, id] as const,

  // ---- 统计 ----
  stats: () => [ROOT.stats] as const,

  // ---- 导入（Phase 2.3）----
  /** ``GET /api/import/status``：导入功能开关与限制。 */
  importStatus: () => [ROOT.importStatus] as const,

  // ---- 局域网访问（方案 A）----
  /** ``GET /api/network/status``：局域网状态（不含令牌）。 */
  networkStatus: () => [ROOT.networkStatus] as const,
} as const

export type QueryKeyFactory = typeof qk
