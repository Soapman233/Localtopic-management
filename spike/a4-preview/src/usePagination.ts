/**
 * 分页引擎（**路线 B：JS 测量 + 手动分页**）。
 *
 * 思路：
 *  1. 把全部「块」渲染到一个**宽度与 A4 正文区完全一致**的测量层（不可见）；
 *  2. 等**字体就绪**（`document.fonts.ready`）与**图片就绪**（预解码）后，
 *     用 `getBoundingClientRect().height` 逐块测量真实高度；
 *  3. 按页高贪心装箱，**大题标题 keepWithNext 与后一题同页**，**整题不可分割**；
 *  4. 输出「第 N 页包含哪些块」，页面层据此渲染。
 *
 * 关键设计（回答 E1 必验项 3/4）：
 *  - **图片**：显示尺寸由「原始像素宽高 + 可用宽度」纯函数算出（见 spec.ts），
 *    在 `<img>` 上**预先写入 width/height**，解码前即占位 → 图片异步加载**不会**改高度；
 *  - **公式**：`katex.renderToString` 同步，插入即定高；只需等 **KaTeX 字体**加载
 *    （`document.fonts.ready`），否则 FOUT 会导致度量抖动；
 *  - **兜底**：`ResizeObserver` 监听测量层，若仍有高度变化则自动重排（安全网）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collectImageUrls, type DocBlock } from './blocks'
import type { LayoutModel } from './spec'

/** 浮点容差（px）。 */
const EPS = 0.5

export interface PagePlan {
  /** 本页包含的块下标（升序）。 */
  blockIndices: number[]
  /** 本页内容占用高度（px）。 */
  usedPx: number
  /** 本页是否溢出（内容 > 页高，通常来自「单题比一页还高」）。 */
  overflow: boolean
}

interface Group {
  indices: number[]
  forced: boolean
}

/** 依据 keepWithNext 把块聚成「不可拆分」的组。 */
export function buildGroups(blocks: DocBlock[]): Group[] {
  const groups: Group[] = []
  let i = 0
  while (i < blocks.length) {
    const indices = [i]
    while (blocks[indices[indices.length - 1]].keepWithNext && indices[indices.length - 1] + 1 < blocks.length) {
      indices.push(indices[indices.length - 1] + 1)
    }
    groups.push({ indices, forced: blocks[i].forcePageBreakBefore })
    i = indices[indices.length - 1] + 1
  }
  return groups
}

function groupHeight(
  blocks: DocBlock[],
  heights: number[],
  indices: number[],
  atPageTop: boolean,
): number {
  let h = 0
  indices.forEach((idx, k) => {
    const sb = k === 0 && atPageTop ? 0 : blocks[idx].spacingBeforePx
    h += heights[idx] + sb
  })
  return h
}

/** 贪心分页：把组装箱到页，整组尽量不拆；单组超过一页则允许溢出。 */
export function paginate(heights: number[], blocks: DocBlock[], pageHeightPx: number): PagePlan[] {
  const pages: PagePlan[] = []
  let cur: number[] = []
  let used = 0
  const flush = () => {
    if (cur.length) {
      pages.push({ blockIndices: cur, usedPx: used, overflow: used > pageHeightPx + EPS })
      cur = []
      used = 0
    }
  }

  const groups = buildGroups(blocks)
  for (const g of groups) {
    if (g.forced && cur.length) flush()
    let gh = groupHeight(blocks, heights, g.indices, cur.length === 0)
    if (cur.length && used + gh > pageHeightPx + EPS) {
      flush()
      gh = groupHeight(blocks, heights, g.indices, true)
    }
    void gh
    for (const idx of g.indices) {
      const sb = cur.length === 0 ? 0 : blocks[idx].spacingBeforePx
      cur.push(idx)
      used += heights[idx] + sb
    }
  }
  flush()
  return pages
}

// --------------------------------------------------------------------------- //
// 就绪判定：字体 + 图片
// --------------------------------------------------------------------------- //
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) {
      fonts.ready.then(() => {
        if (!cancelled) setReady(true)
      })
    } else {
      setReady(true)
    }
    return () => {
      cancelled = true
    }
  }, [])
  return ready
}

function useImagesReady(urls: string[]): boolean {
  const key = urls.join('|')
  const [ready, setReady] = useState(urls.length === 0)
  useEffect(() => {
    let cancelled = false
    if (urls.length === 0) {
      setReady(true)
      return
    }
    setReady(false)
    let done = 0
    const finish = () => {
      done += 1
      if (done >= urls.length && !cancelled) setReady(true)
    }
    const timer = window.setTimeout(() => {
      if (!cancelled) setReady(true)
    }, 5000) // 兜底：图片迟迟不返回也不永久卡住
    const imgs = urls.map((u) => {
      const im = new Image()
      im.onload = finish
      im.onerror = finish
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
  return ready
}

// --------------------------------------------------------------------------- //
// 主 Hook
// --------------------------------------------------------------------------- //
export interface PaginationState {
  measureRef: React.RefObject<HTMLDivElement>
  pages: PagePlan[]
  heights: number[]
  /** 单次测量耗时（ms）。 */
  ms: number
  /** 是否已完成测量（字体 + 图片就绪后）。 */
  ready: boolean
  fontsReady: boolean
  imagesReady: boolean
  /** 重复测量 + 分页 N 次，返回单次平均耗时（ms）。 */
  benchmark: (n?: number) => number
  /** 测量版本号：每次成功测量自增，供 UI 观察重排。 */
  version: number
}

export function usePagination(blocks: DocBlock[], model: LayoutModel): PaginationState {
  const measureRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<number[]>([])
  const [ms, setMs] = useState(0)
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState(0)

  const imageUrls = useMemo(() => collectImageUrls(blocks), [blocks])
  const fontsReady = useFontsReady()
  const imagesReady = useImagesReady(imageUrls)

  // 测量：字体 + 图片就绪后，逐块读高度。
  useLayoutEffect(() => {
    if (!fontsReady || !imagesReady) {
      setReady(false)
      return
    }
    const el = measureRef.current
    if (!el) return
    el.style.paddingTop = '0.01px' // 使布局失效，确保计时包含一次真实回流
    const t0 = performance.now()
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-mid]'))
    const hs = nodes.map((n) => n.getBoundingClientRect().height)
    const t1 = performance.now()
    el.style.paddingTop = '0px'
    setHeights(hs)
    setMs(t1 - t0)
    setReady(true)
    setVersion((v) => v + 1)
  }, [blocks, model, fontsReady, imagesReady])

  // 安全网：测量层宽度/内容变化时重测（应对迟到的字体/图片回流）。
  useEffect(() => {
    const el = measureRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-mid]'))
        const hs = nodes.map((n) => n.getBoundingClientRect().height)
        setHeights((prev) => {
          if (prev.length === hs.length && prev.every((h, i) => Math.abs(h - hs[i]) < 0.5)) return prev
          return hs
        })
      })
    })
    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [blocks, model])

  const pages = useMemo(
    () => (ready && heights.length ? paginate(heights, blocks, model.contentHeightPx) : []),
    [ready, heights, blocks, model],
  )

  const benchmark = useCallback(
    (n = 20): number => {
      const el = measureRef.current
      if (!el) return 0
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-mid]'))
      if (nodes.length === 0) return 0
      const t0 = performance.now()
      for (let k = 0; k < n; k++) {
        // 模拟「内容变化」：改一处样式使布局失效（脏标记），下一次读矩形才会真正触发回流。
        el.style.paddingTop = k % 2 === 0 ? '0px' : '0.01px'
        const hs = nodes.map((nd) => nd.getBoundingClientRect().height) // 强制回流 + 逐块测量
        paginate(hs, blocks, model.contentHeightPx) // 分页装箱
      }
      el.style.paddingTop = '0px'
      const t1 = performance.now()
      return (t1 - t0) / n
    },
    [blocks, model],
  )

  return { measureRef, pages, heights, ms, ready, fontsReady, imagesReady, benchmark, version }
}
