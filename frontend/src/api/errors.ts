/** 后端错误码 → 教师可读文案的**唯一来源**。
 *
 * 背景（前端重构方案 §4.2.3）
 * -------------------------
 * 错误码语义此前散落在各页面的 `if (err.code === 40904)` 之类判断中，
 * 一处新增码就容易漏处理。本模块把「码 → 文案 / 分类」收敛到一处。
 *
 * 约定
 * ----
 * 码的前 3 位 = HTTP 状态语义（见后端 `webui/errors.py` 模块注释）：
 * `400xx` 参数校验 / `401xx` 未授权 / `404xx` 资源不存在 / `409xx` 冲突 / `500xx` 内部错误。
 *
 * 注意：后端返回的 `message` 已是中文可读文案，**优先使用它**；
 * 本模块的文案仅在 message 缺失或需要按类别统一措辞时兜底。
 */
import { ApiError } from './client'

/** 后端错误码常量（与 `webui/errors.py` 对齐）。 */
export const ErrorCode = {
  // ---- 400 参数 / 校验 ----
  PlaceholderMissing: 40001,
  InvalidDifficulty: 40002,
  InvalidTemplate: 40003,
  InvalidScore: 40004,
  InvalidCsv: 40005,
  InvalidSettings: 40006,
  InvalidRevision: 40007,
  // ---- 401 未授权（线上部署版鉴权）----
  Unauthorized: 40101,
  // ---- 403 权限不足（线上部署版鉴权：已登录但角色不允许该操作）----
  PermissionDenied: 40301,
  // ---- 404 资源不存在 ----
  QuestionNotFound: 40401,
  PaperNotFound: 40402,
  ItemNotFound: 40403,
  ImageNotFound: 40404,
  JobNotFound: 40405,
  LabelNotFound: 40406,
  ReviewNotFound: 40407,
  SourceNotFound: 40408,
  // ---- 409 冲突 ----
  ContentConflict: 40901,
  NeedForce: 40902,
  NeedConfirm: 40903,
  ExportContentBlocked: 40904,
  ExportEvidenceStale: 40905,
  // ---- 500 内部错误 ----
  Internal: 50001,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 各错误码的兜底文案（后端 message 缺失时使用）。 */
const FALLBACK_MESSAGES: Record<number, string> = {
  [ErrorCode.PlaceholderMissing]: '题目里的公式与题干对不上，请检查该题内容。',
  [ErrorCode.InvalidDifficulty]: '难度取值不合法。',
  [ErrorCode.InvalidTemplate]: '试卷模板或答案模式不合法。',
  [ErrorCode.InvalidScore]: '分值不合法。',
  [ErrorCode.InvalidCsv]: '导入的文件格式不正确，请检查后重试。',
  [ErrorCode.InvalidSettings]: '设置有误，请检查后重试。',
  [ErrorCode.InvalidRevision]: '修订请求不合法。',
  [ErrorCode.Unauthorized]: '未授权：请确认访问权限后重试。',
  [ErrorCode.PermissionDenied]: '你的账号权限不足，不能执行这个操作。如需权限请联系管理员。',
  [ErrorCode.QuestionNotFound]: '题目不存在，可能已被删除。',
  [ErrorCode.PaperNotFound]: '试卷不存在，可能已被删除。',
  [ErrorCode.ItemNotFound]: '试卷中的这道题不存在。',
  [ErrorCode.ImageNotFound]: '题目配图缺失。',
  [ErrorCode.JobNotFound]: '任务不存在或已结束。',
  [ErrorCode.LabelNotFound]: '知识点标签不存在。',
  [ErrorCode.ReviewNotFound]: '待复核项不存在。',
  [ErrorCode.SourceNotFound]: '来源文件不存在。',
  [ErrorCode.ContentConflict]: '内容重复，已存在相同内容。',
  [ErrorCode.NeedForce]: '该操作需要确认后才能执行。',
  [ErrorCode.NeedConfirm]: '该操作影响多条内容，需要先确认。',
  [ErrorCode.ExportContentBlocked]: '导出前还有内容问题需要处理。',
  [ErrorCode.ExportEvidenceStale]: '预览已过期，请重新预览后再导出。',
  [ErrorCode.Internal]: '服务内部错误，请稍后重试。',
}

/** 判断是否为后端抛出的 `ApiError`。 */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** 权限不足类错误码区间（后端 `webui/errors.py` 的 403 段码，如 `40301`）。 */
const PERMISSION_DENIED_MIN = 40300
const PERMISSION_DENIED_MAX = 40400

/**
 * 权限不足时的**统一教师语言**。
 *
 * ⚠️ 权限类错误**绝不**透传后端 message：后端会带上 `viewer 角色无权执行该操作（需要 paper.edit 权限）`
 * 这类**开发者行话**（含内部权限标识 `paper.edit`），直接甩给老师既看不懂又像报错。
 */
export const PERMISSION_DENIED_MESSAGE =
  '你的账号权限不足，不能执行这个操作。如需权限请联系管理员。'

/** 按**错误码**判断是否为「权限不足」（403xx 段）。 */
export function isPermissionDeniedCode(code: number | null | undefined): boolean {
  return code != null && code >= PERMISSION_DENIED_MIN && code < PERMISSION_DENIED_MAX
}

/** 是否为「权限不足」类错误（`403xx` 段码，或 HTTP 403 兜底）。 */
export function isPermissionDenied(err: unknown): boolean {
  if (isApiError(err) && err.status === 403) return true
  return isPermissionDeniedCode(errorCodeOf(err))
}

/** 取出错误码；无法识别时返回 `null`。 */
export function errorCodeOf(err: unknown): number | null {
  if (isApiError(err)) return err.code
  // 作业信息里可能是 snake_case 的 error_code
  if (err && typeof err === 'object') {
    const maybe = (err as { error_code?: unknown }).error_code
    if (typeof maybe === 'number') return maybe
  }
  return null
}

/**
 * 把任意错误转成**给老师看**的一句话。
 *
 * 优先级：**权限类错误 → 前端统一教师文案**（不透传后端内部标识）；
 * 其余：后端 message（已是中文）→ 按码兜底文案 → 通用兜底。
 */
export function describeApiError(err: unknown): string {
  // ⚠️ 权限类错误优先用前端文案：后端 message 含 `paper.edit` 这类内部权限标识，
  // 是开发者行话。其余错误仍保持"后端 message 优先"的既有策略。
  if (isPermissionDenied(err)) return PERMISSION_DENIED_MESSAGE
  if (isApiError(err) && err.message.trim()) return err.message
  const code = errorCodeOf(err)
  if (code !== null && FALLBACK_MESSAGES[code]) return FALLBACK_MESSAGES[code]
  if (err instanceof Error && err.message.trim()) return err.message
  return '操作失败，请稍后重试。'
}

/** 取出错误携带的附加数据（`ApiError.data`）；非 ApiError 时返回 `null`。 */
export function errorDataOf(err: unknown): unknown {
  return isApiError(err) ? err.data : null
}

/** 按**错误码**判断是否为「内容守卫」类错误（适用于作业信息里的 `error_code`）。 */
export function isContentGuardCode(code: number | null | undefined): boolean {
  return code === ErrorCode.ExportContentBlocked || code === ErrorCode.ExportEvidenceStale
}

/** 是否为「内容守卫」类错误（导出前内容问题，需引导用户处理而非简单报错）。 */
export function isContentGuardError(err: unknown): boolean {
  return isContentGuardCode(errorCodeOf(err))
}

/** 是否为「资源不存在」类错误。 */
export function isNotFoundError(err: unknown): boolean {
  const code = errorCodeOf(err)
  return code !== null && code >= 40400 && code < 40500
}

/** 是否为「需要二次确认」类冲突（前端应弹确认框后带 force 重试）。 */
export function isConfirmationRequired(err: unknown): boolean {
  const code = errorCodeOf(err)
  return code === ErrorCode.NeedForce || code === ErrorCode.NeedConfirm
}

/** 是否为「未授权」（线上部署版令牌/会话失效）。 */
export function isUnauthorized(err: unknown): boolean {
  return errorCodeOf(err) === ErrorCode.Unauthorized
}
