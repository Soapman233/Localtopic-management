/** B3：真实设置、空大题与测量节点；几何及门禁闭环另用副本浏览器实测。 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { LivePreviewPanel } from '../../src/components/LivePreviewPanel'
import { PaperSettings } from '../../src/components/PaperSettings'
import { PaperPanel, type PaperActions } from '../../src/components/PaperPanel'
import type { ExportPayload, Paper } from '../../src/api/types'
import { renderWithProviders, renderWithTheme } from './testUtils'

vi.mock('../../src/components/livePreview/usePagination', () => ({
  usePagination: () => ({ measureRef: { current: null }, pages: [{ blockIndices: [], usedPx: 100, overflow: false }], ms: 0.2, ready: true, fontsReady: true, version: 1, heights: [] }),
}))
const payload = { paper: { title: 'B3预览', template: '考试' }, sections: [], content_digest: 'digest-B', answer_mode: '学生版' } as unknown as ExportPayload
const paper = { id: 1, title: '卷A', template: '考试', answer_mode: '学生版', items: [], sections: [
  { id: 11, seq: 1, name: '空大题一', subtotal: 0, unscored_count: 0 },
  { id: 22, seq: 2, name: '空大题二', subtotal: 0, unscored_count: 0 },
], summary: { item_count: 0, total_score: 0, unscored_count: 0 } } as unknown as Paper
function actions(): PaperActions {
  return { addQuestions: vi.fn(), removeItem: vi.fn(), moveItem: vi.fn(), setScore: vi.fn(), addSection: vi.fn(), renameSection: vi.fn(), moveSection: vi.fn(), deleteSection: vi.fn(), refreshSnapshots: vi.fn(), updatePaper: vi.fn() }
}
describe('B3 设置与清单能力', () => {
  it('设置初态折叠；展开修改标题仍只调用元数据入口', () => {
    const update = vi.fn()
    const { container } = renderWithTheme(<PaperSettings paper={paper} onUpdate={update} targetSectionId={null} onTargetSectionChange={vi.fn()} onOpenLibrary={vi.fn()} />)
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByText('试卷设置'))
    const input = screen.getByLabelText('试卷标题')
    fireEvent.change(input, { target: { value: '卷A修正' } })
    fireEvent.blur(input)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ title: '卷A修正' })
    expect(screen.getByRole('combobox', { name: '试卷模板' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '试卷答案模式' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '加入目标' })).toBeVisible()
  })
  it('空大题可见，首尾禁用；上下移请求位置正确且不提供未分组大题移动', () => {
    const a = actions()
    renderWithProviders(<PaperPanel paper={paper} loading={false} actions={a} targetSectionId={null} onTargetSectionChange={vi.fn()} onOpenDrawer={vi.fn()} onOpenDetail={vi.fn()} showSettings={false} />)
    expect(screen.getByText('空大题一')).toBeVisible()
    expect(screen.getByText('空大题二')).toBeVisible()
    expect(screen.getByRole('button', { name: '上移大题 空大题一' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移大题 空大题二' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '下移大题 空大题一' }))
    fireEvent.click(screen.getByRole('button', { name: '上移大题 空大题二' }))
    expect(a.moveSection).toHaveBeenNthCalledWith(1, 11, 2)
    expect(a.moveSection).toHaveBeenNthCalledWith(2, 22, 1)
    expect(screen.getByRole('button', { name: '新增大题' })).toBeVisible()
    expect(screen.queryByText('试卷设置')).toBeNull()
  })
})
describe('B3 清单态持续测量', () => {
  it('不画纸面仍保留独立测量层并上报当前内容摘要；模式切换后纸面恢复', () => {
    const summary = vi.fn()
    const view = renderWithTheme(<LivePreviewPanel paperId={2} data={payload} toolbarMode="hidden" showPages={false} onPageSummary={summary} />)
    expect(view.container.querySelector('.lp-measure')).not.toBeNull()
    expect(view.container.querySelector('.lp-page')).toBeNull()
    expect(summary).toHaveBeenCalledTimes(1)
    expect(summary).toHaveBeenCalledWith({ paperId: 2, contentDigest: 'digest-B', pageCount: 1, overflowPages: 0, ready: true })
    view.rerender(<LivePreviewPanel paperId={2} data={payload} toolbarMode="hidden" onPageSummary={summary} />)
    expect(view.container.querySelector('.lp-page')).not.toBeNull()
    const measurement = view.container.querySelector('.lp-measure')!
    for (let node: Element | null = measurement; node; node = node.parentElement) {
      expect((node as HTMLElement).style.transform).not.toContain('scale')
      expect((node as HTMLElement).style.display).not.toBe('none')
    }
  })
  it('换卷和内容摘要重新上报，compact只保留近似页数', () => {
    const summary = vi.fn()
    const view = renderWithTheme(<LivePreviewPanel paperId={2} data={payload} toolbarMode="compact" onPageSummary={summary} />)
    expect(screen.getByText('约 1 页')).toBeVisible()
    expect(screen.queryByText('模板 考试')).toBeNull()
    view.rerender(<LivePreviewPanel paperId={3} data={{ ...payload, content_digest: 'digest-C' }} toolbarMode="compact" onPageSummary={summary} />)
    expect(summary).toHaveBeenLastCalledWith({ paperId: 3, contentDigest: 'digest-C', pageCount: 1, overflowPages: 0, ready: true })
  })
})
