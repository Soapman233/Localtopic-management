/** DOCX 导入域 API（Phase 2.3）。
 *
 * 后端（已验收，不改）：
 * - ``GET  /api/import/status`` → 功能开关 + 限制（扩展名 / 大小 / 超时），前端据此决定入口是否可用；
 * - ``POST /api/import/docx``   → ``multipart/form-data``（字段名 ``file``）上传，返回 ``job_id``，
 *   需轮询 ``GET /api/jobs/{job_id}`` 直到终态。
 *
 * 为什么上传不走 ``api.post``
 * --------------------------
 * ``client.ts`` 的 ``request`` 会把 body 一律 ``JSON.stringify``，无法传 ``FormData``。
 * 因此这里像 ``api/labels.ts::importReviewCsv`` 一样单独实现，但**保持同一套语义**：
 * 非 0 ``code`` 抛 :class:`ApiError`（携带 code/status/data，供页面弹教师可读提示），
 * 并像 ``client.ts`` 一样**自动附加会话令牌**（本地版无令牌 → 不发该头，与历史一致）。
 */
import { ApiError, api, getAuthToken } from './client'
import type { ImportStatus, ImportSubmitResult } from './types'

/** ``GET /api/import/status``：导入功能状态与限制。 */
export function getImportStatus(): Promise<ImportStatus> {
  return api.get<ImportStatus>('/api/import/status')
}

/**
 * ``POST /api/import/docx``：上传 DOCX 并提交导入作业。
 *
 * @param file      待上传的试卷文件（前端已预校验扩展名与大小）。
 * @param timeoutMs 上传超时（毫秒），默认 120 秒——大文件（上限 100MB）上传比普通请求更慢。
 */
export async function submitImportDocx(
  file: File,
  timeoutMs = 120_000,
): Promise<ImportSubmitResult> {
  const form = new FormData()
  form.append('file', file)

  const token = getAuthToken()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch('/api/import/docx', {
      method: 'POST',
      body: form,
      signal: controller.signal,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    })
  } catch (err) {
    throw new ApiError(
      err instanceof DOMException && err.name === 'AbortError'
        ? '上传超时，请检查网络后重试'
        : '上传失败，请确认后端已启动',
      50001,
      0,
      null,
    )
  } finally {
    window.clearTimeout(timer)
  }

  const text = await resp.text()
  let envelope: { code?: number; data?: ImportSubmitResult; message?: string } | null = null
  try {
    envelope = text ? JSON.parse(text) : null
  } catch {
    envelope = null
  }
  if (envelope && typeof envelope.code === 'number') {
    if (envelope.code === 0) return envelope.data as ImportSubmitResult
    throw new ApiError(envelope.message || '导入提交失败', envelope.code, resp.status, envelope.data)
  }
  if (!resp.ok) throw new ApiError(`HTTP ${resp.status}`, resp.status * 100, resp.status, null)
  throw new ApiError('导入提交返回格式异常', 50001, resp.status, null)
}
