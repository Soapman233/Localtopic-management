/**
 * `ErrorState` 行为测试。
 *
 * 关注用户可见行为：
 * - 传入 `ApiError` 时展示**教师可读文案**（后端 message），而不是错误码；
 * - 点「重试」触发回调；
 * - **默认不显示原始堆栈**：技术细节折叠在「给技术人员的信息」里，且非 debug 模式下
 *   展开也只给提示、不给堆栈（口径同 `glossary.isDebugMode()`）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { ErrorState } from '../../src/components/ErrorState'
import { ApiError } from '../../src/api/client'
import { renderWithTheme } from './testUtils'

describe('ErrorState', () => {
  beforeEach(() => {
    // 保证默认处于「非 debug」模式（避免上一条用例的 localStorage 残留）。
    localStorage.removeItem('qb_debug')
  })
  afterEach(() => {
    localStorage.removeItem('qb_debug')
  })

  it('传入 ApiError 时显示教师可读文案（后端 message），而非错误码', () => {
    renderWithTheme(
      <ErrorState error={new ApiError('题目不存在，可能已被删除。', 40401, 404, null)} />,
    )
    expect(screen.getByText('题目不存在，可能已被删除。')).toBeInTheDocument()
    // 错误码属于技术细节，不应出现在主文案里。
    expect(screen.queryByText(/40401/)).not.toBeInTheDocument()
  })

  it('点「重试」触发回调', () => {
    const onRetry = vi.fn()
    renderWithTheme(<ErrorState error={new Error('boom')} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('未提供 onRetry 时不渲染重试按钮', () => {
    renderWithTheme(<ErrorState error={new Error('boom')} />)
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })

  it('默认不显示原始堆栈：技术细节折叠，展开也只给提示（非 debug）', () => {
    const { container } = renderWithTheme(<ErrorState error={new Error('内部错误细节')} />)
    // 非 debug 模式不渲染 <pre> 堆栈，只给提示；提示默认折叠（不可见）。
    expect(screen.getByText('给技术人员的信息')).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
    const hint = screen.getByText(/原始错误信息默认隐藏/)
    expect(hint).not.toBeVisible()

    // 展开折叠区：非 debug 模式仍不给堆栈，只显示开启调试的提示。
    fireEvent.click(screen.getByText('给技术人员的信息'))
    expect(container.querySelector('pre')).toBeNull()
    expect(hint).toBeVisible()
  })

  it('debug 模式下展开折叠区才显示原始错误信息', () => {
    localStorage.setItem('qb_debug', '1')
    const { container } = renderWithTheme(
      <ErrorState error={new ApiError('后端返回的细节', 50001, 500, null)} />,
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    // 默认折叠 → 堆栈留在 DOM 但不可见。
    expect(pre).not.toBeVisible()

    fireEvent.click(screen.getByText('给技术人员的信息'))
    expect(pre).toBeVisible()
    expect(pre?.textContent).toContain('ApiError')
    expect(pre?.textContent).toContain('50001')
  })
})
