/**
 * 「减少动效」偏好检测。
 *
 * 为什么不用 `useMediaQuery` 一把梭
 * ---------------------------------
 * 本 Hook 要同时服务于两条链路，而它们的**降级时机**不同：
 *
 * 1. **AutoAnimate**：需要在 reduce 时**不启用**（而不是"动画时长设为 0"）；
 * 2. **View Transitions**：需要在 reduce 或浏览器不支持时走**普通 `navigate()`**。
 *
 * 因此这里返回一个布尔值并**监听变化**（用户在系统里改设置后无需刷新页面），
 * 而不是只读一次。
 *
 * ⚠️ 业务逻辑**不得依赖动画结束事件**——动画只是表现层，禁用后功能必须完全一致。
 */
import { useEffect, useState } from 'react'

/** 媒体查询串（与 `index.css` 的全局 reduce 块保持一致）。 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** 读取一次当前偏好（SSR / 无 matchMedia 环境返回 false）。 */
function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

/** 当前是否应「减少动效」。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readPreference)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    // 首挂载时同步一次：首次渲染与订阅之间用户可能改过设置
    setReduced(mql.matches)
    // addEventListener 在旧 Safari 上不存在，回退 addListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])

  return reduced
}

/** 当前环境是否支持 View Transitions API。 */
export function supportsViewTransition(): boolean {
  return typeof document !== 'undefined'
    && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
}
