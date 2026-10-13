/**
 * 自动保存明示单测（设计规范 §4.5 第 3 条）。
 *
 * 时间来源是 `useUiStore.lastEditAt`（**会话态，不持久化**）——
 * 这里直接以不同时间戳渲染，验证文案分档与「未编辑则不渲染」。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { AutosaveNotice } from '../../src/components/AutosaveNotice'
import { useUiStore } from '../../src/store/uiStore'
import { renderPage } from './pages/pageTestUtils'

beforeEach(() => {
  useUiStore.setState({ lastEditAt: null })
})

describe('AutosaveNotice', () => {
  it('本次会话尚未编辑 → 不渲染', () => {
    renderPage(<AutosaveNotice />)
    expect(screen.queryByTestId('autosave-notice')).not.toBeInTheDocument()
  })

  it('刚编辑过 → 「已自动保存 · 上次编辑 刚刚」', () => {
    useUiStore.setState({ lastEditAt: Date.now() })
    renderPage(<AutosaveNotice />)
    const el = screen.getByTestId('autosave-notice')
    expect(el).toHaveTextContent('已自动保存')
    expect(el).toHaveTextContent('上次编辑')
    expect(el).toHaveTextContent('刚刚')
  })

  it('编辑在 2 小时前 → 显示「2 小时前」', () => {
    useUiStore.setState({ lastEditAt: Date.now() - 2 * 60 * 60 * 1000 })
    renderPage(<AutosaveNotice />)
    expect(screen.getByTestId('autosave-notice')).toHaveTextContent('2 小时前')
  })
})
