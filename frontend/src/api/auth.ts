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

/**
 * 后端鉴权模式（与 `webui/auth.py` 的 `resolve_mode` 对齐）。
 *
 * - `off`：未启用（本地版），单机全权；
 * - `token`：仅共享令牌、无用户 → 浏览器端**无法登录**（`auth_enabled` 为 `false`）；
 * - `session` / `token+session`：存在用户体系 → 需要登录；
 * - `uninitialized`：**仅线上版**，鉴权库尚无用户（全新部署，未建号）；
 * - `error`：**仅线上版**，鉴权库存在但读取失败（损坏 / 权限不足）。
 */
export type AuthMode = 'off' | 'token' | 'session' | 'token+session' | 'uninitialized' | 'error'

export interface AuthMeData {
  /**
   * 后端是否**启用了鉴权**。
   *
   * - `false`（本地版 / 未配置用户 / 仅共享令牌）→ 前端**透传**，不拦任何路由；
   * - `true` → 线上版，未登录时 `user` 为 `null`，由 `RequireAuth` 跳登录页。
   *
   * ⚠️ 这个字段是两版适配的**唯一运行时开关**。若它缺失或该端点返回 401，
   * 前端就无法区分"没登录"和"没启用鉴权"，会出现"本地版也被要求登录"的最糟结果。
   */
  auth_enabled: boolean
  user: AuthUser | null
  /** 鉴权模式（诊断用；`error` 表示鉴权库不可用）。旧后端可能不返回，按 `off` 处理。 */
  auth_mode?: AuthMode
  /**
   * 后端在线但**尚未初始化管理员**（鉴权库无用户）。
   *
   * 为 `true` 时前端应给运维**明确指引**（用 CLI 建首个管理员），而不是显示登录表单——
   * 否则运维会反复输错密码却不知道"根本还没有账号"。
   */
  needs_setup?: boolean
  /** 角色 → 权限列表（后端权威矩阵，供将来前端展示 / 调试；当前前端不消费）。 */
  roles?: Record<string, string[]>
}

export interface LoginResult {
  token: string
  user: AuthUser
}

/** 读取当前鉴权状态与用户（**无需凭据**）。
 *
 * ⚠️ **不要用本端点判断「会话是否有效」**（QA 复验时踩过这个坑，第一版探针因此误判）：
 * 本端点是**豁免路径**且**恒返回 200**——令牌过期或无效时同样 200，只是 `user: null`。
 * 所以它只能回答「后端有没有启用鉴权、当前是谁」，
 * **会话有效性一律以受保护端点的 401 为准**。
 */
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
