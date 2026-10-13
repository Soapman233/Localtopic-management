/** 检索结果卡片（P0-3 / PRD 4「结果卡」）。
 *
 * 顶部一行元信息（题号/题型/章节/来源，灰色小字）；中部题干预览（2–3 行截断）；
 * 底部一行状态徽章（答案/解析/待复核）+「加入」「详情」。
 *
 * T20/T23：难度与章节在源数据里几乎恒定缺失（100% / 64.6%），逐卡渲染恒定值无信息量
 * → 二者改为**按条件渲染**（仅真实值才显示）；有数据时自动恢复，不硬删组件逻辑。
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
  /**
   * 单题难度标注入口（P1-4）。
   *
   * ⚠️ T20 之后本卡**不再渲染难度徽章**（难度实测 100%「未标注」，逐卡渲染恒定值无信息量），
   * 而 `DifficultyBadge` 只在「未标注」时才给出「标注」按钮 → 该回调在结果卡上**已不可达**，
   * 因此本卡不再消费它。**保留该 prop 仅为不破坏调用方**（`SearchPage` 仍在传），
   * 难度标注入口仍在单题详情页可用。若未来恢复逐卡标注，再接回 `DifficultyBadge` 即可。
   */
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

/** F10/T11：卡片 CTA 的「filled」观感（hover / 卡片选中态）。
 *
 * 刻意**不**升级为 `contained` variant——批量条的「加入所选」必须保持为页面**唯一**的
 * contained 主按钮（规范 §4.2「一屏 ≤1 个主操作」）；这里用填充色表达强调即可。
 * 提到模块级复用同一对象，避免在 sx 里重复字面量、平白增大首屏 chunk。
 */
const CTA_FILLED = { bgcolor: 'primary.dark', color: 'primary.contrastText', borderColor: 'primary.dark' } as const

/** 结果卡片。 */
export function QuestionCard({
  item,
  onAdd,
  onDetail,
  // 布尔开关一律按 `undefined` 即「关」处理（不写 `= false` 默认值）：
  // 本组件位于**首屏共享 chunk**（组卷页会加载），省下的每个字节都直接算进首屏预算。
  draggable,
  adding,
  selectable,
  selected,
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
              checked={!!selected}
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
          {/* T23：章节实测「待补充」64.6%（5,135/7,945）> 规范 §4.2 的 60% 阈值
              → 逐卡印一个恒定的「待补充」是纯噪音。改为**按条件渲染**：仅当章节为真实值时
              才显示，缺失时整段不渲染（不写「待补充」占位）。 */}
          {item.chapter && item.chapter !== '待补充' && (
            <Typography variant="caption" color="text.secondary">
              章节 {item.chapter}
            </Typography>
          )}
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
        {/* T20：难度实测 100%「未标注」（7,945/7,945，源数据无标注、项目刻意不编造）
            → 逐卡渲染一个恒定的「未标注」徽章无信息量、纯噪音。改为**按条件渲染**：
            仅当难度为**真实标注值**时才渲染；未来补录难度后自动恢复显示，不硬删组件逻辑。
            刻意**不**改成「未知」之类新文案来掩盖（那只是换个恒定值）。 */}
        {item.difficulty && item.difficulty !== '未标注' && (
          <DifficultyBadge difficulty={item.difficulty} />
        )}
        {item.needs_review && <ReviewBadge />}
        <Box sx={{ flex: 1 }} />
        {onAdd && (
          // F10/T11 卡片 CTA 降权（最高频页面 /builder）：一屏曾有 8+ 个同权的蓝色 filled「加入」，
          // 把唯一主操作的视觉权重稀释掉（规范 §4.2「contained 一屏 ≤1」）。
          // 默认降为 **outlined**（次级），仅在 **hover / 卡片选中** 时升为 filled 观感，
          // 使「加入」仍一眼可见但不再常驻抢占主层级。
          // ⚠️ 不做整卡点击——本卡是 dnd-kit 可拖拽节点，整卡点击会与拖拽加题冲突。
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => onAdd(item)}
            disabled={adding}
            sx={selected ? CTA_FILLED : { '&:hover': CTA_FILLED }}
          >
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
