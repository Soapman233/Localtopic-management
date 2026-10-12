/**
 * `StatsPage` 页面级集成测试（阶段 2 遗留：页面级四态替换缺守护）。
 *
 * mock 方案：`vi.stubGlobal('fetch')` 返回 `{code,data,message}` 信封（见 pageTestUtils 注释）。
 * 覆盖：加载中 → LoadingState；有数据 → 渲染统计；请求失败 → ErrorState（含重试）。
 *
 * ⚠️ 本页只有一条主查询路径（`qk.stats()` → `getStats()`），聚焦它即可。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import StatsPage from '../../../src/pages/StatsPage'
import { qk } from '../../../src/api/queryKeys'
import type { StatsData } from '../../../src/api/types'
import { renderPage, jsonResponse, errorResponse, deferredResponse } from './pageTestUtils'

const statsFixture: StatsData = {
  sources: 3,
  questions: 42,
  formulas: 10,
  formulas_ok: 8,
  images: 5,
  labels: 6,
  review_open: 2,
  review_resolved: 1,
  formula_status: [{ status: 'OK', count: 8 }],
  by_stage: [{ key: '初中', count: 42 }],
  by_subject: [{ key: '物理', count: 42 }],
  by_grade: [{ key: '八年级下册', count: 42 }],
  by_textbook: [{ key: '苏科版', count: 42 }],
  by_qtype: [{ key: '选择题', count: 20 }],
  top_chapters: [{ key: '第7章 力', count: 12 }],
  answer_coverage: { total: 42, with_answer: 30, with_analysis: 10, by_source: {} },
  enrich_coverage: {
    source_files_total: 3,
    questions_total: 42,
    grade: { n: 42, total: 42, pct: 100 },
    textbook: { n: 40, total: 42, pct: 95 },
    chapter: { n: 42, total: 42, pct: 100 },
    qtype: { n: 42, total: 42, pct: 100 },
    difficulty: { n: 0, total: 42, pct: 0 },
    knowledge: { n: 10, total: 42, pct: 24 },
    answer: { n: 30, total: 42, pct: 71 },
    analysis: { n: 10, total: 42, pct: 24 },
    review_open: 2,
  },
  label_status: { 待复核: 1, 已确认: 3, 已否决: 0 },
  review: { open: 2, resolved: 1, total: 3, by_status: { UNSUPPORTED: 2 } },
}

describe('StatsPage 页面级集成', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载中 → 显示 LoadingState 文案', async () => {
    const d = deferredResponse()
    vi.stubGlobal('fetch', vi.fn(() => d.promise))
    renderPage(<StatsPage />)

    expect(screen.getByText('正在加载统计…')).toBeInTheDocument()
    // 释放挂起请求，让 client 的超时定时器被清掉（避免遗留 handle）。
    d.resolve(jsonResponse(statsFixture))
    await waitFor(() => expect(screen.queryByText('正在加载统计…')).not.toBeInTheDocument())
  })

  it('有数据 → 渲染统计（总览卡 + 分布），并写入 qk.stats() 缓存', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(statsFixture)))
    const { client } = renderPage(<StatsPage />)

    expect(await screen.findByText('题目总数')).toBeInTheDocument()
    expect(screen.getByText('题库统计')).toBeInTheDocument()
    expect(screen.getByText('题型分布')).toBeInTheDocument()
    // 用 qk 工厂断言缓存键（禁止内联数组）。
    expect(client.getQueryData(qk.stats())).toEqual(statsFixture)
  })

  it('请求失败 → 显示 ErrorState（含重试按钮），点重试会再次请求', async () => {
    const fetchMock = vi.fn(async () => errorResponse(50001, '服务内部错误，请稍后重试。', 500))
    vi.stubGlobal('fetch', fetchMock)
    renderPage(<StatsPage />)

    expect(await screen.findByText('加载统计失败')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /重试/ })
    const before = fetchMock.mock.calls.length
    fireEvent.click(retry)
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })
})

describe('B0 统计状态中文显示', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('待复核及转换状态全部中文化，空与未知状态不标为正常', async () => {
    const states = ['OK', 'UNSUPPORTED', 'EMPTY', 'FAIL', 'UNVERIFIED', 'NEW_CODE', 'OTHER_CODE', null, '']
    const fixture = { ...statsFixture, formula_status: states.map(status => ({ status, count: 1 })), review: { ...statsFixture.review, by_status: Object.fromEntries(states.filter(status => status !== null).map(status => [status, 1])) } }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(fixture)))
    renderPage(<StatsPage />)
    await screen.findByText('题目总数')
    for (const chinese of ['转换完成', '不支持', '未提取到内容', '转换失败', '待核对', '状态信息不可用，待核对']) expect(screen.getAllByText(chinese).length).toBeGreaterThan(0)
    expect(screen.getAllByText('状态信息不可用，待核对')).toHaveLength(4)
    expect(screen.getByText('转换完成 ' + statsFixture.formulas_ok.toLocaleString('zh-CN'))).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bOK\b/)
    expect(document.body.textContent).not.toMatch(/UNSUPPORTED|EMPTY|FAIL|UNVERIFIED|NEW_CODE|OTHER_CODE|OK 1/)
  })
})
