/** 待复核公式队列域 API（架构设计 §3.4 #38–#40，PRD P0-15 / P1-12）。
 *
 * 复用 ``bank.query.list_review``（列表）与 ``bank.review``（summary / resolve）。
 */
import { api, buildQuery } from './client'
import type { ReviewListResponse, ReviewQueueSummary, ReviewResolveResult } from './types'

export interface ListReviewParams {
  /** ``false``（默认）= 未处理队列；``true`` = 已处理。 */
  resolved?: boolean
  /** 按状态过滤（``UNSUPPORTED`` / ``EMPTY`` / ``FAIL``）。 */
  status?: string
  limit?: number
  offset?: number
}

/** ``GET /api/review``：待复核队列列表（分页）。 */
export function listReview(params: ListReviewParams = {}): Promise<ReviewListResponse> {
  return api.get<ReviewListResponse>(`/api/review${buildQuery(params as Record<string, unknown>)}`)
}

/** ``GET /api/review/summary``：队列汇总（open / resolved / by_status）。 */
export function getReviewQueueSummary(): Promise<ReviewQueueSummary> {
  return api.get<ReviewQueueSummary>('/api/review/summary')
}

/** ``POST /api/review/{rq_id}/resolve``：标记已处理（``resolved=true``）或恢复。 */
export function resolveReview(rqId: number, resolved = true): Promise<ReviewResolveResult> {
  return api.post<ReviewResolveResult>(`/api/review/${rqId}/resolve`, { resolved })
}
