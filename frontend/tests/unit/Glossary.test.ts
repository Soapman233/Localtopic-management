/**
 * `lib/glossary.ts` 行为测试（P0-1）。
 *
 * 覆盖两条产品契约：
 * 1. 术语映射函数返回**产品定的教师语言**，且映射结果里不再残留开发者术语；
 * 2. `isDebugMode()` 仅在 `?debug=1` 或 `localStorage.qb_debug=1` 时为真，**默认关闭**。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  GLOSSARY,
  describeDegradedMode,
  describeExportGate,
  describeIssueSource,
  describeLockedSnapshot,
  describeMentionScope,
  describeRevisionIssues,
  describeSnapshotStale,
  describeTechnicalInfo,
  isDebugMode,
  type IssueSource,
} from '../../src/lib/glossary'

/** 构造只带文件名的来源对象（其余坐标字段老师不可见，测试无需关心）。 */
function src(fileName: string | null): IssueSource {
  return { file_name: fileName } as unknown as IssueSource
}

describe('GLOSSARY 术语映射', () => {
  it('把开发者术语映射为产品定的教师语言', () => {
    expect(GLOSSARY.lockedSnapshot).toBe('本题在题库中已更新，本卷仍用加入时的版本')
    expect(GLOSSARY.lockedSnapshotAction).toBe('更新到最新')
    expect(GLOSSARY.exportReady).toBe('预览已确认，可以导出')
    expect(GLOSSARY.exportLocked).toBe('导出已锁定，请先生成并确认预览')
    expect(GLOSSARY.degradedMode).toBe('当前电脑未安装 Word/WPS，已改用结构预览确认')
    expect(GLOSSARY.revisionIssues).toBe('导出前需要处理的问题')
    expect(GLOSSARY.mentionScope).toBe('这是搜索线索，不代表本题考这个知识点')
    expect(GLOSSARY.technicalInfo).toBe('给技术人员的信息')
  })

  it('映射结果里不再残留开发者术语', () => {
    const text = Object.values(GLOSSARY).join('|')
    for (const term of ['快照锁定', '降级解锁', '门禁', '修订候选', '提及口径', '技术详情']) {
      expect(text).not.toContain(term)
    }
  })
})

describe('describe* 文案函数', () => {
  it('describeSnapshotStale 带题数', () => {
    expect(describeSnapshotStale(3)).toBe('3 题在题库中已更新，本卷仍用加入时的版本。')
  })

  it('describeExportGate 三态各返回对应文案', () => {
    expect(describeExportGate('ready')).toBe(GLOSSARY.exportReady)
    expect(describeExportGate('locked')).toBe(GLOSSARY.exportLocked)
    expect(describeExportGate('degraded')).toBe(GLOSSARY.degradedMode)
  })

  it('describeIssueSource 只给文件名，定位不到时如实说明', () => {
    expect(describeIssueSource(src('浮力单元测试.docx'))).toBe('来源文件：浮力单元测试.docx')
    expect(describeIssueSource(src(null))).toBe('来源文件：无法定位')
    expect(describeIssueSource(src('   '))).toBe('来源文件：无法定位')
    expect(describeIssueSource(null)).toBe('来源文件：无法定位')
  })

  it('其余单值函数返回 GLOSSARY 对应项', () => {
    expect(describeLockedSnapshot()).toBe(GLOSSARY.lockedSnapshot)
    expect(describeDegradedMode()).toBe(GLOSSARY.degradedMode)
    expect(describeRevisionIssues()).toBe(GLOSSARY.revisionIssues)
    expect(describeMentionScope()).toBe(GLOSSARY.mentionScope)
    expect(describeTechnicalInfo()).toBe(GLOSSARY.technicalInfo)
  })
})

describe('isDebugMode', () => {
  afterEach(() => {
    // 还原 URL 查询串与 localStorage，避免用例互相污染。
    window.history.replaceState(null, '', window.location.pathname)
    localStorage.removeItem('qb_debug')
  })

  it('默认关闭', () => {
    expect(isDebugMode()).toBe(false)
  })

  it('URL 查询串含 debug=1 时开启', () => {
    window.history.replaceState(null, '', '/?debug=1')
    expect(isDebugMode()).toBe(true)
  })

  it('localStorage qb_debug=1 时开启', () => {
    localStorage.setItem('qb_debug', '1')
    expect(isDebugMode()).toBe(true)
  })

  it('debug 非 1（debug=0 / qb_debug=true）时不开启', () => {
    window.history.replaceState(null, '', '/?debug=0')
    expect(isDebugMode()).toBe(false)
    localStorage.setItem('qb_debug', 'true')
    expect(isDebugMode()).toBe(false)
  })
})
