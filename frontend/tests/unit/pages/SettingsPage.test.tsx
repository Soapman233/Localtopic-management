/**
 * `SettingsPage` 页面级集成测试（阶段 2 遗留：页面级四态替换缺守护）。
 *
 * mock 方案：`vi.stubGlobal('fetch')` 返回 `{code,data,message}` 信封。
 * 覆盖：加载中 → LoadingState；请求失败 → ErrorState（含重试）；有数据 → 回填表单。
 *
 * 说明：本页无「空态」（设置恒有默认值），故不测 EmptyState。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import SettingsPage from '../../../src/pages/SettingsPage'
import type { SettingsData } from '../../../src/api/types'
import { renderPage, jsonResponse, errorResponse, deferredResponse } from './pageTestUtils'

const settingsFixture: SettingsData = {
  db_path: 'C:/qb/bank.db',
  export_dir: 'C:/qb/exports',
  default_template: '考试',
  katex: { throw_on_error: false, strict: true },
  theme: { primary: '#3370FF', dark: false },
}

describe('SettingsPage 页面级集成', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载中 → 显示 LoadingState 文案', async () => {
    const d = deferredResponse()
    vi.stubGlobal('fetch', vi.fn(() => d.promise))
    renderPage(<SettingsPage />)

    expect(screen.getByText('正在加载设置…')).toBeInTheDocument()
    d.resolve(jsonResponse(settingsFixture))
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).not.toBeInTheDocument())
  })

  it('请求失败 → 显示 ErrorState（含重试按钮），点重试会再次请求', async () => {
    const fetchMock = vi.fn(async () => errorResponse(50001, '服务内部错误，请稍后重试。', 500))
    vi.stubGlobal('fetch', fetchMock)
    renderPage(<SettingsPage />)

    expect(await screen.findByText('加载设置失败')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /重试/ })
    const before = fetchMock.mock.calls.length
    fireEvent.click(retry)
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })

  it('默认进入「外观」Tab，主色回填为已保存值（不静默迁移）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(settingsFixture)))
    renderPage(<SettingsPage />)

    // 默认外观 Tab：主色输入框回填历史值 #3370FF（不得被静默改写成新默认色）。
    expect(await screen.findByDisplayValue('#3370FF')).toBeInTheDocument()
    // 高级字段（数据库路径）默认不渲染。
    expect(screen.queryByDisplayValue('C:/qb/bank.db')).not.toBeInTheDocument()
  })

  it('切到「高级」Tab 后回填数据库路径与导出目录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(settingsFixture)))
    renderPage(<SettingsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: '高级' }))
    expect(await screen.findByDisplayValue('C:/qb/bank.db')).toBeInTheDocument()
    expect(screen.getByDisplayValue('C:/qb/exports')).toBeInTheDocument()
  })

  // P0/T02：主色「原色」不达标必须**显式标注**（不能只是「看起来没问题」），并给出
  // 一键切推荐主色的动作；点击只改表单值（不静默落盘），标注随之消失。
  it('主色原色不达标 → 显式标注 + 一键切推荐主色；达标 → 不标注', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(settingsFixture)))
    renderPage(<SettingsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('未达 WCAG AA 4.5:1')
    expect(alert).toHaveTextContent('3.96:1')

    fireEvent.click(screen.getByRole('button', { name: '使用推荐主色' }))
    expect(screen.getByDisplayValue('#2F63EA')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/未达 WCAG AA/)).not.toBeInTheDocument())
  })

  it('主色原色达标时不显示不达标标注', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ...settingsFixture, theme: { primary: '#2F63EA', dark: false } })),
    )
    renderPage(<SettingsPage />)

    expect(await screen.findByDisplayValue('#2F63EA')).toBeInTheDocument()
    expect(screen.queryByText(/未达 WCAG AA/)).not.toBeInTheDocument()
  })
})
