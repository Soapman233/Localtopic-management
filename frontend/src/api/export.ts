/** 预览 / 导出 / 作业 API（架构设计 §3.4 #27–#31）。 */
import { api, buildQuery } from './client'
import type {
  ExportPayload,
  JobInfo,
  PreviewResponse,
} from './types'

export interface PreviewRequest {
  answer_mode?: string
  template?: string
}

export interface ExportRequest {
  answer_mode?: string
  template?: string
  formats: string[]
  out_dir?: string
}

/** ``GET /api/papers/{id}/export-data``：导出数据（预览与导出共用，基于快照）。 */
export function getExportData(paperId: number, answerMode?: string, template?: string): Promise<ExportPayload> {
  return api.get<ExportPayload>(
    `/api/papers/${paperId}/export-data${buildQuery({ answer_mode: answerMode, template })}`,
  )
}

/** ``POST /api/papers/{id}/preview``：请求像素级预览（命中缓存直接返回 pages）。 */
export function startPreview(paperId: number, body: PreviewRequest): Promise<PreviewResponse> {
  return api.post<PreviewResponse>(`/api/papers/${paperId}/preview`, body)
}

/** ``POST /api/papers/{id}/export``：提交导出作业，返回 job_id。 */
export function startExport(paperId: number, body: ExportRequest): Promise<{ job_id: string }> {
  return api.post<{ job_id: string }>(`/api/papers/${paperId}/export`, body)
}

/** ``GET /api/jobs/{job_id}``：查询作业状态。 */
export function getJob(jobId: string): Promise<JobInfo> {
  return api.get<JobInfo>(`/api/jobs/${jobId}`)
}

/** ``GET /api/preview/{key}/page_{n}.png``：预览页 PNG 直链。 */
export function previewPageUrl(key: string, n: number): string {
  return `/api/preview/${key}/page_${n}.png`
}
