/**
 * `AnimatedList`（AutoAnimate 封装）行为测试 —— B2 §5 动效护栏。
 *
 * 关注三条硬约束：
 *  1. 默认启用时确实挂载 AutoAnimate；
 *  2. `enabled={false}` 时**不**挂载；
 *  3. 系统 `prefers-reduced-motion: reduce` 时**不**挂载（即使默认 enabled）。
 *
 * 通过 `vi.mock` 替换 `@formkit/auto-animate`，直接断言「是否被调用」，
 * 不依赖真实动画（jsdom 无渲染引擎）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import AnimatedList from '../../src/components/AnimatedList'

// vi.mock 会被提升到文件顶部，故用 vi.hoisted 共享 mock 引用。
const { autoAnimateMock } = vi.hoisted(() => ({
  autoAnimateMock: vi.fn(() => ({ destroy: vi.fn() })),
}))
vi.mock('@formkit/auto-animate', () => ({ default: autoAnimateMock }))

/** 打桩 matchMedia：仅当 reduce 偏好为真且查询是 reduced-motion 时 matches=true。 */
function stubMatchMedia(reduce: boolean): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

describe('AnimatedList', () => {
  beforeEach(() => autoAnimateMock.mockClear())

  it('默认启用：挂载时调用 AutoAnimate', () => {
    render(
      <AnimatedList>
        <div key="a">A</div>
      </AnimatedList>,
    )
    expect(autoAnimateMock).toHaveBeenCalledTimes(1)
  })

  it('enabled={false} 时不启用 AutoAnimate', () => {
    render(
      <AnimatedList enabled={false}>
        <div key="a">A</div>
      </AnimatedList>,
    )
    expect(autoAnimateMock).not.toHaveBeenCalled()
  })

  it('prefers-reduced-motion: reduce 时不启用（即使默认 enabled）', () => {
    const restore = stubMatchMedia(true)
    try {
      render(
        <AnimatedList>
          <div key="a">A</div>
        </AnimatedList>,
      )
      expect(autoAnimateMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('enabled 由 false 变 true 时才启用', () => {
    const { rerender } = render(
      <AnimatedList enabled={false}>
        <div key="a">A</div>
      </AnimatedList>,
    )
    expect(autoAnimateMock).not.toHaveBeenCalled()
    rerender(
      <AnimatedList enabled>
        <div key="a">A</div>
      </AnimatedList>,
    )
    expect(autoAnimateMock).toHaveBeenCalledTimes(1)
  })

  it('卸载时销毁 controller（不残留内联样式）', () => {
    const destroy = vi.fn()
    autoAnimateMock.mockReturnValueOnce({ destroy })
    const { unmount } = render(
      <AnimatedList>
        <div key="a">A</div>
      </AnimatedList>,
    )
    unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
