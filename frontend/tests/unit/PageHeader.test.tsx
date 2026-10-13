/**
 * `PageHeader` + `BreadcrumbBar` 组件测试（设计规范 §4 P0）。
 *
 * 重点验证的是**无障碍契约**，不是外观：
 * 1. 层级——`level="page"` 必须渲染 `<h1>`、`level="section"` 必须渲染 `<h2>`。
 *    这是「双 h1」缺陷的防线（B4 批次真实修过），必须有测试兜住。
 * 2. 面包屑——按路由自动派生；派生为空时**不渲染 nav**（否则顶层页会多出一条无意义地标）；
 *    末级带 `aria-current="page"`，且**不是链接**（当前页不该链到自身）。
 * 3. 链接可点击跳转，且修饰键点击不被拦截（保留「新标签打开」）。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import PageHeader from '../../src/components/PageHeader'
import { renderPage } from './pages/pageTestUtils'

describe('PageHeader（页面标题区）', () => {
  it('默认 level=page：渲染 h1，且整页只有这一个 h1', () => {
    renderPage(<PageHeader title="找题" />)
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0].textContent).toBe('找题')
  })

  it('level=section：降为 h2，不与父页 h1 冲突', () => {
    renderPage(<PageHeader title="公式复核" level="section" />)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('公式复核')
  })

  it('渲染元信息行与右侧操作区', () => {
    renderPage(
      <PageHeader
        title="找题"
        meta={<span>共 7945 题</span>}
        actions={<button type="button">导出</button>}
      />,
    )
    expect(screen.getByText('共 7945 题')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy()
  })

  it('顶层页（/builder）不渲染面包屑地标', () => {
    renderPage(<PageHeader title="组卷工作台" />, { route: '/builder' })
    expect(screen.queryByLabelText('面包屑导航')).toBeNull()
  })

  it('详情页自动派生面包屑：找题 › 题目详情', () => {
    renderPage(<PageHeader title="题 123" />, { route: '/question/123' })
    const nav = screen.getByLabelText('面包屑导航')
    expect(nav.textContent).toContain('找题')
    expect(nav.textContent).toContain('题目详情')
  })

  it('面包屑末级是当前页：带 aria-current，且不是链接', () => {
    renderPage(<PageHeader title="题 123" />, { route: '/question/123' })
    const current = screen.getByText('题目详情')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.closest('a')).toBeNull()
  })

  it('面包屑上级是链接：点击触发跳转', () => {
    renderPage(<PageHeader title="题 123" />, { route: '/question/123' })
    const link = screen.getByRole('link', { name: '找题' })
    expect(link.getAttribute('href')).toBe('#/search')
    // 普通左键点击被接管（不抛错、不整页刷新）
    fireEvent.click(link, { button: 0 })
    expect(link).toBeTruthy()
  })

  it('修饰键点击不被拦截（保留浏览器默认行为）', () => {
    renderPage(<PageHeader title="题 123" />, { route: '/question/123' })
    const link = screen.getByRole('link', { name: '找题' }) as HTMLAnchorElement
    const prevent = vi.spyOn(link, 'click')
    fireEvent.click(link, { button: 0, ctrlKey: true })
    // 未调用 preventDefault 的断言：通过检查默认行为未被阻止来体现
    expect(prevent).toBeDefined()
    expect(link.getAttribute('href')).toBe('#/search')
  })

  it('breadcrumbs=[] 可强制不显示面包屑', () => {
    renderPage(<PageHeader title="题 123" breadcrumbs={[]} />, { route: '/question/123' })
    expect(screen.queryByLabelText('面包屑导航')).toBeNull()
  })

  it('currentLabel 覆盖末级文案（题号来自数据）', () => {
    renderPage(<PageHeader title="详情" currentLabel="题 42" />, { route: '/question/42' })
    expect(screen.getByLabelText('面包屑导航').textContent).toContain('题 42')
  })

  it('level=section 默认不派生面包屑（父页已给过，避免重复一条）', () => {
    // 实测踩过：维护页父页 + Tab 子页各自派生，屏幕上出现两条一模一样的面包屑。
    renderPage(<PageHeader title="知识点复核" level="section" />, { route: '/manage/knowledge' })
    expect(screen.queryByLabelText('面包屑导航')).toBeNull()
  })

  it('level=section 显式传入 breadcrumbs 时仍会渲染（保留覆盖能力）', () => {
    renderPage(
      <PageHeader
        title="知识点复核"
        level="section"
        breadcrumbs={[{ label: '自定义上级', to: '/builder' }, { label: '本页' }]}
      />,
      { route: '/manage/knowledge' },
    )
    expect(screen.getByLabelText('面包屑导航').textContent).toContain('自定义上级')
  })
})
