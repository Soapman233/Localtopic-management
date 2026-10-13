/** 系统减少动效偏好：同步初值、实时监听，旧 Safari 成对清理；API缺失时保守关闭。 */
import { useEffect, useState } from 'react'
export const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia(MOTION_QUERY).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(MOTION_QUERY)
    const update = () => setReduced(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener(update)
    return () => media.removeListener(update)
  }, [])
  return reduced
}
