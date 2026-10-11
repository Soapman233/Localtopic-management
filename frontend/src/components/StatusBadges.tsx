/** 统一徽章组件（架构设计 §8.4「徽章统一语义」单一来源）。
 *
 * 覆盖：答案（有/无）、解析（有/无）、难度（未标注/易/中/难）、公式（待复核）、
 * 知识点（已确认/待复核/已否决）、元数据（待补充）。
 *
 * 设计约束（PRD 5.2）：难度为空时**必须**渲染灰色「未标注」徽章 + 「标注」按钮，
 * **绝不能渲染成空白**（空白会被误读为「简单/无难度」）。
 */
import { Button, Chip, Stack, Tooltip } from '@mui/material'
import type { ChipProps } from '@mui/material'

export interface BadgeProps {
  label: string
  color?: ChipProps['color']
  variant?: ChipProps['variant']
  title?: string
  sx?: ChipProps['sx']
}

/** 通用徽章：小尺寸圆角 chip + 可选 tooltip。 */
export function Badge({ label, color = 'default', variant = 'filled', title, sx }: BadgeProps) {
  const chip = <Chip size="small" label={label} color={color} variant={variant} sx={sx} />
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip
}

/** 答案徽章：有答案=绿底浅色；无答案=灰底。 */
export function AnswerBadge({ hasAnswer }: { hasAnswer: boolean }) {
  return hasAnswer ? (
    <Badge label="有答案" color="success" variant="outlined" />
  ) : (
    <Badge label="无答案" color="default" title="题库中该题没有答案，导出解析版时只会显示题干" />
  )
}

/** 解析徽章：有解析=绿底浅色；无解析=灰底。 */
export function AnalysisBadge({ hasAnalysis }: { hasAnalysis: boolean }) {
  return hasAnalysis ? (
    <Badge label="有解析" color="success" variant="outlined" />
  ) : (
    <Badge label="无解析" color="default" />
  )
}

/** 难度分级色（M6：易=绿 / 中=橙 / 难=红）。 */
export const DIFFICULTY_COLOR: Record<string, ChipProps['color']> = {
  易: 'success',
  中: 'warning',
  难: 'error',
}

/** 难度徽章：未标注=灰描边（**绝不空白**）+ 可选「标注」按钮。 */
export function DifficultyBadge({
  difficulty,
  onAnnotate,
}: {
  difficulty?: string | null
  onAnnotate?: () => void
}) {
  const isUnlabeled = !difficulty || difficulty === '未标注'
  if (isUnlabeled) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" component="span">
        <Chip
          size="small"
          label="未标注"
          variant="outlined"
          sx={{ color: 'text.secondary', borderColor: '#D0D3D9' }}
        />
        {onAnnotate && (
          <Button size="small" onClick={onAnnotate} sx={{ minWidth: 0, px: 0.75, fontSize: 12 }}>
            标注
          </Button>
        )}
      </Stack>
    )
  }
  return (
    <Badge
      label={`难度 ${difficulty}`}
      color={DIFFICULTY_COLOR[difficulty] ?? 'default'}
      title={`人工标注难度：${difficulty}`}
    />
  )
}

/** 公式待复核徽章（橙底）。 */
export function ReviewBadge({ count }: { count?: number }) {
  return (
    <Badge
      label={count && count > 0 ? `待复核公式 ${count}` : '待复核公式'}
      color="warning"
      title="该题含状态非 OK 的公式，已进入待复核队列"
    />
  )
}

/** 知识点三态徽章：已确认（实心色）/ 待复核（描边+问号）/ 已否决（划掉）。 */
export function LabelStatusBadge({ status }: { status?: string | null }) {
  const st = status || '待复核'
  if (st === '已确认') {
    return <Badge label="已确认" color="success" title="该知识点标签已被人工确认" />
  }
  if (st === '已否决') {
    return (
      <Badge
        label="已否决"
        color="default"
        sx={{ textDecoration: 'line-through', opacity: 0.75 }}
        title="该知识点标签已被人工否决"
      />
    )
  }
  return (
    <Badge
      label="待复核？"
      color="warning"
      variant="outlined"
      title="该标签为系统「提及」识别结果，尚未人工复核"
    />
  )
}

/** 元数据「待补充」徽章（灰底，出现在筛选栏与覆盖率提示）。 */
export function MissingBadge({ count }: { count?: number }) {
  return (
    <Badge
      label={count === undefined ? '待补充' : `待补充 (${count.toLocaleString('zh-CN')})`}
      color="default"
      title="该维度缺失元数据的题；缺失不影响关键词检索，但无法按此维度筛出"
    />
  )
}

/** 「仅看已确认知识点」严格模式状态徽章。 */
export function StrictKpBadge({ confirmed, pending }: { confirmed: number; pending: number }) {
  return (
    <Badge
      label={`已确认 ${confirmed.toLocaleString('zh-CN')} / 待复核 ${pending.toLocaleString('zh-CN')}`}
      color="default"
      variant="outlined"
      title="知识点为「提及」口径：系统识别题干中出现过的知识词，不代表本题在考查它"
    />
  )
}
