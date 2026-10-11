/** fetch 封装：统一解包 {code,data,message}、错误抛出、超时控制。
 *
 * 约定（架构设计 §8.1）：
 * - 成功：{code:0, data, message:"ok"} → 返回 data；
 * - 失败：{code!=0} → 抛 ApiError（携带 code/status/data），由调用方弹 Toast。
 */
import type { ApiEnvelope } from './types'

export class ApiError extends Error {
  code: number
  status: number
  data: unknown

  constructor(message: string, code: number, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.data = data
  }
}

const BASE_URL = '' // 生产同源；dev 由 Vite 代理 /api

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = 30000, headers = {} } = options
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json', ...headers },
    signal: options.signal ?? controller.signal,
  }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let resp: Response
  try {
    resp = await fetch(`${BASE_URL}${path}`, init)
  } catch (err) {
    window.clearTimeout(timer)
    throw new ApiError(
      err instanceof DOMException && err.name === 'AbortError'
        ? '请求超时，请稍后重试'
        : '网络请求失败，请确认后端已启动',
      50001,
      0,
      null,
    )
  } finally {
    window.clearTimeout(timer)
  }

  const text = await resp.text()
  let envelope: ApiEnvelope<T> | null = null
  try {
    envelope = text ? (JSON.parse(text) as ApiEnvelope<T>) : null
  } catch {
    envelope = null
  }

  if (envelope && typeof envelope.code === 'number') {
    if (envelope.code === 0) {
      return envelope.data
    }
    throw new ApiError(envelope.message || '请求失败', envelope.code, resp.status, envelope.data)
  }
  // 非标准响应（如 404 静态资源）
  if (!resp.ok) {
    throw new ApiError(`HTTP ${resp.status}`, resp.status * 100, resp.status, null)
  }
  return (envelope as unknown as T)
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
}

export function buildQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    usp.append(key, String(value))
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

export default api
