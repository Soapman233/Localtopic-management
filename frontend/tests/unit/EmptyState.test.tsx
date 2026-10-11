/**
 * `EmptyState` 行为测试。
 *
 * 关注用户可见行为：标题 / 说明渲染、有行动按钮时点击触发回调、无行动按钮时不渲染按钮。
 * 不断言内部实现（className / state）。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { EmptyState } from '../../src/components/EmptyState'
import { renderWithTheme } from './testUtils'

describe('EmptyState', () => {
  it('渲染标题与说明', () => {
    renderWithTheme(
      <EmptyState title="没有匹配的题目" description="试试调整关键词或清除筛选条件。" />,
    )
    expect(screen.getByText('没有匹配的题目')).toBeInTheDocument()
    expect(screen.getByText('试试调整关键词或清除筛选条件。')).toBeInTheDocument()
  })

  it('提供行动按钮时渲染按钮，点击触发回调', () => {
    const onAction = vi.fn()
    renderWithTheme(
      <EmptyState title="没有匹配的题目" actionLabel="清除筛选" onAction={onAction} />,
    )
    const btn = screen.getByRole('button', { name: '清除筛选' })
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('未提供行动按钮时不渲染按钮', () => {
    renderWithTheme(<EmptyState title="还没有数据" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('支持自定义图标', () => {
    renderWithTheme(<EmptyState title="空空如也" icon={<span data-testid="my-icon">★</span>} />)
    expect(screen.getByTestId('my-icon')).toBeInTheDocument()
  })
})
