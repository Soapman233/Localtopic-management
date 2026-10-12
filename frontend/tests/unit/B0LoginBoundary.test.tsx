/** B0 登录结构加固：可控 lazy Promise 验证延迟/拒绝，而非虚构当前构建报错。 */
import { lazy } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoginLoadBoundary from '../../src/components/LoginLoadBoundary'
import LoginPage from '../../src/pages/LoginPage'
import routerSrc from '../../src/router.tsx?raw'
import { renderWithTheme } from './testUtils'

const auth = vi.hoisted(() => ({ value: { authEnabled: false, authMode: 'off', loading: false, needsSetup: false, user: null, login: vi.fn() } }))
vi.mock('../../src/app/auth/AuthProvider', () => ({ useAuth: () => auth.value }))
vi.mock('../../src/router', () => ({ DEFAULT_LANDING_PATH: '/builder' }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function pendingLogin() {
  let resolve!: (value: { default: typeof LoginPage }) => void
  let reject!: (error: Error) => void
  const Page = lazy(() => new Promise<{ default: typeof LoginPage }>((yes, no) => { resolve = yes; reject = no }))
  renderWithTheme(<MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginLoadBoundary><Page /></LoginLoadBoundary>} />
    <Route path="/builder" element={<div>本地工作台</div>} />
  </Routes></MemoryRouter>)
  return { resolve: () => resolve({ default: LoginPage }), reject: () => reject(new Error('https://internal/login-chunk.js password=secret stack-token')) }
}
describe('顶层登录独立加载边界', () => {
  it('真实路由声明包裹登录页且仍不套 RequireAuth', () => {
    expect(routerSrc).toContain("{ path: '/login', element: <LoginLoadBoundary><LoginPage /></LoginLoadBoundary> }")
  })
  it('延迟时有可访问加载态，完成后本地版仍跳转工作台', async () => {
    auth.value.authEnabled = false; auth.value.authMode = 'off'
    const gate = pendingLogin()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载登录页面…')
    await act(async () => gate.resolve())
    expect(await screen.findByText('本地工作台')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('延迟结束后线上版仍显示登录表单', async () => {
    auth.value.authEnabled = true; auth.value.authMode = 'session'
    const gate = pendingLogin()
    await act(async () => gate.resolve())
    expect(await screen.findByText('登录题库')).toBeInTheDocument()
    expect(screen.queryByText('本地工作台')).not.toBeInTheDocument()
  })
  it('拒绝时显示中文错误与有效刷新操作，错误 URL/秘密不进入 DOM', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = pendingLogin()
    await act(async () => gate.reject())
    expect(screen.getByRole('alert')).toHaveTextContent('登录页面暂时无法加载')
    expect(document.body.textContent).not.toMatch(/internal|password|secret|stack-token/)
    // jsdom 的 Location 为不可配置对象；仅替换 global window 的 location 读取，验证真实点击调用刷新。
    const reload = vi.fn()
    const browserWindow = window
    vi.stubGlobal('window', new Proxy(browserWindow, { get: (target, key) => key === 'location' ? { reload } : Reflect.get(target, key) }))
    fireEvent.click(screen.getByRole('button', { name: '刷新页面' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
