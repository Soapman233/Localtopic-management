/**
 * `CoverageBanner` 行为测试（B2 §3.3 起改为「一行摘要 + 展开明细」）。
 *
 * 关注：默认**只占一行**（六维数值不铺开）、点「展开明细」后才渲染六维数值与复核数、
 * `dismissed` / 无数据时返回 null、点关闭按钮触发 `onDismiss`。
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
  it('默认只占一行：显示「数据完整度」摘要，不铺开六维数值', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    expect(screen.getByText('数据完整度')).toBeInTheDocument()
    // 默认折叠：六维数值与复核数都还没渲染。
    expect(screen.queryByText('17%（1,342/7,945）')).not.toBeInTheDocument()
    expect(screen.queryByText('待复核公式')).not.toBeInTheDocument()
  })

  it('展开明细后渲染各维度覆盖率（千分位 / 百分比）与复核数', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByTestId('coverage-toggle'))
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
    fireEvent.click(screen.getByTestId('coverage-toggle'))
    // 样本里 textbook / chapter 的 n=0 → 应显示「未标注（7,945 题）」
    expect(screen.getAllByText(/未标注（7,945 题）/).length).toBeGreaterThan(0)
    // 且不应再出现会被误读成"统计坏了"的 0%
    expect(screen.queryByText('0%（0/7,945）')).not.toBeInTheDocument()
  })

  it('明说「难度」全库未标注、暂不能按难度筛选', () => {
    renderWithTheme(<CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />)
    expect(screen.getByText(/暂不能按难度筛选/)).toBeInTheDocument()
  })

  it('T08：永久性说明**不再是 Alert**（尤其不是橙色 warning），改为中性一行', () => {
    const { container } = renderWithTheme(
      <CoverageBanner coverage={makeCoverage()} dismissed={false} onDismiss={vi.fn()} />,
    )
    expect(screen.getByTestId('coverage-banner')).toBeInTheDocument()
    // 规范 §3.3：永久性数据说明禁止用 Alert 常驻。
    expect(container.querySelector('.MuiAlert-root')).toBeNull()
    expect(container.querySelector('.MuiAlert-standardWarning')).toBeNull()
  })
})
