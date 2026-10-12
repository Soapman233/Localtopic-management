/** B0 预览可见性：固定 ready 分页结果，挂载真实 Panel/PageView；不依赖 jsdom 的几何测量。 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { LivePreviewPanel } from '../../src/components/LivePreviewPanel'
import { renderWithTheme } from './testUtils'
import type { ExportPayload } from '../../src/api/types'

vi.mock('../../src/components/livePreview/usePagination', () => ({
  usePagination: () => ({ measureRef: { current: null }, pages: [{ blockIndices: [], usedPx: 100, overflow: false }], ms: 0.2, ready: true, fontsReady: true, version: 1, heights: [] }),
}))
const payload = { paper: { title: 'B0预览', template: '考试' }, sections: [], layout_revision: 'layout-B0-v1', answer_mode: '学生版' } as unknown as ExportPayload
function checkDebug(debug: boolean | undefined, visible: boolean) {
  const { container } = renderWithTheme(<LivePreviewPanel paperId={1} data={payload} debug={debug} />)
  expect(!!screen.queryByText('layout-B0-v1')).toBe(visible)
  expect(!!screen.queryByText('测量 0.20ms · 重排 v1')).toBe(visible)
  expect(!!container.querySelector('.lp-debug-badge')).toBe(visible)
}
afterEach(() => { window.history.replaceState(null, '', '/'); localStorage.removeItem('qb_debug') })
describe('B0 统一有效 debug 值', () => {
  it('默认 ready DOM 无版本、测量与分页徽标', () => checkDebug(undefined, false))
  it('显式 true 显示三类诊断', () => checkDebug(true, true))
  it.each(['/?debug=1', '/#/builder?debug=1'])('缺省 prop 读取 URL %s', (url) => { window.history.replaceState(null, '', url); checkDebug(undefined, true) })
  it('缺省 prop 读取 storage', () => { localStorage.setItem('qb_debug', '1'); checkDebug(undefined, true) })
  it('显式 false 关闭 URL 与 storage 开启的全部诊断（降级预览）', () => { window.history.replaceState(null, '', '/?debug=1#/builder?debug=1'); localStorage.setItem('qb_debug', '1'); checkDebug(false, false) })
})
