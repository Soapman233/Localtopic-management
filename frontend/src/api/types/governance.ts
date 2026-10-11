/** 治理与设置类型（知识点复核 / 公式复核 / 来源文件 / 统计 / 设置）——R2 从 `api/types.ts` 拆分。
 *
 * 对外仍经 `api/types.ts` 统一 re-export，导入路径不变。
 */
import type { CoverageBucket, CoverageSummary } from './core'

/** 难度三档（与 bank.edit.DIFFICULTIES 一致）。 */
export const DIFFICULTIES = ['易', '中', '难'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

// ---------------------------------------------------------------------------
// T05 治理与设置：知识点复核（P0-14）
// ---------------------------------------------------------------------------

/** 按标签汇总的一行（``bank.labels.review_summary``）。 */
export interface LabelSummaryRow {
  label_id: number
  label_name: string
  total: number
  pending: number
  confirmed: number
  rejected: number
}

/** ``GET /api/labels/review-summary`` 响应。 */
export interface LabelSummaryResponse {
  summary: LabelSummaryRow[]
  /** 状态计数（键为「待复核」「已确认」「已否决」）。 */
  counts: Record<string, number>
  namespace: string
  status: string | null
}

/** 某标签下的逐条复核项（``bank.labels.review_items``）。 */
export interface LabelReviewItem {
  question_id: number
  number: string | null
  snippet: string
  source: string | null
  review_status: string
}

/** ``GET /api/labels/review-items`` 响应。 */
export interface LabelReviewItemsResponse {
  total: number
  items: LabelReviewItem[]
  limit: number
  offset: number
  label_id: number
  label_name: string
  status: string | null
}

/** ``POST /api/labels/decision/preview`` 响应（只读影响预检）。 */
export interface LabelDecisionPreview {
  found: boolean
  label_id: number | null
  label_name: string
  decision: string
  matched: number
  pending: number
  /** 实际会被改动的条数（= ``pending``）。 */
  will_update: number
  question_id: number | null
}

/** ``POST /api/labels/decision`` 响应。 */
export interface LabelDecisionResult {
  label_id: number | null
  label_name: string
  decision: string
  updated: number
  matched: number
  already_decided: number
}

/** ``POST /api/labels/import-review`` 响应。 */
export interface LabelImportResult {
  total: number
  applied: number
  skipped: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// T05 治理与设置：待复核公式队列（P0-15 / P1-12）
// ---------------------------------------------------------------------------

/** 待复核队列项（``bank.query.list_review``）。 */
export interface ReviewItem {
  id: number
  formula_id: number | null
  question_id: number | null
  status: string | null
  kind: string | null
  progid: string | null
  part: string | null
  /** 源 DOCX 包内的预览媒体路径（如 ``media/image17.wmf``）。 */
  preview: string | null
  reason: string | null
  resolved: number
  number: string | null
  section: string | null
  chapter: string | null
  file_name: string | null
  question_text?: string | null
  fid?: string | null
  latex?: string | null
  preview_url?: string | null
}

/** ``GET /api/review`` 响应。 */
export interface ReviewListResponse {
  total: number
  items: ReviewItem[]
  limit: number
  offset: number
}

/** ``GET /api/review/summary`` 响应（``bank.review.summary``）。 */
export interface ReviewQueueSummary {
  open: number
  resolved: number
  total: number
  /** 未处理项按 status 的计数（如 ``{UNSUPPORTED, EMPTY, FAIL}``）。 */
  by_status: Record<string, number>
}

/** ``POST /api/review/{rq_id}/resolve`` 响应。 */
export interface ReviewResolveResult {
  rq_id: number
  question_id: number | null
  resolved: boolean
}

// ---------------------------------------------------------------------------
// T05 治理与设置：来源文件管理（P1-7 / P2-3）
// ---------------------------------------------------------------------------

/** ``GET /api/sources`` 列表行（``bank.query.list_sources``）。 */
export interface SourceRow {
  id: number
  file_name: string
  stage: string | null
  grade: string | null
  subject: string | null
  textbook: string | null
  chapter: string | null
  questions_count: number
  formulas_count: number
}

/** ``source_files`` 行（详情内 ``source`` 字段）。 */
export interface SourceFileMeta {
  id: number
  path?: string | null
  sha256?: string | null
  file_name: string
  stage?: string | null
  grade?: string | null
  subject?: string | null
  textbook?: string | null
  chapter?: string | null
  questions_count?: number | null
  formulas_count?: number | null
  imported_at?: string | null
  /** 年级 provenance：``manual`` 表示人工回填（P2-3）。 */
  grade_source?: string | null
  textbook_source?: string | null
}

/** ``GET /api/sources/{id}`` 响应（``bank.query.source_detail``）。 */
export interface SourceDetail {
  source: SourceFileMeta
  questions_count: number
  formulas_count: number
  /** 该来源内的覆盖率（chapter/qtype/answer）。 */
  coverage: Record<string, CoverageBucket>
  question_ids_preview: number[]
}

/** ``GET /api/sources/{id}/impact`` 响应（文件级字段编辑影响预检）。 */
export interface SourceImpact {
  field: string
  affected_questions: number
}

/** ``POST /api/sources/{id}/metadata`` 响应。 */
export interface SourceMetadataResult {
  source: SourceFileMeta
  affected_questions: number
  confirmed?: boolean
}

// ---------------------------------------------------------------------------
// T05 治理与设置：题库统计（P1-8）
// ---------------------------------------------------------------------------

/** 分布计数行（``bank.query._count_by``）。 */
export interface CountRow {
  key: string | null
  count: number
}

/** 公式状态分布行。 */
export interface FormulaStatusRow {
  status: string | null
  count: number
}

/** 答案覆盖（``bank.answers.coverage``）。 */
export interface AnswerCoverage {
  total: number
  with_answer: number
  with_analysis: number
  by_source: Record<string, number>
}

/** ``GET /api/stats`` 响应（query.stats + answers/enrich/labels/review 聚合）。 */
export interface StatsData {
  sources: number
  questions: number
  formulas: number
  formulas_ok: number
  images: number
  labels: number
  review_open: number
  review_resolved: number
  formula_status: FormulaStatusRow[]
  by_stage: CountRow[]
  by_subject: CountRow[]
  by_grade: CountRow[]
  by_textbook: CountRow[]
  by_qtype: CountRow[]
  top_chapters: CountRow[]
  answer_coverage: AnswerCoverage
  enrich_coverage: CoverageSummary
  label_status: Record<string, number>
  review: ReviewQueueSummary
}

// ---------------------------------------------------------------------------
// T05 治理与设置：系统设置（P1-9）
// ---------------------------------------------------------------------------

/** ``GET/PUT /api/settings`` 响应（``webui.config``）。 */
export interface SettingsData {
  db_path: string
  export_dir: string
  default_template: string
  katex: { throw_on_error?: boolean; strict?: boolean; [key: string]: unknown }
  theme: { primary?: string; dark?: boolean; [key: string]: unknown }
}

/** 试卷模板取值（与 webui.config.TEMPLATES 一致）。 */
export const TEMPLATES = ['考试', '测验', '作业'] as const
export type Template = (typeof TEMPLATES)[number]

/** 知识点复核状态取值（与 bank.labels 一致）。 */
export const REVIEW_STATUSES = ['待复核', '已确认', '已否决'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
