/** B5行为自测：真实偏好监听、Router选项和列表身份资格，浏览器WAAPI证据另见D交接。 */
import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from '../../src/hooks/useReducedMotion'
import { useAppNavigate } from '../../src/hooks/useAppNavigate'
import { markRouteWarm } from '../../src/app/routeTransitions'
import { canAnimateList } from '../../src/lib/listMotion'
const router = vi.hoisted(() => ({ from: '/search', navigate: vi.fn() }))
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(),
  useNavigate: () => router.navigate, useLocation: () => ({ pathname: router.from }) }))
const originalMedia = window.matchMedia
function media(initial = false, legacy = false) {
  const handlers = new Set<() => void>()
  const m = { matches: initial, addEventListener: legacy ? undefined : vi.fn((_event, fn) => handlers.add(fn)),
    removeEventListener: legacy ? undefined : vi.fn((_event, fn) => handlers.delete(fn)),
    addListener: vi.fn(fn => handlers.add(fn)), removeListener: vi.fn(fn => handlers.delete(fn)) }
  window.matchMedia = vi.fn(() => m as unknown as MediaQueryList)
  return { m, handlers, change(value: boolean) { act(() => { m.matches = value; handlers.forEach(fn => fn()) }) } }
}
afterEach(() => { window.matchMedia = originalMedia; router.navigate.mockClear(); router.from = '/search'; delete (document as Partial<Document>).startViewTransition })
describe('B5实时减少动效订阅', () => {
  it('同步初值并实时双向响应；现代监听严格清理', () => {
    const pref = media(true)
    const hook = renderHook(useReducedMotion, { wrapper: StrictMode })
    expect(hook.result.current).toBe(true)
    expect(pref.handlers.size).toBe(1)
    pref.change(false); expect(hook.result.current).toBe(false)
    pref.change(true); expect(hook.result.current).toBe(true)
    hook.unmount(); expect(pref.handlers.size).toBe(0)
    expect(pref.m.addListener).not.toHaveBeenCalled()
  })
  it('旧Safari只成对使用addListener/removeListener；卸载无残留', () => {
    const pref = media(false, true)
    const hook = renderHook(useReducedMotion)
    pref.change(true); expect(hook.result.current).toBe(true)
    hook.unmount(); expect(pref.handlers.size).toBe(0)
    expect(pref.m.addListener).toHaveBeenCalledTimes(1)
    expect(pref.m.removeListener).toHaveBeenCalledTimes(1)
  })
  it('API缺失保守禁动效', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    const hook = renderHook(useReducedMotion)
    expect(hook.result.current).toBe(true)
  })
})
describe('B5列表资格完整身份与反方向守卫', () => {
  const ids = Array.from({ length: 20 }, (_, i) => i + 1)
  const before = { ids, scope: 'page1-keywordA', stable: true }
  it('首载不动画；同查询删1/增1允许', () => {
    expect(canAnimateList(undefined, before)).toBe(false)
    expect(canAnimateList(before, { ...before, ids: ids.slice(1) })).toBe(true)
    expect(canAnimateList(before, { ...before, ids: [...ids, 21] })).toBe(true)
  })
  it('翻页、筛选或严格模式改变即使部分ID重合也禁用', () => {
    for (const scope of ['page2-keywordA', 'page1-keywordB', 'page1-strict'])
      expect(canAnimateList(before, { ...before, scope, ids: ids.slice(1) })).toBe(false)
  })
  it('大量替换/全部替换/逆序/仅排序禁用；低项数遵守25%', () => {
    for (const next of [ids.slice(5), ids.map(id => id + 40), [...ids].reverse(), [20, ...ids.slice(1, -1)]])
      expect(canAnimateList(before, { ...before, ids: next })).toBe(false)
    expect(canAnimateList({ ...before, ids: [1, 2, 3] }, { ...before, ids: [1, 2] })).toBe(false)
  })
  it('loading/placeholder/error后恢复无补播；批量条仅稳定查询显隐', () => {
    expect(canAnimateList({ ...before, stable: false }, { ...before, ids: ids.slice(1) })).toBe(false)
    expect(canAnimateList(before, { ...before, stable: false, ids: ids.slice(1) })).toBe(false)
    const bar = { ...before, ids: [] }
    expect(canAnimateList(bar, { ...bar, ids: ['selection'] }, true)).toBe(true)
    expect(canAnimateList(bar, { ...bar, scope: 'other', ids: ['selection'] }, true)).toBe(false)
  })
})
describe('B5增强navigate只传Router选项', () => {
  it('冷safe页普通；模块成功warm后安全双端才传true，选项原样保留且只调用一次', () => {
    media(); document.startViewTransition = vi.fn()
    const hook = renderHook(useAppNavigate)
    hook.result.current('/settings'); expect(router.navigate).toHaveBeenLastCalledWith('/settings', { viewTransition: false })
    markRouteWarm('/search'); markRouteWarm('/settings')
    router.navigate.mockClear()
    const state = { a: 3 }
    hook.result.current({ pathname: '/settings', search: '?debug=1' }, { replace: true, state, preventScrollReset: true })
    expect(router.navigate).toHaveBeenCalledTimes(1)
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/settings', search: '?debug=1' }, { replace: true, state, preventScrollReset: true, viewTransition: true })
    expect(document.startViewTransition).not.toHaveBeenCalled()
  })
  it('reduce/API缺失/显式false/双向测量页/非白名单都普通导航', () => {
    const pref = media(); document.startViewTransition = vi.fn()
    markRouteWarm('/search'); markRouteWarm('/settings')
    const hook = renderHook(useAppNavigate)
    pref.change(true); hook.result.current('/settings'); expect(router.navigate.mock.lastCall?.[1].viewTransition).toBe(false)
    pref.change(false); delete (document as Partial<Document>).startViewTransition
    hook.result.current('/settings'); expect(router.navigate.mock.lastCall?.[1].viewTransition).toBe(false)
    document.startViewTransition = vi.fn()
    hook.result.current('/settings', { viewTransition: false }); expect(router.navigate.mock.lastCall?.[1].viewTransition).toBe(false)
    for (const target of ['/builder', '/export', '/search-other', '/manage/unknown']) {
      hook.result.current(target); expect(router.navigate.mock.lastCall?.[1].viewTransition).toBe(false)
    }
    for (const from of ['/builder', '/export']) {
      router.from = from; hook.rerender(); hook.result.current('/search'); expect(router.navigate.mock.lastCall?.[1].viewTransition).toBe(false)
    }
  })
  it('number、相对路径、query-only与同页替换不改Router语义', () => {
    media(); document.startViewTransition = vi.fn()
    const hook = renderHook(useAppNavigate)
    hook.result.current(-1); expect(router.navigate).toHaveBeenLastCalledWith(-1)
    for (const target of ['../settings', '?debug=1', { search: '?page=2' }, '/search?keyword=x']) {
      hook.result.current(target, { replace: true }); expect(router.navigate).toHaveBeenLastCalledWith(target, { replace: true, viewTransition: false })
    }
  })
})
