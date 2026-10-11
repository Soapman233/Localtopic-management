/**
 * `FormulaReviewPage` 页面级集成测试（阶段 2 遗留：页面级四态替换缺守护）。
 *
 * mock 方案：`vi.stubGlobal('fetch')` 按 URL 分发，返回 `{code,data,message}` 信封。
 * 覆盖：加载中 → LoadingState；空队列 → EmptyState（队列已清零）；请求失败 → ErrorState。
 *
 * ⚠️ 本页有两条查询（summary + list）。列表态（loading / empty / error）由 `listQ` 驱动，
 * 故仅聚焦列表主路径；summary 一律返回成功，避免把测试写成一团。
 * 未覆盖：分页、切换 tab、标记已处理等交互（属组件行为，非本次四态守护目标）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import FormulaReviewPage from '../../../src/pages/FormulaReviewPage'
import { renderPage, jsonResponse, errorResponse, deferredResponse } from './pageTestUtils'

const summaryOk = { open: 0, resolved: 0, total: 0, by_status: {} }
const emptyList = { total: 0, items: [], limit: 50, offset: 0 }

/** 按 URL 分发：summary 成功、list 用传入响应。 */
function mockFetchWithList(listResponse: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/review/summary')) return jsonResponse(summaryOk)
    if (url.includes('/api/review')) return listResponse()
    return errorResponse(40404, '资源不存在', 404)
  })
}

describe('FormulaReviewPage 页面级集成', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载中 → 显示 LoadingState 文案', async () => {
    const d = deferredResponse()
    // summary 也一并挂起；list 挂起即触发 LoadingState。
    vi.stubGlobal('fetch', vi.fn(() => d.promise))
    renderPage(<FormulaReviewPage />)

    expect(screen.getByText('正在加载复核队列…')).toBeInTheDocument()
    d.resolve(jsonResponse(emptyList))
    await waitFor(() => expect(screen.queryByText('正在加载复核队列…')).not.toBeInTheDocument())
  })

  it('空队列 → 显示 EmptyState（队列已清零）', async () => {
    vi.stubGlobal('fetch', mockFetchWithList(() => jsonResponse(emptyList)))
    renderPage(<FormulaReviewPage />)

    expect(await screen.findByText('队列已清零')).toBeInTheDocument()
  })

  it('请求失败 → 显示 ErrorState（含重试按钮）', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchWithList(() => errorResponse(50001, '服务内部错误，请稍后重试。', 500)),
    )
    renderPage(<FormulaReviewPage />)

    expect(await screen.findByText('加载队列失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })
})
