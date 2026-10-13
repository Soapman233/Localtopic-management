/**
 * `SlideOver`（右侧滑出面板）测试。
 *
 * 关键契约：
 * 1. **必须能被读屏识别为对话框**——MUI `Drawer` 自身不设 `role`，
 *    所以这个组件显式把 `role="dialog"` + `aria-labelledby` 放到 Paper 上。
 *    这条一旦丢了，读屏只会当它是一个普通区域（本项目 P5-3 修过的同类问题）。
 * 2. 关闭按钮可访问名是「关闭」，点击回调生效。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import SlideOver from '../../src/components/SlideOver'
import { renderPage } from './pages/pageTestUtils'

describe('SlideOver（右侧滑出面板）', () => {
  it('打开时是带可访问名的对话框', () => {
    renderPage(
      <SlideOver open onClose={() => {}} title="新建试卷">
        <span>表单内容</span>
      </SlideOver>,
    )
    const dialog = screen.getByRole('dialog', { name: '新建试卷' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('表单内容')).toBeTruthy()
  })

  it('标题是 h2（不与页面 h1 冲突）', () => {
    renderPage(
      <SlideOver open onClose={() => {}} title="新建试卷">
        <span>x</span>
      </SlideOver>,
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('新建试卷')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('渲染说明与操作区', () => {
    renderPage(
      <SlideOver
        open
        onClose={() => {}}
        title="新建试卷"
        description="新建后会自动切换"
        actions={<button type="button">创建</button>}
      >
        <span>x</span>
      </SlideOver>,
    )
    expect(screen.getByText('新建后会自动切换')).toBeTruthy()
    expect(screen.getByRole('button', { name: '创建' })).toBeTruthy()
  })

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    renderPage(
      <SlideOver open onClose={onClose} title="新建试卷">
        <span>x</span>
      </SlideOver>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('关闭时不显示内容', () => {
    renderPage(
      <SlideOver open={false} onClose={() => {}} title="新建试卷">
        <span>表单内容</span>
      </SlideOver>,
    )
    // `keepMounted` 让 Paper 保留在 DOM 里（省去每次开合的挂载开销），
    // 所以断言的是「不可见 / 不在无障碍树里」，而不是「不在 DOM 里」。
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('表单内容')).not.toBeVisible()
  })
})
