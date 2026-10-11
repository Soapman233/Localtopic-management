/** 覆盖率提示条（P0-13 数据状态可见性）。
 *
 * 橙色、**非阻塞**、可关闭（PRD 4「提示条」/ 5.1）。
 * 文案示例：「年级 17%（1,342/7,945）」，悬浮说明「缺失元数据的题仍可被关键词检索命中，
 * 只是无法按此维度筛出」。
 */
import { Alert, AlertTitle, Box, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { CoverageBucket, CoverageSummary } from '../api/types'

function fmtPct(bucket?: CoverageBucket | null): string {
  if (!bucket) return '—'
  const n = bucket.n?.toLocaleString('zh-CN') ?? '0'
  const total = bucket.total?.toLocaleString('zh-CN') ?? '0'
  return `${bucket.pct ?? 0}%（${n}/${total}）`
}

export interface CoverageBannerProps {
  coverage?: CoverageSummary | null
  dismissed: boolean
  onDismiss: () => void
}

/** 覆盖率提示条；`dismissed` 为真时返回 null。 */
export function CoverageBanner({ coverage, dismissed, onDismiss }: CoverageBannerProps) {
  if (dismissed || !coverage) return null

  const items: { label: string; bucket?: CoverageBucket | null; tip: string }[] = [
    { label: '年级', bucket: coverage.grade, tip: '缺失元数据的题仍可被关键词检索命中，只是无法按此维度筛出' },
    { label: '教材', bucket: coverage.textbook, tip: '缺失元数据的题仍可被关键词检索命中，只是无法按此维度筛出' },
    { label: '章节', bucket: coverage.chapter, tip: '章节为题目级字段，缺失时无法按章节筛出' },
    { label: '答案', bucket: coverage.answer, tip: '库中无答案的题不会被硬造答案，导出解析版时只显示题干' },
    { label: '解析', bucket: coverage.analysis, tip: '库中无解析的题不会被硬造解析' },
    { label: '难度', bucket: coverage.difficulty, tip: '难度需教研组人工标注，系统只负责留空（不做自动推断）' },
  ]

  return (
    <Alert
      severity="warning"
      sx={{ mb: 2, alignItems: 'flex-start' }}
      action={
        <IconButton aria-label="关闭提示" size="small" onClick={onDismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      <AlertTitle>数据覆盖率提示</AlertTitle>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        年级、教材、章节尚未标全，按这些维度筛选会漏掉未标注的题。
        可清除相应筛选后用关键词查找，或选择「待补充」查看缺失项。
      </Typography>
      <Stack direction="row" flexWrap="wrap" columnGap={2} rowGap={0.5}>
        {items.map((it) => (
          <Box key={it.label} title={it.tip}>
            <Typography variant="body2" component="span" color="text.secondary">
              {it.label}{' '}
            </Typography>
            <Typography variant="body2" component="span" fontWeight={600}>
              {fmtPct(it.bucket)}
            </Typography>
          </Box>
        ))}
        <Box>
          <Typography variant="body2" component="span" color="text.secondary">
            待复核公式{' '}
          </Typography>
          <Typography variant="body2" component="span" fontWeight={600}>
            {coverage.review_open?.toLocaleString('zh-CN') ?? '0'} 条
          </Typography>
        </Box>
      </Stack>
    </Alert>
  )
}

export default CoverageBanner
