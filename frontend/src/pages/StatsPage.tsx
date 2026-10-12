/** P8 题库统计页（PRD P1-8）。
 *
 * 覆盖需求：
 * - P1-8：总览卡 + 各维度分布（题型 / 章节 / 答案覆盖 / 公式状态…）；
 * - PRD 5.5：答案 / 解析覆盖率；PRD 5.4：待复核公式「已处理 / 待处理」进度。
 */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { getStats } from '../api/stats'
import type { CountRow, CoverageBucket, StatsData } from '../api/types'
import { describeFormulaStatus } from '../lib/glossary'
import { qk } from '../api/queryKeys'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'

/** 总览卡。 */
function StatCard({
  label,
  value,
  hint,
  action,
}: {
  label: string
  value: ReactNode
  hint?: string
  action?: ReactNode
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 150, flex: '1 1 150px' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {/* P5-3：总览卡的「数值」是数据而非标题——去掉 variant=h5 带来的伪 <h5>，避免污染标题大纲。 */}
      <Typography variant="h5" fontWeight={700} component="div">
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
      {action}
    </Paper>
  )
}

/** 覆盖率条。 */
function CoverageRow({ label, bucket }: { label: string; bucket?: CoverageBucket | null }) {
  if (!bucket) return null
  return (
    <Box sx={{ mb: 1 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {bucket.pct}%（{bucket.n.toLocaleString('zh-CN')}/{bucket.total.toLocaleString('zh-CN')}）
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, bucket.pct)}
        sx={{ mt: 0.5, height: 8, borderRadius: 4 }}
      />
    </Box>
  )
}

/** 分布列表（横向条形）。 */
function DistributionList({ title, rows, onItemClick, headingLevel = 1 }: {
  title: string
  headingLevel?: 1 | 2
  rows: CountRow[]
  onItemClick?: (key: string) => void
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: '1 1 320px', minWidth: 280 }}>
      <Typography variant="subtitle2" component={headingLevel === 1 ? 'h2' : 'h3'} gutterBottom>
        {title}
      </Typography>
      {rows.length === 0 && <EmptyState dense title="该维度暂无数据" />}
      <Stack spacing={0.75}>
        {rows.slice(0, 12).map((r, i) => {
          const key = r.key ?? '（空）'
          return (
            <Box key={`${key}-${i}`}>
              <Stack direction="row" justifyContent="space-between">
                <Typography
                  variant="body2"
                  sx={{ cursor: onItemClick ? 'pointer' : 'default' }}
                  onClick={() => onItemClick?.(key)}
                >
                  {key}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {r.count.toLocaleString('zh-CN')}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={(100 * r.count) / max}
                sx={{ mt: 0.25, height: 6, borderRadius: 3 }}
              />
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}

/** P8 题库统计页。 */
/** 嵌入维护父页时主标题为 h2；独立使用保留 h1，不改变视觉排版。 */
export default function StatsPage({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const pageHeading = headingLevel === 1 ? 'h1' : 'h2'
  const sectionHeading = headingLevel === 1 ? 'h2' : 'h3'
  const navigate = useNavigate()
  const statsQ = useQuery({ queryKey: qk.stats(), queryFn: () => getStats() })

  if (statsQ.isLoading) {
    return (
      <Box>
        <Typography variant="h6" component={pageHeading} gutterBottom>
          题库统计
        </Typography>
        <LoadingState label="正在加载统计…" />
      </Box>
    )
  }
  if (statsQ.isError) {
    return (
      <Box>
        <Typography variant="h6" component={pageHeading} gutterBottom>
          题库统计
        </Typography>
        <ErrorState error={statsQ.error} title="加载统计失败" onRetry={() => statsQ.refetch()} />
      </Box>
    )
  }

  const s: StatsData = statsQ.data as StatsData
  const env = s.enrich_coverage
  const ans = s.answer_coverage
  const reviewTotal = s.review?.total ?? 0
  const reviewPct = reviewTotal > 0 ? Math.round((100 * (s.review?.resolved ?? 0)) / reviewTotal) : 0

  return (
    <Box>
      <Typography variant="h6" component={pageHeading} gutterBottom>
        题库统计
      </Typography>

      {/* 总览卡 */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <StatCard label="题目总数" value={s.questions.toLocaleString('zh-CN')} />
        <StatCard label="来源文件" value={s.sources.toLocaleString('zh-CN')} />
        <StatCard
          label="公式"
          value={s.formulas.toLocaleString('zh-CN')}
          hint={`转换完成 ${s.formulas_ok.toLocaleString('zh-CN')}`}
        />
        <StatCard label="图片" value={s.images.toLocaleString('zh-CN')} />
        <StatCard label="标签" value={s.labels.toLocaleString('zh-CN')} />
        <StatCard
          label="待复核公式"
          value={s.review_open.toLocaleString('zh-CN')}
          hint={`已处理 ${s.review_resolved.toLocaleString('zh-CN')}`}
          action={
            <Button size="small" sx={{ mt: 0.5 }} onClick={() => navigate('/manage/formula-review')}>
              去处理 →
            </Button>
          }
        />
      </Stack>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        {/* 覆盖率 */}
        <Paper variant="outlined" sx={{ p: 2, flex: '1 1 380px', minWidth: 320 }}>
          <Typography variant="subtitle2" component={sectionHeading} gutterBottom>
            元数据 / 内容覆盖率
          </Typography>
          <CoverageRow label="年级" bucket={env.grade} />
          <CoverageRow label="教材" bucket={env.textbook} />
          <CoverageRow label="章节" bucket={env.chapter} />
          <CoverageRow label="题型" bucket={env.qtype} />
          <CoverageRow label="难度（100% 未标注）" bucket={env.difficulty} />
          <CoverageRow label="知识点（搜索线索）" bucket={env.knowledge} />
          <CoverageRow
            label="答案"
            bucket={{ n: ans.with_answer, total: ans.total, pct: ans.total ? Math.round((100 * ans.with_answer) / ans.total) : 0 }}
          />
          <CoverageRow
            label="解析"
            bucket={{ n: ans.with_analysis, total: ans.total, pct: ans.total ? Math.round((100 * ans.with_analysis) / ans.total) : 0 }}
          />
          <Typography variant="caption" color="text.secondary">
            说明：覆盖率口径统一按题目数统计（年级/教材逐题继承其来源文件的取值）；
            难度需教研组人工标注，系统不做自动推断。
          </Typography>
        </Paper>

        {/* 复核进度 + 知识点状态 */}
        <Paper variant="outlined" sx={{ p: 2, flex: '1 1 380px', minWidth: 320 }}>
          <Typography variant="subtitle2" component={sectionHeading} gutterBottom>
            待复核公式清零进度
          </Typography>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              已处理 {s.review?.resolved ?? 0} / 共 {reviewTotal}
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {reviewPct}%
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={reviewPct} sx={{ mt: 1, height: 8, borderRadius: 4 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {Object.entries(s.review?.by_status ?? {}).map(([k, v]) => (
              <Chip key={k} size="small" color="warning" variant="outlined" label={`${describeFormulaStatus(k)} ${v}`} />
            ))}
          </Stack>

          <Typography variant="subtitle2" component={sectionHeading} sx={{ mt: 2 }} gutterBottom>
            知识点复核状态
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" color="warning" variant="outlined" label={`待复核 ${(s.label_status['待复核'] ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" color="success" variant="outlined" label={`已确认 ${(s.label_status['已确认'] ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" label={`已否决 ${(s.label_status['已否决'] ?? 0).toLocaleString('zh-CN')}`} />
          </Stack>
          <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/manage/knowledge')}>
            去知识点复核 →
          </Button>
        </Paper>
      </Stack>

      {/* 各维度分布 */}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <DistributionList headingLevel={headingLevel} title="题型分布" rows={s.by_qtype} onItemClick={() => navigate('/search')} />
        <DistributionList headingLevel={headingLevel} title="年级分布" rows={s.by_grade} onItemClick={() => navigate('/search')} />
        <DistributionList headingLevel={headingLevel} title="教材分布" rows={s.by_textbook} onItemClick={() => navigate('/search')} />
        <DistributionList headingLevel={headingLevel} title="学段分布" rows={s.by_stage} onItemClick={() => navigate('/search')} />
        <DistributionList headingLevel={headingLevel} title="学科分布" rows={s.by_subject} onItemClick={() => navigate('/search')} />
        <DistributionList headingLevel={headingLevel}
          title="公式状态分布"
          rows={s.formula_status.map((f) => ({ key: describeFormulaStatus(f.status), count: f.count }))}
        />
        <DistributionList headingLevel={headingLevel} title="高频章节（Top 20）" rows={s.top_chapters} onItemClick={() => navigate('/search')} />
      </Stack>
    </Box>
  )
}
