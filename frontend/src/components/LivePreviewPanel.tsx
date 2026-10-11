/**
 * LivePreviewPanel —— A4 近似排版 · 自动分页**结构预览**组件（P1 只读 → P3 可编辑）。
 *
 * 把 E1 探针（`spike/a4-preview/`）验证过的分页引擎**产品化**：在真实前端里
 * 用「JS 测量 + 手动分页」渲染「近似 A4」的多页预览，长块完整可读，超页时明确标注结构分页近似。
 *
 * 保留探针验证过的关键结论（勿丢）：
 *  1. **路线 B**（JS 测量 + 手动分页），非 CSS columns；
 *  2. **`WORD_SINGLE_LINE_FACTOR = 1.29`**：Word「1.5 倍行距」= 1.5 × 字体自然行高
 *     ≈ 23.2pt，**不是** CSS 的 18pt（见 spec.ts）；
 *  3. 题目作测量块，超页时容器自然增高，不裁切内容；
 *  4. 图片**预置 width/height**（复用后端 `fit_image_size` 规则），避免加载后回流；
 *  5. **测量层放在 `transform: scale()` 容器之外**（否则 `getBoundingClientRect()`
 *     返回缩放后尺寸，页数会错）；
 *  6. 等 `document.fonts.ready`（KaTeX 字体）。
 *
 * 数据源：父组件传入的 `ExportPayload`（`GET /api/papers/{id}/export-data`，#27，未新增端点）。
 * 公式渲染：复用 `frontend/src/components/KatexFormula.tsx` 的 `FormulaText`（未重写）。
 *
 * P3（可编辑排版视图，§5-Q8）：
 *  - `editable=true` 时，题目块成为 `@dnd-kit` 可排序节点（复用父级 `DndContext` +
 *    `moveQuestion`，**跨大题拖拽暂不支持**，与现有 `onDragEnd` 一致）；
 *  - 题目右上角工具栏：点**分值 chip** 就地改分（`onScoreChange`，非法值红框）、
 *    `✕` 删除（`onRemove`）；**不改题干文字**（点题号跳详情页由父级处理）。
 */
import { useMemo, useState } from 'react'
import { Alert, Box, Chip, CircularProgress, Stack, Tooltip, Typography, useTheme } from '@mui/material'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ExportPayload, ContentBlock } from '../api/types'
import {
  BlockView,
  buildBlocks,
  fmtNum,
  type DocBlock,
  type ResolvedImage,
} from './livePreview/blocks'
import { computeLayout, type LayoutModel, type TemplateName } from './livePreview/spec'
import { usePagination } from './livePreview/usePagination'
import { PageView } from './livePreview/PageView'
import {
  useImageMetrics,
} from './livePreview/useResolvedImages'
import './livePreview/livePreview.css'

/** 分值上限（与后端 `_validate_score` 一致）。 */
const SCORE_MAX = 1000

export interface LivePreviewPanelProps {
  /** 试卷 id（用于诊断信息；数据本身由 `data` 提供）。 */
  paperId: number
  /** 导出数据（父组件传入，避免重复请求）。 */
  data: ExportPayload
  /** P3：是否可编辑（排版视图内拖拽调序 / 改分 / 删除）。 */
  editable?: boolean
  /** P3：题目重排（由父级 `DndContext.onDragEnd` 驱动；此回调保留接口，暂不单独触发）。 */
  onReorder?: (fromIndex: number, toIndex: number) => void
  /** P3：改分（`itemId` → 分值；`null` = 清除）。 */
  onScoreChange?: (itemId: number, score: number | null) => void
  /** P3：删题。 */
  onRemove?: (itemId: number) => void
  /** 可选：模板覆盖（默认取 `data.paper.template`）。 */
  template?: TemplateName
  /** 可选：预览缩放（仅影响展示，**不影响测量**）。 */
  scale?: number
  /** 可选：显示每页调试徽标。 */
  debug?: boolean
}

/** 取 payload.paper.template（后端为 `Record<string, unknown>`）。 */
function paperTemplate(data: ExportPayload): string {
  const p = data.paper as { template?: unknown }
  return typeof p?.template === 'string' ? p.template : '考试'
}

/** 单题工具栏（改分 / 删除）——绝对定位，不参与文档流。 */
function QuestionChrome({
  block,
  editing,
  value,
  invalid,
  onStartEdit,
  onChange,
  onCommit,
  onCancel,
  onRemove,
}: {
  block: DocBlock
  editing: boolean
  value: string
  invalid: boolean
  onStartEdit: () => void
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  onRemove: () => void
}) {
  return (
    <div className="lp-qtoolbar" data-testid="lp-qtoolbar">
      {editing ? (
        <input
          className={`lp-score-input${invalid ? ' lp-invalid' : ''}`}
          autoFocus
          value={value}
          aria-label="分值"
          title={invalid ? '分值需为 0–1000 的数字（可小数）' : '回车/失焦保存，Esc 取消'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            else if (e.key === 'Escape') onCancel()
          }}
          onBlur={onCommit}
        />
      ) : (
        <button
          type="button"
          className={`lp-score-chip${block.score == null ? ' lp-score-empty' : ''}`}
          title="点击修改分值"
          data-testid="lp-score-chip"
          onClick={(e) => {
            e.stopPropagation()
            onStartEdit()
          }}
        >
          {block.score == null ? '未设分' : `${fmtNum(block.score)} 分`}
        </button>
      )}
      <button
        type="button"
        className="lp-qdel"
        title="移除本题"
        data-testid="lp-qdel"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        ✕
      </button>
    </div>
  )
}

export function LivePreviewPanel(props: LivePreviewPanelProps) {
  const { paperId, data, editable = false, template: templateProp, scale = 1, debug = false } = props

  // P1-6：深色模式下给「非纸张 chrome」加 `lp-dark` 类（纸张本身保持白底黑字）。
  const dark = useTheme().palette.mode === 'dark'

  const template = (templateProp ?? paperTemplate(data)) as TemplateName
  const model: LayoutModel = useMemo(() => computeLayout(template, 'A4'), [template])

  // ---- 图片解析（复用现有端点，不新增） -------------------------------------

  const { imagesByItem, urls } = useMemo(() => {
    const byItem = new Map<number, ResolvedImage[]>()
    const urlList: string[] = []
    for (const sec of data.sections) {
      for (const q of sec.questions) {
        const arr = (q.content_blocks ?? []).filter((block): block is Extract<ContentBlock, { kind: 'image' }> => block.kind === 'image').map((img) => {
          const url = img.url
          const naturalW = img.width && img.width > 0 ? img.width : null
          const naturalH = img.height && img.height > 0 ? img.height : null
          if (url && (!naturalW || !naturalH)) urlList.push(url)
          return { url, naturalW, naturalH, mediaPath: img.media_path ?? null, instanceId: img.instance_id, sourceWidthEmu: img.source_width_emu, sourceHeightEmu: img.source_height_emu } as ResolvedImage
        })
        byItem.set(q.item_id, arr)
      }
    }
    return { imagesByItem: byItem, urls: urlList }
  }, [data])

  const { ready: metricsReady, dims } = useImageMetrics(urls)
  // 图片就绪 = 题目详情已取回（才能拼直链）+ 图片已解码（才能定尺寸）。
  const imagesReady = metricsReady

  // 把解码得到的原始像素尺寸注入图片块。
  const imagesWithDims = useMemo(() => {
    const m = new Map<number, ResolvedImage[]>()
    for (const [itemId, arr] of imagesByItem) {
      m.set(
        itemId,
        arr.map((im) =>
          im.url && dims[im.url] ? { ...im, naturalW: dims[im.url].w, naturalH: dims[im.url].h } : im,
        ),
      )
    }
    return m
  }, [imagesByItem, dims])

  // ---- 块模型 + 分页 --------------------------------------------------------
  const blocks: DocBlock[] = useMemo(
    () => buildBlocks(data, model, imagesWithDims),
    [data, model, imagesWithDims],
  )
  const pagination = usePagination(blocks, model, imagesReady)
  const { measureRef, pages, ms, ready, fontsReady, version } = pagination

  const totalQuestions = useMemo(
    () => data.sections.reduce((a, s) => a + (s.questions?.length ?? 0), 0),
    [data],
  )
  const overflowPages = pages.filter((p) => p.overflow).length

  // ---- 分值就地编辑状态（受控，避免分页重排时输入丢失） --------------------
  const [scoreEdit, setScoreEdit] = useState<{ itemId: number; value: string } | null>(null)

  const scoreInvalid = useMemo(() => {
    if (!scoreEdit) return false
    const raw = scoreEdit.value.trim()
    if (raw === '') return false // 空 = 清除分值（合法）
    const n = Number(raw)
    return !Number.isFinite(n) || n < 0 || n > SCORE_MAX
  }, [scoreEdit])

  const commitScore = (itemId: number) => {
    if (!scoreEdit || scoreEdit.itemId !== itemId) return
    const raw = scoreEdit.value.trim()
    if (raw === '') {
      props.onScoreChange?.(itemId, null)
      setScoreEdit(null)
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > SCORE_MAX) return // 非法：保持编辑态（红框提示）
    props.onScoreChange?.(itemId, n)
    setScoreEdit(null)
  }

  // ---- 可排序题目 id（供 SortableContext） ---------------------------------
  const sortableIds = useMemo(
    () =>
      blocks
        .filter((b) => b.kind === 'question' && b.itemId != null)
        .map((b) => `item-${b.itemId}`),
    [blocks],
  )

  const renderQuestionChrome = (b: DocBlock) => (
    <QuestionChrome
      block={b}
      editing={scoreEdit?.itemId === b.itemId}
      value={scoreEdit && scoreEdit.itemId === b.itemId ? scoreEdit.value : ''}
      invalid={scoreInvalid && scoreEdit?.itemId === b.itemId}
      onStartEdit={() => setScoreEdit({ itemId: b.itemId!, value: b.score == null ? '' : fmtNum(b.score) })}
      onChange={(v) => setScoreEdit((s) => (s ? { ...s, value: v } : s))}
      onCommit={() => commitScore(b.itemId!)}
      onCancel={() => setScoreEdit(null)}
      onRemove={() => props.onRemove?.(b.itemId!)}
    />
  )

  // ---- 「约 N 页」 ----------------------------------------------------------
  const pageCountLabel =
    overflowPages > 0 ? `约 ${pages.length} 页（含长题，最终以导出为准）` : `约 ${pages.length} 页`
  const overflowTip =
    overflowPages > 0
      ? `检测到 ${overflowPages} 页存在「单题高于一整页」：真实 Word 会拆分该题，本预览将长块自然增高以完整呈现，结构分页近似。`
      : '结构分页近似；内容按当前模式有序块显示，最终分页以像素预览为准。'

  // ---- 诊断信息（供取证脚本读取，只读、无副作用） --------------------------
  const pageSummary = pages.map((p, i) => {
    const qs = p.blockIndices
      .map((idx) => blocks[idx])
      .filter((b) => b.kind === 'question')
      .map((b) => b.qNumber)
    return {
      page: i + 1,
      firstQuestion: qs.length ? qs[0] : null,
      questions: qs,
      usedPx: Math.round(p.usedPx),
      overflow: p.overflow,
    }
  })
  ;(window as unknown as { __livePreview?: unknown }).__livePreview = {
    paperId,
    contentDigest: data.content_digest,
    contentManifest: data.sections.flatMap(s => s.questions.map(q => ({ itemId: q.item_id, status: q.content_status, blocks: q.content_blocks.map(b => b.kind === 'image' ? { kind: b.kind, branch: b.branch, instanceId: b.instance_id } : { kind: b.kind, branch: b.branch, text: b.text }) }))),
    template,
    answerMode: data.answer_mode,
    editable,
    pages: pages.length,
    ready,
    fontsReady,
    imagesReady,
    version,
    ms,
    questions: totalQuestions,
    overflowPages,
    pageSummary,
    pageHeightPx: model.contentHeightPx,
    lineHeightPx: model.lineHeightPx,
    blockHeights: pagination.heights,
    blockIds: blocks.map((b) => b.id),
    itemIds: blocks.filter((b) => b.itemId != null).map((b) => b.itemId),
  }

  const pagesEl = (
    <>
      {pages.map((p, i) => (
        <PageView
          key={i}
          page={p}
          blocks={blocks}
          model={model}
          pageNumber={i + 1}
          totalPages={pages.length}
          debug={debug}
          editable={editable}
          scale={scale}
          renderQuestionChrome={editable ? renderQuestionChrome : undefined}
        />
      ))}
    </>
  )

  return (
    <Box className={`lp-doc${dark ? ' lp-dark' : ''}`}>
      {/* 顶部工具栏 */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Tooltip title={overflowTip}>
          <Chip
            size="small"
            color={overflowPages > 0 ? 'warning' : 'success'}
            variant="outlined"
            label={pageCountLabel}
          />
        </Tooltip>
        <Chip size="small" variant="outlined" label={`模板 ${template}`} />
        <Chip size="small" variant="outlined" label={data.layout_revision} />
        <Chip size="small" variant="outlined" label={data.answer_mode || '—'} />
        <Chip size="small" variant="outlined" label={`${totalQuestions} 题`} />
        {!ready && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              正在测量（等待字体与图片）…
            </Typography>
          </Stack>
        )}
        {ready && (
          <Typography variant="caption" color="text.secondary">
            测量 {ms.toFixed(2)}ms · 重排 v{version}
          </Typography>
        )}
      </Stack>

      {/* 测量层（不可见，宽度 = 正文区宽）。
          ★ 必须放在缩放容器之外：否则 transform:scale 会等比缩小
            getBoundingClientRect，污染测量。 */}
      <div ref={measureRef} className="lp-measure" style={{ width: model.contentWidthPx }}>
        {blocks.map((b) => (
          <div
            key={b.id}
            data-mid={b.id}
            className={`lp-block lp-block--${b.kind}`}
            style={{ paddingBottom: b.spacingAfterPx }}
          >
            <BlockView block={b} model={model} />
          </div>
        ))}
      </div>

      {/* 页面层（可缩放展示） */}
      <Box
        sx={{
          bgcolor: dark ? '#1b1b1b' : '#EDEFF2',
          borderRadius: 1,
          p: 2,
          maxHeight: '72vh',
          overflow: 'auto',
        }}
      >
        {!ready && (
          <Alert severity="info" sx={{ mb: 1 }}>
            正在测量分页（等待 KaTeX 字体与题目图片就绪）…
          </Alert>
        )}
        <div
          style={{
            transform: scale !== 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
        >
          {editable ? (
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {pagesEl}
            </SortableContext>
          ) : (
            pagesEl
          )}
        </div>
      </Box>
    </Box>
  )
}

export default LivePreviewPanel
