/**
 * T25 只读态（规范 §3.2 七态模型的只读态 / §4.2「disabled 必须有 Tooltip 说明为什么」）。
 *
 * 用 `lib/permissions` 的 `roleCan` **单一开关**模拟两种部署形态：
 * - `perms.allow = false` → 线上版只读账号（viewer）；
 * - `perms.allow = true`  → 有写权限（本地版单机全权的等价路径）。
 *
 * 断言两条：
 * 1. 只读账号下写操作 `disabled` 且给出「为什么」的教师语言说明（不是点了才被后端 403 拒绝）；
 * 2. 有权限时**控件可用、且不出现任何新增禁用或提示**（本地版零影响）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import QuestionCard from '../../src/components/QuestionCard'
import KnowledgeReviewPage from '../../src/pages/KnowledgeReviewPage'
import FormulaReviewPage from '../../src/pages/FormulaReviewPage'
import { renderWithTheme } from './testUtils'
import { renderPage, jsonResponse } from './pages/pageTestUtils'
import type { SearchItem } from '../../src/api/types'

const perms = vi.hoisted(() => ({ allow: true }))
vi.mock('../../src/lib/permissions', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/permissions')>()
  return { ...orig, roleCan: () => perms.allow }
})

const item = { id: 7, number: '7', plain_text: '计算 2**3' } as unknown as SearchItem

describe('T25 · QuestionCard 只读态', () => {
  it('无「加入」权限 → 按钮 disabled + Tooltip 说明为什么', async () => {
    renderWithTheme(
      <QuestionCard item={item} onAdd={vi.fn()} addDisabledReason="你的账号是只读权限，不能编辑试卷。如需权限请联系管理员。" />,
    )
    const add = screen.getByRole('button', { name: '加入' })
    expect(add).toBeDisabled()
    // MUI Tooltip 对 disabled 子元素不触发事件 → 外层 span 承接；在 span 上触发悬停即弹出提示。
    fireEvent.mouseOver(add.parentElement!)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('只读权限')
    expect(tip).toHaveTextContent('联系管理员')
  })

  it('有权限 → 按钮可用，且不渲染任何 Tooltip（本地版零影响）', () => {
    renderWithTheme(<QuestionCard item={item} onAdd={vi.fn()} />)
    expect(screen.getByRole('button', { name: '加入' })).toBeEnabled()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('无「标注难度」权限 → 按钮 disabled + Tooltip；有权限 → 可用', () => {
    const { unmount } = renderWithTheme(
      <QuestionCard item={item} onAdd={vi.fn()} onAnnotate={vi.fn()} annotateDisabledReason="你的账号是只读权限，不能修改题目。" />,
    )
    expect(screen.getByRole('button', { name: '标注难度' })).toBeDisabled()
    unmount()
    renderWithTheme(<QuestionCard item={item} onAdd={vi.fn()} onAnnotate={vi.fn()} />)
    expect(screen.getByRole('button', { name: '标注难度' })).toBeEnabled()
  })
})

// ───────────────────────────── 知识点复核（governance.review） ─────────────────────────────
const labelSummary = {
  summary: [{ label_id: 2, label_name: '压强', total: 80, pending: 50, confirmed: 20, rejected: 10 }],
  counts: { 待复核: 50, 已确认: 20, 已否决: 10 },
  namespace: '知识点',
  status: null,
}
const labelItems = {
  total: 1,
  items: [{ question_id: 101, number: '1', snippet: '压强题干', source: 'A.docx', review_status: '待复核' }],
  limit: 50, offset: 0, label_id: 2, label_name: '压强', status: '待复核',
}
function stubLabels() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/labels/review-summary')) return jsonResponse(labelSummary)
    if (url.includes('/api/labels/review-items')) return jsonResponse(labelItems)
    return jsonResponse({})
  }))
}

describe('T25 · KnowledgeReviewPage 只读态', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('只读账号：批量确认/否决 disabled，且就地说明「为什么」', async () => {
    perms.allow = false
    stubLabels()
    renderPage(<KnowledgeReviewPage />)
    fireEvent.click(await screen.findByRole('button', { name: '压强 · 待复核 50' }))
    const confirm = await screen.findByRole('button', { name: '批量确认待复核' })
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量否决待复核' })).toBeDisabled()
    // 逐条按钮同样禁用（只读账号不能做任何复核决定）。
    expect(await screen.findByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '否决' })).toBeDisabled()
    // 「为什么」在右侧面板内说明一次。
    expect(screen.getByText(/不能处理复核项/)).toBeInTheDocument()
  })

  it('有权限：批量与逐条按钮均可用（零影响）', async () => {
    perms.allow = true
    stubLabels()
    renderPage(<KnowledgeReviewPage />)
    fireEvent.click(await screen.findByRole('button', { name: '压强 · 待复核 50' }))
    expect(await screen.findByRole('button', { name: '批量确认待复核' })).toBeEnabled()
    expect(await screen.findByRole('button', { name: '确认' })).toBeEnabled()
    expect(screen.queryByText(/不能处理复核项/)).toBeNull()
  })
})

// ───────────────────────────── 公式复核（governance.review） ─────────────────────────────
function stubFormula() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/review/summary')) return jsonResponse({ total: 1, open: 1, resolved: 0, by_status: { UNSUPPORTED: 1 } })
    if (url.includes('/api/review')) return jsonResponse({ total: 1, items: [{ id: 5, status: 'UNSUPPORTED', resolved: 0, question_id: 101, number: '1', question_text: '题干', file_name: 'A.docx' }] })
    return jsonResponse({})
  }))
}

describe('T25 · FormulaReviewPage 只读态', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('只读账号：「标记已处理」disabled + Tooltip 说明；有权限时可用', async () => {
    perms.allow = false
    stubFormula()
    const first = renderPage(<FormulaReviewPage />)
    const btn = await screen.findByRole('button', { name: /标记已处理/ })
    expect(btn).toBeDisabled()
    fireEvent.mouseOver(btn.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('只读权限')
    first.unmount()

    perms.allow = true
    renderPage(<FormulaReviewPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /标记已处理/ })).toBeEnabled())
  })
})
