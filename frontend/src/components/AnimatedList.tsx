/** 找题页专用轻列表：DOM提交后的layout阶段先关整体替换，早于MutationObserver。
 * 插件只在实际挂载且系统允许时下载；禁用期间不补播，恢复以当前DOM为基线。
 * 不用于测量、纸面、DnD或题干内部。资格同时核对查询身份、稳定状态与共同ID顺序。
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { MOTION_QUERY, useReducedMotion } from '../hooks/useReducedMotion'
import { canAnimateList, type ListSnapshot } from '../lib/listMotion'
type Controller = { enable: () => void; disable: () => void; isEnabled: () => boolean }
export function AnimatedList({ children, scope, stable, ids, toolbar = false, testId }: ListSnapshot & {
  children: ReactNode; toolbar?: boolean; testId?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const controller = useRef<Controller>()
  const previous = useRef<ListSnapshot>()
  const reduced = useReducedMotion()
  const stop = () => {
    controller.current?.disable()
    // disable只阻止未来动画；即时取消该父节点/直接子项上的运行中WAAPI，含移除临时节点。
    for (const animation of root.current?.getAnimations?.({ subtree: true }) ?? []) {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target === root.current || target?.parentElement === root.current) animation.cancel()
    }
  }
  useLayoutEffect(() => {
    const current = { scope, stable, ids }
    const allowed = !reduced && canAnimateList(previous.current, current, toolbar)
    if (allowed) controller.current?.enable()
    else stop()
    previous.current = current
  })
  useEffect(() => {
    if (reduced || !root.current) return
    let canceled = false
    const element = root.current
    // 迟到import只登记当下DOM，绝不将等待期间的首载/查询变化补播。
    void import('@formkit/auto-animate').then(({ default: autoAnimate }) => {
      if (canceled || typeof window.matchMedia !== 'function' || window.matchMedia(MOTION_QUERY).matches) return
      const value = autoAnimate(element, { duration: 120, easing: 'ease-out' })
      value.disable()
      controller.current = value
    }).catch(() => { /* 可选增强失败不影响检索、勾选或提交，继续无动画。 */ })
    return () => { canceled = true; stop(); controller.current = undefined }
  }, [reduced])
  return <div ref={root} data-testid={testId}>{children}</div>
}
