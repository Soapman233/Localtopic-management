/**
 * B4 维护页与设置页重构护栏。
 *
 * 覆盖（全部走 `vi.stubGlobal('fetch')` 的信封 mock，与页面测试同一方案）：
 * - 知识点复核：标签按待复核降序、待复核 Top5 可点击、批量**先预检**、取消不写；
 * - 公式复核：主从详情切换后正文 / fid / 源图**对应同一项**，长题干可展开；
 * - 来源文件：三种缺失值均进入缺失筛选、正常值不误判；详情路径默认折叠；
 * - 题库统计：分布默认 Top5、展开为全部、条形**分母按完整 rows**（非可见行）；
 * - 设置页：高级默认只读、外观保存**只发外观字段**、高级保存**只发修改项**、取消不写。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import KnowledgeReviewPage from '../../src/pages/KnowledgeReviewPage'
import FormulaReviewPage from '../../src/pages/FormulaReviewPage'
import SourcesPage from '../../src/pages/SourcesPage'
import StatsPage from '../../src/pages/StatsPage'
import SettingsPage from '../../src/pages/SettingsPage'
import type { SettingsData } from '../../src/api/types'
import { renderPage, jsonResponse, errorResponse } from './pages/pageTestUtils'

interface Call { url: string; method: string; body: unknown }

/** 安装一个按 URL 分发的 fetch 桩，并把调用记录进 `calls`。 */
function stubFetch(calls: Call[], routes: Array<[string, () => Response]>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    for (const [frag, make] of routes) if (url.includes(frag)) return make()
    return errorResponse(40404, '资源不存在', 404)
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

// ───────────────────────────── B4-1 知识点复核 ─────────────────────────────
const labelSummary = {
  summary: [
    { label_id: 1, label_name: '浮力', total: 100, pending: 30, confirmed: 60, rejected: 10 },
    { label_id: 2, label_name: '压强', total: 80, pending: 50, confirmed: 20, rejected: 10 },
    { label_id: 3, label_name: '密度', total: 60, pending: 0, confirmed: 60, rejected: 0 },
    { label_id: 4, label_name: '功', total: 40, pending: 5, confirmed: 35, rejected: 0 },
    { label_id: 5, label_name: '功率', total: 20, pending: 3, confirmed: 17, rejected: 0 },
    { label_id: 6, label_name: '机械能', total: 10, pending: 1, confirmed: 9, rejected: 0 },
  ],
  counts: { 待复核: 89, 已确认: 201, 已否决: 20 },
  namespace: '知识点',
  status: null,
}
const labelItems = {
  total: 1,
  items: [{ question_id: 101, number: '1', snippet: '压强题干', source: 'A.docx', review_status: '待复核' }],
  limit: 50, offset: 0, label_id: 2, label_name: '压强', status: '待复核',
}
const decisionPreview = {
  found: true, label_id: 2, label_name: '压强', decision: '确认',
  matched: 80, pending: 50, will_update: 50, question_id: null,
}
function labelRoutes(calls: Call[]) {
  return [
    ['/api/labels/decision/preview', () => jsonResponse(decisionPreview)],
    ['/api/labels/decision', () => jsonResponse({ label_id: 2, label_name: '压强', decision: '确认', updated: 50, matched: 80, already_decided: 0 })],
    ['/api/labels/review-summary', () => jsonResponse(labelSummary)],
    ['/api/labels/review-items', () => jsonResponse(labelItems)],
  ] as Array<[string, () => Response]>
}

describe('B4-1 知识点复核', () => {
  it('未选择时右侧显示待复核最多的前五个标签，按待复核降序且可点击进入', async () => {
    const calls: Call[] = []
    stubFetch(calls, labelRoutes(calls))
    renderPage(<KnowledgeReviewPage />)

    const top = await screen.findAllByRole('button', { name: /· 待复核/ })
    expect(top.map((b) => b.textContent)).toEqual([
      '压强 · 待复核 50', '浮力 · 待复核 30', '功 · 待复核 5', '功率 · 待复核 3', '机械能 · 待复核 1',
    ])

    fireEvent.click(screen.getByRole('button', { name: '压强 · 待复核 50' }))
    await waitFor(() => expect(
      calls.some((c) => c.url.includes('/api/labels/review-items') && decodeURIComponent(c.url).includes('label_name=压强')),
    ).toBe(true))
    // 页面加载与切标签均不自动调用决定接口。
    expect(calls.some((c) => c.url.includes('/api/labels/decision') && !c.url.includes('/preview'))).toBe(false)
  })

  it('CSV 导出 / 导入收进「批量处理」菜单（不再占顶栏）', async () => {
    const calls: Call[] = []
    stubFetch(calls, labelRoutes(calls))
    renderPage(<KnowledgeReviewPage />)

    await screen.findByText('压强')
    // 顶栏不再直接出现 CSV 按钮。
    expect(screen.queryByRole('link', { name: /导出待复核 CSV/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批量处理' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /导出待复核 CSV/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /导入复核 CSV/ })).toBeInTheDocument()
  })

  it('「有待复核」筛选隐藏无待复核标签', async () => {
    const calls: Call[] = []
    stubFetch(calls, labelRoutes(calls))
    renderPage(<KnowledgeReviewPage />)

    await screen.findByText('密度')
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.queryByText('密度')).not.toBeInTheDocument())
    // 仍有待复核的标签保留。
    expect(screen.getAllByText('压强').length).toBeGreaterThan(0)
  })

  it('批量先预检、取消不发决定请求；确认时带 confirm=true 且不覆盖已有决定', async () => {
    const calls: Call[] = []
    stubFetch(calls, labelRoutes(calls))
    renderPage(<KnowledgeReviewPage />)

    fireEvent.click(await screen.findByRole('button', { name: '压强 · 待复核 50' }))
    await screen.findByText('压强题干')

    // 取消路径：先预检，确认框显示真实影响数 50，取消后不写库。
    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('50')).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/api/labels/decision/preview'))).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.some((c) => c.url.includes('/api/labels/decision') && !c.url.includes('/preview'))).toBe(false)

    // 确认路径：提交 confirm=true。
    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.some((c) =>
      c.url.endsWith('/api/labels/decision') && (c.body as { confirm?: boolean })?.confirm === true,
    )).toBe(true))
  })
})

// ───────────────────────────── B4-2 公式复核 ─────────────────────────────
const longText = '这是一段很长的题干内容用于验证折叠展开'.repeat(8)
const reviewSummaryOk = { open: 2, resolved: 0, total: 2, by_status: { UNSUPPORTED: 1, EMPTY: 1 } }
const reviewList = {
  total: 2, limit: 50, offset: 0,
  items: [
    { id: 1, question_id: 11, number: '1', status: 'UNSUPPORTED', resolved: 0, kind: 'mathtype', part: 'embeddings/ole1.bin', reason: 'r1', question_text: longText, fid: 'F1', latex: 'a+b', preview_url: '/p1.png', file_name: 'A.docx' },
    { id: 2, question_id: 22, number: '2', status: 'EMPTY', resolved: 0, question_text: '第二条题干', fid: 'F2', latex: 'c+d', preview_url: '/p2.png', file_name: 'B.docx' },
  ],
}
describe('B4-2 公式复核主从详情', () => {
  it('切换选中项后正文 / fid / 源图对应同一项；长题干可展开', async () => {
    const calls: Call[] = []
    stubFetch(calls, [
      ['/api/review/summary', () => jsonResponse(reviewSummaryOk)],
      ['/api/review', () => jsonResponse(reviewList)],
    ])
    renderPage(<FormulaReviewPage />)

    // 默认聚焦第一条：正文与源图属于第 1 项；长题干全文仍在 DOM（不丢字）。
    expect(await screen.findByText(new RegExp(longText.slice(0, 12)))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(longText))).toBeInTheDocument()
    expect(screen.getByAltText('公式 F1 的源预览')).toBeInTheDocument()

    // 切到第二条：正文、fid、源图必须一起换。
    fireEvent.click(screen.getByRole('button', { name: /题 2/ }))
    await waitFor(() => expect(screen.getByAltText('公式 F2 的源预览')).toBeInTheDocument())
    expect(screen.getByText(/第二条题干/)).toBeInTheDocument()
    expect(screen.queryByAltText('公式 F1 的源预览')).not.toBeInTheDocument()
  })

  it('长题干提供展开按钮且切换为收起', async () => {
    const calls: Call[] = []
    stubFetch(calls, [
      ['/api/review/summary', () => jsonResponse(reviewSummaryOk)],
      ['/api/review', () => jsonResponse(reviewList)],
    ])
    renderPage(<FormulaReviewPage />)
    const expand = await screen.findByRole('button', { name: '展开全文' })
    fireEvent.click(expand)
    expect(await screen.findByRole('button', { name: '收起全文' })).toBeInTheDocument()
  })
})

// ───────────────────────────── B4-3 来源文件 ─────────────────────────────
const sourceRows = [
  { id: 1, file_name: 'A.docx', stage: '初中', grade: '八年级下册', subject: '物理', textbook: '苏科版', chapter: null, questions_count: 30, formulas_count: 4 },
  { id: 2, file_name: '空串.docx', stage: null, grade: '   ', subject: null, textbook: null, chapter: null, questions_count: 5, formulas_count: 0 },
  { id: 3, file_name: '待补充.docx', stage: null, grade: '待补充', subject: null, textbook: '待补充', chapter: null, questions_count: 5, formulas_count: 0 },
]
const sourceDetail = {
  source: { id: 1, path: 'D:/题库/原始/A.docx', file_name: 'A.docx', grade: '八年级下册', textbook: '苏科版', grade_source: 'manual', textbook_source: null },
  questions_count: 30, formulas_count: 4,
  coverage: { chapter: { n: 10, total: 30, pct: 33 } },
  question_ids_preview: [1, 2],
}
describe('B4-3 来源文件', () => {
  it('NULL / 空串 /「待补充」均进入缺失筛选，正常值不误判；缺失单元格用「—」', async () => {
    const calls: Call[] = []
    stubFetch(calls, [
      ['/api/sources/1', () => jsonResponse(sourceDetail)],
      ['/api/sources', () => jsonResponse(sourceRows)],
    ])
    renderPage(<SourcesPage />)

    // 三行都渲染；缺失单元格用「—」。
    expect(await screen.findByText('A.docx')).toBeInTheDocument()
    expect(screen.getByText('空串.docx')).toBeInTheDocument()
    expect(screen.getByText('待补充.docx')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/缺失/).length).toBeGreaterThan(0)

    // 开启「仅看元数据缺失」→ 仅正常值 A.docx 被过滤掉。
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.queryByText('A.docx')).not.toBeInTheDocument())
    expect(screen.getByText('空串.docx')).toBeInTheDocument()
    expect(screen.getByText('待补充.docx')).toBeInTheDocument()
  })

  it('详情默认不显示绝对路径，「文件位置」展开后可读', async () => {
    const calls: Call[] = []
    stubFetch(calls, [
      ['/api/sources/1', () => jsonResponse(sourceDetail)],
      ['/api/sources', () => jsonResponse(sourceRows)],
    ])
    renderPage(<SourcesPage />)

    fireEvent.click(await screen.findByText('A.docx'))
    const dialog = await screen.findByRole('dialog')
    // 等详情加载完成（出现题量 chip）。
    await within(dialog).findByText('题量 30')
    // 「文件位置」默认折叠：绝对路径不在首屏展开。
    const summary = within(dialog).getByRole('button', { name: '文件位置' })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(summary)
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'))
    expect(within(dialog).getByText(/D:\/题库\/原始\/A.docx/)).toBeInTheDocument()
  })
})

// ───────────────────────────── B4-4 题库统计 ─────────────────────────────
const chapterRows = Array.from({ length: 20 }, (_, i) => ({
  key: `章${String(i + 1).padStart(2, '0')}`,
  count: i === 5 ? 100 : 20 - i,
}))
const statsFixture = {
  sources: 3, questions: 42, formulas: 10, formulas_ok: 8, images: 5, labels: 6,
  review_open: 2, review_resolved: 1,
  formula_status: [{ status: 'OK', count: 8 }],
  by_stage: [{ key: '初中', count: 42 }],
  by_subject: [{ key: '物理', count: 42 }],
  by_grade: [{ key: '八年级下册', count: 42 }],
  by_textbook: [{ key: '苏科版', count: 42 }],
  by_qtype: [{ key: '选择题', count: 20 }],
  top_chapters: chapterRows,
  answer_coverage: { total: 42, with_answer: 30, with_analysis: 10, by_source: {} },
  enrich_coverage: {
    source_files_total: 3, questions_total: 42,
    grade: { n: 42, total: 42, pct: 100 }, textbook: { n: 40, total: 42, pct: 95 },
    chapter: { n: 42, total: 42, pct: 100 }, qtype: { n: 42, total: 42, pct: 100 },
    difficulty: { n: 0, total: 42, pct: 0 }, knowledge: { n: 10, total: 42, pct: 24 },
    answer: { n: 30, total: 42, pct: 71 }, analysis: { n: 10, total: 42, pct: 24 }, review_open: 2,
  },
  label_status: { 待复核: 1, 已确认: 3, 已否决: 0 },
  review: { open: 2, resolved: 1, total: 3, by_status: { UNSUPPORTED: 2 } },
}
describe('B4-4 题库统计分布 Top5', () => {
  it('20 项默认 Top5，可展开为全部再收起；条形分母按完整 rows（非可见行）', async () => {
    const calls: Call[] = []
    stubFetch(calls, [['/api/stats', () => jsonResponse(statsFixture)]])
    renderPage(<StatsPage />)

    const heading = await screen.findByText('高频章节（20）')
    const paper = heading.closest('.MuiPaper-root') as HTMLElement

    // 默认 5 行。
    expect(within(paper).getByText('章01')).toBeInTheDocument()
    expect(within(paper).queryByText('章06')).not.toBeInTheDocument()

    // 条形分母按**完整 rows** 最大值（100）计算：章01 count=20 → 20%。
    const barBefore = within(paper).getAllByRole('progressbar')[0]
    expect(barBefore.getAttribute('aria-valuenow')).toBe('20')

    // 展开为全部 20 行，分母不变。
    fireEvent.click(within(paper).getByRole('button', { name: '高频章节 展开全部 20 项' }))
    expect(within(paper).getByText('章06')).toBeInTheDocument()
    expect(within(paper).getByText('章20')).toBeInTheDocument()
    expect(within(paper).getAllByRole('progressbar')[0].getAttribute('aria-valuenow')).toBe('20')

    // 收起回 5 行。
    fireEvent.click(within(paper).getByRole('button', { name: '高频章节 收起' }))
    expect(within(paper).queryByText('章06')).not.toBeInTheDocument()
  })

  it('不足五项的分布不出现展开按钮', async () => {
    const calls: Call[] = []
    stubFetch(calls, [['/api/stats', () => jsonResponse(statsFixture)]])
    renderPage(<StatsPage />)

    const heading = await screen.findByText('题型分布（1）')
    const paper = heading.closest('.MuiPaper-root') as HTMLElement
    expect(within(paper).queryByRole('button', { name: /展开全部/ })).not.toBeInTheDocument()
  })
})

// ───────────────────────────── B4-5 设置页 ─────────────────────────────
const settingsFixture: SettingsData = {
  db_path: 'C:/qb/bank.db',
  export_dir: 'C:/qb/exports',
  default_template: '考试',
  katex: { throw_on_error: false, strict: true },
  theme: { primary: '#3370FF', dark: false },
}
describe('B4-5 设置页外观 / 高级拆分', () => {
  function routes() {
    return [['/api/settings', () => jsonResponse(settingsFixture)]] as Array<[string, () => Response]>
  }

  it('外观保存只提交 theme 与 default_template，不含高级字段', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<SettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /保存外观设置/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    const body = put.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['default_template', 'theme'])
    expect(body).not.toHaveProperty('db_path')
    expect(body).not.toHaveProperty('export_dir')
    expect(body).not.toHaveProperty('katex')
  })

  it('高级默认只读、开关禁用；解锁后仅提交被修改的高级字段', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<SettingsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: '高级' }))
    const dbInput = await screen.findByDisplayValue('C:/qb/bank.db')
    expect(dbInput).toHaveAttribute('readonly')
    for (const sw of screen.getAllByRole('checkbox')) expect(sw).toBeDisabled()

    // 未解锁时保存按钮不存在。
    expect(screen.queryByRole('button', { name: /保存高级设置/ })).not.toBeInTheDocument()

    // 解锁 → 只改导出目录。
    fireEvent.click(screen.getByRole('button', { name: /编辑高级设置/ }))
    const exportInput = screen.getByDisplayValue('C:/qb/exports')
    expect(exportInput).not.toHaveAttribute('readonly')
    fireEvent.change(exportInput, { target: { value: 'D:/exports' } })
    fireEvent.click(screen.getByRole('button', { name: /保存高级设置/ }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect((calls.find((c) => c.method === 'PUT')!.body as Record<string, unknown>)).toEqual({ export_dir: 'D:/exports' })
  })

  it('高级取消不写库', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<SettingsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: '高级' }))
    fireEvent.click(await screen.findByRole('button', { name: /编辑高级设置/ }))
    fireEvent.change(screen.getByDisplayValue('C:/qb/exports'), { target: { value: 'D:/nope' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /保存高级设置/ })).not.toBeInTheDocument())
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})
