/**
 * 「X 分钟前」相对时间纯函数单测（设计规范 §4.5 第 3 条）。
 *
 * 覆盖全部档位边界：0 / 不足 1 分钟 / 恰好 1 分钟 / 59 分钟 / 恰好 1 小时 /
 * 23 小时 59 分 / 恰好 1 天；以及负数与 NaN 的防御分支。
 */
import { describe, expect, it } from 'vitest'
import { describeAutosave, describeRelativeTime } from '../../src/lib/glossary'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('describeRelativeTime（相对时间纯函数）', () => {
  it('不足 1 分钟 → 刚刚（含 0）', () => {
    expect(describeRelativeTime(0)).toBe('刚刚')
    expect(describeRelativeTime(59_999)).toBe('刚刚')
  })

  it('1–59 分钟 → X 分钟前（含边界 1 与 59）', () => {
    expect(describeRelativeTime(MIN)).toBe('1 分钟前')
    expect(describeRelativeTime(30 * MIN)).toBe('30 分钟前')
    expect(describeRelativeTime(59 * MIN)).toBe('59 分钟前')
    expect(describeRelativeTime(60 * MIN - 1)).toBe('59 分钟前')
  })

  it('恰好 60 分钟 → 1 小时前；59 分 59 秒仍为分钟', () => {
    expect(describeRelativeTime(60 * MIN)).toBe('1 小时前')
    expect(describeRelativeTime(60 * MIN - 1)).toBe('59 分钟前')
  })

  it('1–23 小时 → X 小时前（含边界 23 小时 59 分）', () => {
    expect(describeRelativeTime(3 * HOUR)).toBe('3 小时前')
    expect(describeRelativeTime(DAY - 1)).toBe('23 小时前')
  })

  it('恰好 1 天 → 1 天前；跨天继续按天', () => {
    expect(describeRelativeTime(DAY)).toBe('1 天前')
    expect(describeRelativeTime(3 * DAY + 5 * HOUR)).toBe('3 天前')
  })

  it('负数（时钟回拨）与 NaN → 刚刚（不产出坏文案）', () => {
    expect(describeRelativeTime(-1)).toBe('刚刚')
    expect(describeRelativeTime(-5 * HOUR)).toBe('刚刚')
    expect(describeRelativeTime(Number.NaN)).toBe('刚刚')
  })
})

describe('describeAutosave（整行文案）', () => {
  it('拼成「已自动保存 · 上次编辑 …」', () => {
    expect(describeAutosave(0)).toBe('已自动保存 · 上次编辑 刚刚')
    expect(describeAutosave(5 * MIN)).toBe('已自动保存 · 上次编辑 5 分钟前')
    expect(describeAutosave(2 * HOUR)).toBe('已自动保存 · 上次编辑 2 小时前')
  })
})
