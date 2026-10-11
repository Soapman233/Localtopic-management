/**
 * `ConfirmDialog` 行为测试（真实 DOM + Testing Library）。
 *
 * 关注**用户可见行为**：标题/内容渲染、影响条数呈现、确认/取消回调、loading 禁用。
 * 不断言 className / 内部 state。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { ConfirmDialog } from '../../src/components/ConfirmDialog'
import { renderWithTheme } from './testUtils'

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  renderWithTheme(
    <ConfirmDialog open title="确认操作" onCancel={onCancel} onConfirm={onConfirm} {...props} />,
  )
  return { onCancel, onConfirm }
}

describe('ConfirmDialog', () => {
  it('打开时渲染标题与说明内容', () => {
    renderDialog({ children: '删除后不可恢复' })
    expect(screen.getByText('确认操作')).toBeInTheDocument()
    expect(screen.getByText('删除后不可恢复')).toBeInTheDocument()
  })

  it('传入 impactCount 时醒目渲染「前缀 / 条数 / 单位」', () => {
    renderDialog({ impactCount: 1234, impactLabel: '条关联', impactPrefix: '将否决' })
    expect(screen.getByText('将否决')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('条关联')).toBeInTheDocument()
  })

  it('未传 impactCount 时不渲染条数块', () => {
    renderDialog()
    expect(screen.queryByText('将影响')).not.toBeInTheDocument()
  })

  it('点击「确认」触发 onConfirm', () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('点击「取消」触发 onCancel', () => {
    const { onCancel } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('自定义 confirmText 生效', () => {
    renderDialog({ confirmText: '确认否决' })
    expect(screen.getByRole('button', { name: '确认否决' })).toBeInTheDocument()
  })

  it('loading 时确认与取消按钮均禁用', () => {
    renderDialog({ loading: true })
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
  })

  it('error 时渲染错误提示', () => {
    renderDialog({ error: '保存失败，请重试' })
    expect(screen.getByText('保存失败，请重试')).toBeInTheDocument()
  })
})
