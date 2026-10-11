/**
 * `useQuestionFilters` 单测（前端重构方案 §1.6）。
 *
 * 该 hook 收敛了检索页与组卷页此前各自维护的「关键词防抖 / URL 同步 / query 与 facets 参数」逻辑，
 * 是两页行为一致的**唯一保障**，故对下列契约逐条设防：
 *  - URL 初始还原；
 *  - 关键词 300ms 防抖且页码归 1；
 *  - `queryParams` 带分页、`facetsParams` 不带；`kp_confirmed_only` 取自 `strictKp`；
 *  - `reset` 清空全部并归页；
 *  - `hasActiveFilters` 判定；
 *  - 筛选条件写入 URL。
 *
 * 需要 `MemoryRouter`（hook 内用 `useSearchParams`）；`useUiStore` 为模块级单例，用 `setState` 注入严格模式。
 * 说明：本文件刻意用 `.ts` + `createElement`（而非 `.tsx` JSX），以保持任务约定的文件名。
 */
import { createElement, Fragment, type ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useQuestionFilters } from '../../src/hooks/useQuestionFilters'
import { useUiStore } from '../../src/store/uiStore'

/** 探针：把当前 URL query 写入 sink，供断言「筛选条件是否写入 URL」。 */
function Probe({ sink, children }: { sink: { search: string }; children?: ReactNode }) {
  sink.search = useLocation().search
  return createElement(Fragment, null, children)
}

/** 在 MemoryRouter 下渲染 hook（可选 sink 捕获 URL）。 */
function renderFilters(initialEntry = '/builder', pageSize = 15, sink?: { search: string }) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      sink ? createElement(Probe, { sink }, children) : children,
    )
  return renderHook(() => useQuestionFilters({ pageSize }), { wrapper: Wrapper })
}

beforeEach(() => {
  useUiStore.setState({ strictKp: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useQuestionFilters', () => {
  it('从 URL 还原初始关键词 / 筛选 / 页码', () => {
    const { result } = renderFilters('/builder?keyword=浮力&grade=八年级&has_answer=1&page=3')
    expect(result.current.keywordInput).toBe('浮力')
    expect(result.current.filters.keyword).toBe('浮力')
    expect(result.current.filters.grade).toBe('八年级')
    expect(result.current.filters.has_answer).toBe(true)
    expect(result.current.page).toBe(3)
  })

  it('关键词 300ms 防抖：到点才写入 filters，且页码归 1', () => {
    vi.useFakeTimers()
    const { result } = renderFilters('/builder?page=2')
    act(() => {
      result.current.setKeywordInput('欧姆')
    })
    // 未到 300ms：尚未写入 filters。
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current.filters.keyword).toBeUndefined()
    // 到 300ms：写入关键词并归页。
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.filters.keyword).toBe('欧姆')
    expect(result.current.page).toBe(1)
  })

  it('queryParams 带分页 / facetsParams 不带；kp_confirmed_only 取自 strictKp', () => {
    vi.useFakeTimers() // 冻结防抖定时器，保持 page=3 不被归 1。
    useUiStore.setState({ strictKp: true })
    const { result } = renderFilters('/builder?keyword=力&page=3', 20)
    expect(result.current.queryParams.limit).toBe(20)
    expect(result.current.queryParams.offset).toBe(40)
    expect(result.current.queryParams.kp_confirmed_only).toBe(true)
    expect(result.current.facetsParams.kp_confirmed_only).toBe(true)
    expect(result.current.facetsParams.limit).toBeUndefined()
    expect(result.current.facetsParams.offset).toBeUndefined()
  })

  it('reset 清空关键词与筛选并把页码归 1', () => {
    const { result } = renderFilters('/builder?keyword=浮力&grade=八年级&page=2')
    act(() => {
      result.current.reset()
    })
    expect(result.current.filters).toEqual({})
    expect(result.current.keywordInput).toBe('')
    expect(result.current.page).toBe(1)
  })

  it('hasActiveFilters 反映是否存在生效筛选', () => {
    const { result } = renderFilters('/builder?grade=八年级')
    expect(result.current.hasActiveFilters).toBe(true)
    act(() => {
      result.current.reset()
    })
    expect(result.current.hasActiveFilters).toBe(false)
  })

  it('筛选条件写入 URL', () => {
    const sink = { search: '' }
    const { result } = renderFilters('/builder', 15, sink)
    act(() => {
      result.current.setFilters({ grade: '八年级' })
    })
    expect(decodeURIComponent(sink.search)).toContain('grade=八年级')
  })
})
