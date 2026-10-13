/**
 * `QuestionDetailPage` 页面级结构守护（本轮表现层对齐）。
 *
 * 断言**结构契约**，不触碰任何数据/编辑语义：
 * 1. 页头由 `PageHeader` 渲染，整页**恰好一个 h1**（「题 9」）；
 * 2. 面包屑自动派生成「找题 › 题 9」（`currentLabel` 覆盖末级）；
 * 3. 右侧「来源 / 历史」上下文面板存在，且来源文件信息**不隐藏**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import QuestionDetailPage from '../../../src/pages/QuestionDetailPage'
import type { Question } from '../../../src/api/types'
import { renderWithProviders } from '../testUtils'
import { jsonResponse } from './pageTestUtils'

const questionFixture: Question = {
  id: 9,
  source_id: 1,
  number: '9',
  text: '题干文本',
  version: 1,
  src_file: '八年级物理下册期末卷.docx',
}

function renderDetail() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/question/9']}>
      <Routes>
        <Route path="/question/:id" element={<QuestionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('QuestionDetailPage 页头与上下文面板', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('整页恰好一个 h1，且为「题 9」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(questionFixture)))
    renderDetail()
    const h1 = await screen.findByRole('heading', { level: 1, name: '题 9' })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('面包屑自动派生成「找题 › 题 9」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(questionFixture)))
    renderDetail()
    // 先等数据加载完成（加载态面包屑末级是「题目详情」，题号来自数据）。
    await screen.findByRole('heading', { level: 1, name: '题 9' })
    const nav = screen.getByLabelText('面包屑导航')
    expect(nav.textContent).toContain('找题')
    expect(nav.textContent).toContain('题 9')
  })

  it('「来源 / 历史」收进抽屉：默认关闭，点页头入口后可见来源文件信息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(questionFixture)))
    renderDetail()

    // R05（= ③）：右栏由**内联面板**改为**抽屉**——默认关闭，
    // 信息不隐藏，但必须有一个显式入口（否则来源/历史无处可点）。
    expect(screen.queryByRole('dialog', { name: '来源 / 历史' })).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /来源 \/ 历史/ }))

    const drawer = await screen.findByRole('dialog', { name: '来源 / 历史' })
    expect(drawer).toBeInTheDocument()
    expect(within(drawer).getByText('八年级物理下册期末卷.docx')).toBeInTheDocument()
  })
})
