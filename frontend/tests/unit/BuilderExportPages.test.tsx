/**
 * 组卷工作台 / 导出中心「页面标题区」护栏（设计规范 §4 P0）。
 *
 * 本轮把两页的手写标题换成 `PageHeader`，并去掉页面内自加 `maxWidth`。
 * 这里守住两条**可被 jsdom 稳定断言**的性质：
 * 1. 每个页面**恰好一个 `<h1>`**（`PageHeader level="page"`），且文案为页面主标题；
 * 2. `/export` 自动派生出「组卷工作台 › 导出中心」面包屑（与侧栏选中态口径一致）。
 *
 * ⚠️ 与 `A11y.test.tsx` 的分工：那份文件用**设置页**做「唯一 h1」的代表性断言；
 * 本文件专门覆盖本轮改动的这两个页面，防止再退回「手写标题 / 双 h1 / 缺面包屑」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import ExportPage from '../../src/pages/ExportPage'
import PaperBuilderPage from '../../src/pages/PaperBuilderPage'
import { AuthProvider } from '../../src/app/auth/AuthProvider'
import { usePaperStore } from '../../src/store/paperStore'
import { renderPage } from './pages/pageTestUtils'

/** 空信封响应：所有取数返回空 data，页面进入空态（不依赖后端）。 */
function emptyResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: {}, message: 'ok' }),
  } as unknown as Response
}

beforeEach(() => {
  // 唯一状态来源：清空当前试卷，确保两页都走「未选择试卷」分支。
  usePaperStore.setState({ currentPaperId: null, targetSectionId: null })
  vi.stubGlobal('fetch', vi.fn(async () => emptyResponse()))
})

afterEach(() => vi.unstubAllGlobals())

describe('导出中心（ExportPage）页面标题区', () => {
  it('未选择试卷时恰好一个 h1「导出中心」，并派生「组卷工作台 › 导出中心」面包屑', async () => {
    renderPage(<ExportPage />, { route: '/export' })

    const h1s = await screen.findAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('导出中心')

    const nav = screen.getByLabelText('面包屑导航')
    expect(nav.textContent).toContain('组卷工作台')
    expect(nav.textContent).toContain('导出中心')
  })
})

describe('组卷工作台（PaperBuilderPage）页面标题区', () => {
  it('恰好一个 h1「组卷工作台」（不再使用仅供读屏的绝对定位标题）', async () => {
    // 组卷页用到 `usePermission` → 需要 `AuthProvider`（与生产 main.tsx 同构）。
    renderPage(
      <AuthProvider>
        <PaperBuilderPage />
      </AuthProvider>,
      { route: '/builder' },
    )

    const h1s = await screen.findAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('组卷工作台')

    // 顶层页（侧栏可见）不渲染面包屑地标。
    expect(screen.queryByLabelText('面包屑导航')).toBeNull()
  })
})
