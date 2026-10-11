/** 来源文件域 API（架构设计 §3.4 #41–#44，PRD P1-7 / P2-3）。
 *
 * 复用 ``bank.query.list_sources`` / ``source_detail`` 与 ``bank.edit.update_file_metadata``。
 *
 * 关键产品约束（PRD 3.2 / Q3）：年级、教材是**文件级**字段——改一题 = 改该来源文件下
 * **全部题**。故编辑前必须经 ``getSourceImpact`` 预检影响题数并二次确认；后端对未确认的
 * 写入返回 **40903**。
 */
import { api, buildQuery } from './client'
import type { SourceDetail, SourceImpact, SourceMetadataResult, SourceRow } from './types'

/** ``GET /api/sources``：来源文件列表（按题量倒序）。 */
export function listSources(limit = 0): Promise<SourceRow[]> {
  return api.get<SourceRow[]>(`/api/sources${buildQuery({ limit: limit || undefined })}`)
}

/** ``GET /api/sources/{id}``：来源文件详情（含覆盖率与题目 id 预览）。 */
export function getSource(id: number): Promise<SourceDetail> {
  return api.get<SourceDetail>(`/api/sources/${id}`)
}

/** ``GET /api/sources/{id}/impact``：预检文件级字段编辑的影响题数。 */
export function getSourceImpact(id: number, field: 'grade' | 'textbook'): Promise<SourceImpact> {
  return api.get<SourceImpact>(`/api/sources/${id}/impact${buildQuery({ field })}`)
}

export interface SourceMetadataBody {
  grade?: string
  textbook?: string
  /** 文件级写入必须显式 ``confirm=true``（否则后端返回 40903）。 */
  confirm: boolean
}

/** ``POST /api/sources/{id}/metadata``：编辑文件级年级/教材。 */
export function updateSourceMetadata(
  id: number,
  body: SourceMetadataBody,
): Promise<SourceMetadataResult> {
  return api.post<SourceMetadataResult>(`/api/sources/${id}/metadata`, body)
}
