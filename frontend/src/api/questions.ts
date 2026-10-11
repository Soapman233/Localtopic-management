/** 题目域 API（架构设计 §3.4 #5–#11）。 */
import { api } from './client'
import type { Question, QuestionVersionRow, VersionSnapshot } from './types'

/** 题目编辑补丁（与 `bank.edit.save_question` 的 patch 对齐）。 */
export interface QuestionPatchBody {
  text?: string
  answer?: string
  analysis?: string
  qtype?: string
  chapter?: string
  difficulty?: string
  /** 仅支持编辑**现有**公式（按 fid 定位，不支持新增/删除公式行）。 */
  formulas?: { fid: string; latex?: string }[]
  /** 知识点标签名列表（全量覆盖语义）。 */
  labels?: string[]
}

/** ``PUT /api/questions/{id}`` 响应。 */
export interface SaveQuestionResult {
  question: Question
  version: number
  warnings: string[]
}

/** ``GET /api/questions/{id}``：单题详情。 */
export function getQuestion(id: number): Promise<Question> {
  return api.get<Question>(`/api/questions/${id}`)
}

/** ``PUT /api/questions/{id}``：保存编辑（留版 / 冲突 / FTS 一致由后端保证）。 */
export function updateQuestion(
  id: number,
  patch: QuestionPatchBody,
  force = false,
): Promise<SaveQuestionResult> {
  return api.put<SaveQuestionResult>(`/api/questions/${id}`, { patch, force })
}

/** ``GET /api/questions/{id}/versions``：版本历史（只读）。 */
export function getVersions(id: number): Promise<QuestionVersionRow[]> {
  return api.get<QuestionVersionRow[]>(`/api/questions/${id}/versions`)
}

/** ``GET /api/questions/{id}/versions/{version}``：某一版完整快照（只读）。 */
export function getVersion(id: number, version: number): Promise<VersionSnapshot> {
  return api.get<VersionSnapshot>(`/api/questions/${id}/versions/${version}`)
}

/** ``POST /api/questions/{id}/difficulty``：单题难度标注（易/中/难）。 */
export function setDifficulty(id: number, level: string): Promise<{ question: Question }> {
  return api.post<{ question: Question }>(`/api/questions/${id}/difficulty`, { level })
}

/** ``POST /api/questions/difficulty/batch``：批量难度标注。 */
export function batchSetDifficulty(
  ids: number[],
  level: string,
): Promise<{ updated: number; missing: number[] }> {
  return api.post<{ updated: number; missing: number[] }>('/api/questions/difficulty/batch', {
    ids,
    level,
  })
}

/** 图片直链（只读；从源 DOCX 包内按 sha256 取出）。 */
export function mediaUrl(questionId: number, imageId: number | string): string {
  return `/api/questions/${questionId}/media/${imageId}`
}
