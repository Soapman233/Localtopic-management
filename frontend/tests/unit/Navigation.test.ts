/**
 * 导航信息架构的**配置不变量**测试（P0-4 / P1-6 护栏）。
 *
 * 纯配置校验、不渲染路由：改导航结构时若漏项 / 路径重复 / 旧链接映射写错，
 * 这些用例会直接变红。渲染层面的断言见 `Navigation.render.test.tsx`。
 */
import { describe, it, expect } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, SETTINGS_ITEM } from '../../src/App'
import { DEFAULT_LANDING_PATH, LEGACY_REDIRECTS } from '../../src/router'

/** 期望的导航路径全集（含顺序）——改动导航结构时必须同步更新此清单。 */
const EXPECTED_PATHS = [
  'import',
  'builder',
  'search',
  'export',
  'manage/knowledge',
  'manage/formula-review',
  'manage/sources',
  'manage/stats',
  'settings',
]

describe('导航配置不变量', () => {
  it('每个导航项的 path 唯一（无重复项）', () => {
    const paths = NAV_ITEMS.map((i) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('NAV_ITEMS 与期望路径全集完全一致（防漏项 / 防改名）', () => {
    expect(NAV_ITEMS.map((i) => i.path)).toEqual(EXPECTED_PATHS)
  })

  it('每个导航项都能在已知路由集合中找到对应路由（或属于固定路由）', () => {
    // 已知路由集合 = 全部导航路径 + 单题详情 + 旧链接重定向源。
    const knownRoutes = new Set<string>([
      ...NAV_ITEMS.map((i) => i.path),
      'question/:id',
      ...Object.keys(LEGACY_REDIRECTS),
    ])
    for (const item of NAV_ITEMS) {
      expect(knownRoutes.has(item.path)).toBe(true)
    }
  })

  it('分组项数符合预期（日常备课 4 项 / 数据治理 4 项）', () => {
    expect(NAV_GROUPS).toHaveLength(2)
    expect(NAV_GROUPS[0].label).toBe('日常备课')
    expect(NAV_GROUPS[0].items).toHaveLength(4)
    expect(NAV_GROUPS[1].label).toBe('数据治理')
    expect(NAV_GROUPS[1].items).toHaveLength(4)
  })

  it('系统设置不归入任何分组，固定为底部独立项', () => {
    const groupedPaths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path))
    expect(groupedPaths).not.toContain(SETTINGS_ITEM.path)
    // NAV_ITEMS 的末项应为系统设置（渲染时也固定在侧栏底部）。
    expect(NAV_ITEMS[NAV_ITEMS.length - 1].path).toBe(SETTINGS_ITEM.path)
  })

  it('默认落地页是组卷工作台 /builder', () => {
    expect(DEFAULT_LANDING_PATH).toBe('/builder')
    // 落地页必须是一个真实存在的导航路由。
    expect(NAV_ITEMS.some((i) => `/${i.path}` === DEFAULT_LANDING_PATH)).toBe(true)
  })
})

describe('旧链接兼容重定向', () => {
  it('四条旧路径都映射到对应的 /manage/* 新路径', () => {
    expect(LEGACY_REDIRECTS).toEqual({
      knowledge: '/manage/knowledge',
      'formula-review': '/manage/formula-review',
      sources: '/manage/sources',
      stats: '/manage/stats',
    })
  })

  it('每个重定向目标都是真实存在的导航路由（不会指向 404）', () => {
    const navPaths = new Set(NAV_ITEMS.map((i) => `/${i.path}`))
    for (const target of Object.values(LEGACY_REDIRECTS)) {
      expect(navPaths.has(target)).toBe(true)
    }
  })

  it('旧路径与新导航路径不冲突（避免遮蔽新路由）', () => {
    const navPaths = new Set(NAV_ITEMS.map((i) => i.path))
    for (const from of Object.keys(LEGACY_REDIRECTS)) {
      expect(navPaths.has(from)).toBe(false)
    }
  })
})
