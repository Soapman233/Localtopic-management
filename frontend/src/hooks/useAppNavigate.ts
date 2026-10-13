/** 薄导航委托：增强实现仅在低频路由实际加载后登记，冷工作台不下载动效业务。 */
import { useLocation, useNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom'
export const isSafeMotionPath = (path: string) => /^\/(search|question\/[^/]+|manage\/(knowledge|formula-review|sources|stats)|settings)$/.test(path)
type Enhancement = (from: string, to: To, options: NavigateOptions) => boolean
let enhancement: Enhancement | undefined
export function registerNavigationEnhancement(value: Enhancement) { enhancement = value }
export function useAppNavigate(): NavigateFunction {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return ((to: To | number, options: NavigateOptions = {}) => {
    if (typeof to === 'number') { navigate(to); return }
    // 显式false与调用者的其他Router选项原样保留；未经增强资格核验不得透传true。
    navigate(to, { ...options, viewTransition: enhancement?.(pathname, to, options) ?? false })
  }) as NavigateFunction
}
