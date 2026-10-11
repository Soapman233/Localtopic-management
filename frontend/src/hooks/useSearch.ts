/** 检索 hooks：把筛选条件包成 react-query（缓存 / 分页 / 失效）。 */
import { useQuery } from '@tanstack/react-query'
import { getCoverage, getFacets, searchQuestions, type SearchParams } from '../api/search'
import { qk } from '../api/queryKeys'

/** 检索结果查询（分页时保留上一页数据，避免闪烁）。 */
export function useSearchQuery(params: SearchParams) {
  return useQuery({
    queryKey: qk.search(params),
    queryFn: () => searchQuestions(params),
    placeholderData: (prev) => prev,
  })
}

/** 筛选栏 facets 查询（计数 + 待补充桶 + 覆盖率）。 */
export function useFacetsQuery(params: SearchParams) {
  return useQuery({
    queryKey: qk.facets(params),
    queryFn: () => getFacets(params),
  })
}

/** 全局覆盖率查询（P0-13）。 */
export function useCoverageQuery() {
  return useQuery({
    queryKey: qk.coverage(),
    queryFn: getCoverage,
    staleTime: 60_000,
  })
}
