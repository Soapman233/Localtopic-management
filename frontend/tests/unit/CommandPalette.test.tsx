/**
 * `CommandPalette`（⌘K 全局快速跳转）测试。
 *
 * 重点：
 * 1. `buildPaletteItems` 是纯函数，先把它钉死——尤其是**搜索项必须用 `?keyword=`**
 *    （找题页的 `useQuestionFilters` 只认这个参数名；用 `?q=` 会「跳过去但条件没带上」）。
 * 2. 键盘可用：↓ 移动高亮、Enter 执行当前项。
 * 3. 无障碍：输入框是 ARIA combobox 且 `aria-activedescendant` 指向当前 `role="option"`。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import CommandPalette, { buildPaletteItems } from '../../src/components/CommandPalette'
import { renderPage } from './pages/pageTestUtils'

describe('buildPaletteItems（纯函数）', () => {
  it('空查询：只列可跳转页面，且高频页在前', () => {
    const items = buildPaletteItems('')
    expect(items[0].label).toBe('组卷工作台')
    expect(items.map((i) => i.label)).toContain('系统设置')
    expect(items.every((i) => i.id.startsWith('nav-'))).toBe(true)
  })

  it('非空查询：首项是「搜索题目」，且用 ?keyword= 而非自造参数', () => {
    const items = buildPaletteItems('浮力')
    expect(items[0].label).toBe('搜索题目「浮力」')
    expect(items[0].to).toBe(`/search?keyword=${encodeURIComponent('浮力')}`)
    // 防回归：绝不能出现 `?q=`
    expect(items[0].to).not.toContain('?q=')
  })

  it('按标题或英文路径匹配', () => {
    expect(buildPaletteItems('统计').map((i) => i.label)).toContain('题库统计')
    expect(buildPaletteItems('stats').map((i) => i.label)).toContain('题库统计')
    expect(buildPaletteItems('manage').map((i) => i.label)).toContain('公式复核')
  })

  it('无匹配时只剩搜索项', () => {
    const items = buildPaletteItems('zzz-不存在')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('action-search')
  })
})

describe('CommandPalette（渲染与键盘）', () => {
  it('关闭时不渲染面板', () => {
    renderPage(<CommandPalette open={false} onClose={() => {}} onNavigate={() => {}} />)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('打开时输入框是 combobox，且指向当前高亮项', () => {
    renderPage(<CommandPalette open onClose={() => {}} onNavigate={() => {}} />)
    const input = screen.getByRole('combobox')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-0')
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('↓ 移动高亮，Enter 执行当前项', () => {
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    renderPage(<CommandPalette open onClose={onClose} onNavigate={onNavigate} />)
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-1')
    fireEvent.keyDown(input, { key: 'Enter' })
    // 第二项是「找题」
    expect(onNavigate).toHaveBeenCalledWith('/search')
    expect(onClose).toHaveBeenCalled()
  })

  it('输入关键词后 Enter 直接跳到找题并带上 keyword', () => {
    const onNavigate = vi.fn()
    renderPage(<CommandPalette open onClose={() => {}} onNavigate={onNavigate} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '浮力' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith(`/search?keyword=${encodeURIComponent('浮力')}`)
  })

  it('↑ 从第一项回绕到最后一项', () => {
    renderPage(<CommandPalette open onClose={() => {}} onNavigate={() => {}} />)
    const input = screen.getByRole('combobox')
    const n = screen.getAllByRole('option').length
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.getAttribute('aria-activedescendant')).toBe(`palette-option-${n - 1}`)
  })

  it('点击条目即跳转', () => {
    const onNavigate = vi.fn()
    renderPage(<CommandPalette open onClose={() => {}} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('option', { name: /系统设置/ }))
    expect(onNavigate).toHaveBeenCalledWith('/settings')
  })
})
