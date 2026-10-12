/** B1：真实路由与筛选同步；只替换预览渲染和请求边界。 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { renderWithProviders } from './testUtils'
import { usePaperStore } from '../../src/store/paperStore'
import { useUiStore } from '../../src/store/uiStore'
import { usePaperLibraryStore } from '../../src/store/paperLibraryStore'
import ExportPage from '../../src/pages/ExportPage'
import PaperBuilderPage from '../../src/pages/PaperBuilderPage'
const stubs = vi.hoisted(() => ({ getPaper: vi.fn(), preview: vi.fn(), export: vi.fn(), gate: vi.fn() }))
vi.mock('../../src/api/papers', async importOriginal => ({ ...await importOriginal<object>(), getPaper: stubs.getPaper }))
vi.mock('../../src/api/export', () => ({ getExportData: vi.fn(async () => ({ sections: [], paper: { title: '卷B' } })) }))
vi.mock('../../src/hooks/useSearch', () => ({ useSearchQuery: () => ({ data: { items: [], total: 0 } }), useFacetsQuery: () => ({ data: {} }) }))
vi.mock('../../src/components/FilterSidebar', () => ({ FilterSidebar: () => null }))
vi.mock('../../src/components/QuestionCard', () => ({ QuestionCard: () => null }))
vi.mock('../../src/components/LivePreviewPanel', () => ({ LivePreviewPanel: () => <div>结构预览</div> }))
vi.mock('../../src/components/livePreview/ExportDiagnostics', () => ({ ExportDiagnosticsPanel: (p: { readOnly?: boolean }) => <div data-testid="diagnostics-mode">{p.readOnly ? '只读' : '可修订'}</div>, IssueDetails: () => null }))
vi.mock('../../src/components/ExportDrawer', () => ({ ExportDrawer: (p: { open: boolean; paperId: number; onClose: () => void }) => p.open ? <div role="dialog" aria-label={'导出卷' + p.paperId}><button onClick={p.onClose}>关闭导出</button></div> : null }))
vi.mock('../../src/hooks/useExportGate', () => ({ useExportGate: (p: unknown) => stubs.gate(p), describeEnvFailure: () => '环境不可用' }))
const paper = { id: 2, title: '卷B', template: '考试', answer_mode: '学生版', items: [], sections: [], summary: { item_count: 0, total_score: 0, unscored_count: 0 } }
// jsdom AbortSignal 与 Node Request 不同 realm；测试无 loader，仅去掉传入 signal。
const NativeRequest = globalThis.Request
beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest { constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, { ...init, signal: undefined }) } })
  vi.clearAllMocks()
  usePaperStore.setState({ currentPaperId: 1, targetSectionId: 91 })
  useUiStore.setState({ builderView: 'layout' })
  usePaperLibraryStore.setState({ open: false })
  stubs.getPaper.mockResolvedValue(paper)
  stubs.gate.mockReturnValue({ paperQ: { data: paper }, exportDataQ: { data: { paper, sections: [], summary: paper.summary } }, contentAllowed: true, answerMode: '学生版', template: '考试', setAnswerMode: vi.fn(), setTemplate: vi.fn(), degradedOk: false, unlocked: false, refreshDiagnostics: vi.fn(), previewPages: [], previewCached: false, previewing: false, envFail: null, elapsed: 0, runPreview: stubs.preview, previewStages: [], previewStage: 0, exportMut: { mutate: stubs.export } })
})
afterEach(() => vi.unstubAllGlobals())
function routes(initialEntries: NonNullable<Parameters<typeof createMemoryRouter>[1]>['initialEntries']) {
  return createMemoryRouter([{ path: '/export', element: <ExportPage /> }, { path: '/builder', element: <PaperBuilderPage /> }], { initialEntries })
}
describe('B1 全屏辅助与指定卷一次性回程', () => {
  it('指定卷B辅助只读、一次预览；回程开B且清目标与意图，保留筛选/debug', async () => {
    const router = routes([{ pathname: '/export', search: '?paper_id=2&keyword=浮力&debug=1&debug=0&source=preview', state: { marker: '辅助回程' } }])
    renderWithProviders(<StrictMode><RouterProvider router={router} /></StrictMode>)
    expect(screen.getByTestId('diagnostics-mode')).toHaveTextContent('只读')
    expect(screen.queryByRole('button', { name: /^导出$/ })).toBeNull()
    expect(screen.queryByText('DOCX')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
    expect(stubs.preview).toHaveBeenCalledTimes(1)
    expect(stubs.export).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('back-to-builder'))
    await screen.findByRole('dialog', { name: '导出卷2' })
    await waitFor(() => expect(usePaperStore.getState().currentPaperId).toBe(2))
    expect(usePaperStore.getState().targetSectionId).toBeNull()
    expect(stubs.getPaper.mock.calls.every(call => call[0] === 2)).toBe(true)
    await waitFor(() => expect(router.state.location.state?.openExportForPaperId).toBeUndefined())
    expect(new URLSearchParams(router.state.location.search).get('keyword')).toBe('浮力')
    expect(new URLSearchParams(router.state.location.search).getAll('debug')).toEqual(['1', '0'])
    await act(() => new Promise(resolve => setTimeout(resolve, 650)))
    expect(new URLSearchParams(router.state.location.search).get('source')).toBe('preview')
    expect(new URLSearchParams(router.state.location.search).get('paper_id')).toBe('2')
    expect(router.state.location.state?.marker).toBe('辅助回程')
    fireEvent.click(screen.getByRole('button', { name: '关闭导出' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(() => router.navigate(router.state.location.pathname + router.state.location.search, { replace: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each([0, -2, 2.5, '2', null])('非法回程ID %s 不打开导出且清意图', async id => {
    const router = routes([{ pathname: '/builder', search: '?keyword=浮力&debug=1', state: { openExportForPaperId: id, marker: '保留' } }])
    renderWithProviders(<RouterProvider router={router} />)
    await waitFor(() => expect(router.state.location.state?.openExportForPaperId).toBeUndefined())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(usePaperStore.getState().currentPaperId).toBe(1)
    await act(() => new Promise(resolve => setTimeout(resolve, 650)))
    expect(router.state.location.state?.marker).toBe('保留')
  })
  it('不存在指定卷保持X，不退旧A', async () => {
    stubs.getPaper.mockRejectedValue(new Error('试卷不存在'))
    const router = routes([{ pathname: '/builder', state: { openExportForPaperId: 999 } }])
    renderWithProviders(<RouterProvider router={router} />)
    await screen.findByRole('dialog', { name: '导出卷999' })
    await waitFor(() => expect(stubs.getPaper).toHaveBeenCalledWith(999))
    expect(stubs.getPaper.mock.calls.every(call => call[0] === 999)).toBe(true)
    expect(usePaperStore.getState().currentPaperId).toBe(999)
    await screen.findByText('指定试卷加载失败')
    expect(screen.getByText('试卷不存在')).toBeInTheDocument()
  })
  it('非法指定卷不请求旧A，空态调用唯一试卷管理', () => {
    const router = routes(['/export?paper_id=bad'])
    renderWithProviders(<RouterProvider router={router} />)
    expect(stubs.gate.mock.calls[0][0]).toMatchObject({ paperId: 0, enabled: false })
    fireEvent.click(screen.getByRole('button', { name: '试卷管理' }))
    expect(usePaperLibraryStore.getState().open).toBe(true)
  })
})
