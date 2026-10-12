/**
 * P0-1 回归测试：**默认（非 debug）渲染出的文本不得出现原始技术字段**。
 *
 * 覆盖两处：
 * 1. `IssueDetails`（单条问题的「技术详情」部分）；
 * 2. `ExportDiagnosticsPanel`（诊断面板，含「完整诊断 JSON」这类容易泄漏的折叠区）。
 *
 * 开启 debug（`?debug=1`）后，原始字段才出现在「给技术人员的信息」折叠区里。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ExportIssue, ExportPayload } from '../../src/api/types'
import { IssueDetails, ExportDiagnosticsPanel } from '../../src/components/livePreview/ExportDiagnostics'
import { renderWithTheme } from './testUtils'

/** 验收口径里点名禁止出现的原始字段名。 */
const RAW_FIELD_NAMES = [
  'scan index',
  'snapshot_digest',
  'evidence_digest',
  'body_paragraph_number',
  'instance_id',
  'blocked_modes',
]

const issue: ExportIssue = {
  kind: 'answer_region_item',
  severity: 'blocker',
  blocked_modes: ['学生版', '答案解析版'],
  paper_id: 7,
  item_id: 113,
  seq: 5,
  question_id: 5542,
  question_version: 3,
  summary: '答案区混入题干',
  message: '检测到答案片段出现在题干区。',
  suggested_action: '请人工核对后修正来源文件。',
  source: {
    source_id: 1,
    file_name: '浮力单元测试.docx',
    expected_sha256: 'aaa',
    actual_sha256: 'bbb',
    start_scan_index: 5,
    end_scan_index: 6,
    answer_region_start_scan_index: 9,
    body_paragraph_number: 8,
  },
  instance_id: 'doc:p1:i0',
}

const payload: ExportPayload = {
  content_guard_revision: 'cg-1',
  layout_revision: 'ly-1',
  content_digest: 'cd-1',
  diagnostics: {
    diagnostic_digest: 'diag-1',
    export_allowed: false,
    blocker_count: 1,
    warning_count: 0,
    issues: [issue],
    duplicate_groups: [{ question_id: 5542, item_ids: [113], seqs: [5] }],
    revision_proposal: {
      exclude_item_ids: [],
      keep_item_ids: [113],
      unresolved_item_ids: [],
      message: '建议先处理阻断项。',
    },
  },
  paper: { title: '浮力测试卷', template: '考试' },
  answer_mode: '答案解析版',
  generated_at: '2026-01-01T00:00:00Z',
  summary: {
    paper_id: 7,
    title: '浮力测试卷',
    template: '考试',
    answer_mode: '答案解析版',
    status: 'draft',
    item_count: 1,
    section_count: 1,
    total_score: 5,
    scored_count: 1,
    unscored_count: 0,
    score_complete: true,
    sections: [],
    qtype_distribution: {},
  },
  sections: [
    {
      section_id: 1,
      name: '一、选择题',
      seq: 1,
      item_count: 1,
      subtotal: 5,
      questions: [
        {
          content_status: 'blocked',
          snapshot_digest: 'snap-1',
          evidence_digest: 'ev-1',
          issues: [issue],
          content_blocks: [],
          item_id: 113,
          seq: 5,
          question_id: 5542,
          question_version: 3,
          score: 5,
          show_answer: true,
          show_analysis: true,
        },
      ],
    },
  ],
}

/** 面板依赖 react-query，这里用独立的 QueryClient 包裹（禁用重试，避免真发请求）。 */
function renderPanel(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithTheme(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  localStorage.removeItem('qb_debug')
  window.history.replaceState(null, '', window.location.pathname)
})

describe('IssueDetails 默认不泄露技术字段（P0-1）', () => {
  it('非 debug：只给老师摘要与来源文件，原始字段名一律不出现', () => {
    const { container } = renderWithTheme(<IssueDetails issue={issue} />)
    const text = container.textContent ?? ''
    for (const field of RAW_FIELD_NAMES) expect(text).not.toContain(field)
    // 教师语言仍在。
    expect(text).toContain('答案区混入题干')
    expect(text).toContain('来源文件：浮力单元测试.docx')
    // 「技术详情」这个内部词与折叠区都不应出现。
    expect(text).not.toContain('技术详情')
    expect(text).not.toContain('给技术人员的信息')
  })

  it('debug（?debug=1）：原始字段出现在「给技术人员的信息」折叠区', () => {
    window.history.replaceState(null, '', '/?debug=1')
    const { container } = renderWithTheme(<IssueDetails issue={issue} />)
    const text = container.textContent ?? ''
    expect(text).toContain('给技术人员的信息')
    expect(text).toContain('scan index')
    expect(text).toContain('body直属段号')
    expect(text).toContain('doc:p1:i0') // 图实例
    expect(text).toContain('受影响模式')
  })
})

describe('ExportDiagnosticsPanel 默认不泄露技术字段（P0-1）', () => {
  it('非 debug：面板文本不含原始字段名（含「完整诊断 JSON」折叠区）', () => {
    const { container } = renderPanel(<ExportDiagnosticsPanel paperId={7} data={payload} />)
    const text = container.textContent ?? ''
    for (const field of RAW_FIELD_NAMES) expect(text).not.toContain(field)
    // 教师语言仍在：结论 + 「导出前需要处理的问题」入口。
    expect(text).toContain('当前模式内容被阻断')
    expect(text).toContain('导出前需要处理的问题')
    expect(text).not.toContain('修订候选')
  })
})


/** B1 只读辅助：保留结论与来源，但不挂载修订控件或产生写请求。 */
describe('B1 诊断只读模式', () => {
  it('readOnly 无候选按钮、Dialog及请求，默认模式仍保留候选入口', () => {
    const request = vi.spyOn(globalThis, 'fetch')
    const view = renderPanel(<ExportDiagnosticsPanel paperId={7} data={payload} readOnly />)
    expect(view.container.textContent).toContain('当前模式内容被阻断')
    expect(view.container.textContent).toContain('浮力单元测试.docx')
    expect(view.container.querySelector('button')).toBeNull()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(request).not.toHaveBeenCalled()
    view.unmount()
    const editable = renderPanel(<ExportDiagnosticsPanel paperId={7} data={payload} />)
    expect(editable.container.querySelector('button')).not.toBeNull()
    request.mockRestore()
  })
})
