/** 鉴权上下文（阶段 4：两版适配）。
 *
 * 设计要点
 * --------
 * 1. **本地版必须零感知**：构建期即为本地版（`VITE_DEPLOY_MODE=local`）时，
 *    **完全不请求** `/api/auth/me`，`role` 视为 `admin`（单机全权）、
 *    路由**恒真透传**、不显示任何登录入口。这与改造前的行为**完全一致**。
 * 2. **令牌集中管理**：令牌存在 `localStorage`，并同步给 `api/client.ts`
 *    （全局自动附加 `Authorization` 头），避免每个 api 函数各传一遍、漏一个就出洞。
 * 3. **401 统一处理且幂等**：任何请求返回 401 → **只处理一次**地清除本地会话，
 *    并让 `RequireAuth` 跳登录页。清会话时用 `setQueryData` 写入确定值，
 *    **不**触发 `/api/auth/me` 重取——否则会形成请求风暴（详见 `clearSession`）。
 *    ⚠️ 登录接口自身传了 `skipAuthRedirect`，否则"密码错"会连带触发跳转、冲掉错误提示。
 * 4. **前端只负责体验，不负责安全**：这里做的是"不显示注定失败的操作"，
 *    **真正的权限强制在后端**。前端隐藏按钮不等于安全。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAuthMe,
  login as apiLogin,
  logout as apiLogout,
  type AuthMeData,
  type AuthMode,
  type AuthUser,
  type Role,
} from '../../api/auth'
import { getAuthToken, setAuthToken, setUnauthorizedHandler } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { IS_ONLINE } from '../../lib/deployMode'

const TOKEN_KEY = 'qb-auth-token'

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // 隐私模式 / 存储被禁用时按未登录处理，不抛错
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 存储不可用时忽略：本次会话仍能用（内存里的令牌已设） */
  }
}

export interface AuthContextValue {
  /** 后端是否启用了鉴权。`false` = 本地版 → 一切透传。 */
  authEnabled: boolean
  /** 当前用户；未登录或未启用鉴权时为 `null`。 */
  user: AuthUser | null
  /** 正在读取鉴权状态（避免登录页/主界面闪烁）。 */
  loading: boolean
  /** 生效角色：未启用鉴权时按 `admin`（单机全权）。 */
  role: Role
  /** 后端鉴权模式（诊断用）；`error` = 鉴权库不可用。 */
  authMode: AuthMode
  /** 后端在线但尚未初始化管理员 → 应给运维指引而不是登录表单。 */
  needsSetup: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** 供组件读取鉴权状态。必须在 `<AuthProvider>` 内使用。 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  // 令牌在**首帧之前**就同步给 client，保证 `me` 请求带上它。
  const [token, setToken] = useState<string | null>(() => {
    const t = readStoredToken()
    setAuthToken(t)
    return t
  })

  const meQ = useQuery({
    queryKey: qk.authMe(),
    queryFn: getAuthMe,
    // 鉴权状态在会话内基本不变；登录/登出时我们主动失效它。
    staleTime: Infinity,
    retry: false,
    // 构建期开关真正生效：**本地版（VITE_DEPLOY_MODE=local）完全不请求**
    // `/api/auth/me`——本地版没有用户体系，这一步既省一次启动请求，也让本地版
    // 从根本上不可能卷入"401 请求风暴"。线上版才查询，以运行时 `auth_enabled` 为准。
    enabled: IS_ONLINE,
  })

  const clearSession = useCallback(() => {
    // ⚠️ 幂等 + 断环：令牌已清（登出后 / 上一次失效已处理）时直接返回。
    // 若不幂等，401 回调会反复触发下面的清会话逻辑，而清会话又会触发重取，
    // 形成"401 → 清会话 → 重取 /api/auth/me → 401"的自我循环
    // （实测曾达 12 秒 7328 次，约 610 次/秒）。
    if (getAuthToken() === null) return
    setAuthToken(null)
    storeToken(null)
    setToken(null)
    // ⚠️ 关键：用 `setQueryData` 写入"已登出"的**确定值**，**绝不要** `invalidateQueries`——
    // 后者会立即把该 query 标记为 stale 并触发 `/api/auth/me` 重新请求，
    // 而该请求在会话失效时又会 401，正是风暴的闭环。
    // 保留 `auth_enabled` 等既有字段（否则会把"线上版"误降级为"本地版"），仅清空 `user`。
    qc.setQueryData<AuthMeData>(qk.authMe(), (prev) => ({
      ...(prev ?? { auth_enabled: false }),
      user: null,
    }))
  }, [qc])

  // 401 → 清会话（`RequireAuth` 会据此跳登录页）。
  useEffect(() => {
    setUnauthorizedHandler(clearSession)
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await apiLogin(username, password)
      setAuthToken(res.token)
      storeToken(res.token)
      setToken(res.token)
      // 令牌变了 → 之前缓存的（未登录态）数据必须作废；同时重取 `me` 拿到新身份。
      await qc.invalidateQueries()
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } catch {
      // 后端幂等；网络失败也不该把用户卡在"登不出去"的状态
    }
    clearSession()
    // 令牌变了 → 作废既有缓存；但**排除** `authMe`：登出后重取它只会白白再打一次
    // `/api/auth/me`（在会话已失效的后端上还会 401），没有收益只有风险。
    await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== qk.authMe()[0] })
  }, [clearSession, qc])

  const authEnabled = meQ.data?.auth_enabled === true
  const user = meQ.data?.user ?? null
  const authMode: AuthMode = meQ.data?.auth_mode ?? 'off'
  // `needs_setup` 为后端新增字段；兼容尚未返回它的旧后端：`uninitialized` 模式同样意味着"待初始化"。
  const needsSetup = meQ.data?.needs_setup === true || authMode === 'uninitialized'

  const value = useMemo<AuthContextValue>(
    () => ({
      authEnabled,
      user,
      loading: meQ.isLoading,
      // ⚠️ 未启用鉴权 = 本地版单机 → 全权。这正是"本地版零感知"的关键。
      role: authEnabled ? (user?.role ?? 'viewer') : 'admin',
      authMode,
      needsSetup,
      login,
      logout,
    }),
    [authEnabled, user, meQ.isLoading, authMode, needsSetup, login, logout],
  )

  // 令牌 state 的用途仅是「登录/登出时触发一次重渲染」，其值不参与渲染。
  void token

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
