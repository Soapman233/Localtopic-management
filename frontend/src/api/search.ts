/** 检索域 API（架构设计 §3.4 #2/#3/#4）。
 *
 * 约定：所有查询参数 `snake_case`，与后端 `bank.query.search` 一致；
 * 空串/undefined 由 `buildQuery` 自动剔除。
 */
import { api, buildQuery } from './client'
import type { CoverageSummary, FacetsData, SearchResult } from './types'

export interface SearchParams {
  keyword?: string
  stage?: string
  subject?: string
  grade?: string
  textbook?: string
  chapter?: string
  qtype?: string
  difficulty?: string
  section?: string
  has_answer?: boolean
  has_analysis?: boolean
  needs_review?: boolean
  /** 「仅看已确认知识点」严格模式（默认关闭）。 */
  kp_confirmed_only?: boolean
  /**
   * 「待补充」桶筛选（PRD 5.1）：命中该维度**缺失元数据**（NULL/空）的题。
   *
   * 联调实测：后端 `/api/search` **已支持**该组参数（`grade_missing=true` → 6,549 题），
   * 命名约定为 `<维度>_missing=true`。
   */
  grade_missing?: boolean
  textbook_missing?: boolean
  chapter_missing?: boolean
  qtype_missing?: boolean
  difficulty_missing?: boolean
  limit?: number
  offset?: number
}

/** ``GET /api/search``：关键词 + 筛选条件检索（分页）。 */
export function searchQuestions(params: SearchParams): Promise<SearchResult> {
  return api.get<SearchResult>(`/api/search${buildQuery(params as Record<string, unknown>)}`)
}

/** ``GET /api/search/facets``：筛选栏计数 + 「待补充」桶 + 覆盖率。 */
export function getFacets(params: SearchParams): Promise<FacetsData> {
  return api.get<FacetsData>(`/api/search/facets${buildQuery(params as Record<string, unknown>)}`)
}

/** ``GET /api/meta/coverage``：全局覆盖率（P0-13 数据状态可见性）。 */
export function getCoverage(): Promise<CoverageSummary> {
  return api.get<CoverageSummary>('/api/meta/coverage')
}
