/**
 * 阶段 5 无障碍语义守护（P5-3）。
 *
 * 覆盖四类**可被 jsdom 稳定断言**的语义：
 * 1. `documentTitleForPath`：路由 → 文档标题的纯函数映射（含未知路由兜底）；
 * 2. App 外壳：skip-link（「跳到主内容」）/ `<main>` 地标 / `<nav>` 地标 / 当前页 `aria-current`；
 * 3. 页面标题层级：每个页面渲染后**恰好一个 h1**（以设置页为例）；
 * 4. Drawer 可访问名：`aria-labelledby` 指向可见标题（MUI Drawer 不自动派生，故需守护）。
 *
 * ⚠️ 边界：jsdom **不能**验证「焦点是否真的可见」「Tab 顺序」「读屏是否播报」，
 * 这些由 `.tmp_verify/phase3_keyboard_e2e.mjs`（真实浏览器）与人工核验覆盖。
 * 本文件只断言 DOM 语义属性，不宣称「已无障碍」。
 *
 * 已知限制（记于 `tests/visual/contrast-pairs.json` 的 `knownIssues`）：
 * 排版预览内 `.lp-qhandle/.lp-score-chip/.lp-qdel` 因外层 `scale(0.72)`，渲染命中区 ≈17px < 24；
 * 同样操作在「清单视图」(PaperPanel) 有 ≥24px 合规入口，功能未对键盘/触控关闭。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App, { BASE_TITLE, documentTitleForPath } from '../../src/App'
import SettingsPage from '../../src/pages/SettingsPage'
import { EmptyState } from '../../src/components/EmptyState'
import type { SettingsData } from '../../src/api/types'
import { renderWithTheme } from './testUtils'
import { renderPage, jsonResponse } from './pages/pageTestUtils'

// mock 掉 API 客户端：健康检查 / 试卷列表返回空数据，测试不依赖后端。
vi.mock('../../src/api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  api: { get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })) },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
}))

/** 在真实主题 + QueryClient + MemoryRouter 下渲染 App 外壳。 */
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

describe('documentTitleForPath（路由 → 文档标题）', () => {
  it('已知导航路由 → 「页面名 · 初中物理题库」', () => {
    expect(documentTitleForPath('/builder')).toBe('组卷工作台 · 初中物理题库')
    expect(documentTitleForPath('/manage/stats')).toBe('题库统计 · 初中物理题库')
    expect(documentTitleForPath('/settings')).toBe('系统设置 · 初中物理题库')
  })

  it('题目详情路由 → 固定文案', () => {
    expect(documentTitleForPath('/question/123')).toBe('题目详情 · 初中物理题库')
  })

  it('未知路由 / 根路径 → 基础标题兜底', () => {
    expect(documentTitleForPath('/')).toBe(BASE_TITLE)
    expect(documentTitleForPath('/not-exist')).toBe(BASE_TITLE)
  })
})

describe('App 外壳无障碍语义', () => {
  it('skip-link 存在、指向 #main-content、且带中文可访问名', () => {
    renderApp()
    const skip = screen.getByRole('link', { name: '跳到主内容' })
    expect(skip).toHaveAttribute('href', '#main-content')
  })

  it('skip-link 位于侧栏导航之前（DOM 顺序靠前，便于首次 Tab 直达）', () => {
    renderApp()
    const skip = screen.getByRole('link', { name: '跳到主内容' })
    const nav = screen.getByRole('navigation', { name: '主导航' })
    // skip-link 必须先于 nav 出现（compareDocumentPosition 的 FOLLOWING 位表示 nav 在 skip 之后）。
    expect(skip.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('主内容区是 <main> 地标，且带 id="main-content" 作为 skip-link 目标', () => {
    renderApp()
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
  })

  it('侧栏是带可访问名的 <nav> 地标', () => {
    renderApp()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })

  it('当前页导航项带 aria-current="page"，非当前项不带', () => {
    renderApp('/builder')
    // 选中的「组卷工作台」应带 aria-current。
    expect(screen.getByText('组卷工作台').closest('[aria-current="page"]')).not.toBeNull()
    // 未选中的「找题」不应带 aria-current。
    expect(screen.getByText('找题').closest('[aria-current]')).toBeNull()
  })

  it('切换到另一路由后，aria-current 随之迁移', () => {
    renderApp('/manage/stats')
    expect(screen.getByText('题库统计').closest('[aria-current="page"]')).not.toBeNull()
    expect(screen.getByText('组卷工作台').closest('[aria-current]')).toBeNull()
  })
})

describe('页面标题层级（以设置页为例）', () => {
  const settingsFixture: SettingsData = {
    db_path: 'C:/qb/bank.db',
    export_dir: 'C:/qb/exports',
    default_template: '考试',
    katex: { throw_on_error: false, strict: true },
    theme: { primary: '#3370FF', dark: false },
  }

  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('页面有且仅有一个 h1，且为页面主标题', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(settingsFixture)))
    renderPage(<SettingsPage />)

    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('系统设置')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('区块标题是 h2（不跳级到 h6）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(settingsFixture)))
    renderPage(<SettingsPage />)

    const h2s = await screen.findAllByRole('heading', { level: 2 })
    const texts = h2s.map((h) => h.textContent)
    expect(texts).toContain('数据库')
    expect(texts).toContain('导出')
  })
})

describe('组件内「伪标题」已消除（P5-3）', () => {
  it('EmptyState 标题渲染为普通元素而非 heading（避免 h1→h6 跳级）', () => {
    renderWithTheme(<EmptyState title="暂无结果" description="换个关键词试试" />)
    // 提示文案不应进入标题大纲。
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('暂无结果')).toBeInTheDocument()
  })
})

describe('Drawer 可访问名（P5-3）', () => {
  it('「切换试卷」抽屉打开后，可见标题被 aria-labelledby 引用（Drawer 不自动派生）', () => {
    renderApp('/builder')
    // 桌面宽度下触发控件是文字按钮「试卷列表」（窄屏才是同名 IconButton）。
    fireEvent.click(screen.getByRole('button', { name: '试卷列表' }))
    // 抽屉标题是真实 h2，且带被 aria-labelledby 引用的 id。
    const title = screen.getByRole('heading', { level: 2, name: '切换试卷' })
    expect(title).toHaveAttribute('id', 'paper-switch-drawer-title')
    // 必须存在某个元素通过 aria-labelledby 指向它（否则读屏只会念「对话框」）。
    expect(document.querySelector('[aria-labelledby="paper-switch-drawer-title"]')).not.toBeNull()
  })
})
