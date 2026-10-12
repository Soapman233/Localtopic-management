/** 检索条件状态 hook —— 检索页 / 组卷页共用（前端重构方案 §1.6 消除重复）。
 *
 * 背景
 * ----
 * `SearchPage.tsx` 与 `PaperBuilderPage.tsx` 此前各自维护了一段**近乎逐行相同**的检索条件逻辑：
 * 关键词 300ms 防抖 → `readFiltersFromUrl` / `writeFiltersToUrl` 同步 URL →
 * `queryParams` / `facetsParams` 两个 `useMemo`，合计约 80 行重复。
 * 任何一处改动（如新增筛选键、改防抖时长）都要改两遍，极易走样。
 *
 * 本 hook 把这段逻辑收敛为**唯一实现**，两个页面只是以不同的 `pageSize` 消费它。
 *
 * 行为契约（与收敛前逐字节一致，勿改）
 * --------------------------------
 *  - 关键词**300ms 防抖**后才写入 `filters.keyword`，并把页码归 1（避免每击键触发 search + facets）；
 *  - 筛选条件 / 页码写入 URL 用 `replace: true`（不污染历史；刷新/回退/分享可保留）；
 *  - `kp_confirmed_only` 取自 `useUiStore.strictKp`（严格模式），两页共享同一开关；
 *  - `queryParams` 带上分页（`limit` / `offset`），`facetsParams` 不带分页。
 *
 * 用法
 * ----
 * ```ts
 * const { keywordInput, setKeywordInput, filters, setFilters, page, setPage,
 *         queryParams, facetsParams, reset, hasActiveFilters } =
 *   useQuestionFilters({ pageSize: PAGE_SIZE })
 * const searchQ = useSearchQuery(queryParams)
 * const facetsQ = useFacetsQuery(facetsParams)
 * ```
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { readFiltersFromUrl, writeFiltersToUrl } from '../api/searchParams'
import type { SearchParams } from '../api/search'
import { useUiStore } from '../store/uiStore'

/** 关键词防抖时长（毫秒）。检索页与组卷页统一。 */
const KEYWORD_DEBOUNCE_MS = 300

export interface UseQuestionFiltersOptions {
  /** 每页条数。检索页与组卷页取值不同（各自页面常量），故由调用方传入。 */
  pageSize: number
}

export interface UseQuestionFiltersResult {
  /** 受控的关键词输入框值（防抖前）。 */
  keywordInput: string
  setKeywordInput: Dispatch<SetStateAction<string>>
  /** 生效中的筛选条件（含防抖后的 `keyword`）。 */
  filters: SearchParams
  setFilters: Dispatch<SetStateAction<SearchParams>>
  /** 当前页码（1 起）。 */
  page: number
  setPage: Dispatch<SetStateAction<number>>
  /** 传给 `useSearchQuery` 的参数（含分页与严格模式）。 */
  queryParams: SearchParams
  /** 传给 `useFacetsQuery` 的参数（不含分页）。 */
  facetsParams: SearchParams
  /** 清空关键词与全部筛选，并把页码归 1。 */
  reset: () => void
  /** 是否存在任何生效中的筛选（供空态是否给出「清除筛选」行动）。 */
  hasActiveFilters: boolean
}

/** 检索条件状态（关键词防抖 / URL 同步 / query 与 facets 参数）。 */
export function useQuestionFilters({ pageSize }: UseQuestionFiltersOptions): UseQuestionFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  // 严格模式（「仅看已确认知识点」）——两页共享同一 UI store 开关。
  const strictKp = useUiStore((s) => s.strictKp)

  // 初始值从 URL 还原（跳详情页返回 / 刷新后条件不丢，§Q6）。
  const [keywordInput, setKeywordInput] = useState(() => searchParams.get('keyword') ?? '')
  const [filters, setFilters] = useState<SearchParams>(() => readFiltersFromUrl(searchParams))
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1)

  // 关键词 300ms 防抖：避免每击键触发 search + facets；关键词变化时页码归 1。
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => ({ ...f, keyword: keywordInput.trim() || undefined }))
      setPage(1)
    }, KEYWORD_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [keywordInput])

  // 筛选条件 / 页码写入 URL（replace，避免污染历史）。
  useEffect(() => {
    setSearchParams((current) => {
      const next = writeFiltersToUrl(filters, page)
      // B0：debug 是路由诊断开关，不是检索条件；同步筛选时保留当前原值及重复值。
      // 只保留这个明确冻结的键，不能把其它未知参数带回，更不能写入查询/API 参数。
      for (const value of current.getAll('debug')) next.append('debug', value)
      return next
    }, { replace: true })
  }, [filters, page, setSearchParams])

  const queryParams: SearchParams = useMemo(
    () => ({
      ...filters,
      kp_confirmed_only: strictKp || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, strictKp, page, pageSize],
  )

  const facetsParams: SearchParams = useMemo(
    () => ({ ...filters, kp_confirmed_only: strictKp || undefined }),
    [filters, strictKp],
  )

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters as Record<string, unknown>).some(([, v]) =>
        Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '',
      ),
    [filters],
  )

  /** 清空关键词与全部筛选（空态行动 / 侧栏重置共用同一行为）。 */
  const reset = () => {
    setFilters({})
    setKeywordInput('')
    setPage(1)
  }

  return {
    keywordInput,
    setKeywordInput,
    filters,
    setFilters,
    page,
    setPage,
    queryParams,
    facetsParams,
    reset,
    hasActiveFilters,
  }
}

export default useQuestionFilters
