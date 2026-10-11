/** 与后端 `GET /api/papers/{id}/export-data` 对齐的数据类型（探针只读消费）。 */

export interface Formula {
  fid: string
  seq?: number
  kind?: string | null
  status?: string | null
  latex?: string | null
}

export interface ImageRef {
  media_path?: string | null
  sha256?: string | null
  /** 探针离线图片地址（由 tools/dump_export_data.py 写入）。 */
  offline_url?: string
  /** 原始像素宽高（由 dump 脚本从图片头读出，用于预置显示尺寸）。 */
  natural_w?: number
  natural_h?: number
}

export interface ExportQuestion {
  item_id: number
  seq: number
  question_id: number
  question_version?: number
  number?: string | null
  qtype?: string | null
  difficulty?: string | null
  score: number | null
  text: string | null
  plain_text?: string | null
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

export interface PaperMeta {
  id: number
  title: string
  subject?: string | null
  stage?: string | null
  grade?: string | null
  template: string
  answer_mode: string
}

export interface ExportPayload {
  paper: PaperMeta
  answer_mode: string
  generated_at?: string
  summary?: unknown
  sections: ExportSection[]
}

export interface ExportDataBundle {
  student: ExportPayload
  answer: ExportPayload
}
