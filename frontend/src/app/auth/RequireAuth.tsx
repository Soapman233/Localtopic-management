/** 路由守卫（阶段 4：两版适配）。
 *
 * 行为
 * ----
 * | 情形 | 行为 |
 * |---|---|
 * | **本地版**（`auth_enabled: false`） | **恒真透传**——不跳登录、不拦任何页面（与改造前完全一致） |
 * | 线上版 · 已登录 | 放行 |
 * | 线上版 · 未登录 | 跳 `/login`，并记下**原目标路径**，登录后回到那里 |
 *
 * ⚠️ 读取鉴权状态期间（`loading`）显示加载态而不是直接跳登录页——
 * 否则已登录用户刷新页面时会**先闪一下登录页**。
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import LoadingState from '../../components/LoadingState'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading } = useAuth()
  const location = useLocation()

  // 本地版：**不等待、不判断**，直接放行。
  // 这一步让"本地版零感知"成为结构性保证，而不是靠条件分支碰运气。
  if (!authEnabled) {
    // 但若鉴权状态还没读到，也要先渲染——本地版不该因为后端慢而卡住。
    return <>{children}</>
  }

  if (loading) {
    return <LoadingState label="正在检查登录状态…" />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
