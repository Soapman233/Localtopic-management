/** 组卷 / 导出 / 预览作业类型——R2 从 `api/types.ts` 按职责拆分。
 *
 * 对外仍经 `api/types.ts` 统一 re-export，导入路径不变。
 */
import type { Formula, ImageRef, LabelRef } from './core'

/** 试卷元数据（``papers`` 行）。 */
export interface PaperMeta {
  id: number
  title: string
  subject?: string | null
  stage?: string | null
  grade?: string | null
  template: string
  answer_mode: string
  status: string
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
  meta?: Record<string, unknown> | null
}

/** 大题（``paper_sections`` 行 + 小计）。 */
export interface PaperSection {
  id: number
  paper_id: number
  name: string
  seq: number
  description?: string | null
  item_count: number
  subtotal: number
  unscored_count: number
}

/** 条目快照（``paper_questions.snapshot_json``）。 */
export interface PaperItemSnapshot {
  question_id?: number
  version?: number
  number?: string | null
  label?: string | null
  qtype?: string | null
  difficulty?: string | null
  section?: string | null
  chapter?: string | null
  content_hash?: string
  char_length?: number
  text?: string
  plain_text?: string
  answer?: string | null
  analysis?: string | null
  answer_source?: string | null
  formulas?: Formula[]
  images?: ImageRef[]
  labels?: LabelRef[]
  source?: Record<string, unknown>
}

/** 试卷条目（``paper_questions`` 行 + 展开的展示字段）。 */
export interface PaperItem {
  id: number
  paper_id: number
  section_id: number | null
  question_id: number
  question_version: number
  seq: number
  score: number | null
  snapshot: PaperItemSnapshot
  number?: string | null
  qtype?: string | null
  difficulty?: string | null
  chapter?: string | null
  source_section?: string | null
  source_file?: string | null
  stage?: string | null
  subject?: string | null
  grade?: string | null
  textbook?: string | null
  char_length?: number | null
  formula_count?: number
  image_count?: number
  has_answer?: boolean
  has_analysis?: boolean
  answer_source?: string | null
  /** 快照版本是否落后于题库当前版本（后端 ``GET /api/papers/{id}`` 已下发该布尔标志）。 */
  stale?: boolean
}

/** 试卷概览（``bank.paper.paper_summary``）。 */
export interface PaperSummary {
  paper_id: number
  title: string
  subject?: string | null
  stage?: string | null
  grade?: string | null
  template: string
  answer_mode: string
  status: string
  item_count: number
  section_count: number
  total_score: number
  scored_count: number
  unscored_count: number
  score_complete: boolean
  sections: PaperSection[]
  ungrouped?: {
    name: string
    item_count: number
    subtotal: number
    unscored_count: number
  } | null
  qtype_distribution: Record<string, number>
}

/** 试卷完整信息（``bank.paper.get_paper`` + 列表页附加统计字段）。 */
export interface Paper extends PaperMeta {
  sections: PaperSection[]
  items: PaperItem[]
  summary: PaperSummary
  /** 列表接口（``GET /api/papers``）附加字段。 */
  item_count?: number
  section_count?: number
  total_score?: number
  unscored_count?: number
}

/** G1：逐条内容诊断与有序分支实例。 */
export interface ExportIssue {
  kind: 'answer_region_item' | 'source_unavailable' | 'source_changed' | 'snapshot_source_mismatch' | 'image_role_unknown' | 'image_missing' | 'source_heading_residue' | 'duplicate_question' | 'current_version_differs' | 'source_structure_unsupported'
  severity: 'blocker' | 'warning'
  blocked_modes: string[]
  paper_id: number | null
  item_id: number | null
  seq: number | null
  question_id: number
  question_version: number
  summary: string
  message: string
  suggested_action: string
  source: { source_id: number | null; file_name: string | null; expected_sha256: string | null; actual_sha256: string | null; start_scan_index: number | null; end_scan_index: number | null; answer_region_start_scan_index: number | null; body_paragraph_number: number | null }
  instance_id: string | null
}
export type ContentBlock =
  | { kind: 'paragraph'; branch: 'stem' | 'answer' | 'analysis'; text: string }
  | { kind: 'image'; branch: 'stem' | 'answer' | 'analysis'; instance_id: string; media_path: string; sha256: string; scan_index: number | null; body_paragraph_number: number | null; source_width_emu: number | null; source_height_emu: number | null; id: number | null; url: string | null; width: number | null; height: number | null }
export interface ExportDiagnostics {
  diagnostic_digest: string
  export_allowed: boolean
  blocker_count: number
  warning_count: number
  issues: ExportIssue[]
  duplicate_groups: { question_id: number; item_ids: number[]; seqs: number[] }[]
  revision_proposal: { exclude_item_ids: number[]; keep_item_ids: number[]; unresolved_item_ids: number[]; message: string }
}
export interface PaperRevisionResult {
  source_paper_id: number
  paper_id: number
  excluded_item_ids: number[]
  item_mapping: { source_item_id: number; item_id: number; source_seq: number; seq: number }[]
  paper: Paper
  diagnostics: ExportDiagnostics
}

/** ``GET /api/papers/{id}/export-data`` 响应（``build_export_payload``）。 */
export interface ExportQuestion {
  content_status: 'ready' | 'blocked'
  snapshot_digest: string
  evidence_digest: string
  issues: ExportIssue[]
  content_blocks: ContentBlock[]
  item_id: number
  seq: number
  question_id: number
  question_version: number
  number?: string | null
  qtype?: string | null
  difficulty?: string | null
  score: number | null
  text?: string
  plain_text?: string
  formulas?: Formula[]
  latex_list?: (string | null)[]
  images?: ImageRef[]
  image_paths?: (string | null)[]
  answer?: string | null
  analysis?: string | null
  answer_source?: string | null
  show_answer: boolean
  show_analysis: boolean
  source?: Record<string, unknown>
}

export interface ExportSection {
  section_id: number | null
  name: string
  seq: number | null
  description?: string | null
  item_count: number
  subtotal: number
  questions: ExportQuestion[]
}

export interface ExportPayload {
  content_guard_revision: string
  layout_revision: string
  content_digest: string
  diagnostics: ExportDiagnostics
  paper: Record<string, unknown>
  answer_mode: string
  generated_at: string
  summary: PaperSummary
  sections: ExportSection[]
}

// ---------------------------------------------------------------------------
// 预览 / 导出作业（P4）
// ---------------------------------------------------------------------------

/** 预览单页（后端实测：``{n, file, url, width, height}``）。 */
export interface PreviewPage {
  n: number
  url: string
  file?: string
  width?: number
  height?: number
}

/** ``POST /api/papers/{id}/preview`` 响应：未命中缓存返回 ``job_id``，命中返回 ``pages``。 */
export interface PreviewResponse {
  content_digest?: string
  content_guard_revision?: string
  layout_revision?: string
  diagnostics?: ExportDiagnostics
  job_id?: string
  cached?: boolean
  key?: string
  pages?: PreviewPage[]
  page_count?: number
}

/** 导出/预览作业结果（后端实测：预览与导出共用同一结果结构）。
 *
 * 关键字段：``docx`` / ``pdf`` 为产物**绝对路径**；``pages`` 为预览位图；``cached`` 表示命中缓存。
 */
export interface ExportJobResult {
  content_digest?: string
  content_guard_revision?: string
  layout_revision?: string
  diagnostics?: ExportDiagnostics
  key?: string
  paper_id?: number
  title?: string
  template?: string
  answer_mode?: string
  page_count?: number
  pages?: PreviewPage[]
  docx?: string | null
  pdf?: string | null
  docx_size_bytes?: number
  pdf_size_bytes?: number
  formats?: string[]
  question_count?: number
  section_count?: number
  formulas_written?: number
  images_written?: number
  warnings?: string[]
  bridge_errors?: unknown[]
  cached?: boolean
  created_at?: string
  elapsed_ms?: number
}

export interface JobInfo {
  job_id: string
  kind: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress?: number
  result?: unknown
  error?: string | null
  error_code?: number | null
  error_data?: unknown
  created_at?: string
  updated_at?: string
}
