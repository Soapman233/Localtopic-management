/**
 * 列表增删动效容器（AutoAnimate 封装）。
 *
 * 设计约束（来自实施方案 §5）
 * ---------------------------
 * * **只用于「同页少量增删」**——首批加载、整页翻页、大量结果替换一律关闭，
 *   否则会让"翻页"变成缓慢的位移动画，反而更难用；
 * * **reduce 时必须完全不启用**（不是把时长设为 0）；
 * * 子项需有**稳定 key**（否则动画会错位）；
 * * **禁止**用于：缩放纸面 / 分页引擎 / DnD 控制 transform 的同一节点 /
 *   每个公式或题干段落（会与 KaTeX 布局、DnD 变换打架）。
 *
 * 用法：
 * ```tsx
 * <AnimatedList>{items.map((it) => <Card key={it.id} />)}</AnimatedList>
 * ```
 */
import { useEffect, useRef } from 'react'
import autoAnimate, { type AutoAnimateOptions } from '@formkit/auto-animate'
import { useReducedMotion } from '../lib/useReducedMotion'
import { tokens } from '../theme'

export interface AnimatedListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 是否启用（默认 true）；仍会与 reduce 偏好取交集。 */
  enabled?: boolean
  /**
   * 动画时长（毫秒）。默认 `tokens.motion.base`（180，规范 §2.6「列表增删」档）——
   * 比 AutoAnimate 自带的 250 更克制。
   */
  duration?: number
  /** 缓动。默认 `tokens.motion.ease`（规范 §2.6 标准缓动）。 */
  easing?: string
  children?: React.ReactNode
}

export default function AnimatedList({
  enabled = true,
  // ⚠️ 默认值来自 **token**，不是字面量——原先的 180 / cubic-bezier(0.2,0,0,1)
  //    恰好等于规范值，但「恰好相等」不等于「有出处」：改 token 时不会跟着变。
  duration = tokens.motion.base,
  easing = tokens.motion.ease,
  children,
  ...rest
}: AnimatedListProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()
  const active = enabled && !reduced

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const opts: AutoAnimateOptions = { duration, easing }
    // 返回的 controller 用于在依赖变化/卸载时**还原 DOM**，避免残留内联样式
    const controller = autoAnimate(el, opts)
    return () => controller.destroy?.()
  }, [active, duration, easing])

  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  )
}
