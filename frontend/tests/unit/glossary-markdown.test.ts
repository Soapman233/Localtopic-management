/**
 * 门禁：**用户可见文案不得含裸 markdown**（设计规范 §3.4-2）。
 *
 * 为什么要有它
 * ------------
 * 界面上**真实出现过**「星号上屏」：局域网面板的风险提示原文是
 * `开启后，**同一网络下的任何设备**都能访问你的题库。`——
 * 老师看到的是两个星号，不是加粗。
 *
 * 而设计评审「上一轮 18 项对账」把「裸 markdown 上屏」标为 **✅ 已修**——
 * **那个结论是错的**：它扫的是页面 `bodyText`，而这几处文案只在**展开/滚动到**时才渲染，
 * 没被采到。这条测试就是防止「扫不到 = 已修」再次发生。
 *
 * 检查方式：**遍历运行时值**，而不是 grep 源码——
 * 源码注释里大量使用 `**` 做 JSDoc 加粗（那是合法的），grep 会淹没在噪音里。
 */
import { describe, expect, it } from 'vitest'
import {
  GLOSSARY,
  describeDegradedMode,
  describeExportGate,
  describeExportGateAction,
  describeImportDisabled,
  describeImportGoToLibrary,
  describeImportGuide,
  describeImportPendingReview,
  describeIssueSource,
  describeIssueTechnical,
  describeJobTimeout,
  describeLockedSnapshot,
  describeMentionScope,
  describePaletteSearch,
  describePreviewRetention,
  describePreviewReused,
  describePrimaryContrast,
  describeRevisionIssues,
  describeSnapshotStale,
  describeTechnicalInfo,
} from '../../src/lib/glossary'
import type { ExportIssue } from '../../src/api/types'

/** 最简 `ExportIssue` 夹具：只为触发 `describeIssueTechnical` 的每个分支。 */
const issueFixture = {
  paper_id: 1,
  item_id: 2,
  seq: 3,
  question_id: 4,
  question_version: 5,
  kind: 'mathtype',
  instance_id: 'i-1',
  blocked_modes: ['学生版'],
  source: {
    file_name: '某试卷.docx',
    start_scan_index: 1,
    end_scan_index: 2,
    answer_region_start_scan_index: null,
    body_paragraph_number: 3,
  },
} as unknown as ExportIssue

/** 全部会产出**用户可见文案**的 describe*（新增函数时请一并加进来）。 */
const describeCallers: Array<[string, () => string]> = [
  ['describeLockedSnapshot', () => describeLockedSnapshot()],
  ['describeSnapshotStale', () => describeSnapshotStale(3)],
  ['describeExportGate/ready', () => describeExportGate('ready')],
  ['describeExportGate/locked', () => describeExportGate('locked')],
  ['describeExportGate/degraded', () => describeExportGate('degraded')],
  ['describeExportGateAction', () => describeExportGateAction('locked')],
  ['describePreviewRetention', () => describePreviewRetention()],
  ['describePreviewReused', () => describePreviewReused()],
  ['describeJobTimeout', () => describeJobTimeout()],
  ['describeDegradedMode', () => describeDegradedMode()],
  ['describeRevisionIssues', () => describeRevisionIssues()],
  ['describeMentionScope', () => describeMentionScope()],
  ['describeTechnicalInfo', () => describeTechnicalInfo()],
  ['describePaletteSearch', () => describePaletteSearch('浮力')],
  ['describePrimaryContrast/ok', () => describePrimaryContrast(5.13, 5.13, true, 4.5)],
  ['describePrimaryContrast/low', () => describePrimaryContrast(3.96, 3.89, false, 4.5)],
  ['describeImportDisabled', () => describeImportDisabled()],
  ['describeImportPendingReview', () => describeImportPendingReview()],
  ['describeImportGoToLibrary', () => describeImportGoToLibrary()],
  ['describeIssueSource', () => describeIssueSource(issueFixture.source)],
  ['describeIssueSource/null', () => describeIssueSource(null)],
  ['describeIssueTechnical', () => describeIssueTechnical(issueFixture)],
]

/** 裸 markdown 的判定：成对星号（`**加粗**`）。 */
const BARE_BOLD = /\*\*[^*]+\*\*/

describe('用户可见文案不得含裸 markdown（规范 §3.4-2）', () => {
  it('GLOSSARY 的每个值都不含 `**`', () => {
    const bad = Object.entries(GLOSSARY).filter(([, v]) => BARE_BOLD.test(v))
    expect(bad, `以下文案会把星号直接显示给老师：${bad.map(([k]) => k).join('、')}`).toEqual([])
  })

  it('全部 describe* 的输出都不含 `**`（含带参数的组合）', () => {
    const bad = describeCallers.filter(([, fn]) => BARE_BOLD.test(fn())).map(([name]) => name)
    expect(bad, `以下函数输出含裸 markdown：${bad.join('、')}`).toEqual([])
  })

  it('反证：检查规则本身能抓到 `**`（否则这是一条永远通过的空门禁）', () => {
    expect(BARE_BOLD.test('开启后，**任何设备**都能访问')).toBe(true)
    expect(BARE_BOLD.test('开启后，「任何设备」都能访问')).toBe(false)
  })

  it('describeImportGuide 返回的三个字段都不含 `**`', () => {
    const g = describeImportGuide()
    for (const v of [g.title, g.body, g.action]) {
      expect(BARE_BOLD.test(v), `含裸 markdown：${v}`).toBe(false)
    }
  })
})
