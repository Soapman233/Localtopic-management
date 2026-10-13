/**
 * `SearchPage` 页面级结构守护（本轮表现层对齐）。
 *
 * 只断言**与检索语义无关**的结构契约（查询参数 / 筛选 / 排序 / 分页一律不动）：
 * 1. 页头由 `PageHeader` 渲染，整页**恰好一个 h1**（「找题」）——对齐 A11y 硬约束；
 * 2. 关键词检索输入框保留（现有功能不丢）；
 * 3. 页头操作区提供「重置筛选」。
 *
 * 渲染需 `AuthProvider`（`usePermissionGuard` → `useAuth`），故用 `renderWithProviders`
 * 叠加 `MemoryRouter`；fetch 在边界打桩（信封响应），与其它页面级测试同构。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from '../../../src/pages/SearchPage'
import { renderWithProviders } from '../testUtils'
import { jsonResponse } from './pageTestUtils'

function renderSearch() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/search']}>
      <SearchPage />
    </MemoryRouter>,
  )
}

describe('SearchPage 页头结构', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('整页恰好一个 h1，且为「找题」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    renderSearch()
    const h1 = await screen.findByRole('heading', { level: 1, name: '找题' })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('保留关键词检索输入框（现有功能不丢）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    renderSearch()
    expect(await screen.findByPlaceholderText('搜索题干关键词')).toBeInTheDocument()
  })

  it('页头操作区提供「重置筛选」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    renderSearch()
    expect(await screen.findByRole('button', { name: '重置筛选' })).toBeInTheDocument()
  })
})
