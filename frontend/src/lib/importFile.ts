/** 导入文件的**纯函数**校验与展示辅助（Phase 2.3）。
 *
 * 为什么独立成模块
 * ----------------
 * 「选文件 → 校验扩展名 / 大小 → 提示」是**纯逻辑**，与 React 无关；
 * 抽出来既让页面保持轻量，也让「扩展名校验 / 大小校验」能被**直接单测**
 * （不必挂载页面、不必模拟拖拽）。
 *
 * ⚠️ 允许的扩展名与大小上限**一律来自 ``GET /api/import/status``**，
 * 本模块**不硬编码** ``.docx`` / ``100MB``——否则后端改了限制前端会与真相对不上。
 */
import type { ImportStatus } from '../api/types'

const KB = 1024
const MB = 1024 * 1024

/** 人类可读的字节数（用于「文件太大」提示）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

/** 由允许的扩展名生成 ``<input accept>`` 取值（如 ``".docx"``）。 */
export function acceptAttr(suffixes: readonly string[]): string {
  return suffixes.join(',')
}

/** 取小写扩展名（含点）；无扩展名返回空串。 */
export function suffixOf(name: string): string {
  const dot = (name ?? '').lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export interface ImportFileValidation {
  ok: boolean
  /** 校验失败时的**中文**提示（成功时为 ``undefined``）。 */
  message?: string
}

/**
 * 上传前**前端预校验**：扩展名 + 大小（用 status 返回的限制，不硬编码）。
 *
 * 只做「能提前发现就提前发现」的拦截；后端仍会再校验一遍（前端校验不是安全边界）。
 */
export function validateImportFile(
  file: Pick<File, 'name' | 'size'>,
  status: Pick<ImportStatus, 'allowed_suffixes' | 'max_bytes'>,
): ImportFileValidation {
  const suffixes = (status.allowed_suffixes ?? []).map((s) => s.toLowerCase())
  const suffix = suffixOf(file.name ?? '')

  if (!suffix || !suffixes.includes(suffix)) {
    const allowed = status.allowed_suffixes?.length
      ? status.allowed_suffixes.join('、')
      : '服务端未声明允许的格式'
    return {
      ok: false,
      message: `只支持 ${allowed} 格式的文件，你选的是「${suffix || '无扩展名'}」。`,
    }
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: '这个文件是空的，请换一个。' }
  }
  if (file.size > status.max_bytes) {
    return {
      ok: false,
      message: `文件太大（${formatBytes(file.size)}），单个文件不能超过 ${formatBytes(status.max_bytes)}。`,
    }
  }
  return { ok: true }
}
