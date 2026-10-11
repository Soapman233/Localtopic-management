/** 用户与权限相关接口（阶段 4：两版适配）。
 *
 * 契约由主理人锁定（与后端 `webui/routers/auth.py` 对齐）：
 * - `GET /api/auth/me` **无需凭据也要能调**，用 `auth_enabled` 区分「未启用鉴权」与「未登录」；
 * - 失败统一走 `{code, data, message}` 信封（见 `api/client.ts`）。
 */
import api from './client'

/** 角色。 */
export type Role = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id: number
  username: string
  display_name: string
  role: Role
}

export interface AuthMeData {
  /**
   * 后端是否**启用了鉴权**。
   *
   * - `false`（本地版 / 未配置用户）→ 前端**透传**，不拦任何路由、不显示登录入口；
   * - `true` → 线上版，未登录时 `user` 为 `null`，由 `RequireAuth` 跳登录页。
   *
   * ⚠️ 这个字段是两版适配的**唯一开关**。若它缺失或该端点返回 401，
   * 前端就无法区分"没登录"和"没启用鉴权"，会出现"本地版也被要求登录"的最糟结果。
   */
  auth_enabled: boolean
  user: AuthUser | null
}

export interface LoginResult {
  token: string
  user: AuthUser
}

/** 读取当前鉴权状态与用户（**无需凭据**）。 */
export function getAuthMe(): Promise<AuthMeData> {
  return api.get<AuthMeData>('/api/auth/me')
}

/** 登录。失败时抛 `ApiError`（code 40101），**不触发全局跳转**（我们本就在登录页）。 */
export function login(username: string, password: string): Promise<LoginResult> {
  return api.post<LoginResult>(
    '/api/auth/login',
    { username, password },
    { skipAuthRedirect: true },
  )
}

/** 登出。后端幂等（令牌已失效也返回成功）。 */
export function logout(): Promise<null> {
  return api.post<null>('/api/auth/logout')
}
