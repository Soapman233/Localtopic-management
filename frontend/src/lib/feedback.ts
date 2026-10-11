/** 统一反馈底座（notistack）。
 *
 * 背景（前端重构方案 §4.5.2）
 * -------------------------
 * 此前反馈机制有 4 种并存（各页自建 `Alert` / `Snackbar` / `saveMsg` state / 页内提示），
 * 位置、时长、样式各异，且错误易被滚动位置淹没。本模块提供**唯一入口**：
 *
 * - 组件内：`const notify = useNotify()` → `notify.success('已加入试卷')`
 * - 组件外（如 react-query 的错误处理）：`notify.error(...)`（全局单例）
 *
 * 注意：全局 `notify` 需先由 `<NotifierBridge/>` 在 `SnackbarProvider` 内部绑定；
 * 未绑定时调用是**安全空操作**（不会抛错），但也不会有提示。
 */
import { useMemo } from 'react'
import { useSnackbar, type SnackbarKey } from 'notistack'
import { describeApiError } from '../api/errors'

export type NotifyVariant = 'success' | 'error' | 'warning' | 'info'

export interface NotifyOptions {
  variant?: NotifyVariant
  /** 自动关闭毫秒数；错误默认停留更久。 */
  autoHideDuration?: number
  /** 传 true 则不自动关闭（适合需要用户阅读的错误）。 */
  persist?: boolean
}

type Enqueue = (message: string, options?: NotifyOptions) => SnackbarKey | undefined

/** 全局（组件外可用）的入队函数；由 NotifierBridge 绑定。 */
let enqueueGlobal: Enqueue | null = null

/** 供 NotifierBridge 绑定/解绑；**业务代码不要直接调用**。 */
export function bindNotifier(fn: Enqueue | null): void {
  enqueueGlobal = fn
}

function enqueue(message: string, options: NotifyOptions = {}): SnackbarKey | undefined {
  if (!enqueueGlobal) return undefined
  const { variant = 'info', persist = false } = options
  const autoHideDuration = options.autoHideDuration ?? (variant === 'error' ? 6000 : 3000)
  return enqueueGlobal(message, {
    variant,
    autoHideDuration: persist ? undefined : autoHideDuration,
  })
}

/** 组件外可用的全局反馈单例。 */
export const notify = {
  success: (message: string, options?: NotifyOptions) => enqueue(message, { ...options, variant: 'success' }),
  error: (message: string, options?: NotifyOptions) => enqueue(message, { ...options, variant: 'error' }),
  warning: (message: string, options?: NotifyOptions) => enqueue(message, { ...options, variant: 'warning' }),
  info: (message: string, options?: NotifyOptions) => enqueue(message, { ...options, variant: 'info' }),
  /** 直接把一个异常转成教师可读的错误提示（走 `describeApiError`）。 */
  errorFrom: (err: unknown, options?: NotifyOptions) =>
    enqueue(describeApiError(err), { ...options, variant: 'error' }),
}

export interface NotifyApi {
  success: (message: string, options?: NotifyOptions) => void
  error: (message: string, options?: NotifyOptions) => void
  warning: (message: string, options?: NotifyOptions) => void
  info: (message: string, options?: NotifyOptions) => void
  errorFrom: (err: unknown, options?: NotifyOptions) => void
}

/** 组件内使用的反馈 hook（基于 notistack，无需等待全局绑定）。 */
export function useNotify(): NotifyApi {
  const { enqueueSnackbar } = useSnackbar()
  return useMemo(() => {
    const push = (message: string, variant: NotifyVariant, options?: NotifyOptions) => {
      const persist = options?.persist ?? false
      const autoHideDuration =
        options?.autoHideDuration ?? (variant === 'error' ? 6000 : 3000)
      enqueueSnackbar(message, {
        variant,
        autoHideDuration: persist ? undefined : autoHideDuration,
      })
    }
    return {
      success: (m, o) => push(m, 'success', o),
      error: (m, o) => push(m, 'error', o),
      warning: (m, o) => push(m, 'warning', o),
      info: (m, o) => push(m, 'info', o),
      errorFrom: (err, o) => push(describeApiError(err), 'error', o),
    }
  }, [enqueueSnackbar])
}
