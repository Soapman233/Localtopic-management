/**
 * `StatusBadges` 行为测试。
 *
 * 覆盖产品约束：难度为空/「未标注」时**必须**渲染灰色「未标注」徽章（绝不空白），
 * 以及有/无答案、有/无解析、待复核公式、知识点三态、待补充等徽章文案。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import {
  AnswerBadge,
  AnalysisBadge,
  DifficultyBadge,
  LabelStatusBadge,
  MissingBadge,
  ReviewBadge,
} from '../../src/components/StatusBadges'
import { renderWithTheme } from './testUtils'

describe('AnswerBadge / AnalysisBadge', () => {
  it('有答案渲染「有答案」，无答案渲染「无答案」', () => {
    const { unmount } = renderWithTheme(<AnswerBadge hasAnswer />)
    expect(screen.getByText('有答案')).toBeInTheDocument()
    unmount()

    renderWithTheme(<AnswerBadge hasAnswer={false} />)
    expect(screen.getByText('无答案')).toBeInTheDocument()
  })

  it('有解析渲染「有解析」，无解析渲染「无解析」', () => {
    const { unmount } = renderWithTheme(<AnalysisBadge hasAnalysis />)
    expect(screen.getByText('有解析')).toBeInTheDocument()
    unmount()

    renderWithTheme(<AnalysisBadge hasAnalysis={false} />)
    expect(screen.getByText('无解析')).toBeInTheDocument()
  })
})

describe('DifficultyBadge', () => {
  it('难度为空时渲染「未标注」而非空白', () => {
    renderWithTheme(<DifficultyBadge difficulty={null} />)
    expect(screen.getByText('未标注')).toBeInTheDocument()
  })

  it('难度为「未标注」时同样渲染「未标注」', () => {
    renderWithTheme(<DifficultyBadge difficulty="未标注" />)
    expect(screen.getByText('未标注')).toBeInTheDocument()
  })

  it('已标注难度渲染「难度 易」', () => {
    renderWithTheme(<DifficultyBadge difficulty="易" />)
    expect(screen.getByText('难度 易')).toBeInTheDocument()
  })

  it('提供 onAnnotate 时渲染「标注」按钮并回调', () => {
    const onAnnotate = vi.fn()
    renderWithTheme(<DifficultyBadge difficulty={null} onAnnotate={onAnnotate} />)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    expect(onAnnotate).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewBadge / LabelStatusBadge / MissingBadge', () => {
  it('ReviewBadge 带数量时显示「待复核公式 N」', () => {
    renderWithTheme(<ReviewBadge count={3} />)
    expect(screen.getByText('待复核公式 3')).toBeInTheDocument()
  })

  it('ReviewBadge 无数量时显示「待复核公式」', () => {
    renderWithTheme(<ReviewBadge />)
    expect(screen.getByText('待复核公式')).toBeInTheDocument()
  })

  it('知识点三态徽章文案正确', () => {
    const { unmount: u1 } = renderWithTheme(<LabelStatusBadge status="已确认" />)
    expect(screen.getByText('已确认')).toBeInTheDocument()
    u1()

    const { unmount: u2 } = renderWithTheme(<LabelStatusBadge status="已否决" />)
    expect(screen.getByText('已否决')).toBeInTheDocument()
    u2()

    renderWithTheme(<LabelStatusBadge status={null} />)
    expect(screen.getByText('待复核？')).toBeInTheDocument()
  })

  it('MissingBadge 带数量时千分位格式化', () => {
    const { unmount } = renderWithTheme(<MissingBadge count={1234} />)
    expect(screen.getByText('待补充 (1,234)')).toBeInTheDocument()
    unmount()

    renderWithTheme(<MissingBadge />)
    expect(screen.getByText('待补充')).toBeInTheDocument()
  })
})
