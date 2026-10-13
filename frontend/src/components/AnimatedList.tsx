/** 找题页专用轻列表：DOM提交后的layout阶段先关整体替换，早于MutationObserver。
 * 插件只在实际挂载且系统允许时下载；禁用期间不补播，恢复以当前DOM为基线。
 * 不用于测量、纸面、DnD或题干内部。资格同时核对查询身份、稳定状态与共同ID顺序。
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { MOTION_QUERY, useReducedMotion } from '../hooks/useReducedMotion'
import { canAnimateList, type ListSnapshot } from '../lib/listMotion'
type Controller = {
  enable: () => void
  disable: () => void
  isEnabled: () => boolean
  /** 断开观察器 / 定时器并注销父节点集合；由库暴露，卸载时必须调用。 */
  destroy?: () => void
}
/** AutoAnimate 给「待移除元素」打的私有标记（见已安装版本 index.mjs 的 remove()）。 */
const AA_DEL = '__aa_del'
export function AnimatedList({ children, scope, stable, ids, toolbar = false, testId }: ListSnapshot & {
  children: ReactNode; toolbar?: boolean; testId?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const controller = useRef<Controller>()
  const previous = useRef<ListSnapshot>()
  const reduced = useReducedMotion()
  const stop = () => {
    const el = root.current
    controller.current?.disable()
    if (!el) return
    // disable 只取消 WAAPI（不触发库的 finish → cleanUp）；被取消的移除动画会让库在
    // remove() 里重新挂回父节点的「待移除元素」永久残留（绝对定位残影）。因此这里显式
    // 移除带库删除标记的直接子节点——只删插件标记的临时节点，不动 React 仍渲染的正常节点。
    for (const animation of el.getAnimations?.({ subtree: true }) ?? []) {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target === el || target?.parentElement === el) animation.cancel()
    }
    for (const child of Array.from(el.children)) {
      if (AA_DEL in child) child.remove()
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
    return () => {
      canceled = true
      stop()
      // 卸载 / 偏好切换时销毁控制器：disconnect MutationObserver / IntersectionObserver、
      // 解除 ResizeObserver 与定时器，避免「找题↔设置」往返使观察器持续累积。
      // destroy 后该实例已失效，必须置空，不能被后续 enable() 复用。
      controller.current?.destroy?.()
      controller.current = undefined
    }
  }, [reduced])
  return <div ref={root} data-testid={testId}>{children}</div>
}
