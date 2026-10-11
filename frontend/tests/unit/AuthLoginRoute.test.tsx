/**
 * 登录页两版适配测试（阶段 4 / P1-2 + 目标形状新增状态）。
 *
 * 覆盖：
 * - **本地版**（`auth_enabled === false`）访问 `/login` → 重定向到默认落地页，不显示登录表单；
 * - **线上版**未登录 → 显示登录表单；
 * - **待初始化管理员**（`needs_setup`）→ 显示建号指引，不显示登录表单；
 * - **鉴权库不可用**（`auth_mode === 'error'`）→ 显示「鉴权服务不可用」，不显示登录表单；
 * - 鉴权状态读取中 → 显示加载态（避免误判为本地版而闪跳）。
 *
 * 这里**直接 mock `useAuth`**：本用例只验证登录页在不同鉴权状态下的**渲染分支**，
 * 不依赖 AuthProvider 内部实现（其行为由 `AuthProvider.test.tsx` 与浏览器探针覆盖）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from '../../src/pages/LoginPage'
import { renderWithTheme } from './testUtils'

const useAuthMock = vi.fn()

vi.mock('../../src/app/auth/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}))

// 只借用默认落地页常量，避免把整个 router（含 createHashRouter 副作用）拉进用例。
vi.mock('../../src/router', () => ({
  DEFAULT_LANDING_PATH: '/builder',
}))

/** 基础上下文：线上版、已就绪、未登录。 */
const BASE = {
  login: vi.fn(),
  user: null,
  role: 'viewer' as const,
  authEnabled: true,
  loading: false,
  authMode: 'session' as const,
  needsSetup: false,
}

function renderLogin() {
  return renderWithTheme(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/builder" element={<div>组卷工作台落地页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage · 两版适配与异常状态', () => {
  beforeEach(() => useAuthMock.mockReset())

  it('本地版（auth_enabled=false）访问 /login → 重定向到默认落地页，不显示登录表单', () => {
    useAuthMock.mockReturnValue({ ...BASE, authEnabled: false, authMode: 'off' })
    renderLogin()
    expect(screen.getByText('组卷工作台落地页')).toBeInTheDocument()
    expect(screen.queryByText('登录题库')).not.toBeInTheDocument()
  })

  it('线上版未登录 → 显示登录表单', () => {
    useAuthMock.mockReturnValue({ ...BASE })
    renderLogin()
    expect(screen.getByText('登录题库')).toBeInTheDocument()
    expect(screen.getByTestId('login-submit')).toBeInTheDocument()
  })

  it('待初始化管理员（needs_setup）→ 显示建号指引，不显示登录表单', () => {
    useAuthMock.mockReturnValue({
      ...BASE,
      authEnabled: false,
      authMode: 'uninitialized',
      needsSetup: true,
    })
    renderLogin()
    expect(screen.getByText('尚未初始化管理员')).toBeInTheDocument()
    expect(screen.queryByText('登录题库')).not.toBeInTheDocument()
    // 未登录时也不该误重定向到落地页
    expect(screen.queryByText('组卷工作台落地页')).not.toBeInTheDocument()
  })

  it('鉴权库不可用（auth_mode=error）→ 显示「鉴权服务不可用」，不显示登录表单', () => {
    useAuthMock.mockReturnValue({ ...BASE, authEnabled: false, authMode: 'error' })
    renderLogin()
    expect(screen.getByText('鉴权服务不可用')).toBeInTheDocument()
    expect(screen.queryByText('登录题库')).not.toBeInTheDocument()
  })

  it('鉴权状态读取中 → 显示加载态（不误判为本地版而闪跳）', () => {
    useAuthMock.mockReturnValue({ ...BASE, loading: true, authEnabled: false, authMode: 'off' })
    renderLogin()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('组卷工作台落地页')).not.toBeInTheDocument()
    expect(screen.queryByText('登录题库')).not.toBeInTheDocument()
  })
})
