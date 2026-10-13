/**
 * 主题三态纯函数单测（设计规范 §4.5 第 7 条）。
 *
 * 重点覆盖「旧安装兼容」的迁移判断：
 * - 已存三态优先（用户显式选择过就以用户为准）；
 * - 旧布尔 `true` → 深色（保留显式选择）；
 * - 旧布尔 `false` / 缺失 → **跟随系统**（历史默认值，无法区分「选过浅色」与「从未选过」）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_MODE,
  THEME_MODE_STORAGE_KEY,
  effectiveDark,
  isThemeMode,
  readStoredThemeMode,
  resolveThemeMode,
  writeStoredThemeMode,
} from '../../src/lib/themeMode'

afterEach(() => {
  try {
    localStorage.removeItem(THEME_MODE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
})

describe('isThemeMode', () => {
  it('只接受三个合法值', () => {
    expect(isThemeMode('system')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('Dark')).toBe(false)
    expect(isThemeMode('')).toBe(false)
    expect(isThemeMode(null)).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
    expect(isThemeMode(1)).toBe(false)
  })
})

describe('resolveThemeMode（旧值兼容 / 迁移）', () => {
  it('已存合法三态优先，忽略旧布尔', () => {
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
    expect(resolveThemeMode('system', true)).toBe('system')
  })

  it('旧布尔 true → 深色（显式选择保留）', () => {
    expect(resolveThemeMode(null, true)).toBe('dark')
  })

  it('旧布尔 false → 跟随系统（历史默认值，不视为显式选择）', () => {
    expect(resolveThemeMode(null, false)).toBe('system')
  })

  it('无任何旧值 → 跟随系统（规范默认）', () => {
    expect(resolveThemeMode(null, undefined)).toBe(DEFAULT_THEME_MODE)
    expect(DEFAULT_THEME_MODE).toBe('system')
  })

  it('非法已存值被忽略，按旧布尔处理', () => {
    expect(resolveThemeMode('sepia', true)).toBe('dark')
    expect(resolveThemeMode(undefined, false)).toBe('system')
  })
})

describe('effectiveDark', () => {
  it('深色恒真、浅色恒假', () => {
    expect(effectiveDark('dark', false)).toBe(true)
    expect(effectiveDark('light', true)).toBe(false)
  })

  it('跟随系统时取系统偏好', () => {
    expect(effectiveDark('system', true)).toBe(true)
    expect(effectiveDark('system', false)).toBe(false)
  })
})

describe('读写三态偏好（localStorage）', () => {
  it('写入后可读回；未写入时为 null', () => {
    expect(readStoredThemeMode()).toBeNull()
    writeStoredThemeMode('dark')
    expect(readStoredThemeMode()).toBe('dark')
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('dark')
  })

  it('存入非法裸值时读回 null（不会当成合法三态）', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'sepia')
    expect(readStoredThemeMode()).toBeNull()
  })
})
