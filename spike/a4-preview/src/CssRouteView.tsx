/**
 * 路线 A 对比视图：**纯 CSS 分栏分页**（`column-width` + `break-inside: avoid`）。
 *
 * 目的：实测浏览器原生分页能否满足「近似 A4 + 题目不跨页」。
 * 结论见报告；此处只做可复现的实测。
 *
 * 做法：把全部块放进一个 `height = 正文区高` 的多栏容器，`column-fill: auto`，
 * 每栏 = 一页正文区；每个块设 `break-inside: avoid`。挂载后测量**实际栏数**，
 * 并检测**是否有块被拆**（块高 > 页高时浏览器无法避免拆分）。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BlockView, type DocBlock } from './blocks'
import type { LayoutModel } from './spec'

export interface CssRouteViewProps {
  blocks: DocBlock[]
  model: LayoutModel
}

export function CssRouteView({ blocks, model }: CssRouteViewProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<{ cols: number; split: number[] }>({ cols: 0, split: [] })

  const gap = model.marginLeftPx + model.marginRightPx

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const measure = () => {
      const cols = Math.max(1, Math.round((el.scrollWidth + gap) / (model.contentWidthPx + gap)))
      const split: number[] = []
      el.querySelectorAll<HTMLElement>('[data-cssblock]').forEach((n) => {
        if (n.getBoundingClientRect().height > model.contentHeightPx + 0.5) {
          split.push(Number(n.dataset.cssblock))
        }
      })
      setInfo({ cols, split })
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [blocks, model, gap])

  const totalWidth = Math.max(info.cols, 1) * (model.contentWidthPx + gap)

  return (
    <div>
      <div className="metrics" style={{ marginBottom: 10 }}>
        {'【路线 A · CSS 分栏分页】实测\n'}
        {`栏数（= 页数）：${info.cols}\n`}
        {`被拆分的块：${info.split.length === 0 ? '无' : info.split.join(', ')}\n`}
        {`说明：浏览器原生分页；无法逐页渲染卷头/页脚，栏数需 JS 反推。`}
      </div>
      <div style={{ overflow: 'auto', border: '1px dashed #b7c0cc', borderRadius: 8, padding: 8 }}>
        <div style={{ position: 'relative', width: totalWidth }}>
          {/* 页面底纹（每栏一页） */}
          {Array.from({ length: Math.max(info.cols, 1) }).map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * (model.contentWidthPx + gap) + gap / 2,
                top: 0,
                width: model.contentWidthPx,
                height: model.contentHeightPx,
                background: '#fff',
                boxShadow: '0 0 0 1px #d9dee5',
              }}
            />
          ))}
          <div
            ref={ref}
            className="css-cols"
            style={{
              position: 'relative',
              columnWidth: `${model.contentWidthPx}px`,
              columnGap: `${gap}px`,
              height: model.contentHeightPx,
              columnFill: 'auto',
              width: totalWidth,
              paddingLeft: gap / 2,
              paddingRight: gap / 2,
              boxSizing: 'border-box',
            }}
          >
            {blocks.map((b, i) => (
              <div
                key={b.id}
                data-cssblock={i}
                className={`doc-block doc-block--${b.kind}`}
                style={{
                  breakInside: 'avoid',
                  breakBefore: b.forcePageBreakBefore ? 'column' : undefined,
                  breakAfter: b.keepWithNext ? 'avoid' : undefined,
                  paddingBottom: b.spacingAfterPx,
                }}
              >
                <BlockView block={b} model={model} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
