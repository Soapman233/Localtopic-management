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

// --------------------------------------------------------------------------- //
// 会话令牌（阶段 4：两版适配）
// --------------------------------------------------------------------------- //
//
// 背景：线上部署版启用用户体系后，除登录接口外的 `/api/*` 都需要凭据。
// 若让每个 api 函数各自传 header，会散落到十几处、且极易漏（新增端点时最危险）。
// 因此这里做**全局自动附加**：AuthProvider 登录时 `setAuthToken(token)`，
// 之后所有请求自动带上 `Authorization: Bearer <token>`。
//
// **本地运行版**：从不设置令牌 → 不发送 Authorization 头 → 与历史行为**完全一致**
// （既有 205 项前端测试不受影响）。

let authToken: string | null = null

/** 由 `AuthProvider` 在登录/登出时调用。**业务代码不要直接调用**。 */
export function setAuthToken(token: string | null): void {
  authToken = token
}

/** 当前令牌（仅供测试与调试读取）。 */
export function getAuthToken(): string | null {
  return authToken
}

/** 收到 401 时的回调（由 `AuthProvider` 注册）：清除本地会话并跳登录页。 */
let onUnauthorized: (() => void) | null = null

/** 由 `AuthProvider` 注册 401 处理。**业务代码不要直接调用**。 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  /**
   * 跳过「401 → 全局跳登录页」处理。
   *
   * 用于**登录接口自身**：登录时密码错会返回 401，此时我们本来就在登录页，
   * 不该再触发一次跳转（否则会覆盖掉页面上的错误提示）。
   */
  skipAuthRedirect?: boolean
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
    headers: {
      Accept: 'application/json',
      // 线上版：自动附加会话令牌；本地版从未设置令牌 → 不加该头（行为与历史一致）。
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
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

  // 会话失效（401）→ 通知 AuthProvider 清除本地会话并跳登录页。
  // ⚠️ 登录接口自身要传 `skipAuthRedirect: true`，否则"密码错"会连带触发一次跳转，
  // 把页面上的错误提示冲掉。
  //
  // ⚠️ 去重/节流（P0-1 风暴修复的第二道保险）：**仅当本次请求确实带着令牌**却仍被拒时，
  // 才视为会话失效并回调。令牌已清（登出后 / 上一次失效已处理）再收到的 401 一律不再回调——
  // 否则多个并发请求的 401 会各触发一次清会话，而清会话又可能触发重取，
  // 形成"401 → 清会话 → 重取 → 401"的自我循环（实测曾达 12 秒 7328 次）。
  if (resp.status === 401 && !options.skipAuthRedirect) {
    if (authToken) onUnauthorized?.()
  }

  const text = await resp.text()
  // try/catch 两条路径都会赋值，初值 `= null` 是死赋值（no-useless-assignment），故不写初值。
  let envelope: ApiEnvelope<T> | null
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
