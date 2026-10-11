/**
 * 单页渲染：一个「近似 A4」的白纸页面。
 *
 * 页面几何与测量层严格对应：
 * - 页面内边距 = 页边距（左侧额外加装订线）；
 * - 正文区宽度 = `model.contentWidthPx`（与测量层同宽）；
 * - 每个块的 `padding-bottom` = 段后间距（计入高度）；非页首块的 `margin-top` = 段前间距。
 */
import type { ReactNode } from 'react'
import { BlockView, type DocBlock } from './blocks'
import { ptToPx, type LayoutModel } from './spec'
import type { PagePlan } from './usePagination'

export interface PageViewProps {
  page: PagePlan
  blocks: DocBlock[]
  model: LayoutModel
  pageNumber: number
  totalPages: number
  debug: boolean
}

export function PageView({ page, blocks, model, pageNumber, totalPages, debug }: PageViewProps): ReactNode {
  const footerSize = ptToPx(9)
  return (
    <div
      className="a4-page"
      style={{
        width: model.pageWidthPx,
        height: model.pageHeightPx,
        paddingTop: model.marginTopPx,
        paddingBottom: model.marginBottomPx,
        paddingLeft: model.marginLeftPx + model.gutterPx,
        paddingRight: model.marginRightPx,
        boxSizing: 'border-box',
      }}
    >
      {debug && (
        <div className="page-debug-badge">
          第 {pageNumber} / {totalPages} 页 · {page.blockIndices.length} 块 · 占用{' '}
          {Math.round(page.usedPx)}px / {Math.round(model.contentHeightPx)}px
          {page.overflow ? ' · ⚠溢出' : ''}
        </div>
      )}
      <div className="page-content" style={{ width: model.contentWidthPx }}>
        {page.blockIndices.map((idx, k) => {
          const b = blocks[idx]
          return (
            <div
              key={b.id}
              className={`doc-block doc-block--${b.kind}`}
              style={{
                paddingBottom: b.spacingAfterPx,
                marginTop: k === 0 ? 0 : b.spacingBeforePx,
              }}
            >
              <BlockView block={b} model={model} />
            </div>
          )
        })}
      </div>
      <div className="page-footer" style={{ fontSize: footerSize }}>
        — {pageNumber} —
      </div>
    </div>
  )
}
