/** 检索结果卡片（P0-3 / PRD 4「结果卡」）。
 *
 * 顶部一行元信息（题号/题型/章节/来源，灰色小字）；中部题干预览（2–3 行截断）；
 * 底部一行状态徽章（答案/解析/难度/待复核）+「加入」「详情」。
 *
 * 可拖拽（P1-10）：拖到右栏试卷即加入（由组卷页的 DndContext 处理）。
 */
import { Box, Button, Card, CardActions, CardContent, Checkbox, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { tokens } from '../theme'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import AddIcon from '@mui/icons-material/Add'
import ArticleIcon from '@mui/icons-material/Article'
import { useDraggable } from '@dnd-kit/core'
import type { SearchItem } from '../api/types'
import { AnswerBadge, AnalysisBadge, DifficultyBadge, ReviewBadge } from './StatusBadges'
import { stripAnswerSections } from '../lib/questionText'

export interface QuestionCardProps {
  item: SearchItem
  onAdd?: (item: SearchItem) => void
  onDetail?: (item: SearchItem) => void
  onAnnotate?: (item: SearchItem) => void
  draggable?: boolean
  adding?: boolean
  /** P1-3：是否展示多选框（批量加题）。 */
  selectable?: boolean
  /** P1-3：当前是否被选中。 */
  selected?: boolean
  /** P1-3：勾选变化回调。 */
  onSelectChange?: (item: SearchItem, selected: boolean) => void
}

/** 结果卡的题干预览：只保留「题干 + 选项」。
 *
 * T05：部分来源文件的 `plain_text` 里内嵌了 `【答案】/【详解】…`（与 `answer`/`analysis`
 * 同源），整段铺在列表里既冗余又误导。这里在**渲染期**剥离（不动数据），
 * 答案/解析状态仍由卡片底部徽章表达。
 */
function previewText(item: SearchItem): string {
  const t = stripAnswerSections(item.plain_text).replace(/\s+/g, ' ').trim()
  return t || '（无题干文本）'
}

/** 答案/解析状态：优先用后端下发的布尔标志，其次按字段推断；**都拿不到则返回 undefined**。
 *
 * `GET /api/search` 现已下发 item 的 `has_answer` / `has_analysis`（B2 已修），此处取其值；
 * 若某次未下发则回退按 `answer` / `analysis` 字段推断，仍拿不到则返回 `undefined`
 * ——此时**不渲染徽章**（绝不渲染成「无答案」，避免误导）。
 */
function resolveAnswerFlags(item: SearchItem): { hasAnswer?: boolean; hasAnalysis?: boolean } {
  const hasAnswer =
    item.has_answer ??
    (item.answer != null ? Boolean(item.answer.trim()) : undefined)
  const hasAnalysis =
    item.has_analysis ??
    (item.analysis != null ? Boolean(item.analysis.trim()) : undefined)
  return { hasAnswer, hasAnalysis }
}

/** 结果卡片。 */
export function QuestionCard({
  item,
  onAdd,
  onDetail,
  onAnnotate,
  draggable = false,
  adding = false,
  selectable = false,
  selected = false,
  onSelectChange,
}: QuestionCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lib-${item.id}`,
    data: { type: 'library', questionId: item.id },
    disabled: !draggable,
  })

  const { hasAnswer, hasAnalysis } = resolveAnswerFlags(item)

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 1300 : undefined }
    : undefined

  return (
    <Card
      ref={setNodeRef}
      style={style}
      variant="outlined"
      sx={{
        mb: 1.5,
        transition: 'box-shadow .15s, border-color .15s',
        '&:hover': { boxShadow: tokens.cardHoverShadow, borderColor: 'primary.light' },
      }}
    >
      <CardContent sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.75 }} useFlexGap>
          {selectable && (
            <Checkbox
              size="small"
              checked={selected}
              onChange={(e) => onSelectChange?.(item, e.target.checked)}
              inputProps={{ 'aria-label': `选择题 ${item.number || item.id}` }}
              sx={{ p: 0.25, mr: -0.5 }}
            />
          )}
          {draggable && (
            <Tooltip title="拖拽到右侧试卷即可加入">
              <DragIndicatorIcon
                fontSize="small"
                // P5-3 触达尺寸（SC 2.5.8）：20×20 的拖拽把手补 2px 透明内边距到 24×24。
                // 用 `content-box` 让 padding 外扩命中区而**不放大图标本身**（视觉零变化）。
                sx={{ color: 'text.disabled', cursor: 'grab', boxSizing: 'content-box', p: 0.25 }}
                {...attributes}
                {...listeners}
              />
            </Tooltip>
          )}
          <Typography variant="caption" color="text.secondary">
            题 {item.number || item.id}
          </Typography>
          {item.qtype && <Chip size="small" label={item.qtype} variant="outlined" />}
          <Typography variant="caption" color="text.secondary">
            章节 {item.chapter || '待补充'}
          </Typography>
          {item.file_name && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
              来源 {item.file_name}
            </Typography>
          )}
        </Stack>

        <Typography
          variant="body2"
          sx={{
            lineHeight: 1.7,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {previewText(item)}
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 1.5, pt: 0, flexWrap: 'wrap', gap: 0.5 }}>
        {hasAnswer !== undefined && <AnswerBadge hasAnswer={hasAnswer} />}
        {hasAnalysis !== undefined && <AnalysisBadge hasAnalysis={hasAnalysis} />}
        <DifficultyBadge difficulty={item.difficulty} onAnnotate={onAnnotate ? () => onAnnotate(item) : undefined} />
        {item.needs_review && <ReviewBadge />}
        <Box sx={{ flex: 1 }} />
        {onAdd && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => onAdd(item)} disabled={adding}>
            加入
          </Button>
        )}
        {onDetail && (
          <Button size="small" startIcon={<ArticleIcon />} onClick={() => onDetail(item)}>
            详情
          </Button>
        )}
      </CardActions>
    </Card>
  )
}

export default QuestionCard
