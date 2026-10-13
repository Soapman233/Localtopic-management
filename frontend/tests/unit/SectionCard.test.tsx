/**
 * `SectionCard` 组件测试（设计规范 §4 P0）。
 *
 * 关键契约：
 * 1. 标题语义层级正确（h2 / h3），**不产生 h1**；
 * 2. `variant="plain"` 不画卡片外框（避免「卡片里的卡片」）；
 * 3. 无标题时不渲染标题行（只有内容）。
 */
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import SectionCard from '../../src/components/SectionCard'
import { renderPage } from './pages/pageTestUtils'

describe('SectionCard（分区卡片）', () => {
  it('默认渲染 h2 标题与内容', () => {
    renderPage(
      <SectionCard title="试卷设置">
        <span>内容区</span>
      </SectionCard>,
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('试卷设置')
    expect(screen.getByText('内容区')).toBeTruthy()
  })

  it('level=subsection 降为 h3', () => {
    renderPage(<SectionCard title="细分" level="subsection"><span>x</span></SectionCard>)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('细分')
  })

  it('不产生 h1（页面主标题归 PageHeader）', () => {
    renderPage(<SectionCard title="任意"><span>x</span></SectionCard>)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('渲染标题右侧元信息与操作', () => {
    renderPage(
      <SectionCard title="我关注的" meta={<span>3</span>} actions={<button type="button">全部</button>}>
        <span>x</span>
      </SectionCard>,
    )
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部' })).toBeTruthy()
  })

  it('无标题时不渲染标题行', () => {
    renderPage(<SectionCard><span>裸内容</span></SectionCard>)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('裸内容')).toBeTruthy()
  })

  it('disablePadding 真的生效（不是声明了没用的空属性）', () => {
    // 曾经的缺陷：`disablePadding` 只声明未使用，调用方传了没反应，
    // 只能各自用 `contentSx={{ p: 0 }}` 绕过——这条测试就是防线。
    const padded = renderPage(<SectionCard><span>a</span></SectionCard>)
    const paddedBody = screen.getByText('a').parentElement as HTMLElement
    expect(getComputedStyle(paddedBody).paddingLeft).toBe('16px')
    padded.unmount()

    renderPage(<SectionCard disablePadding><span>b</span></SectionCard>)
    const bareBody = screen.getByText('b').parentElement as HTMLElement
    expect(getComputedStyle(bareBody).paddingLeft).toBe('0px')
  })
})
