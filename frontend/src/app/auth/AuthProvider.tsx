/** 鉴权上下文（阶段 4：两版适配）。
 *
 * 设计要点
 * --------
 * 1. **本地版必须零感知**：本地版后端返回 `auth_enabled: false`，此时
 *    `role` 视为 `admin`（单机全权）、路由**恒真透传**、不显示任何登录入口。
 *    这与改造前的行为**完全一致**。
 * 2. **令牌集中管理**：令牌存在 `localStorage`，并同步给 `api/client.ts`
 *    （全局自动附加 `Authorization` 头），避免每个 api 函数各传一遍、漏一个就出洞。
 * 3. **401 统一处理**：任何请求返回 401 → 清除本地会话并让 `RequireAuth` 跳登录页。
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
import { getAuthMe, login as apiLogin, logout as apiLogout, type AuthUser, type Role } from '../../api/auth'
import { setAuthToken, setUnauthorizedHandler } from '../../api/client'
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
  })

  const clearSession = useCallback(() => {
    setAuthToken(null)
    storeToken(null)
    setToken(null)
    qc.invalidateQueries({ queryKey: qk.authMe() })
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
      // 令牌变了 → 之前缓存的（未登录态）数据必须作废
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
    await qc.invalidateQueries()
  }, [clearSession, qc])

  const authEnabled = meQ.data?.auth_enabled === true
  const user = meQ.data?.user ?? null

  const value = useMemo<AuthContextValue>(
    () => ({
      authEnabled,
      user,
      loading: meQ.isLoading,
      // ⚠️ 未启用鉴权 = 本地版单机 → 全权。这正是"本地版零感知"的关键。
      role: authEnabled ? (user?.role ?? 'viewer') : 'admin',
      login,
      logout,
    }),
    [authEnabled, user, meQ.isLoading, login, logout],
  )

  // 本地版（构建期即为 local）**不需要**等待后端答复就能渲染——
  // 避免"纯本地部署因后端慢/不可用而卡在加载态"。
  void token
  void IS_ONLINE

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
