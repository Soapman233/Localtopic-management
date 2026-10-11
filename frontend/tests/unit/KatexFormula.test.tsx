/**
 * `KatexFormula` / `FormulaText` 行为测试。
 *
 * 关注：正常公式渲染出 KaTeX DOM、块级模式、以及**失败降级**（未识别字形 → 红色源码）
 * 与 `throwOnError=false` 时非法 LaTeX 不崩。依赖 `useSettingsStore`（zustand，无需 Provider）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { KatexFormula, FormulaText } from '../../src/components/KatexFormula'
import { useSettingsStore } from '../../src/store/settingsStore'
import { renderWithTheme } from './testUtils'

beforeEach(() => {
  // 每个用例重置渲染开关，避免用例间互相污染。
  useSettingsStore.setState({ katex: { throwOnError: true, strict: false } })
})

describe('KatexFormula', () => {
  it('合法公式渲染出 KaTeX DOM 节点且无错误', () => {
    const { container } = renderWithTheme(<KatexFormula latex="x^2 + y^2" />)
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('[data-katex-error]')).toBeNull()
  })

  it('displayMode 渲染为块级公式', () => {
    const { container } = renderWithTheme(<KatexFormula latex="\\sum_{i=1}^{n} i" displayMode />)
    expect(container.querySelector('.katex-display')).not.toBeNull()
  })

  it('未识别字形走降级路径：渲染红色源码并携带错误信息', () => {
    const { container } = renderWithTheme(<KatexFormula latex={'\uE000'} />)
    const fallback = container.querySelector('.qb-katex-fallback')
    expect(fallback).not.toBeNull()
    expect(fallback?.textContent).toContain('未知字形')
    expect(container.querySelector('[data-katex-error]')).not.toBeNull()
  })

  it('throwOnError=false 时非法 LaTeX 不抛错、渲染 KaTeX 内联错误', () => {
    useSettingsStore.setState({ katex: { throwOnError: false, strict: false } })
    const { container } = renderWithTheme(<KatexFormula latex="\\frac{" />)
    // 未崩溃即视为通过；KaTeX 在非抛错模式下用 `.katex-error` 标记错误片段。
    expect(container.querySelector('.katex-error')).not.toBeNull()
  })
})

describe('FormulaText', () => {
  it('按 fid 精确映射占位符为公式', () => {
    const { container } = renderWithTheme(
      <FormulaText text="求解 ⟦F1⟧ 的值" formulas={[{ fid: 'F1', latex: 'x^2' }]} />,
    )
    expect(screen.getByText(/求解/)).toBeInTheDocument()
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('未命中 fid 时渲染占位提示而非静默丢弃', () => {
    renderWithTheme(<FormulaText text="⟦F9⟧" formulas={[]} />)
    expect(screen.getByText(/⟦F9⟧/)).toBeInTheDocument()
  })
})
