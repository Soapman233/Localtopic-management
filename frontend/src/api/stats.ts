/** 统计域 API（架构设计 §3.4 #2 / #45，PRD P1-8）。
 *
 * ``/api/stats`` 聚合 ``bank.query.stats`` + ``bank.answers.coverage`` +
 * ``bank.enrich.coverage`` + ``bank.labels.status_counts`` + 待复核队列计数。
 */
import { api } from './client'
import type { CoverageSummary, StatsData } from './types'

/** ``GET /api/stats``：题库统计总览。 */
export function getStats(): Promise<StatsData> {
  return api.get<StatsData>('/api/stats')
}

/** ``GET /api/meta/coverage``：覆盖率（P0-13 数据状态可见性）。 */
export function getMetaCoverage(): Promise<CoverageSummary> {
  return api.get<CoverageSummary>('/api/meta/coverage')
}
