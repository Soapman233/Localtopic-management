/** B0 单题详情：真实页内公式状态，未知/空值不能静默变成正常。 */
import { it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import QuestionDetailPage from '../../src/pages/QuestionDetailPage'
import { renderWithProviders } from './testUtils'

vi.mock('../../src/api/questions', () => ({ getQuestion: async () => ({
  id: 1, number: '1', text: '计算 2**3 的值', labels: [], versions: [], images: [],
  formulas: ['OK', 'UNSUPPORTED', 'EMPTY', 'FAIL', 'UNVERIFIED', 'NEW_CODE', null].map((status, index) => ({ fid: 'F'+index, status, latex: 'x', needs_review: false })),
}), mediaUrl: vi.fn(), setDifficulty: vi.fn(), updateQuestion: vi.fn() }))
it('非正常状态中文显示，空/未知需核对；OK保持安静而不宣称内容正确', async () => {
  renderWithProviders(<MemoryRouter initialEntries={['/question/1']}><Routes><Route path="/question/:id" element={<QuestionDetailPage />} /></Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: '题 1' })
  for (const label of ['不支持', '未提取到内容', '转换失败', '待核对']) expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getAllByText('状态信息不可用，待核对')).toHaveLength(2)
  expect(screen.getByText('计算 2**3 的值')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/UNSUPPORTED|EMPTY|FAIL|UNVERIFIED|NEW_CODE|正常/)
})
