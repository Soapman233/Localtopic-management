/**
 * 导航信息架构的**配置不变量**测试（B1 信息架构重构护栏）。
 *
 * 纯配置校验、不渲染路由：改导航结构时若漏项 / 路径重复 / 旧链接映射写错，
 * 这些用例会直接变红。渲染层面的断言见 `Navigation.render.test.tsx`，
 * 选中规则 / Tab 派生的行为断言见 `navigation.test.tsx`。
 */
import { describe, it, expect } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, SETTINGS_ITEM } from '../../src/App'
import { DEFAULT_LANDING_PATH, LEGACY_REDIRECTS, ROUTE_PATHS } from '../../src/router'

/**
 * 期望的**侧栏**路径全集（含顺序）——B1 后为 5 项：
 * 日常（导入 / 组卷 / 找题）+ 数据维护 + 设置。
 * 改动侧栏结构时必须同步更新此清单。
 */
const EXPECTED_PATHS = ['import', 'builder', 'search', 'manage', 'settings']

describe('导航配置不变量', () => {
  it('每个导航项的 path 唯一（无重复项）', () => {
    const paths = NAV_ITEMS.map((i) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('NAV_ITEMS 与期望路径全集完全一致（防漏项 / 防改名）', () => {
    expect(NAV_ITEMS.map((i) => i.path)).toEqual(EXPECTED_PATHS)
  })

  it('每个导航项都能在**路由集合**中找到对应路由', () => {
    // ⚠️ 用路由集合（ROUTE_PATHS）而非导航集合——B1 后两者已解耦。
    const knownRoutes = new Set<string>([...ROUTE_PATHS, 'question/:id'])
    for (const item of NAV_ITEMS) {
      expect(knownRoutes.has(item.path)).toBe(true)
    }
  })

  it('分组项数符合预期（日常 3 项 / 数据维护 1 项且默认折叠）', () => {
    expect(NAV_GROUPS).toHaveLength(2)
    expect(NAV_GROUPS[0].label).toBe('日常')
    expect(NAV_GROUPS[0].items).toHaveLength(3)
    expect(NAV_GROUPS[0].collapsible).toBeFalsy()
    expect(NAV_GROUPS[1].label).toBe('数据维护')
    expect(NAV_GROUPS[1].items).toHaveLength(1)
    // 低频分组必须显式标记为可折叠（侧栏据此渲染 MUI Collapse，默认关闭）。
    expect(NAV_GROUPS[1].collapsible).toBe(true)
  })

  it('「导入试卷」保留在日常分组（唯一建库途径，不得从侧栏消失）', () => {
    expect(NAV_GROUPS[0].items.map((i) => i.path)).toContain('import')
  })

  it('设置不归入任何分组，固定为底部独立项', () => {
    const groupedPaths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path))
    expect(groupedPaths).not.toContain(SETTINGS_ITEM.path)
    // NAV_ITEMS 的末项应为设置项（渲染时也固定在侧栏底部）。
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

  it('每个重定向目标都是真实存在的**路由**（不会指向 404）', () => {
    // B1 后维护子页不在侧栏集合里，但必须在路由集合里——这正是解耦的意义。
    const routePaths = new Set(ROUTE_PATHS.map((p) => `/${p}`))
    for (const target of Object.values(LEGACY_REDIRECTS)) {
      expect(routePaths.has(target)).toBe(true)
    }
  })

  it('旧路径与新导航路径不冲突（避免遮蔽新路由）', () => {
    const navPaths = new Set(NAV_ITEMS.map((i) => i.path))
    for (const from of Object.keys(LEGACY_REDIRECTS)) {
      expect(navPaths.has(from)).toBe(false)
    }
  })
})
