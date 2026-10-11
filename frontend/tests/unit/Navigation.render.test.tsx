/**
 * 导航渲染测试：真实渲染 `App` 侧栏，断言分组标题与各导航项都出现在界面上，
 * 且分组标题不进入键盘 Tab 序列、导航项本身可聚焦（P0-4 / P1-6 用户可见行为）。
 *
 * 需要 `QueryClientProvider`（`App` 内有健康检查 `useQuery`）+ `MemoryRouter`。
 * `api.get` 被 mock 掉，避免测试触发真实网络请求。
 */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../src/App'
import { renderWithTheme } from './testUtils'

// mock 掉 API 客户端：健康检查返回"正常"，测试不依赖后端。
vi.mock('../../src/api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  api: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
}))

/** 在真实主题 + QueryClient + MemoryRouter 下渲染 App。 */
function renderApp(initialPath = '/builder') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithTheme(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const GROUP_LABELS = ['日常备课', '数据治理']
const ITEM_LABELS = [
  '组卷工作台',
  '找题',
  '导出中心',
  '知识点复核',
  '公式复核',
  '来源文件',
  '题库统计',
  '系统设置',
]

describe('侧栏导航渲染', () => {
  it('顶部标题为教师向文案，不含「Web」等技术词', () => {
    renderApp()
    expect(screen.getByText('初中物理 · 题库与组卷')).toBeInTheDocument()
    expect(screen.queryByText(/Web/)).not.toBeInTheDocument()
  })

  it('两个分组标题都渲染出来', () => {
    renderApp()
    for (const label of GROUP_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('八个导航项全部渲染出来', () => {
    renderApp()
    for (const label of ITEM_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('分组标题不进入键盘 Tab 序列（无 tabindex，非交互元素）', () => {
    renderApp()
    for (const label of GROUP_LABELS) {
      expect(screen.getByText(label)).not.toHaveAttribute('tabindex')
    }
  })

  it('每个导航项都可键盘聚焦（Tab 能依次走到）', () => {
    renderApp()
    for (const label of ITEM_LABELS) {
      // 精确取标签文本节点，再上溯到可聚焦的 ListItemButton（role=button / tabindex=0）。
      const button = screen.getByText(label).closest('[role="button"]')
      expect(button).not.toBeNull()
      expect(button).toHaveAttribute('tabindex', '0')
    }
  })
})
