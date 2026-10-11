/**
 * `CoverageBanner` 行为测试。
 *
 * 关注：覆盖率数据渲染（含千分位与百分比格式）、`dismissed` / 无数据时返回 null、
 * 点关闭按钮触发 `onDismiss`。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { CoverageBanner } from '../../src/components/CoverageBanner'
import type { CoverageSummary } from '../../src/api/types'
import { renderWithTheme } from './testUtils'

function makeCoverage(): CoverageSummary {
  const bucket = (n: number, pct: number) => ({ n, total: 7945, pct })
  return {
    source_files_total: 10,
    questions_total: 7945,
    grade: bucket(1342, 17),
    textbook: bucket(0, 0),
    chapter: bucket(0, 0),
    qtype: bucket(7945, 100),
    difficulty: bucket(100, 1),
    knowledge: bucket(0, 0),
    answer: bucket(7000, 88),
    analysis: bucket(6000, 76),
    review_open: 3,
  }
}

describe('CoverageBanner', () => {
  it('渲染标题与各维度覆盖率（千分位 / 百分比）', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    expect(screen.getByText('数据覆盖率提示')).toBeInTheDocument()
    expect(screen.getByText('年级')).toBeInTheDocument()
    expect(screen.getByText('17%（1,342/7,945）')).toBeInTheDocument()
    expect(screen.getByText('待复核公式')).toBeInTheDocument()
    expect(screen.getByText('3 条')).toBeInTheDocument()
  })

  it('dismissed 为 true 时不渲染', () => {
    const { container } = renderWithTheme(
      <CoverageBanner coverage={makeCoverage()} dismissed onDismiss={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('无覆盖率数据时不渲染', () => {
    const { container } = renderWithTheme(
      <CoverageBanner coverage={null} dismissed={false} onDismiss={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('点击关闭按钮触发 onDismiss', () => {
    const onDismiss = vi.fn()
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('关闭提示'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('覆盖率为 0 的维度显示「未标注」而不是「0%」（P0-5）', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    // 样本里 textbook / chapter 的 n=0 → 应显示「未标注（7,945 题）」
    expect(screen.getAllByText(/未标注（7,945 题）/).length).toBeGreaterThan(0)
    // 且不应再出现会被误读成"统计坏了"的 0%
    expect(screen.queryByText('0%（0/7,945）')).not.toBeInTheDocument()
  })

  it('明说「难度」全库未标注、暂不能按难度筛选', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    expect(screen.getByText(/暂不能按难度筛选/)).toBeInTheDocument()
  })
})
