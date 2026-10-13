/**
 * `SourcesPage` 页面级集成测试（阶段 2 遗留：页面级四态替换缺守护）。
 *
 * mock 方案：`vi.stubGlobal('fetch')` 返回 `{code,data,message}` 信封。
 * 覆盖：加载中 → LoadingState；空列表 → EmptyState；请求失败 → ErrorState；有数据 → 表格行。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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

  it('有数据 → 渲染表格行；缺失以行内「—」标记，不再有逐行元数据徽章（T06）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rowsFixture)))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('八年级物理下册期末卷.docx')).toBeInTheDocument()
    expect(screen.getByText('未标注来源.docx')).toBeInTheDocument()
    // 第 2 行年级/教材缺失 → 该行渲染带可访问名的「—」标记（不只靠颜色）。
    expect(screen.getByLabelText('年级缺失')).toBeInTheDocument()
    expect(screen.getByLabelText('教材缺失')).toBeInTheDocument()
    // T06：原「元数据状态」列（174/209 行同值）的逐行徽章已删除。
    expect(screen.queryByText('待补充元数据')).not.toBeInTheDocument()
    expect(screen.queryByText('完整')).not.toBeInTheDocument()
    expect(screen.queryByText('元数据状态')).not.toBeInTheDocument()
  })

  it('行数超过每页上限 → 只渲染首页并出现分页器（T06）', async () => {
    const many: SourceRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      file_name: `来源${String(i + 1).padStart(2, '0')}.docx`,
      stage: '初中',
      grade: '八年级下册',
      subject: '物理',
      textbook: '苏科版',
      chapter: null,
      questions_count: i,
      formulas_count: 0,
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(many)))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('来源01.docx')).toBeInTheDocument()
    // 每页 25 行：第 25 行在、第 26 行不在。
    expect(screen.getByText('来源25.docx')).toBeInTheDocument()
    expect(screen.queryByText('来源26.docx')).not.toBeInTheDocument()
    // 分页器存在（2 页）。
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument()
  })
})
