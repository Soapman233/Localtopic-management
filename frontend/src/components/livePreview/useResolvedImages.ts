/**
 * 图片解析：把 `export-data` 里的图片**解析为可用的直链 + 原始像素尺寸**。
 *
 * 新版 export-data 已提供 url/width/height，无需逐题请求详情或重复解码。
 * 以下详情索引仅兼容没有这些字段的旧版后端。
 * 背景（移植时的关键发现）：
 *  - `export-data`（`GET /api/papers/{id}/export-data`）里的图片只有
 *    `{ media_path, sha256 }`，**不含** `id`，也不含原始像素宽高；
 *  - 生产取图直链是 `GET /api/questions/{question_id}/media/{image_id}`（需要整型 `image_id`），
 *    与 `QuestionDetailPage.tsx` 的做法一致；
 *  - 因此这里**复用现有端点** `GET /api/questions/{id}`（返回图片 `id`），
 *    按 `sha256`（主）/ `media_path`（备）匹配出 `image_id`，再拼直链。
 *    **未新增任何 API 端点。**
 *
 * 原始像素尺寸：生产未下发，故在浏览器端**预加载解码**取得 `naturalWidth/Height`，
 * 再按后端 `fit_image_size` 规则（见 spec.ts）预置 `<img>` 尺寸——效果与探针一致。
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getQuestion, mediaUrl } from '../../api/questions'
import type { ExportPayload, ImageRef, Question } from '../../api/types'
import { qk } from '../../api/queryKeys'

/** 收集 payload 里所有去重后的 `question_id`。 */
export function collectQuestionIds(data: ExportPayload): number[] {
  const set = new Set<number>()
  for (const s of data.sections) {
    for (const q of s.questions) {
      // 新版数据包含 url（包括明确的 null），仅旧版图片信息才请求详情。
      if (q.images?.some((image) => image.url === undefined) && q.question_id > 0) set.add(q.question_id)
    }
  }
  return [...set]
}

/** 题目详情里的图片索引（`question_id` → 图片列表，含 `id`）。 */
export function useQuestionImageIndex(data: ExportPayload): {
  map: Map<number, ImageRef[]>
  loading: boolean
} {
  const ids = useMemo(() => collectQuestionIds(data), [data])
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.question(id),
      queryFn: () => getQuestion(id),
      staleTime: 5 * 60 * 1000,
    })),
  })

  const loading = results.some((r) => r.isLoading)

  // ★ 关键：`useQueries` **每次渲染都返回新数组**，其引用不稳定，不能直接作为
  //   useMemo 依赖（否则下游 blocks 每帧重建 → 分页引擎无限重测）。
  //   这里先算一个**按值**的签名（题目 id → 图片 id 列表），签名不变则复用同一个 Map。
  const signature = ids
    .map((id, i) => {
      const imgs = (results[i]?.data as Question | undefined)?.images ?? []
      return `${id}:${imgs.map((im) => im.id ?? 'x').join('.')}`
    })
    .join('|')

  const map = useMemo(() => {
    const m = new Map<number, ImageRef[]>()
    results.forEach((r, i) => {
      const q = r.data as Question | undefined
      if (q) m.set(ids[i], q.images ?? [])
    })
    return m
    // 依赖签名（按值比较），而非 results 引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return { map, loading }
}

/**
 * 把一条 export-data 图片解析为直链。
 * 新版优先使用直链；旧版按 sha256 匹配，仅无指纹时按 media_path 匹配。
 * 返回 `null` 表示取不到（如实提示，不伪造）。
 */
export function resolveImageUrl(
  questionId: number,
  img: ImageRef,
  _index: number,
  detailMap: Map<number, ImageRef[]>,
): string | null {
  if (img.url !== undefined) return img.url
  if (img.id != null) return mediaUrl(questionId, img.id)
  const list = detailMap.get(questionId) ?? []
  let match: ImageRef | undefined
  if (img.sha256) match = list.find((d) => d.sha256 && d.sha256 === img.sha256)
  if (!match && !img.sha256 && img.media_path) match = list.find((d) => d.media_path === img.media_path)
  if (match?.id != null) return mediaUrl(questionId, match.id)
  return null
}

export interface ImageDim {
  w: number
  h: number
}
const EMPTY_DIMS: Record<string, ImageDim> = {}

/**
 * 预加载图片并采集原始像素尺寸。
 *
 * 返回 `ready`：全部图片加载/失败完毕后为 `true`（含 8s 兜底，避免永久卡住）。
 * `dims`：`url → {w, h}`（仅成功解码的图片有值）。
 */
export function useImageMetrics(urls: string[]): { ready: boolean; dims: Record<string, ImageDim> } {
  const key = urls.join('|')
  const [state, setState] = useState<{ key: string; ready: boolean; dims: Record<string, ImageDim> }>({
    key,
    ready: urls.length === 0,
    dims: {},
  })

  useEffect(() => {
    let cancelled = false
    if (urls.length === 0) {
      setState({ key, ready: true, dims: {} })
      return
    }
    setState({ key, ready: false, dims: {} })
    const dims: Record<string, ImageDim> = {}
    let done = 0
    const finish = () => {
      done += 1
      if (done >= urls.length && !cancelled) setState({ key, ready: true, dims: { ...dims } })
    }
    const timer = window.setTimeout(() => {
      if (!cancelled) setState({ key, ready: true, dims: { ...dims } })
    }, 8000)
    const imgs = urls.map((u) => {
      const im = new Image()
      im.onload = () => {
        if (im.naturalWidth > 0 && im.naturalHeight > 0) dims[u] = { w: im.naturalWidth, h: im.naturalHeight }
        finish()
      }
      im.onerror = () => finish()
      im.src = u
      return im
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      imgs.forEach((im) => {
        im.onload = null
        im.onerror = null
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.key === key ? state : { ready: urls.length === 0, dims: EMPTY_DIMS }
}
