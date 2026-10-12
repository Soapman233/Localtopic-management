/** 顶层登录路由的加载边界：App 的 Outlet 边界覆盖不到这里。
 * 加固延迟/失败时的呈现，不宣称当前构建已有报错。lazy 会缓存拒绝，
 * 因此提供真正重新请求页面的刷新操作，且不把导入 URL/错误详情展示给老师。 */
import { Suspense, type ReactNode } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { Alert, Button } from '@mui/material'
import { LoadingState } from './LoadingState'

export default function LoginLoadBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={
      <Alert severity="error" action={<Button onClick={() => window.location.reload()}>刷新页面</Button>}>
        登录页面暂时无法加载，请刷新页面后重试。
      </Alert>
    }>
      <Suspense fallback={<LoadingState label="正在加载登录页面…" />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}
