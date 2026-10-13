/** 数据完整度提示条（P0-13 数据状态可见性）。
 *
 * **永久性数据说明**、非阻塞、可关闭（PRD 4「提示条」/ 5.1）。
 *
 * 设计（B2 §3.3）：默认**只占一行**——一句话说清「哪些维度未标全会漏题」，
 * 需要时才展开看六维数值与复核数。**不合算未经定义的完整度百分比**（不造总分）。
 * 折叠的只是「数值明细」，**影响当前筛选结果的漏题事实**由结果区的
 * {@link GradeGapNotice} 继续显露，不随这里一起藏掉。
 *
 * T08（规范 §3.3 反馈通道表）：这是**永久性数据说明**，不是「需要立刻行动」的告警，
 * 因此**不得**用橙色 Alert 常驻。改为一行中性 caption + 「展开明细」按钮；
 * 展开后的数值同样走中性色（语义色只留给需要立刻行动的告警）。
 */
import { useState } from 'react'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { CoverageBucket, CoverageSummary } from '../api/types'

function fmtPct(bucket?: CoverageBucket | null): string {
  if (!bucket) return '—'
  const n = bucket.n?.toLocaleString('zh-CN') ?? '0'
  const total = bucket.total?.toLocaleString('zh-CN') ?? '0'
  return `${bucket.pct ?? 0}%（${n}/${total}）`
}

/**
 * 覆盖率**为 0** 的维度（如难度）应显示为「未标注」而不是「0%」——
 * 「0%」看起来像"统计坏了"，「未标注」才说明"数据本身没标，需要人工补"（P0-5）。
 */
function isUnannotated(bucket?: CoverageBucket | null): boolean {
  return Boolean(bucket) && (bucket?.n ?? 0) === 0
}

export interface CoverageBannerProps {
  coverage?: CoverageSummary | null
  dismissed: boolean
  onDismiss: () => void
}

/** 数据完整度提示条；`dismissed` 为真时返回 null。默认折叠为一行，展开后看六维数值。 */
export function CoverageBanner({ coverage, dismissed, onDismiss }: CoverageBannerProps) {
  // hooks 必须在提前 return 之前调用。
  const [expanded, setExpanded] = useState(false)
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
    // T08：**不再是 Alert**。永久性说明用中性一行 caption（规范 §3.3 禁止橙色 Alert 常驻）。
    <Box
      data-testid="coverage-banner"
      sx={{ mb: 2, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {/* 默认一行：只说「按哪些维度筛会漏题」这一件事实，不铺开六维数值。 */}
        <Typography variant="body2" component="span" fontWeight={500}>
          数据完整度
        </Typography>
        <Typography variant="body2" component="span" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          年级、教材、章节尚未标全，按这些维度筛选会漏掉未标注的题；「难度」需教研组人工标注，暂不能按难度筛选。
        </Typography>
        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="coverage-toggle"
        >
          {expanded ? '收起' : '展开明细'}
        </Button>
        <IconButton aria-label="关闭提示" size="small" onClick={onDismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {expanded && (
        <Stack direction="row" flexWrap="wrap" columnGap={2} rowGap={0.5} sx={{ mt: 0.75 }}>
          {items.map((it) => (
            <Box key={it.label} title={it.tip}>
              <Typography variant="body2" component="span" color="text.secondary">
                {it.label}{' '}
              </Typography>
              {isUnannotated(it.bucket) ? (
                // P0-5：0% 不等于"统计坏了"，要直说是"未标注"。
                // T08：这里也只强调文字（不加语义色）——它同样是永久性说明。
                <Typography variant="body2" component="span" fontWeight={500}>
                  未标注（{it.bucket?.total?.toLocaleString('zh-CN') ?? '0'} 题）
                </Typography>
              ) : (
                <Typography variant="body2" component="span" fontWeight={500}>
                  {fmtPct(it.bucket)}
                </Typography>
              )}
            </Box>
          ))}
          <Box>
            <Typography variant="body2" component="span" color="text.secondary">
              待复核公式{' '}
            </Typography>
            <Typography variant="body2" component="span" fontWeight={500}>
              {coverage.review_open?.toLocaleString('zh-CN') ?? '0'} 条
            </Typography>
          </Box>
        </Stack>
      )}
    </Box>
  )
}

export default CoverageBanner
