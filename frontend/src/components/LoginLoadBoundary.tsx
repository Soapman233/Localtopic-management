/** 顶层登录路由的加载边界：App 的 Outlet 边界覆盖不到这里。
 * 加固延迟/失败时的呈现，不宣称当前构建已有报错。lazy 会缓存拒绝，
 * 因此提供真正重新请求页面的刷新操作，且不把导入 URL/错误详情展示给老师。 */
import { Suspense, type ReactNode } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

export default function LoginLoadBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={() => (
        // 复用统一错误态（§4.2）：错误态**含重试**（§3.2）——lazy 会缓存拒绝，
        // 因此「重试」落到真正重新请求页面的刷新操作。
        // ⚠️ 刻意**不透传原始错误**：`ErrorState` 会先渲染 `describeApiError(error)`，
        // 而 lazy 导入失败的错误 message 含 chunk URL / 查询串，会泄露给老师；
        // 故传入脱敏后的 Error（与 PaperPanel `error={new Error(文案)}` 同法）。
        <ErrorState
          error={new Error('登录页面暂时无法加载，请刷新页面后重试。')}
          title="登录页面暂时无法加载"
          onRetry={() => window.location.reload()}
          retryLabel="刷新页面"
        />
      )}
    >
      <Suspense fallback={<LoadingState label="正在加载登录页面…" />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}
