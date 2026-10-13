/** 安全页面加载成功才登记warm；冷加载、相对/查询导航、测量页一律普通导航。 */
import { isSafeMotionPath, registerNavigationEnhancement } from '../hooks/useAppNavigate'
import { MOTION_QUERY } from '../hooks/useReducedMotion'
import './routeTransitions.css'
const warm = new Set<string>()
const pageKey = (path: string) => path.startsWith('/question/') ? '/question/:id' : path
export function markRouteWarm(path: string) { warm.add(pageKey(path)) }
registerNavigationEnhancement((from, to, options) => {
  const target = typeof to === 'string' ? to.split(/[?#]/)[0] : to.pathname
  return options.viewTransition !== false && !options.relative && !!target?.startsWith('/') && target !== from &&
    isSafeMotionPath(from) && isSafeMotionPath(target) && warm.has(pageKey(from)) && warm.has(pageKey(target)) &&
    typeof document.startViewTransition === 'function' && typeof window.matchMedia === 'function' &&
    !window.matchMedia(MOTION_QUERY).matches
})
