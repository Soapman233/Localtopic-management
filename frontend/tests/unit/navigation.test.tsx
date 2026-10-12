/**
 * B1 信息架构重构的**行为护栏**（与配置不变量 `Navigation.test.ts` 互补）。
 *
 * 覆盖三块：
 * 1. **选中规则**（`selectedNavPathFor`）：完整路径 / 分段前缀匹配，
 *    `/question/:id`→找题、`/export`→组卷，且 `/search-other` **不得**误选「找题」；
 * 2. **旧路径重定向**：`/knowledge` 等四条旧书签 → `/manage/*`，并保留查询串；
 * 3. **维护页 Tab 由 pathname 派生**：`maintenanceTabFromPath` 纯函数 + 真实渲染，
 *    断言只挂载当前 Tab 面板、id / aria 关联正确。
 */
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { selectedNavPathFor, documentTitleForPath } from '../../src/App'
import { LEGACY_REDIRECTS, ROUTE_PATHS, LegacyRedirect } from '../../src/router'
import DataMaintenancePage, { maintenanceTabFromPath } from '../../src/pages/DataMaintenancePage'
import { renderWithTheme } from './testUtils'

describe('选中规则（selectedNavPathFor）', () => {
  it.each([
    ['/builder', 'builder'],
    ['/import', 'import'],
    ['/search', 'search'],
    ['/question/123', 'search'],
    ['/manage', 'manage'],
    ['/manage/stats', 'manage'],
    ['/manage/formula-review', 'manage'],
    ['/settings', 'settings'],
    ['/export', 'builder'],
  ])('%s → 选中 %s', (pathname, expected) => {
    expect(selectedNavPathFor(pathname)).toBe(expected)
  })

  it('分段前缀匹配：/search-other 不得误选「找题」', () => {
    expect(selectedNavPathFor('/search-other')).toBeNull()
    expect(selectedNavPathFor('/builder-x')).toBeNull()
  })

  it('根路径不选中任何项', () => {
    expect(selectedNavPathFor('/')).toBeNull()
  })
})

describe('文档标题（独立路由标题表）', () => {
  it('维护子页显示具体标题（不退化成「数据维护」）', () => {
    expect(documentTitleForPath('/manage/knowledge')).toBe('知识点复核 · 初中物理题库')
    expect(documentTitleForPath('/manage/formula-review')).toBe('公式复核 · 初中物理题库')
    expect(documentTitleForPath('/manage/stats')).toBe('题库统计 · 初中物理题库')
    expect(documentTitleForPath('/manage')).toBe('数据维护 · 初中物理题库')
  })

  it('不在侧栏的页面（导出中心）也能解析出标题', () => {
    expect(documentTitleForPath('/export')).toBe('导出中心 · 初中物理题库')
  })
})

describe('旧路径重定向', () => {
  it('四条旧路径映射到对应的 /manage/* 新路径', () => {
    expect(LEGACY_REDIRECTS).toEqual({
      knowledge: '/manage/knowledge',
      'formula-review': '/manage/formula-review',
      sources: '/manage/sources',
      stats: '/manage/stats',
    })
  })

  it('每个重定向目标都存在于**路由集合**（而非导航集合）', () => {
    const routePaths = new Set(ROUTE_PATHS.map((p) => `/${p}`))
    for (const target of Object.values(LEGACY_REDIRECTS)) {
      expect(routePaths.has(target)).toBe(true)
    }
  })

  it('实际重定向到 /manage/* 且保留查询串', () => {
    function LocationProbe() {
      const loc = useLocation()
      return <div data-testid="loc">{loc.pathname + loc.search}</div>
    }
    renderWithTheme(
      <MemoryRouter initialEntries={['/formula-review?debug=1']}>
        <Routes>
          <Route
            path="/formula-review"
            element={<LegacyRedirect to={LEGACY_REDIRECTS['formula-review']} />}
          />
          <Route path="/manage/formula-review" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('loc')).toHaveTextContent('/manage/formula-review?debug=1')
  })
})

describe('维护页 Tab 由 pathname 派生', () => {
  it('maintenanceTabFromPath：/manage/<tab> → 对应 Tab，未知回落默认', () => {
    expect(maintenanceTabFromPath('/manage/knowledge')).toBe('knowledge')
    expect(maintenanceTabFromPath('/manage/formula-review')).toBe('formula-review')
    expect(maintenanceTabFromPath('/manage/sources')).toBe('sources')
    expect(maintenanceTabFromPath('/manage/stats')).toBe('stats')
    expect(maintenanceTabFromPath('/manage')).toBe('knowledge')
    expect(maintenanceTabFromPath('/manage/unknown')).toBe('knowledge')
  })

  it('渲染：只挂载当前 Tab 面板，Tab / panel 的 id 与 aria 关联正确', () => {
    renderWithTheme(
      <MemoryRouter initialEntries={['/manage/stats']}>
        <Routes>
          <Route path="/manage" element={<DataMaintenancePage />}>
            <Route path="knowledge" element={<div>知识点面板</div>} />
            <Route path="stats" element={<div>统计面板</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    // 父页 h1。
    expect(screen.getByRole('heading', { level: 1, name: '数据维护' })).toBeInTheDocument()

    // 当前 Tab 选中，且 id / aria-controls 指向对应面板。
    const activeTab = screen.getByRole('tab', { name: '题库统计' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeTab).toHaveAttribute('id', 'manage-tab-stats')
    expect(activeTab).toHaveAttribute('aria-controls', 'manage-panel-stats')

    // 当前 panel 的 id / aria-labelledby 与 Tab 一一对应。
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('id', 'manage-panel-stats')
    expect(panel).toHaveAttribute('aria-labelledby', 'manage-tab-stats')

    // 非活动 Tab 不挂载：只有当前子路由内容在 DOM 中。
    expect(screen.getByText('统计面板')).toBeInTheDocument()
    expect(screen.queryByText('知识点面板')).not.toBeInTheDocument()
  })
})
