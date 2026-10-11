/**
 * 检索条件 ↔ URL query 的共享工具（§Q6：检索条件写入 URL，刷新/回退/分享可保留）。
 *
 * 检索页（`pages/SearchPage.tsx`）与组卷页（`pages/PaperBuilderPage.tsx`）共用同一实现，
 * 避免两处键名/布尔编码不一致。
 */
import type { SearchParams } from './search'

/** 字符串型筛选键（含 `keyword`）。 */
export const FILTER_STR_KEYS = [
  'keyword',
  'stage',
  'subject',
  'grade',
  'textbook',
  'chapter',
  'qtype',
  'difficulty',
  'section',
] as const

/** 布尔型筛选键（URL 中以 `1` 表示 true）。 */
export const FILTER_BOOL_KEYS = [
  'has_answer',
  'has_analysis',
  'needs_review',
  'grade_missing',
  'textbook_missing',
  'chapter_missing',
  'qtype_missing',
  'difficulty_missing',
] as const

/** 从 URL query 还原检索筛选条件（含 `keyword`）。 */
export function readFiltersFromUrl(sp: URLSearchParams): SearchParams {
  const f: Record<string, unknown> = {}
  for (const k of FILTER_STR_KEYS) {
    const v = sp.get(k)
    if (v) f[k] = v
  }
  for (const k of FILTER_BOOL_KEYS) {
    if (sp.get(k) === '1') f[k] = true
  }
  return f as SearchParams
}

/** 把检索筛选条件 + 页码写入 URL query（布尔以 `1` 表示，页码 1 省略）。 */
export function writeFiltersToUrl(f: SearchParams, page: number): URLSearchParams {
  const sp = new URLSearchParams()
  const rec = f as Record<string, unknown>
  for (const k of FILTER_STR_KEYS) {
    const v = rec[k]
    if (typeof v === 'string' && v) sp.set(k, v)
  }
  for (const k of FILTER_BOOL_KEYS) {
    if (rec[k] === true) sp.set(k, '1')
  }
  if (page > 1) sp.set('page', String(page))
  return sp
}
