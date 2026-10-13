/**
 * `SourcesPage` 页面级集成测试（阶段 2 遗留：页面级四态替换缺守护）。
 *
 * mock 方案：`vi.stubGlobal('fetch')` 返回 `{code,data,message}` 信封。
 * 覆盖：加载中 → LoadingState；空列表 → EmptyState；请求失败 → ErrorState；有数据 → 表格行。
 *
 * T05（评审 F5）追加：分页（默认 25 行/页，只改渲染行数）+「元数据状态」列去徽章化
 * （同值率 83% → 行级 `—` 标记 + 顶部「仅看元数据缺失」筛选）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import SourcesPage from '../../../src/pages/SourcesPage'
import type { SourceRow } from '../../../src/api/types'
import { renderPage, jsonResponse, errorResponse, deferredResponse } from './pageTestUtils'

const rowsFixture: SourceRow[] = [
  {
    id: 1,
    file_name: '八年级物理下册期末卷.docx',
    stage: '初中',
    grade: '八年级下册',
    subject: '物理',
    textbook: '苏科版',
    chapter: null,
    questions_count: 30,
    formulas_count: 4,
  },
  {
    id: 2,
    file_name: '未标注来源.docx',
    stage: null,
    grade: null,
    subject: null,
    textbook: null,
    chapter: null,
    questions_count: 5,
    formulas_count: 0,
  },
]

/** 生成 `n` 行来源文件（分页用例用；部分行缺年级/教材以贴近真实同值率）。 */
function makeRows(n: number): SourceRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    file_name: `来源文件-${String(i + 1).padStart(3, '0')}.docx`,
    stage: '初中',
    grade: i % 3 === 0 ? null : '八年级下册',
    subject: '物理',
    textbook: i % 5 === 0 ? null : '苏科版',
    chapter: null,
    questions_count: i + 1,
    formulas_count: i % 7,
  }))
}

describe('SourcesPage 页面级集成', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载中 → 显示 LoadingState 文案', async () => {
    const d = deferredResponse()
    vi.stubGlobal('fetch', vi.fn(() => d.promise))
    renderPage(<SourcesPage />)

    expect(screen.getByText('正在加载来源文件…')).toBeInTheDocument()
    d.resolve(jsonResponse([]))
    await waitFor(() => expect(screen.queryByText('正在加载来源文件…')).not.toBeInTheDocument())
  })

  it('空列表 → 显示 EmptyState（无匹配来源文件）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('没有匹配的来源文件')).toBeInTheDocument()
  })

  it('请求失败 → 显示 ErrorState（含重试按钮）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(50001, '服务内部错误，请稍后重试。', 500)))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('加载来源文件失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('有数据 → 渲染表格行 + 行级缺失标记（不再逐行渲染「元数据状态」徽章）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rowsFixture)))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('八年级物理下册期末卷.docx')).toBeInTheDocument()
    expect(screen.getByText('未标注来源.docx')).toBeInTheDocument()
    // 第 2 行年级/教材缺失 → 行级标记「—」（带可访问名），这是缺失的**唯一**行级信号。
    expect(screen.getByLabelText('年级元数据缺失')).toBeInTheDocument()
    expect(screen.getByLabelText('教材元数据缺失')).toBeInTheDocument()
    // 去徽章化：同值率 83% 的「元数据状态」列整列移除（逐行 Chip 不再存在）。
    expect(screen.queryByText('元数据状态')).not.toBeInTheDocument()
    expect(screen.queryByText('待补充元数据')).not.toBeInTheDocument()
    expect(screen.queryByText('完整')).not.toBeInTheDocument()
    // 聚合信号改由顶部「仅看元数据缺失」筛选承载。
    expect(screen.getByLabelText('仅看元数据缺失')).toBeInTheDocument()
  })

  it('分页：默认每页 25 行，只渲染当前页；范围文案为中文；翻页后换页', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(makeRows(60))))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('来源文件-001.docx')).toBeInTheDocument()
    // 第 1 页只渲染 25 行正文（+ 1 行表头）；第 26 行不渲染。
    expect(screen.getAllByRole('row')).toHaveLength(26)
    expect(screen.queryByText('来源文件-026.docx')).not.toBeInTheDocument()
    // 中文范围与每页条数文案。
    expect(screen.getByText(/第 1.25 行，共 60 行/)).toBeInTheDocument()
    expect(screen.getByText('每页')).toBeInTheDocument()

    // 翻到第 2 页：范围文案随之变化，且渲染的是 26–50 行。
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText(/第 26.50 行，共 60 行/)).toBeInTheDocument()
    expect(screen.getByText('来源文件-026.docx')).toBeInTheDocument()
    expect(screen.queryByText('来源文件-001.docx')).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26)
  })
})
