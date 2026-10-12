/**
 * 导航统一入口（带 View Transitions 增强）。
 *
 * 为什么要有这一层
 * ----------------
 * 页面切换动效必须**集中接入**，否则每个页面各写一遍 `navigate`，
 * 必然出现"有的跳转有过渡、有的没有"的割裂感；且降级逻辑会被漏掉。
 *
 * 降级规则（**硬要求**，见实施方案 §5）
 * ------------------------------------
 * 以下任一情况走**普通 `navigate()`**，行为与不加动效时**完全一致**：
 * 1. 用户系统设置为「减少动效」；
 * 2. 浏览器不支持 `document.startViewTransition`。
 *
 * ⚠️ **业务逻辑不得依赖动画结束事件**——动画只是表现层。
 */
import { useCallback } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'
import { supportsViewTransition, useReducedMotion } from './useReducedMotion'

export interface AppNavigate {
  /** 跳转；自动决定是否使用 View Transition。 */
  (to: To, options?: NavigateOptions): void
}

/**
 * 返回带过渡增强的 `navigate`。
 *
 * 实现说明：直接使用 react-router 6.30 的 `viewTransition` 选项，
 * **不**手写 `startViewTransition(() => navigate())`——那样会假定 React 已同步提交 DOM，
 * 过渡会拍到旧内容。
 */
export function useAppNavigate(): AppNavigate {
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  return useCallback(
    (to: To, options?: NavigateOptions) => {
      const canAnimate = !reduced && supportsViewTransition()
      navigate(to, canAnimate ? { ...options, viewTransition: true } : options)
    },
    [navigate, reduced],
  )
}

/** 页面容器使用的 View Transition 名称（与 `index.css` 中的规则对应）。 */
export const ROUTE_TRANSITION_NAME = 'route-content'
