/** 试卷域 API（架构设计 §3.4 #12–#26）。
 *
 * 关键约定（架构设计 §8.7 / §10）：所有组卷写操作**由后端返回整卷**，
 * 前端**不做乐观累加**——每次操作后以返回的 `paper` 为准（或失效重取）。
 */
import { api, buildQuery } from './client'
import type { Paper, PaperRevisionResult } from './types'

export interface PaperCreateBody {
  title: string
  subject?: string
  stage?: string
  grade?: string
  template?: string
  answer_mode?: string
  status?: string
}

export interface PaperPatchBody {
  title?: string
  template?: string
  answer_mode?: string
  status?: string
  subject?: string
  stage?: string
  grade?: string
}

export interface AddQuestionsBody {
  question_ids: number[]
  /** 归入大题（id 或名称；新名自动创建）。 */
  section?: string | number | null
  section_id?: number | null
  /** 插入的全卷题序（1 起）；省略则追加。 */
  position?: number | null
  score?: number | null
}

/** ``GET /api/papers``：试卷列表（含题数/总分/未设分题数）。 */
export function listPapers(params: { status?: string; subject?: string } = {}): Promise<Paper[]> {
  return api.get<Paper[]>(`/api/papers${buildQuery(params as Record<string, unknown>)}`)
}

/** ``POST /api/papers``：新建试卷。 */
export function createPaper(body: PaperCreateBody): Promise<Paper> {
  return api.post<Paper>('/api/papers', body)
}

/** ``GET /api/papers/{id}``：整卷（元数据 + 大题 + 条目 + 概览）。 */
export function getPaper(id: number): Promise<Paper> {
  return api.get<Paper>(`/api/papers/${id}`)
}

/** ``PATCH /api/papers/{id}``：改试卷元数据。 */
export function patchPaper(id: number, body: PaperPatchBody): Promise<Paper> {
  return api.patch<Paper>(`/api/papers/${id}`, body)
}

/** ``DELETE /api/papers/{id}``：删除试卷（非空需 force）。 */
export function deletePaper(
  id: number,
  force = false,
): Promise<{ deleted: boolean; removed_items: number }> {
  return api.del<{ deleted: boolean; removed_items: number }>(
    `/api/papers/${id}${buildQuery({ force })}`,
  )
}

/** ``POST /api/papers/{id}/questions``：加题（返回整卷）。 */
export function addQuestions(id: number, body: AddQuestionsBody): Promise<Paper> {
  return api.post<Paper>(`/api/papers/${id}/questions`, body)
}

/** ``DELETE /api/papers/{id}/questions/{item_id}``：移除条目（返回整卷）。 */
export function removeQuestion(paperId: number, itemId: number): Promise<Paper> {
  return api.del<Paper>(`/api/papers/${paperId}/questions/${itemId}`)
}

/** ``POST /api/papers/{id}/questions/{item_id}/move``：移动条目到指定题序（返回整卷）。 */
export function moveQuestion(paperId: number, itemId: number, position: number): Promise<Paper> {
  return api.post<Paper>(`/api/papers/${paperId}/questions/${itemId}/move`, { position })
}

/** ``POST /api/papers/{id}/questions/{item_id}/score``：设分值（null=清除，返回整卷）。 */
export function setScore(paperId: number, itemId: number, score: number | null): Promise<Paper> {
  return api.post<Paper>(`/api/papers/${paperId}/questions/${itemId}/score`, { score })
}

/** ``POST /api/papers/{id}/scores``：批量设分值。 */
export function setScores(
  paperId: number,
  mapping: Record<number, number | null>,
): Promise<{ updated: number; missing: number[] }> {
  return api.post<{ updated: number; missing: number[] }>(`/api/papers/${paperId}/scores`, {
    mapping,
  })
}

/** ``POST /api/papers/{id}/sections``：新增大题（返回整卷）。 */
export function addSection(
  paperId: number,
  body: { name: string; position?: number; description?: string },
): Promise<Paper> {
  return api.post<Paper>(`/api/papers/${paperId}/sections`, body)
}

/** ``PATCH /api/papers/{id}/sections/{sid}``：重命名大题（返回整卷）。 */
export function renameSection(paperId: number, sectionId: number, name: string): Promise<Paper> {
  return api.patch<Paper>(`/api/papers/${paperId}/sections/${sectionId}`, { name })
}

/** ``POST /api/papers/{id}/sections/{sid}/move``：移动大题（返回整卷）。 */
export function moveSection(paperId: number, sectionId: number, position: number): Promise<Paper> {
  return api.post<Paper>(`/api/papers/${paperId}/sections/${sectionId}/move`, { position })
}

/** ``DELETE /api/papers/{id}/sections/{sid}``：删除大题（非空需 force）。 */
export function deleteSection(
  paperId: number,
  sectionId: number,
  force = false,
): Promise<{ deleted: boolean; ungrouped: number }> {
  return api.del<{ deleted: boolean; ungrouped: number }>(
    `/api/papers/${paperId}/sections/${sectionId}${buildQuery({ force })}`,
  )
}

/** ``POST /api/papers/{id}/refresh-snapshots``：按卷刷新快照（不隐式全库）。 */
export function refreshSnapshots(
  paperId: number,
): Promise<{ refreshed: number; skipped_version_changed: number }> {
  return api.post<{ refreshed: number; skipped_version_changed: number }>(
    `/api/papers/${paperId}/refresh-snapshots`,
    {},
  )
}

/** 显式复制锁定快照到修订卷，原卷保持不动。 */
export function createRevision(paperId: number, body: { title?: string; exclude_item_ids: number[]; diagnostic_digest: string; confirm: boolean }): Promise<PaperRevisionResult> {
  return api.post<PaperRevisionResult>(`/api/papers/${paperId}/revisions`, body)
}
