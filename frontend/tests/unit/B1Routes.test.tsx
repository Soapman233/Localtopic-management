/** B1 路由独立性与兼容真实执行护栏；不以导航全集自证路由全集。 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { LegacyRedirect, PAGES } from '../../src/router'
import { selectedNavPath, documentTitleForPath } from '../../src/app/routeMetadata'
import { NAV_ITEMS } from '../../src/App'

afterEach(cleanup)
it('隐藏五个入口后辅助与维护业务路由仍在独立集合', () => {
  expect(NAV_ITEMS.map(item => item.path)).toEqual(['builder', 'search', 'manage', 'settings'])
  for (const path of ['export','manage/knowledge','manage/formula-review','manage/sources','manage/stats']) {
    expect(PAGES[path]).toBeDefined()
    expect(NAV_ITEMS.some(item => item.path === path)).toBe(false)
  }
})
function LocationProbe() {
  const location = useLocation()
  return <pre data-testid="location">{JSON.stringify({ ...location, action: useNavigationType() })}</pre>
}
it.each(['knowledge','formula-review','sources','stats',''])('兼容路径 %s 替换保留 query/state', async path => {
  const source = path ? '/' + path : '/manage'
  const target = '/manage/' + (path || 'knowledge')
  const state = { source: 'bookmark' }
  render(<MemoryRouter initialEntries={[{ pathname:source, search:'?debug=1&filter=pending', state }]}>
    <Routes><Route path={source} element={<LegacyRedirect to={target} />} />
      <Route path={target} element={<LocationProbe />} /></Routes>
  </MemoryRouter>)
  await waitFor(() => expect(JSON.parse(screen.getByTestId('location').textContent || '{}').pathname).toBe(target))
  const actual = JSON.parse(screen.getByTestId('location').textContent || '{}')
  expect(actual.search).toBe('?debug=1&filter=pending')
  expect(actual.state).toEqual(state)
  expect(actual.action).toBe('REPLACE')
})
it.each([
  ['/builder','builder'], ['/search','search'], ['/question/123','search'],
  ['/manage/formula-review','manage'], ['/settings','settings'], ['/export','builder'],
  ['/search-other',undefined], ['/question/123/other',undefined],
])('导航分段匹配 %s', (path, selected) => { expect(selectedNavPath(path)).toBe(selected) })
it('具体维护标题不依赖仅四项的导航', () => {
  expect(documentTitleForPath('/manage/formula-review')).toBe('公式复核 · 初中物理题库')
  expect(documentTitleForPath('/export')).toBe('试卷预览 · 初中物理题库')
})
