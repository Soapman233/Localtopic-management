/**
 * `ErrorBoundary` 行为测试（阶段 0 护栏）。
 *
 * 关注**用户可见行为**：单页异常时是否给出可恢复的兜底界面、重试能否恢复、
 * 切换路由（resetKeys 变化）能否自动脱困。不断言内部实现。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import ErrorBoundary from '../../src/components/ErrorBoundary'
import { renderWithTheme } from './testUtils'

/** 由测试控制的「会抛错的子组件」。 */
let shouldThrow = true

function Boom() {
  if (shouldThrow) throw new Error('渲染炸了')
  return <div>正常内容</div>
}

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    shouldThrow = true
    // React 会把被边界捕获的错误打到 console.error；测试中静音以免噪音。
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it('子组件抛错时渲染中文兜底界面，而不是白屏', () => {
    renderWithTheme(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这个页面出错了')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument()
  })

  it('兜底界面展示错误信息，技术细节默认折叠（不直接糊给老师）', () => {
    renderWithTheme(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('渲染炸了')).toBeInTheDocument()
    expect(screen.getByText('给技术人员的信息')).toBeInTheDocument()
  })

  it('问题修复后点「重试」可恢复渲染', () => {
    renderWithTheme(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这个页面出错了')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))

    expect(screen.getByText('正常内容')).toBeInTheDocument()
    expect(screen.queryByText('这个页面出错了')).not.toBeInTheDocument()
  })

  it('resetKeys 变化时自动重置（切换路由不再卡在错误页）', () => {
    function Harness() {
      const [key, setKey] = useState('/a')
      return (
        <>
          <button onClick={() => setKey('/b')}>切到另一页</button>
          <ErrorBoundary resetKeys={[key]}>
            <Boom />
          </ErrorBoundary>
        </>
      )
    }
    renderWithTheme(<Harness />)
    expect(screen.getByText('这个页面出错了')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: '切到另一页' }))

    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})
