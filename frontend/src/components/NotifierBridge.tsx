/** 把 notistack 的入队函数绑定到全局 `notify`（见 `lib/feedback.ts`）。
 *
 * 为什么需要它
 * ------------
 * notistack 的 `useSnackbar()` 只能在 `SnackbarProvider` 的**子树**里使用；
 * 而 react-query 的错误处理、事件回调等**组件外**代码也需要弹提示。
 * 本组件挂在 Provider 内，把入队函数桥接到模块级单例。
 */
import { useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { bindNotifier } from '../lib/feedback'

export default function NotifierBridge() {
  const { enqueueSnackbar } = useSnackbar()

  useEffect(() => {
    bindNotifier((message, options) =>
      enqueueSnackbar(message, {
        variant: options?.variant ?? 'info',
        autoHideDuration: options?.autoHideDuration,
      }),
    )
    return () => bindNotifier(null)
  }, [enqueueSnackbar])

  return null
}
