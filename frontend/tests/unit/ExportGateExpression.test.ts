/**
 * 阶段 3「门禁**表达**重写」的行为测试（T3-2 / L1 / L2 / L4）。
 *
 * ⚠️ 本文件**只测表达层**（怎么说、怎么显示、入口在哪），**不测门禁判定**——
 * 「能不能导出」的语义由 `uiStore` 决定，已由 `tests/preview-and-theme.test.cjs`
 * 与 `frontend/tests/frontend-fixes.test.cjs` 覆盖；此处不得触碰其行为。
 *
 * 覆盖：
 *  - 三态文案**同源**：`exportGateState` + `describeExportGate` 为抽屉/导出中心的唯一派生口径；
 *  - 锁定态**可执行下一步**：`describeExportGateAction('locked')` 直接给「生成预览」；
 *  - 「刷新即锁」**解释**：`describePreviewRetention` 讲清原因（只解释、不改行为）；
 *  - L2：「命中缓存」→ 教师语言；
 *  - L1：环境失败原因默认走教师语言，技术细节仅在 debug 下可见；
 *  - L4：长任务阶段常量与**前端推断**索引（后端不上报阶段名）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  GLOSSARY,
  describeExportGate,
  describeExportGateAction,
  describeJobTimeout,
  describePreviewRetention,
  describePreviewReused,
  exportGateState,
} from '../../src/lib/glossary'
import {
  EXPORT_STAGES,
  PREVIEW_STAGES,
  describeEnvFailure,
  envReason,
  inferExportStage,
  inferPreviewStage,
} from '../../src/hooks/exportGateShared'

afterEach(() => {
  localStorage.removeItem('qb_debug')
})

describe('三态文案同源（T3-2）', () => {
  it('exportGateState 是解锁/降级 → 三态 key 的唯一派生口径', () => {
    expect(exportGateState(false, false)).toBe('locked')
    expect(exportGateState(false, true)).toBe('locked') // 未解锁时即使有降级确认也算锁定
    expect(exportGateState(true, false)).toBe('ready')
    expect(exportGateState(true, true)).toBe('degraded')
  })

  it('既有三态文案语义未被改动（只增不改）', () => {
    expect(describeExportGate('ready')).toBe(GLOSSARY.exportReady)
    expect(describeExportGate('locked')).toBe(GLOSSARY.exportLocked)
    expect(describeExportGate('degraded')).toBe(GLOSSARY.degradedMode)
  })

  it('同一状态下，导出抽屉与导出中心派生出的三态 key 完全一致（同源）', () => {
    // 两个入口都调用 exportGateState(unlocked, degradedOk)，故对同一 (unlocked, degradedOk) 结果唯一。
    for (const [unlocked, degradedOk] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      expect(exportGateState(unlocked, degradedOk)).toBe(exportGateState(unlocked, degradedOk))
    }
  })
})

describe('锁定态可执行动作 + 刷新即锁解释（T3-2）', () => {
  it('describeExportGateAction 只在锁定态给动作，文案即「生成预览」', () => {
    expect(describeExportGateAction('locked')).toBe(GLOSSARY.generatePreview)
    expect(describeExportGateAction('locked')).toBe('生成预览')
    expect(describeExportGateAction('ready')).toBe('')
    expect(describeExportGateAction('degraded')).toBe('')
  })

  it('describePreviewRetention 解释原因（含「刷新」「重新生成」），且不改行为', () => {
    const text = describePreviewRetention()
    expect(text).toBe(GLOSSARY.previewNotPersisted)
    expect(text).toContain('刷新')
    expect(text).toContain('重新生成')
  })
})

describe('L2：命中缓存的教师语言', () => {
  it('describePreviewReused 返回教师语言，不再是「命中缓存」', () => {
    expect(describePreviewReused()).toBe(GLOSSARY.previewReused)
    expect(describePreviewReused()).not.toContain('命中缓存')
  })
})

describe('L1：环境失败原因走教师语言，技术细节仅在 debug 下可见', () => {
  it('默认（非 debug）只给教师语言，不含 editor_sdk 等技术词', () => {
    expect(describeEnvFailure('editor_sdk')).toBe(GLOSSARY.envEditorSdk)
    expect(describeEnvFailure('editor_sdk')).not.toContain('editor_sdk')
    expect(describeEnvFailure('office')).toBe(GLOSSARY.envOffice)
    expect(describeEnvFailure(null)).toBe(GLOSSARY.envUnknown)
  })

  it('debug 下追加技术细节（envReason），维护者仍可定位', () => {
    localStorage.setItem('qb_debug', '1')
    const text = describeEnvFailure('editor_sdk')
    expect(text).toContain(GLOSSARY.envEditorSdk)
    expect(text).toContain(envReason('editor_sdk'))
    expect(text).toContain('editor_sdk')
  })

  it('envReason（技术口径）本身保留，供 debug / 日志使用', () => {
    expect(envReason('editor_sdk')).toContain('editor_sdk')
    expect(envReason('office')).toContain('Word')
    expect(envReason(null)).toContain('环境依赖缺失')
  })
})

describe('L4：长任务阶段（前端推断）', () => {
  it('阶段名覆盖需求要求的两条路径', () => {
    expect(PREVIEW_STAGES).toEqual(['内容检查', '渲染文档', '生成 PDF', '生成预览图'])
    expect(EXPORT_STAGES).toEqual(['内容检查', '渲染文档', '写出 DOCX/PDF'])
  })

  it('inferPreviewStage：内容检查 → 请求中 → 作业内按已用时长推断推进', () => {
    const base = { checking: false, requesting: false, running: false, elapsedSec: 0 }
    expect(inferPreviewStage({ ...base, checking: true })).toBe(0)
    expect(inferPreviewStage({ ...base, requesting: true })).toBe(1)
    expect(inferPreviewStage({ ...base, running: true, elapsedSec: 0 })).toBe(1)
    expect(inferPreviewStage({ ...base, running: true, elapsedSec: 2 })).toBe(2)
    expect(inferPreviewStage({ ...base, running: true, elapsedSec: 5 })).toBe(3)
    // 未在预览时回到首阶段，不越界。
    expect(inferPreviewStage(base)).toBe(0)
  })

  it('inferExportStage：内容检查 → 渲染文档 → 写出 DOCX/PDF', () => {
    const base = { checking: false, requesting: false, running: false, elapsedSec: 0 }
    expect(inferExportStage({ ...base, checking: true })).toBe(0)
    expect(inferExportStage({ ...base, requesting: true })).toBe(1)
    expect(inferExportStage({ ...base, running: true, elapsedSec: 0 })).toBe(1)
    expect(inferExportStage({ ...base, running: true, elapsedSec: 4 })).toBe(2)
  })
})

describe('L5 接线：作业超时的教师语言', () => {
  it('describeJobTimeout 返回教师语言（含「超时」「重试」）', () => {
    expect(describeJobTimeout()).toBe(GLOSSARY.jobTimeout)
    expect(describeJobTimeout()).toContain('超时')
    expect(describeJobTimeout()).toContain('重试')
  })
})

describe('新增术语不含开发者黑话（沿用 Glossary 契约）', () => {
  it('新增 GLOSSARY 值不含内部术语', () => {
    const added = [
      GLOSSARY.generatePreview,
      GLOSSARY.regeneratePreview,
      GLOSSARY.previewNotPersisted,
      GLOSSARY.previewReused,
      GLOSSARY.envEditorSdk,
      GLOSSARY.envOffice,
      GLOSSARY.envUnknown,
      GLOSSARY.jobTimeout,
    ].join('|')
    for (const term of ['快照锁定', '降级解锁', '门禁', '修订候选', '提及口径', '技术详情']) {
      expect(added).not.toContain(term)
    }
  })
})
