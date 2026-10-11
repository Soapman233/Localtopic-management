/**
 * `FilterSidebar` 行为测试（阶段 1 · P0-5 难度死功能）。
 *
 * 核心关注：**没有标注数据的维度不能再装作可用**——老师点了筛不出结果会误判成
 * 「系统坏了 / 题库没题」。这里断言：
 *  1. 无数据的维度标注「暂不可用」并**不渲染**选项按钮，改为给出可读的原因与出路；
 *  2. 有数据的维度行为不变（仍渲染选项、点击触发 onChange）；
 *  3. 若 URL 里带着一个已不可用维度的旧筛选，提供「清除该筛选」而不是让人卡住。
 *
 * 断言全部用 `within(维度容器)` 限定范围——否则「全部」按钮在其它维度也存在，会误判。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { FilterSidebar } from '../../src/components/FilterSidebar'
import type { FacetsData } from '../../src/api/types'
import { renderWithTheme } from './testUtils'

/** 构造 facets：`difficulty` 全库未标注（items 为空、全部落在 missing）。 */
function makeFacets(): FacetsData {
  const bucket = (n: number, pct: number) => ({ n, total: 7945, pct })
  return {
    dimensions: {
      grade: { items: [{ key: '八年级下册', count: 43 }], missing: 631 },
      difficulty: { items: [], missing: 818 },
    },
    coverage: {
      source_files_total: 209,
      questions_total: 7945,
      grade: bucket(1396, 17.6),
      textbook: bucket(1392, 17.5),
      chapter: bucket(2810, 35.4),
      qtype: bucket(5559, 70),
      difficulty: bucket(0, 0),
      knowledge: bucket(0, 0),
      answer: bucket(3973, 50),
      analysis: bucket(4639, 58.4),
      review_open: 132,
    },
  } as FacetsData
}

function renderSidebar(filters: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  renderWithTheme(
    <FilterSidebar
      facets={makeFacets()}
      loading={false}
      filters={filters as never}
      onChange={onChange}
      strictKp={false}
      onStrictKpChange={vi.fn()}
      onReset={vi.fn()}
    />,
  )
  return { onChange }
}

const dim = (key: string) => within(screen.getByTestId(`filter-dim-${key}`))

describe('FilterSidebar · 无数据维度（P0-5）', () => {
  it('难度全库未标注时，维度标题旁标注「暂不可用」', () => {
    renderSidebar()
    expect(dim('difficulty').getByText('暂不可用')).toBeInTheDocument()
  })

  it('不可用维度给出可读原因与出路（而不是一排筛不出结果的按钮）', () => {
    renderSidebar()
    expect(dim('difficulty').getByText(/按它筛选不会有结果/)).toBeInTheDocument()
    expect(dim('difficulty').getByText(/改用关键词检索/)).toBeInTheDocument()
  })

  it('不可用维度不渲染任何选项按钮（避免"点了没反应"）', () => {
    renderSidebar()
    expect(dim('difficulty').queryByText('全部')).not.toBeInTheDocument()
    expect(dim('difficulty').queryByText(/^待补充 \(/)).not.toBeInTheDocument()
  })

  it('有数据的维度行为不变：仍渲染选项且点击触发 onChange', () => {
    const { onChange } = renderSidebar()
    expect(dim('grade').getByText('全部')).toBeInTheDocument()
    fireEvent.click(dim('grade').getByText('八年级下册 (43)'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ grade: '八年级下册' }))
  })

  it('URL 里带着已不可用维度的旧筛选时，提供「清除该筛选」', () => {
    const { onChange } = renderSidebar({ difficulty: '中等' })
    const clear = dim('difficulty').getByText('清除该筛选')
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ difficulty: undefined }))
  })
})
