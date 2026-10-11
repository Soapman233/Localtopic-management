/**
 * 单页渲染：一个「近似 A4」的白纸页面（从 spike 移植）。
 *
 * 页面几何与测量层严格对应：
 * - 页面内边距 = 页边距（左侧额外加装订线）；
 * - 正文区宽度 = `model.contentWidthPx`（与测量层同宽）；
 * - 每个块的 `padding-bottom` = 段后间距（计入高度）；非页首块的 `margin-top` = 段前间距。
 *
 * 页脚文案与真实导出对齐：`第 N 页 共 M 页`（spike 原为 `— N —`）。
 *
 * P3（排版视图可编辑）：
 * - 当 `editable` 时，**题目块**包裹为 `@dnd-kit` 可排序节点（`id = item-<itemId>`），
 *   与组卷页共享同一个 `DndContext`（`onDragEnd` 复用 `moveQuestion`）；
 * - 拖拽手柄 `⠿`（绝对定位，**不参与文档流**）与题目工具栏（改分 / 删除，由父级
 *   `renderQuestionChrome` 注入）均为**绝对定位**，故**不改变块高度**、不污染分页测量。
 * - 因外层存在 `transform: scale()`，拖拽位移按 `1/scale` 换算后再应用，保证屏幕位移与指针一致。
 */
import type { CSSProperties, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
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
  /** P3：排版视图内可编辑（题目块可拖拽调序 + 注入题目工具栏）。 */
  editable?: boolean
  /** 仅用于拖拽位移换算：外层 `transform: scale()` 的缩放比（默认 1）。 */
  scale?: number
  /** P3：题目工具栏（改分 / 删除）渲染回调；`editable` 时对每个题目块调用。 */
  renderQuestionChrome?: (block: DocBlock) => ReactNode
}

/** 可排序的题目块（仅在 `editable` 下渲染；由父级 `DndContext` 驱动）。 */
function SortableQuestionBlock({
  block,
  model,
  style,
  scale,
  chrome,
}: {
  block: DocBlock
  model: LayoutModel
  style: CSSProperties
  scale: number
  chrome?: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item-${block.itemId}`,
    data: { type: 'paper-item', itemId: block.itemId, sectionId: block.sectionId ?? null },
  })
  // ★ 外层 `transform: scale(s)` 会把本地 translate 放大 s 倍；除以 s 抵消，
  //   使屏幕上的拖拽位移与指针一致（否则缩放视图里拖拽会「跟不上手」）。
  const s = scale || 1
  const dragTransform = transform
    ? `translate3d(${transform.x / s}px, ${transform.y / s}px, 0)`
    : undefined
  return (
    <div
      ref={setNodeRef}
      className="lp-block lp-block--question lp-block--editable"
      style={{
        ...style,
        transform: dragTransform,
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 6 : undefined,
        position: 'relative',
      }}
    >
      <span className="lp-qhandle" {...attributes} {...listeners} title="拖拽调序（同大题内）">
        ⠿
      </span>
      <BlockView block={block} model={model} />
      {chrome}
    </div>
  )
}

export function PageView({
  page,
  blocks,
  model,
  pageNumber,
  totalPages,
  debug,
  editable = false,
  scale = 1,
  renderQuestionChrome,
}: PageViewProps): ReactNode {
  const footerSize = ptToPx(9)
  return (
    <div
      className="lp-page"
      style={{
        width: model.pageWidthPx,
        minHeight: model.pageHeightPx,
        height: page.overflow ? undefined : model.pageHeightPx,
        paddingTop: model.marginTopPx,
        paddingBottom: model.marginBottomPx,
        paddingLeft: model.marginLeftPx + model.gutterPx,
        paddingRight: model.marginRightPx,
        boxSizing: 'border-box',
      }}
    >
      {debug && (
        <div className="lp-debug-badge">
          第 {pageNumber} / {totalPages} 页 · {page.blockIndices.length} 块 · 占用{' '}
          {Math.round(page.usedPx)}px / {Math.round(model.contentHeightPx)}px
          {page.overflow ? ' · ⚠溢出' : ''}
        </div>
      )}
      <div className="lp-page-content" style={{ width: model.contentWidthPx }}>
        {page.blockIndices.map((idx, k) => {
          const b = blocks[idx]
          const style: CSSProperties = {
            paddingBottom: b.spacingAfterPx,
            marginTop: k === 0 ? 0 : b.spacingBeforePx,
          }
          if (editable && b.kind === 'question' && b.itemId != null) {
            return (
              <SortableQuestionBlock
                key={b.id}
                block={b}
                model={model}
                style={style}
                scale={scale}
                chrome={renderQuestionChrome?.(b)}
              />
            )
          }
          return (
            <div key={b.id} className={`lp-block lp-block--${b.kind}`} style={style}>
              <BlockView block={b} model={model} />
            </div>
          )
        })}
      </div>
      <div className="lp-footer" style={{ fontSize: footerSize }}>
        第 {pageNumber} 页 共 {totalPages} 页
      </div>
    </div>
  )
}
