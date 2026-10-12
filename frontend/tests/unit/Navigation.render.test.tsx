/**
 * 导航渲染测试：真实渲染 `App` 侧栏，断言分组标题与各导航项都出现在界面上，
 * 且分组标题不进入键盘 Tab 序列、导航项本身可聚焦（B1 信息架构重构）。
 *
 * 覆盖：
 * - 日常分组（导入 / 组卷 / 找题）+ 设置常显；
 * - 低频「数据维护」分组**默认折叠**（MUI Collapse），触发器带 aria-expanded / aria-controls；
 * - 点击触发器展开；直接访问 /manage/* 自动展开并高亮。
 *
 * 需要 `QueryClientProvider`（`App` 内有健康检查 `useQuery`）+ `MemoryRouter`。
 * `api.get` 被 mock 掉，避免测试触发真实网络请求。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../src/app/auth/AuthProvider'
import App from '../../src/App'
import { renderWithTheme } from './testUtils'

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

/** 折叠态下可见的导航项（「数据维护」子项默认不挂载，故不在其中）。 */
const VISIBLE_ITEM_LABELS = ['导入试卷', '组卷工作台', '找题', '数据维护', '设置']

describe('侧栏导航渲染', () => {
  it('顶部标题为教师向文案，不含「Web」等技术词', () => {
    renderApp()
    expect(screen.getByText('初中物理 · 题库与组卷')).toBeInTheDocument()
    expect(screen.queryByText(/Web/)).not.toBeInTheDocument()
  })

  it('两个分组标题都渲染出来', () => {
    renderApp()
    for (const label of ['日常', '数据维护']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('折叠态下五个导航项全部渲染出来', () => {
    renderApp()
    for (const label of VISIBLE_ITEM_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('「日常」分组标题不进入键盘 Tab 序列（无 tabindex，非交互元素）', () => {
    renderApp()
    expect(screen.getByText('日常')).not.toHaveAttribute('tabindex')
  })

  it('每个可见导航项都可键盘聚焦（Tab 能依次走到）', () => {
    renderApp()
    for (const label of VISIBLE_ITEM_LABELS) {
      // 精确取标签文本节点，再上溯到可聚焦的 ListItemButton（role=button / tabindex=0）。
      const button = screen.getByText(label).closest('[role="button"]')
      expect(button).not.toBeNull()
      expect(button).toHaveAttribute('tabindex', '0')
    }
  })

  it('低频「数据维护」分组默认折叠：触发器 aria-expanded=false，子项未挂载', () => {
    renderApp()
    const trigger = screen.getByRole('button', { name: '展开数据维护分组' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls', 'nav-manage-region')
    // 仅触发器一处「数据维护」文本（子项被 Collapse 卸载）。
    expect(screen.getAllByText('数据维护')).toHaveLength(1)
  })

  it('点击触发器展开分组并挂载「数据维护」子项', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: '展开数据维护分组' }))
    const trigger = screen.getByRole('button', { name: '收起数据维护分组' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // 触发器 + 子项 = 两处「数据维护」。
    expect(screen.getAllByText('数据维护')).toHaveLength(2)
  })

  it('直接访问 /manage/* 时自动展开并高亮「数据维护」', () => {
    renderApp('/manage/stats')
    expect(screen.getByRole('button', { name: '收起数据维护分组' })).toHaveAttribute('aria-expanded', 'true')
    const current = document.querySelector('[aria-current="page"]')
    expect(current).not.toBeNull()
    expect(current).toHaveTextContent('数据维护')
  })
})
