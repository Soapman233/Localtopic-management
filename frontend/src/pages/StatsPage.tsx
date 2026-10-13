/** P8 题库统计页（PRD P1-8）。
 *
 * 覆盖需求：
 * - P1-8：总览卡 + 各维度分布（题型 / 章节 / 答案覆盖 / 公式状态…）；
 * - PRD 5.5：答案 / 解析覆盖率；PRD 5.4：待复核公式「已处理 / 待处理」进度。
 *
 * B4 渐进披露（方案 §3.8）：本页作为「数据维护」Tab 子页嵌入。
 * - 标题层级：父页 h1（`DataMaintenancePage`）；本页 `PageHeader level="section"` → h2；
 *   内部分区用 `SectionCard`（h3），分区内小节 h4。
 * - 首屏突出「题数 / 来源数 / 待处理数」，公式 / 图片 / 标签退为次级数据。
 * - 每个分布默认 Top5，可展开显示接口返回的全部行；标题旁显示实际项数。
 * - 数据口径、取数接口一律不变，只调整表现层。
 *
 * 配色（对齐语义槽，**不改 theme 色值**）：KPI 卡左侧竖条与数值取
 * `palette.primary/success/warning/error` 的 `.main`（文字安全值，白底达标）；
 * 进度条用 `success`（正向进度）/ `warning`（待复核计数）语义色。
 */
import { useState } from 'react'
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
import { qk } from '../api/queryKeys'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'

/** 状态代码 → 中文（含 OK；未知值明确「待核对」，不冒充正常）。 */
const STATUS_ZH: Record<string, string> = {
  OK: '正常',
  UNSUPPORTED: '不支持',
  EMPTY: '未提取到内容',
  FAIL: '转换失败',
}

/** 状态代码转中文；未知 / 空值不伪装成正常。 */
function statusText(code: string | null | undefined): string {
  const k = (code ?? '').trim()
  if (!k) return '（未标注）'
  return STATUS_ZH[k] ?? `待核对（${k}）`
}

/** 可用的语义色槽（取 `palette.<accent>.main`，均为文字安全值）。 */
type Accent = 'primary' | 'success' | 'warning' | 'error'

/** 总览卡（KPI 卡片化）：左侧语义色竖条 + 数值用语义槽主色。 */
function StatCard({
  label,
  value,
  hint,
  action,
  accent = 'primary',
}: {
  label: string
  value: ReactNode
  hint?: string
  action?: ReactNode
  accent?: Accent
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minWidth: 150,
        flex: '1 1 150px',
        borderLeft: '3px solid',
        borderLeftColor: `${accent}.main`,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {/* P5-3：总览卡的「数值」是数据而非标题——去掉 variant=h5 带来的伪 <h5>，避免污染标题大纲。 */}
      <Typography variant="h5" fontWeight={500} component="div" sx={{ color: `${accent}.main` }}>
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
        color="primary"
        sx={{ mt: 0.5, height: 8, borderRadius: 4 }}
      />
    </Box>
  )
}

/** 分布列表（横向条形）：默认 Top5，可展开显示全部；条形尺度始终按完整 rows 计算。 */
function DistributionList({ title, rows, onItemClick }: {
  title: string
  rows: CountRow[]
  onItemClick?: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  const shown = expanded ? rows : rows.slice(0, 5)
  return (
    <SectionCard
      title={title}
      meta={`${rows.length} 项`}
      level="subsection"
      sx={{ flex: '1 1 320px', minWidth: 280 }}
    >
      {rows.length === 0 && <EmptyState dense title="该维度暂无数据" />}
      <Stack spacing={0.75}>
        {shown.map((r, i) => {
          const key = r.key ?? '（空）'
          return (
            <Box key={`${key}-${i}`}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                {onItemClick ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onItemClick(key)}
                    aria-label={`查看「${key}」的题目`}
                    sx={{
                      p: 0,
                      minWidth: 0,
                      textTransform: 'none',
                      fontWeight: 400,
                      color: 'text.primary',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                    }}
                  >
                    {key}
                  </Button>
                ) : (
                  <Typography variant="body2">{key}</Typography>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {r.count.toLocaleString('zh-CN')}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={(100 * r.count) / max}
                color="primary"
                sx={{ mt: 0.25, height: 6, borderRadius: 3 }}
              />
            </Box>
          )
        })}
      </Stack>
      {rows.length > 5 && (
        <Button size="small" sx={{ mt: 1 }} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? '收起' : `展开全部 ${rows.length} 项`}
        </Button>
      )}
    </SectionCard>
  )
}

/** P8 题库统计页。 */
export default function StatsPage() {
  const navigate = useNavigate()
  const statsQ = useQuery({ queryKey: qk.stats(), queryFn: () => getStats() })

  if (statsQ.isLoading) {
    return (
      <Box>
        <PageHeader level="section" title="题库统计" />
        <LoadingState label="正在加载统计…" />
      </Box>
    )
  }
  if (statsQ.isError) {
    return (
      <Box>
        <PageHeader level="section" title="题库统计" />
        <ErrorState error={statsQ.error} title="加载统计失败" onRetry={() => statsQ.refetch()} />
      </Box>
    )
  }

  const s: StatsData = statsQ.data as StatsData
  const env = s.enrich_coverage
  const ans = s.answer_coverage
  const reviewTotal = s.review?.total ?? 0
  const reviewPct = reviewTotal > 0 ? Math.round((100 * (s.review?.resolved ?? 0)) / reviewTotal) : 0
  const difficultyUnlabeledPct = 100 - (env.difficulty?.pct ?? 0)

  return (
    <Box>
      <PageHeader level="section" title="题库统计" />

      {/* 总览卡：题数 / 来源数 / 待处理数优先，其余为次级数据 */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <StatCard label="题目总数" value={s.questions.toLocaleString('zh-CN')} accent="primary" />
        <StatCard label="来源文件" value={s.sources.toLocaleString('zh-CN')} accent="primary" />
        <StatCard
          label="待复核公式"
          value={s.review_open.toLocaleString('zh-CN')}
          hint={`已处理 ${s.review_resolved.toLocaleString('zh-CN')}`}
          accent="warning"
          action={
            <Button size="small" sx={{ mt: 0.5 }} onClick={() => navigate('/manage/formula-review')}>
              去处理 →
            </Button>
          }
        />
        <StatCard
          label="公式"
          value={s.formulas.toLocaleString('zh-CN')}
          hint={`OK ${s.formulas_ok.toLocaleString('zh-CN')}`}
          accent="success"
        />
        <StatCard label="图片" value={s.images.toLocaleString('zh-CN')} accent="primary" />
        <StatCard label="标签" value={s.labels.toLocaleString('zh-CN')} accent="primary" />
      </Stack>

      <SectionCard title="数据状态" level="subsection" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {/* 覆盖率 */}
          <Box sx={{ flex: '1 1 380px', minWidth: 260 }}>
            <Typography variant="subtitle2" component="h4" gutterBottom>
              元数据 / 内容覆盖率
            </Typography>
            <CoverageRow label="年级" bucket={env.grade} />
            <CoverageRow label="教材" bucket={env.textbook} />
            <CoverageRow label="章节" bucket={env.chapter} />
            <CoverageRow label="题型" bucket={env.qtype} />
            <CoverageRow label={`难度（未标注 ${difficultyUnlabeledPct}%）`} bucket={env.difficulty} />
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
          </Box>

          {/* 复核进度 + 知识点状态 */}
          <Box sx={{ flex: '1 1 380px', minWidth: 260 }}>
            <Typography variant="subtitle2" component="h4" gutterBottom>
              待复核公式清零进度
            </Typography>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                已处理 {s.review?.resolved ?? 0} / 共 {reviewTotal}
              </Typography>
              <Typography variant="body2" fontWeight={500}>
                {reviewPct}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={reviewPct}
              color="success"
              sx={{ mt: 1, height: 8, borderRadius: 4 }}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              {Object.entries(s.review?.by_status ?? {}).map(([k, v]) => (
                <Chip key={k} size="small" color="warning" variant="outlined" label={`${statusText(k)} ${v}`} />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              处理进度仅表示「是否已看过」，不代表公式内容已核对正确。
            </Typography>

            <Typography variant="subtitle2" component="h4" sx={{ mt: 2 }} gutterBottom>
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
          </Box>
        </Stack>
      </SectionCard>

      {/* 各维度分布：默认 Top5，可展开全部 */}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <DistributionList title="题型分布" rows={s.by_qtype} onItemClick={() => navigate('/search')} />
        <DistributionList title="年级分布" rows={s.by_grade} onItemClick={() => navigate('/search')} />
        <DistributionList title="教材分布" rows={s.by_textbook} onItemClick={() => navigate('/search')} />
        <DistributionList title="学段分布" rows={s.by_stage} onItemClick={() => navigate('/search')} />
        <DistributionList title="学科分布" rows={s.by_subject} onItemClick={() => navigate('/search')} />
        <DistributionList
          title="公式状态分布"
          rows={s.formula_status.map((f) => ({ key: statusText(f.status), count: f.count }))}
        />
        <DistributionList title="高频章节" rows={s.top_chapters} onItemClick={() => navigate('/search')} />
      </Stack>
    </Box>
  )
}
