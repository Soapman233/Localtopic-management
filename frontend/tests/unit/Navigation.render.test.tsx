/**
 * 导航渲染测试：真实渲染 `App` 侧栏，断言分组标题与各导航项都出现在界面上，
 * 且分组标题不进入键盘 Tab 序列、导航项本身可聚焦（P0-4 / P1-6 用户可见行为）。
 *
 * 需要 `QueryClientProvider`（`App` 内有健康检查 `useQuery`）+ `MemoryRouter`。
 * `api.get` 被 mock 掉，避免测试触发真实网络请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../src/app/auth/AuthProvider'
import { usePaperLibraryStore } from '../../src/store/paperLibraryStore'
import App from '../../src/App'
import { renderWithTheme } from './testUtils'

beforeEach(() => usePaperLibraryStore.setState({ open: false }))

// mock 掉 API 客户端：健康检查返回"正常"，测试不依赖后端。
vi.mock('../../src/api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  api: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  // 阶段 4：AuthProvider 依赖这些导出；测试替身需同步（否则 vitest 会报
  // "No ... export is defined on the mock"）。返回 no-op，让被测组件按本地版语义渲染。
  setAuthToken: vi.fn(),
  getAuthToken: vi.fn(() => null),
  setUnauthorizedHandler: vi.fn(),
}))

/** 在真实主题 + QueryClient + MemoryRouter 下渲染 App。 */
function renderApp(initialPath = '/builder') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithTheme(
    <QueryClientProvider client={queryClient}>
        {/* 阶段 4：App 内含 SessionControls/SessionNotice，需要 AuthProvider（与生产 main.tsx 同构）。 */}
        <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
        </AuthProvider>
    </QueryClientProvider>,
  )
}

const GROUP_LABELS = ['日常', '数据维护']
const ITEM_LABELS = ['组卷工作台', '找题', '数据维护', '设置']

describe('侧栏导航渲染', () => {
  it('顶部标题为教师向文案，不含「Web」等技术词', () => {
    renderApp()
    expect(screen.getByText('初中物理 · 题库与组卷')).toBeInTheDocument()
    expect(screen.queryByText(/Web/)).not.toBeInTheDocument()
  })

  it('两个分组标题都渲染出来', () => {
    renderApp()
    for (const label of GROUP_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('维护默认折叠，展开后四个逻辑导航项可达', () => {
    renderApp()
    expect(screen.getByRole('button', { name: '展开数据维护' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: '展开数据维护' }))
    for (const label of ITEM_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('日常标题不入Tab序列，维护触发器可键盘展开', () => {
    renderApp()
    expect(screen.getByText('日常')).not.toHaveAttribute('tabindex')
    expect(screen.getByRole('button', { name: '展开数据维护' })).toHaveAttribute('tabindex', '0')
  })

  it('每个导航项都可键盘聚焦（Tab 能依次走到）', () => {
    renderApp('/manage/knowledge')
    for (const label of ITEM_LABELS) {
      // 精确取标签文本节点，再上溯到可聚焦的 ListItemButton（role=button / tabindex=0）。
      const button = screen.getAllByText(label).map(node => node.closest('[role="button"]')).find(node => node && !node.hasAttribute('aria-expanded'))
      expect(button).toBeTruthy()
      expect(button).toHaveAttribute('tabindex', '0')
    }
  })
})
