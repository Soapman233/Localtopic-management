/** 知识点复核域 API（架构设计 §3.4 #32–#37，PRD P0-14）。
 *
 * 复用 ``bank.labels``：按标签汇总、逐条清单、决策影响预检、确认/否决、复核 CSV 导出/导入。
 *
 * 关键约定（PRD Q6 / 架构 §3.4）：
 * - **批量**决策（不带 ``question_id``）必须先经 ``previewDecision`` 预检影响条数，
 *   用户确认后以 ``confirm=true`` 提交；后端对未确认的批量决策返回 **40903**。
 * - ``decision`` 取值可写「确认」/「否决」（后端大小写不敏感归一化）。
 */
import { ApiError, api, buildQuery } from './client'
import type {
  LabelDecisionPreview,
  LabelDecisionResult,
  LabelImportResult,
  LabelReviewItemsResponse,
  LabelSummaryResponse,
} from './types'

export interface ReviewSummaryParams {
  namespace?: string
  status?: string | null
  limit?: number
}

/** ``GET /api/labels/review-summary``：按标签汇总 + 状态计数。 */
export function getReviewSummary(params: ReviewSummaryParams = {}): Promise<LabelSummaryResponse> {
  return api.get<LabelSummaryResponse>(
    `/api/labels/review-summary${buildQuery(params as Record<string, unknown>)}`,
  )
}

export interface ReviewItemsParams {
  label_name: string
  status?: string | null
  namespace?: string
  limit?: number
  offset?: number
}

/** ``GET /api/labels/review-items``：某标签的逐条复核清单（分页）。 */
export function getReviewItems(params: ReviewItemsParams): Promise<LabelReviewItemsResponse> {
  return api.get<LabelReviewItemsResponse>(
    `/api/labels/review-items${buildQuery(params as unknown as Record<string, unknown>)}`,
  )
}

export interface DecisionPreviewBody {
  label_name: string
  /** 「确认」或「否决」。 */
  decision: string
  /** 给定则只统计「该题该标签」一条关联；省略则统计该标签全部待复核。 */
  question_id?: number
}

/** ``POST /api/labels/decision/preview``：**只读**预检一次决策的影响条数（供二次确认）。 */
export function previewDecision(body: DecisionPreviewBody): Promise<LabelDecisionPreview> {
  return api.post<LabelDecisionPreview>('/api/labels/decision/preview', body)
}

export interface DecisionBody {
  label_name: string
  decision: string
  question_id?: number
  /** 批量决策必须显式 ``confirm=true``（否则后端返回 40903）。 */
  confirm?: boolean
  force?: boolean
}

/** ``POST /api/labels/decision``：确认 / 否决。 */
export function decideLabel(body: DecisionBody): Promise<LabelDecisionResult> {
  return api.post<LabelDecisionResult>('/api/labels/decision', body)
}

/** ``GET /api/labels/export-review``：复核清单 CSV 直链（浏览器下载，utf-8-sig）。 */
export function exportReviewUrl(status: string | null = '待复核', namespace = '知识点'): string {
  return `/api/labels/export-review${buildQuery({ status: status ?? undefined, namespace })}`
}

/** ``POST /api/labels/import-review``：导入老师填写的复核 CSV（multipart）。
 *
 * 因需上传文件（``FormData``），不能走 JSON 封装的 ``api.post``，故单独实现并复用
 * :class:`ApiError` 语义（非 0 code 抛错，供页面弹友好提示）。
 */
export async function importReviewCsv(file: File, force = false): Promise<LabelImportResult> {
  const form = new FormData()
  form.append('file', file)
  const url = `/api/labels/import-review${buildQuery({ force: force || undefined })}`

  let resp: Response
  try {
    resp = await fetch(url, { method: 'POST', body: form })
  } catch {
    throw new ApiError('CSV 上传失败，请确认后端已启动', 50001, 0, null)
  }

  const text = await resp.text()
  let envelope: { code?: number; data?: LabelImportResult; message?: string } | null = null
  try {
    envelope = text ? JSON.parse(text) : null
  } catch {
    envelope = null
  }
  if (envelope && typeof envelope.code === 'number') {
    if (envelope.code === 0) {
      return envelope.data as LabelImportResult
    }
    throw new ApiError(envelope.message || 'CSV 导入失败', envelope.code, resp.status, envelope.data)
  }
  if (!resp.ok) {
    throw new ApiError(`HTTP ${resp.status}`, resp.status * 100, resp.status, null)
  }
  throw new ApiError('CSV 导入返回格式异常', 50001, resp.status, null)
}
