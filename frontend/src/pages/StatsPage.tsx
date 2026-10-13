/** P8 题库统计页（PRD P1-8）。
 *
 * 覆盖需求：
 * - P1-8：总览卡 + 各维度分布（题型 / 章节 / 答案覆盖 / 公式状态…）；
 * - PRD 5.5：答案 / 解析覆盖率；PRD 5.4：待复核公式「已处理 / 待处理」进度。
 *
 * B4-4 重构（内容优先的工具型极简）：
 * - 首屏突出**题数 / 来源数 / 待处理数**（主指标行），公式 / 图片 / 标签退为次级行；
 * - 两个治理面板合并为一个「数据状态」区，仍**分别**呈现题目覆盖率、关联数、处理进度；
 * - 每个分布默认 **Top5**，展开后显示接口返回的全部行；标题显示**实际数量**（不再写死「Top20」）；
 * - 可点击分布项改为 `Button`，**键盘可达**；难度「未标注」比例**由当前数据生成**。
 *
 * ⚠️ 口径边界：Top5 只改变**展示条数**，条形尺度仍按完整 `rows` 的最大值计算（展开前后一致）；
 * 公式**处理进度不等于正确率**；标签是**关联条数**，不能与题目数合并。
 */
import { useState, type ReactNode } from 'react'
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
import { useAppNavigate } from '../hooks/useAppNavigate'
import { getStats } from '../api/stats'
import type { CountRow, CoverageBucket, StatsData } from '../api/types'
import { describeFormulaStatus } from '../lib/glossary'
import { qk } from '../api/queryKeys'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'

/** 总览卡。`secondary` 为次级指标（字号更小、观感更轻）。 */
function StatCard({
  label,
  value,
  hint,
  action,
  secondary = false,
}: {
  label: string
  value: ReactNode
  hint?: string
  action?: ReactNode
  secondary?: boolean
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: secondary ? 1.5 : 2, minWidth: secondary ? 130 : 160, flex: `1 1 ${secondary ? 130 : 160}px` }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {/* P5-3：总览卡的「数值」是数据而非标题——去掉 variant=h5 带来的伪 <h5>，避免污染标题大纲。 */}
      <Typography variant={secondary ? 'h6' : 'h5'} fontWeight={700} component="div">
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

/** 分布列表（横向条形）。默认展示 `initialVisible` 行，可展开为全部。 */
function DistributionList({ title, rows, onItemClick, headingLevel = 1, initialVisible = 5 }: {
  title: string
  headingLevel?: 1 | 2
  rows: CountRow[]
  onItemClick?: (key: string) => void
  /** 默认展示行数（Top5）。 */
  initialVisible?: number
}) {
  const [expanded, setExpanded] = useState(false)
  // ⚠️ 尺度按**完整 rows** 的最大值计算：展开 / 收起只改展示条数，条形分母不变。
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  const visible = expanded ? rows : rows.slice(0, initialVisible)
  const canExpand = rows.length > initialVisible
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: '1 1 320px', minWidth: 280 }}>
      <Typography variant="subtitle2" component={headingLevel === 1 ? 'h2' : 'h3'} gutterBottom>
        {title}（{rows.length}）
      </Typography>
      {rows.length === 0 && <EmptyState dense title="该维度暂无数据" />}
      <Stack spacing={0.75}>
        {visible.map((r, i) => {
          const key = r.key ?? '（空）'
          const label = r.key ?? '（空）'
          return (
            <Box key={`${key}-${i}`}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                {onItemClick ? (
                  // 可点击项改 Button：天然支持 Tab 聚焦与 Enter/Space 激活。
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onItemClick(key)}
                    sx={{
                      minWidth: 0,
                      p: 0,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                      fontWeight: 400,
                      fontSize: 14,
                      lineHeight: 1.43,
                      color: 'text.primary',
                      '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' },
                    }}
                  >
                    {label}
                  </Button>
                ) : (
                  <Typography variant="body2">{label}</Typography>
                )}
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
      {canExpand && (
        <Button
          size="small"
          sx={{ mt: 1 }}
          aria-label={expanded ? `${title} 收起` : `${title} 展开全部 ${rows.length} 项`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : `展开全部 ${rows.length} 项`}
        </Button>
      )}
    </Paper>
  )
}

/** P8 题库统计页。 */
/** 嵌入维护父页时主标题为 h2；独立使用保留 h1，不改变视觉排版。 */
export default function StatsPage({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const pageHeading = headingLevel === 1 ? 'h1' : 'h2'
  const sectionHeading = headingLevel === 1 ? 'h2' : 'h3'
  const navigate = useAppNavigate()
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
  // 「难度未标注比例」由**当前数据**生成，不写死 100%。
  const difficultyLabel = env.difficulty
    ? `难度（未标注 ${Math.round(100 - env.difficulty.pct)}%）`
    : '难度'

  return (
    <Box>
      <Typography variant="h6" component={pageHeading} gutterBottom>
        题库统计
      </Typography>

      {/* 首屏主指标：题数 / 来源数 / 待处理数 */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <StatCard label="题目总数" value={s.questions.toLocaleString('zh-CN')} />
        <StatCard label="来源文件" value={s.sources.toLocaleString('zh-CN')} />
        <StatCard
          label="待处理（待复核公式）"
          value={s.review_open.toLocaleString('zh-CN')}
          hint={`已处理 ${s.review_resolved.toLocaleString('zh-CN')}`}
          action={
            <Button size="small" sx={{ mt: 0.5 }} onClick={() => navigate('/manage/formula-review')}>
              去处理 →
            </Button>
          }
        />
      </Stack>

      {/* 次级指标：公式 / 图片 / 标签 */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <StatCard
          secondary
          label="公式"
          value={s.formulas.toLocaleString('zh-CN')}
          hint={`转换完成 ${s.formulas_ok.toLocaleString('zh-CN')}`}
        />
        <StatCard secondary label="图片" value={s.images.toLocaleString('zh-CN')} />
        <StatCard secondary label="标签" value={s.labels.toLocaleString('zh-CN')} />
      </Stack>

      {/* 数据状态区：题目覆盖率 / 关联数 / 处理进度 三者仍分开呈现 */}
      <Typography variant="subtitle2" component={sectionHeading} gutterBottom>
        数据状态
      </Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        {/* 题目覆盖率 */}
        <Paper variant="outlined" sx={{ p: 2, flex: '1 1 380px', minWidth: 320 }}>
          <Typography variant="subtitle2" component="div" fontWeight={600} gutterBottom>
            题目覆盖率
          </Typography>
          <CoverageRow label="年级" bucket={env.grade} />
          <CoverageRow label="教材" bucket={env.textbook} />
          <CoverageRow label="章节" bucket={env.chapter} />
          <CoverageRow label="题型" bucket={env.qtype} />
          <CoverageRow label={difficultyLabel} bucket={env.difficulty} />
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

        {/* 处理进度（≠ 内容正确率） */}
        <Paper variant="outlined" sx={{ p: 2, flex: '1 1 380px', minWidth: 320 }}>
          <Typography variant="subtitle2" component="div" fontWeight={600} gutterBottom>
            待复核公式处理进度
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
          <Typography variant="caption" color="text.secondary">
            处理进度只表示「已核对动作」的比例，<strong>不代表公式内容正确率</strong>。
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {/* T04：这是**公式转换状态的聚合计数**，不是需要立刻行动的告警 → 用中性描边，
                不再用警告橙（语义色只留给单项状态与真正的告警，见设计规范 §2.1 铁律 2）。 */}
            {Object.entries(s.review?.by_status ?? {}).map(([k, v]) => (
              <Chip key={k} size="small" variant="outlined" label={`${describeFormulaStatus(k)} ${v}`} />
            ))}
          </Stack>

          {/* 知识点复核状态（关联条数，非题目数） */}
          <Typography variant="subtitle2" component="div" fontWeight={600} sx={{ mt: 2 }} gutterBottom>
            知识点关联复核状态
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {/* T04：同上——三个都是**关联条数**聚合计数 → 中性描边（语义色只给单项状态）。 */}
            <Chip size="small" variant="outlined" label={`待复核 ${(s.label_status['待复核'] ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" variant="outlined" label={`已确认 ${(s.label_status['已确认'] ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" variant="outlined" label={`已否决 ${(s.label_status['已否决'] ?? 0).toLocaleString('zh-CN')}`} />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            以上为「题-标签关联条数」，一道题可对应多个标签，<strong>不能</strong>与题目数直接相加。
          </Typography>
          <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/manage/knowledge')}>
            去知识点复核 →
          </Button>
        </Paper>
      </Stack>

      {/* 各维度分布（默认 Top5，可展开全部） */}
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
        <DistributionList headingLevel={headingLevel} title="高频章节" rows={s.top_chapters} onItemClick={() => navigate('/search')} />
      </Stack>
    </Box>
  )
}
