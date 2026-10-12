/** B1 抽屉动作数量：状态独立构造，挂载真实抽屉。 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { ExportDrawer } from '../../src/components/ExportDrawer'
import { renderWithProviders } from './testUtils'
const stubs = vi.hoisted(() => ({ gate: vi.fn(), preview: vi.fn(), export: vi.fn() }))
vi.mock('../../src/hooks/useExportGate', () => ({ useExportGate: () => stubs.gate(), describeEnvFailure: () => '环境不可用' }))
const base = {
  paperQ: { data: { title: '唯一入口卷' } }, exportDataQ: {}, contentAllowed: true,
  answerMode: '学生版', template: '考试', setAnswerMode: vi.fn(), setTemplate: vi.fn(),
  degradedOk: false, unlocked: false, previewPages: [], previewCached: false,
  previewing: false, previewError: null, envFail: null, elapsed: 0,
  exportDisabled: true, exportFormats: { docx: true, pdf: false }, setExportFormats: vi.fn(),
  exportMut: {}, exportJob: {}, previewStages: [], previewStage: 0,
}
beforeEach(() => vi.clearAllMocks())
describe('B1 导出抽屉单一动作', () => {
  it.each([
    ['锁定无图', {}],
    ['已解锁', { unlocked: true }],
    ['旧图', { previewPages: [{ n: 1, url: '/old.png' }], showStale: true }],
    ['失败', { previewError: '生成失败' }],
    ['内容阻断', { contentAllowed: false }],
    ['请求中', { previewing: true }],
    ['环境失败', { envFail: 'office' }],
  ])('%s 状态只有一个像素预览与一个导出动作', (_name, override) => {
    stubs.gate.mockReturnValue({ ...base, ...override, runPreview: stubs.preview, confirmDegraded: vi.fn(), exportMut: { mutate: stubs.export } })
    renderWithProviders(<ExportDrawer open onClose={vi.fn()} paperId={2} autoPreview={false} />)
    expect(screen.getAllByRole('button', { name: /^(重新生成预览|生成预览)$/ })).toHaveLength(1)
    expect(screen.getAllByTestId('export-button')).toHaveLength(1)
    const preview = screen.getByTestId('regen-button')
    if (!(override as { previewing?: boolean }).previewing && (override as { contentAllowed?: boolean }).contentAllowed !== false) {
      fireEvent.click(preview)
      expect(stubs.preview).toHaveBeenCalledTimes(1)
    }
  })
})
