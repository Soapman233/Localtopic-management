/**
 * `AuthProvider` 构建期开关测试（P1-3：`VITE_DEPLOY_MODE` 不再是无操作）。
 *
 * 不变量：**本地版**（测试环境未注入 `VITE_DEPLOY_MODE` → `IS_ONLINE === false`）
 * **完全不请求** `/api/auth/me`。这既省一次启动请求，也让本地版从根本上
 * 不可能卷入 401 请求风暴。线上版是否请求由 `AuthProvider` 的 `enabled` 决定，
 * 由浏览器探针在真实后端上覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../../src/app/auth/AuthProvider'

// `vi.hoisted` 保证 mock 工厂引用的 spy 在提升后已初始化。
const { getAuthMe } = vi.hoisted(() => ({ getAuthMe: vi.fn() }))
vi.mock('../../src/api/auth', () => ({
  getAuthMe,
  login: vi.fn(),
  logout: vi.fn(),
}))

function Probe() {
  const { authEnabled, loading, authMode, needsSetup, role } = useAuth()
  return (
    <div data-testid="probe">
      {`enabled=${authEnabled};loading=${loading};mode=${authMode};setup=${needsSetup};role=${role}`}
    </div>
  )
}

function renderProvider() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('AuthProvider · 构建期开关', () => {
  beforeEach(() => getAuthMe.mockReset())

  it('本地版（IS_ONLINE=false）完全不请求 /api/auth/me，且按 admin 全权', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('loading=false'))
    expect(getAuthMe).not.toHaveBeenCalled()
    const text = screen.getByTestId('probe').textContent ?? ''
    expect(text).toContain('enabled=false')
    expect(text).toContain('mode=off')
    expect(text).toContain('setup=false')
    expect(text).toContain('role=admin')
  })
})
