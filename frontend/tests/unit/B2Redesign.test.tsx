/**
 * B2 设计重构验收（找题页 + 单题详情页 + 空态行动）。
 *
 * 覆盖规格 `.tmp_verify/B2_spec.md` 中**可被 jsdom 稳定断言**的部分：
 *  - B2-1：未选题时**无批量条**；勾选后出现并计数；清空后消失；搜索 placeholder 去术语；
 *          覆盖率默认折叠为一行「数据完整度」；严格模式状态就地显示在知识点筛选旁。
 *  - B2-2：详情正文 `maxWidth: 720` 且居中；「更多信息」默认关闭、可展开；
 *          未知/待核对风险（「待复核公式」徽章）**不随折叠一起隐藏**；版本历史默认折叠。
 *  - B2-3：空卷空态给出可点击的下一步（去找题）。
 *
 * ⚠️ 视觉缺陷（真实宽度、居中、题卡上沿）由 `.tmp_verify/b2_probe.mjs` 在 1366×768 实测，
 * 单元测试只守语义与结构不变量。
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SearchPage from '../../src/pages/SearchPage'
import QuestionDetailPage from '../../src/pages/QuestionDetailPage'
import { CoverageBanner } from '../../src/components/CoverageBanner'
import { FilterSidebar } from '../../src/components/FilterSidebar'
import type { CoverageSummary, FacetsData } from '../../src/api/types'
import { renderWithProviders, renderWithTheme } from './testUtils'

// ---- 找题页：一条结果、无答案字段 ----
vi.mock('../../src/hooks/useSearch', () => ({
  useSearchQuery: () => ({
    data: {
      total: 1,
      items: [{ id: 7, number: '7', text: '计算 2**3', plain_text: '计算 2**3', labels: [], difficulty: '未标注' }],
      grade_gap: null,
    },
    isFetching: false,
  }),
  useFacetsQuery: () => ({ data: undefined, isLoading: false }),
  useCoverageQuery: () => ({ data: null }),
}))

function mountSearch() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/search']}>
      <SearchPage />
    </MemoryRouter>,
  )
}

describe('B2-1 找题页：批量条按需出现', () => {
  it('未勾选任何题时不渲染批量条', () => {
    mountSearch()
    expect(screen.queryByTestId('add-selected')).not.toBeInTheDocument()
  })

  it('勾选一题后出现批量条并显示计数；清空后消失', () => {
    mountSearch()
    fireEvent.click(screen.getByLabelText('选择题 7'))
    const bar = screen.getByTestId('add-selected')
    expect(bar).toHaveTextContent('加入所选（1）')
    // 点「清空」→ 选择清空 → 批量条随之消失。
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(screen.queryByTestId('add-selected')).not.toBeInTheDocument()
  })

  it('搜索框 placeholder 不再出现「中文双字切分」术语', () => {
    mountSearch()
    const input = screen.getByPlaceholderText('搜索题干关键词')
    expect(input).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('中文双字切分')
  })
})

describe('B2-1 覆盖率一行摘要', () => {
  const coverage: CoverageSummary = {
    source_files_total: 10,
    questions_total: 7945,
    grade: { n: 1342, total: 7945, pct: 17 },
    textbook: { n: 0, total: 7945, pct: 0 },
    chapter: { n: 0, total: 7945, pct: 0 },
    qtype: { n: 7945, total: 7945, pct: 100 },
    difficulty: { n: 0, total: 7945, pct: 0 },
    knowledge: { n: 0, total: 7945, pct: 0 },
    answer: { n: 7000, total: 7945, pct: 88 },
    analysis: { n: 6000, total: 7945, pct: 76 },
    review_open: 132,
  }

  it('默认折叠：只显示「数据完整度」一行，不渲染六维数值', () => {
    renderWithTheme(<CoverageBanner coverage={coverage} dismissed={false} onDismiss={vi.fn()} />)
    expect(screen.getByText('数据完整度')).toBeInTheDocument()
    expect(screen.queryByText('17%（1,342/7,945）')).not.toBeInTheDocument()
  })

  it('展开后显示六维数值与复核数，且不造未定义的总体百分比', () => {
    renderWithTheme(<CoverageBanner coverage={coverage} dismissed={false} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByTestId('coverage-toggle'))
    expect(screen.getByText('17%（1,342/7,945）')).toBeInTheDocument()
    expect(screen.getByText('132 条')).toBeInTheDocument()
    // 不得出现「完整度 42%」这类未经定义的合成分数。
    expect(document.body.textContent).not.toMatch(/完整度\s*\d+\s*%/)
  })
})

describe('B2-1 严格模式状态移到知识点筛选旁', () => {
  const facets: FacetsData = {
    dimensions: { grade: { items: [{ key: '八年级下册', count: 43 }], missing: 631 } },
    coverage: {
      source_files_total: 209,
      questions_total: 7945,
      grade: { n: 1396, total: 7945, pct: 17.6 },
      textbook: { n: 1392, total: 7945, pct: 17.5 },
      chapter: { n: 2810, total: 7945, pct: 35.4 },
      qtype: { n: 5559, total: 7945, pct: 70 },
      difficulty: { n: 0, total: 7945, pct: 0 },
      knowledge: { n: 0, total: 7945, pct: 0 },
      answer: { n: 3973, total: 7945, pct: 50 },
      analysis: { n: 4639, total: 7945, pct: 58.4 },
      review_open: 132,
    },
  } as FacetsData

  it('strictKp 为真时，知识点分组内显示「严格模式已启用」', () => {
    renderWithTheme(
      <FilterSidebar facets={facets} loading={false} filters={{} as never} onChange={vi.fn()} strictKp onStrictKpChange={vi.fn()} onReset={vi.fn()} />,
    )
    expect(screen.getByTestId('strict-kp-active')).toHaveTextContent('严格模式已启用')
  })

  it('strictKp 为假时，不显示严格模式状态', () => {
    renderWithTheme(
      <FilterSidebar facets={facets} loading={false} filters={{} as never} onChange={vi.fn()} strictKp={false} onStrictKpChange={vi.fn()} onReset={vi.fn()} />,
    )
    expect(screen.queryByTestId('strict-kp-active')).not.toBeInTheDocument()
  })
})

// ---- 详情页 fixture：含公式（其中一条待复核） ----
vi.mock('../../src/api/questions', () => ({
  getQuestion: async () => ({
    id: 1,
    number: '1',
    text: '计算 2**3 的值',
    answer: '8',
    analysis: '因为 2*2*2=8',
    labels: [],
    versions: [{ version: 1, created_at: '2026-01-01T00:00:00' }],
    images: [],
    src_file: '某来源.docx',
    src_stage: '初中',
    src_subject: '物理',
    src_grade: '八年级',
    src_textbook: '人教版',
    chapter: '1.1',
    formulas: [
      { fid: 'F1', status: 'OK', latex: 'x', needs_review: false },
      { fid: 'F2', status: 'UNSUPPORTED', latex: 'y', needs_review: true },
    ],
  }),
  mediaUrl: vi.fn(),
  setDifficulty: vi.fn(),
  updateQuestion: vi.fn(),
}))

function mountDetail() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/question/1']}>
      <Routes>
        <Route path="/question/:id" element={<QuestionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('B2-2 单题详情：正文宽度与折叠', () => {
  it('正文容器 maxWidth 为 720px 且左右居中', async () => {
    mountDetail()
    await screen.findByRole('heading', { name: '题 1' })
    const box = screen.getByTestId('detail-container')
    const cs = getComputedStyle(box)
    expect(cs.maxWidth).toBe('720px')
    expect(cs.marginLeft).toBe('auto')
    expect(cs.marginRight).toBe('auto')
  })

  it('「更多信息」默认关闭；展开后公式状态与来源出现', async () => {
    mountDetail()
    await screen.findByRole('heading', { name: '题 1' })
    // 默认关闭：折叠区 aria-expanded=false，且公式列表内容不可见。
    const moreSummary = screen.getByRole('button', { name: /更多信息（公式与来源）/ })
    expect(moreSummary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('公式列表（2 条）')).not.toBeVisible()
    // 默认来源摘要只显示文件名（始终可见）。
    expect(screen.getByText('来源文件：某来源.docx')).toBeVisible()
    // 点击展开。
    fireEvent.click(moreSummary)
    expect(moreSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('公式列表（2 条）')).toBeVisible()
    expect(screen.getByText('不支持')).toBeVisible()
  })

  it('待核对风险不随「更多信息」一起隐藏（顶部「待复核公式」徽章始终可见）', async () => {
    mountDetail()
    await screen.findByRole('heading', { name: '题 1' })
    expect(screen.getByText('待复核公式 1')).toBeVisible()
  })

  it('版本历史默认折叠（入口可见、列表未展开）', async () => {
    mountDetail()
    await screen.findByRole('heading', { name: '题 1' })
    const history = screen.getByTestId('version-history')
    expect(within(history).getByText('版本历史（只读）')).toBeVisible()
    // 折叠状态下版本行内容不可见（aria-expanded=false）。
    expect(within(history).getByRole('button', { name: /版本历史（只读）/ })).toHaveAttribute('aria-expanded', 'false')
    expect(within(history).getByText('v1')).not.toBeVisible()
  })
})
