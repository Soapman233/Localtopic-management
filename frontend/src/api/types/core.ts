/** 题库核心类型（题 / 公式 / 图片 / 标签 / 检索 / 版本）——R2 从 `api/types.ts` 按职责拆分。
 *
 * 对外仍经 `api/types.ts` 统一 re-export，导入路径不变。
 */

export interface ApiEnvelope<T> {
  code: number
  data: T
  message: string
}

export interface HealthData {
  ok: boolean
  db: string
  db_exists: boolean
  schema_version: number | null
  degraded: boolean
  messages: string[]
}

export interface Formula {
  id?: number
  fid: string
  seq?: number
  kind?: string | null
  status?: string | null
  latex?: string | null
  progid?: string | null
  part?: string | null
  preview?: string | null
  needs_review?: number
}

export interface ImageRef {
  id?: number
  media_path?: string | null
  sha256?: string | null
  /** export-data 直接提供媒体直链与原始尺寸，null 表示源图不可定位。 */
  url?: string | null
  width?: number | null
  height?: number | null
}

export interface LabelRef {
  namespace: string
  name: string
  review_status?: string
  source?: string | null
}

export interface QuestionVersionRow {
  version: number
  content_hash: string
  char_length: number
  change_source?: string | null
  note?: string | null
  created_at?: string | null
}

export interface Question {
  id: number
  source_id: number
  number: string
  label?: string | null
  text: string
  plain_text?: string
  section?: string | null
  chapter?: string | null
  qtype?: string | null
  difficulty?: string
  char_length?: number
  version: number
  answer?: string | null
  analysis?: string | null
  answer_source?: string | null
  formulas?: Formula[]
  images?: ImageRef[]
  labels?: LabelRef[]
  versions?: QuestionVersionRow[]
  // 来源字段：`GET /api/questions/{id}` 以 `src_*` 前缀下发（实测确认，非 file_name/grade/...）。
  src_file?: string | null
  src_stage?: string | null
  src_subject?: string | null
  src_grade?: string | null
  src_textbook?: string | null
  chapter_source?: string | null
  content_hash?: string
  sub_question_count?: number
  created_at?: string | null
  updated_at?: string | null
}

/** 检索结果条目：``bank.query.search_full`` 的 ``_ITEM_COLUMNS`` 子集（**不含** ``text``，含 ``plain_text``）。
 *
 * 说明：``has_answer`` / ``has_analysis`` 由后端服务层下发（已实现，供结果卡渲染徽章，见 QuestionCard）；
 * ``needs_review`` 通过当前页批量查询下发，不额外读取题目详情；
 * 前端在 ``has_answer`` / ``has_analysis`` 缺失时按 ``answer`` / ``analysis`` 字段兜底推断。
 */
export interface SearchItem {
  id: number
  source_id: number
  number: string
  label?: string | null
  section?: string | null
  chapter?: string | null
  qtype?: string | null
  difficulty?: string | null
  char_length?: number | null
  version: number
  sub_question_count?: number | null
  plain_text?: string | null
  stage?: string | null
  subject?: string | null
  grade?: string | null
  textbook?: string | null
  file_name?: string | null
  has_answer?: boolean
  has_analysis?: boolean
  needs_review?: boolean
  answer?: string | null
  analysis?: string | null
}

export interface SearchResult {
  total: number
  items: SearchItem[]
  limit: number
  offset: number
  /** 选定具体年级后，符合其余全部条件但年级未标注的题量。 */
  grade_gap?: { selected_grade: string; count: number } | null
}

export interface FacetBucket {
  key: string
  count: number
}

export interface FacetDimension {
  items: FacetBucket[]
  missing: number
}

export interface CoverageBucket {
  n: number
  total: number
  pct: number
}

export interface CoverageSummary {
  source_files_total: number
  questions_total: number
  grade: CoverageBucket
  textbook: CoverageBucket
  chapter: CoverageBucket
  qtype: CoverageBucket
  difficulty: CoverageBucket
  knowledge: CoverageBucket
  answer: CoverageBucket
  analysis: CoverageBucket
  review_open: number
  label_status?: Record<string, number>
}

export interface Facets {
  [dimension: string]: FacetDimension | CoverageSummary | Record<string, number>
}

/** ``GET /api/search/facets`` 响应（架构设计 §3.4 #4）。 */
export interface FacetsData {
  /** 各维度取值分布（含「待补充」missing 桶）。 */
  dimensions: Record<string, FacetDimension>
  /** 有/无答案计数（键为「有答案」「无答案」）。 */
  has_answer?: Record<string, number> | null
  /** 有/无解析计数（键为「有解析」「无解析」）。 */
  has_analysis?: Record<string, number> | null
  /** 待复核公式题数（键为「待复核」）。 */
  needs_review?: Record<string, number> | null
  coverage: CoverageSummary
}

/** 版本快照正文（``GET /api/questions/{id}/versions/{version}`` 的 ``data.snapshot``）。
 *
 * 实测：该端点把完整快照放在**嵌套的 ``snapshot``** 字段里（题干 ``text``/``plain_text``
 * 同时也在顶层），答案/解析/公式/图片/标签都在 ``snapshot`` 内。
 */
export interface VersionSnapshotBody {
  question_id?: number
  version?: number
  number?: string | null
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

/** 版本快照响应（``GET /api/questions/{id}/versions/{version}`` 的 data）。 */
export interface VersionSnapshot {
  question_id: number
  version: number
  content_hash?: string
  char_length?: number
  text?: string
  plain_text?: string
  /** 嵌套完整快照（答案/解析/公式/图片/标签在其中）；未留版时为 ``null``。 */
  snapshot?: VersionSnapshotBody | null
  change_source?: string | null
  note?: string | null
  created_at?: string | null
}
