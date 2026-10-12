/** 文档标题独立于侧栏，辅助页与维护子页隐藏导航后仍保留具体标题。 */
export const BASE_TITLE = '初中物理 · 题库与组卷'
export const ROUTE_TITLES: Record<string, string> = {
  builder: '组卷工作台', search: '找题', export: '试卷预览', manage: '数据维护',
  'manage/knowledge': '知识点复核', 'manage/formula-review': '公式复核',
  'manage/sources': '来源文件', 'manage/stats': '题库统计', settings: '设置',
}
export function documentTitleForPath(pathname: string): string {
  const clean = pathname.replace(/^\/+|\/+$/g, '')
  const title = /^question\/[^/]+$/.test(clean) ? '题目详情' : ROUTE_TITLES[clean]
  return title ? title + ' · 初中物理题库' : BASE_TITLE
}
/** 分段匹配避免 search-other 被误选，详情/全屏预览归属日常工作入口。 */
export function selectedNavPath(pathname: string): string | undefined {
  if (pathname === '/builder' || pathname === '/export') return 'builder'
  if (pathname === '/search' || /^\/question\/[^/]+$/.test(pathname)) return 'search'
  if (pathname === '/manage' || pathname.startsWith('/manage/')) return 'manage'
  if (pathname === '/settings') return 'settings'
}
