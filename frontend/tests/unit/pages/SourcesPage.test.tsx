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

  it('有数据 → 渲染表格行与元数据缺失徽标', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rowsFixture)))
    renderPage(<SourcesPage />)

    expect(await screen.findByText('八年级物理下册期末卷.docx')).toBeInTheDocument()
    expect(screen.getByText('未标注来源.docx')).toBeInTheDocument()
    // 第 2 行年级/教材缺失 → 出现「待补充元数据」徽标。
    expect(screen.getByText('待补充元数据')).toBeInTheDocument()
    expect(screen.getByText('完整')).toBeInTheDocument()
  })
})
