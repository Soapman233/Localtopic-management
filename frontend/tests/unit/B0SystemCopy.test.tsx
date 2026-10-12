/** B0 指定系统文案与缺字段事实；包含 ** 的数学题原文始终保留。 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from '../../src/pages/SearchPage'
import ExportPage from '../../src/pages/ExportPage'
import { PaperPanel, type PaperActions } from '../../src/components/PaperPanel'
import { VersionHistory } from '../../src/components/VersionHistory'
import type { Paper as PaperModel } from '../../src/api/types'
import { renderWithProviders } from './testUtils'

vi.mock('../../src/hooks/useSearch', () => ({
  useSearchQuery: () => ({ data: { total: 1, items: [{ id: 1, number: '1', text: '计算 2**3 的值', plain_text: '计算 2**3 的值', labels: [] }] } }),
  useFacetsQuery: () => ({}), useCoverageQuery: () => ({}),
}))
vi.mock('../../src/hooks/useExportGate', () => ({ useExportGate: () => ({ paperQ: { data: { title: 'B0文案', items: [] } }, exportDataQ: {}, previewPages: [], envFail: null, exportFormats: { docx: true, pdf: false }, exportMut: {}, exportJob: {} }) }))
function mount(page: JSX.Element, route = '/') { return renderWithProviders(<MemoryRouter initialEntries={[route]}>{page}</MemoryRouter>) }
afterEach(() => { window.history.replaceState(null, '', '/'); localStorage.removeItem('qb_debug') })
describe('B0 系统文案', () => {
  it.each([false, true])('检索字段缺失 debug=%s：事实仍可见，诊断按开关显示，数学原文保留', (debug) => {
    if (debug) window.history.replaceState(null, '', '/#/search?debug=1')
    mount(<SearchPage />, '/search')
    expect(screen.getByText('答案/解析信息暂不可用', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('计算 2**3 的值')).toBeInTheDocument()
    for (const term of ['/api/search', 'has_answer', 'has_analysis']) expect(document.body.textContent?.includes(term)).toBe(debug)
    expect(screen.queryByText('无答案')).not.toBeInTheDocument()
    expect(screen.queryByText('无解析')).not.toBeInTheDocument()
  })
  it('版本历史的系统强调是 strong，没有裸 Markdown', () => {
    const { container } = mount(<VersionHistory questionId={1} versions={[]} />)
    expect(container.querySelector('strong')).toHaveTextContent('仅供查看，不提供一键回滚')
    expect(container.textContent).not.toContain('**')
  })
  it('大题删除确认用 strong，保留不会丢失事实', () => {
    const paper = { id: 1, title: 'B0', template: '考试', answer_mode: '学生版', sections: [{ id: 1, name: '选择题', seq: 1 }], items: [{ id: 1, question_id: 1, seq: 1, section_id: 1, score: null, has_answer: true, plain_text: '原题 2**3', number: '1' }], summary: { item_count: 1, total_score: 0, unscored_count: 0 } } as unknown as PaperModel
    const actions = Object.fromEntries(['addQuestions','removeItem','moveItem','setScore','addSection','renameSection','moveSection','deleteSection','refreshSnapshots','updatePaper'].map(key => [key, vi.fn()])) as unknown as PaperActions
    mount(<PaperPanel paper={paper} loading={false} actions={actions} targetSectionId={null} onTargetSectionChange={vi.fn()} onOpenDrawer={vi.fn()} onGoExport={vi.fn()} onOpenDetail={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '删除大题' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('strong')).toHaveTextContent('不会丢失')
    expect(dialog.textContent).not.toContain('**')
  })
  it('导出页面删除完整定位段，真实页面仍有导出选项', () => {
    mount(<ExportPage />, '/export?paper_id=1')
    expect(screen.getByRole('heading', { name: '导出中心 · B0文案' })).toBeInTheDocument()
    expect(screen.getByText('答案模式')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/定位：|共用同一份门禁状态/)
  })
})
