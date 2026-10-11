/** 路由守卫（阶段 4：两版适配）。
 *
 * 行为
 * ----
 * | 情形 | 行为 |
 * |---|---|
 * | **本地版**（构建期 local；`auth_enabled: false`） | **恒真透传**——不跳登录、不拦任何页面（与改造前完全一致） |
 * | 线上版 · 鉴权库不可用（`auth_mode: 'error'`） | **fail-closed**：显示「鉴权服务不可用」指引，不放行、不显示登录表单 |
 * | 线上版 · 待初始化管理员（`needs_setup`） | 显示「尚未初始化管理员」指引（用 CLI 建号） |
 * | 线上版 · 已登录 | 放行 |
 * | 线上版 · 未登录 | 跳 `/login`，并记下**原目标路径**，登录后回到那里 |
 *
 * ⚠️ 读取鉴权状态期间（`loading`）显示加载态而不是直接跳登录页——
 * 否则已登录用户刷新页面时会**先闪一下登录页**。
 *
 * ⚠️ 本地版（构建期 local）**从不请求** `/api/auth/me`，因此 `loading` 恒为 `false`，
 * 直接透传，不会因后端慢/不可用而卡在加载态。
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import LoadingState from '../../components/LoadingState'
import { AuthServiceUnavailable, AuthSetupRequired } from '../../components/AuthStatusNotice'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading, authMode, needsSetup } = useAuth()
  const location = useLocation()

  // 线上版：鉴权状态未就绪时先显示加载态（本地版 loading 恒为 false，不受影响）。
  if (loading) {
    return <LoadingState label="正在检查登录状态…" />
  }

  // 线上版「鉴权不可用 / 待初始化」必须 fail-closed：给运维明确指引，
  // 既不静默放行（安全），也不显示注定失败的登录表单（体验）。
  if (authMode === 'error') {
    return <AuthServiceUnavailable />
  }
  if (needsSetup) {
    return <AuthSetupRequired />
  }

  // 未启用鉴权 = 本地版单机 → **恒真透传**。
  // 这一步让"本地版零感知"成为结构性保证，而不是靠条件分支碰运气。
  if (!authEnabled) {
    return <>{children}</>
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
