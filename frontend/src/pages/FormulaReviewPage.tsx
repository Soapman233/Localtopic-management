/** P6 待复核公式队列页（PRD P0-15 / P1-12）。
 *
 * 覆盖需求：
 * - P0-15：按状态分 tab（UNSUPPORTED / EMPTY / FAIL）、显示预览、跳转处理；
 * - P1-12：逐条「标记已处理」（回写 ``review_queue.resolved``）；
 * - PRD 5.4：全局「可见但不阻塞」的计数 + 可清零的处理动作 + 已处理/待处理进度。
 *
 * 说明：``review_queue.preview`` 为源 DOCX 包内的预览媒体路径（如 ``media/image17.wmf``），
 * 后端提供源图直链并转换为 PNG；转换失败时显示明确提示与修复入口。
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  LinearProgress,
  Pagination,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReplayIcon from '@mui/icons-material/Replay'
import { useNavigate } from 'react-router-dom'
import { getReviewQueueSummary, listReview, resolveReview } from '../api/review'
import type { ReviewItem } from '../api/types'
import { KatexFormula } from '../components/KatexFormula'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { describeFormulaStatus, isDebugMode } from '../lib/glossary'
import { qk } from '../api/queryKeys'

const PAGE_SIZE = 50

/** 加载失败仍给出处理入口，不把缺失图伪装成可用预览。 */
function ReviewPreview({ item }: { item: ReviewItem }) {
  const [failed, setFailed] = useState(false)
  if (!item.preview_url || failed) return <Alert severity="warning" sx={{ mt: 1 }}>源预览图缺失或无法转换，请打开该题核对来源文件。</Alert>
  return (
    <Box sx={{ mt: 1, p: 1, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box component="img" src={item.preview_url} alt={`公式 ${item.fid ?? ''} 的源预览`}
        loading="lazy" onError={() => setFailed(true)} sx={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
      <Typography variant="caption" color="text.secondary" display="block">
        转换预览可能出现字距或重叠失真；请用 Word 打开来源试卷核对，不能仅凭此图确认公式正确。
      </Typography>
    </Box>
  )
}


/** 状态代码 → 处理提示。 */
const STATUS_HINT: Record<string, string> = {
  UNSUPPORTED: '该公式尚无经核对的自动转换结果，请打开来源试卷核对后，在详情页手工填写 LaTeX。',
  EMPTY: '转换未提取到内容，不代表来源公式为空。请打开来源试卷核对，不要猜测或直接标记已处理。',
  FAIL: '公式转换失败，请对照来源试卷核对内容后，在详情页修正 LaTeX。',
}

/** P6 待复核公式队列页。 */
/** 嵌入维护父页时主标题为 h2；独立使用保留 h1，不改变视觉排版。 */
export default function FormulaReviewPage({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const pageHeading = headingLevel === 1 ? 'h1' : 'h2'
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<string>('UNSUPPORTED')
  const [showResolved, setShowResolved] = useState(false)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const summaryQ = useQuery({
    queryKey: qk.reviewSummary(),
    queryFn: () => getReviewQueueSummary(),
  })

  const listQ = useQuery({
    queryKey: qk.reviewList(tab, showResolved, page),
    queryFn: () =>
      listReview({
        resolved: showResolved,
        status: tab,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  })

  const resolveMut = useMutation({
    mutationFn: ({ rqId, resolved }: { rqId: number; resolved: boolean }) =>
      resolveReview(rqId, resolved),
    onSuccess: (res) => {
      setToast({ kind: 'success', text: res.resolved ? '已标记为已处理' : '已恢复为待处理' })
      qc.invalidateQueries({ queryKey: qk.reviewRoot() })
      qc.invalidateQueries({ queryKey: qk.stats() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
    },
    onError: (err) => setToast({ kind: 'error', text: `操作失败：${(err as Error).message}` }),
  })

  const summary = summaryQ.data
  const byStatus = summary?.by_status ?? {}
  const total = summary?.total ?? 0
  const resolvedPct = total > 0 ? Math.round((100 * (summary?.resolved ?? 0)) / total) : 0

  const tabs = useMemo(
    () => [
      { key: 'UNSUPPORTED', count: byStatus.UNSUPPORTED ?? 0 },
      { key: 'EMPTY', count: byStatus.EMPTY ?? 0 },
      { key: 'FAIL', count: byStatus.FAIL ?? 0 },
    ],
    [byStatus],
  )

  const items = listQ.data?.items ?? []
  const itemTotal = listQ.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(itemTotal / PAGE_SIZE))

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" component={pageHeading}>待复核公式队列</Typography>
        <Chip size="small" color="warning" label={`待处理 ${(summary?.open ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" color="success" variant="outlined" label={`已处理 ${(summary?.resolved ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" variant="outlined" label={`总计 ${total.toLocaleString('zh-CN')}`} />
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        待核对公式<strong>可见但不阻塞</strong>主链路：它影响公式正确性（报告定为「中」级），
        请逐条核对后处理，无法确认的项目保持待处理；三类转换状态分标签页呈现。
      </Alert>

      {/* 处理进度不代表内容核对通过 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color="text.secondary">
            处理进度：已处理 {summary?.resolved ?? 0} / 共 {total}
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {resolvedPct}%
          </Typography>
        </Stack>
        <LinearProgress variant="determinate" value={resolvedPct} sx={{ mt: 1, height: 8, borderRadius: 4 }} />
      </Paper>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Tabs aria-label="公式复核状态" value={tab} onChange={(_e, v) => { setTab(v); setPage(1) }}>
            {tabs.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                label={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <span>{describeFormulaStatus(t.key)}</span>
                    <Chip size="small" label={t.count} color={tab === t.key ? 'warning' : 'default'} />
                  </Stack>
                }
              />
            ))}
          </Tabs>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={
              <Switch
                checked={showResolved}
                onChange={(e) => { setShowResolved(e.target.checked); setPage(1) }}
              />
            }
            label="显示已处理"
          />
        </Stack>

        {tab && STATUS_HINT[tab] && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {describeFormulaStatus(tab)}：{STATUS_HINT[tab]}
          </Alert>
        )}

        {listQ.isLoading && <LoadingState label="正在加载复核队列…" />}
        {listQ.isError && (
          <ErrorState error={listQ.error} title="加载队列失败" onRetry={() => listQ.refetch()} />
        )}
        {!listQ.isLoading && !listQ.isError && items.length === 0 && (
          <EmptyState
            icon={<CheckCircleOutlineIcon sx={{ fontSize: 44 }} color="success" />}
            title={showResolved ? '暂无已处理项' : '队列已清零'}
            description={
              showResolved
                ? '还没有被标记为已处理的复核项。'
                : '该状态下没有待处理项，公式队列已清零。'
            }
          />
        )}

        <Stack divider={<Divider flexItem />} spacing={0}>
          {items.map((it: ReviewItem) => (
            <Box key={it.id} sx={{ py: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  color={it.resolved ? 'success' : 'warning'}
                  label={describeFormulaStatus(it.status)}
                />
                {it.resolved === 1 && <Chip size="small" variant="outlined" label="已处理" />}
                <Chip
                  size="small"
                  variant="outlined"
                  label={`题 ${it.number ?? it.question_id}`}
                  onClick={() => it.question_id && navigate(`/question/${it.question_id}`)}
                  sx={{ cursor: it.question_id ? 'pointer' : 'default' }}
                />
                {isDebugMode() && it.kind && <Chip size="small" variant="outlined" label={`kind: ${it.kind}`} />}
                {it.chapter && <Chip size="small" variant="outlined" label={`章节 ${it.chapter}`} />}
                <Box sx={{ flex: 1 }} />
                {it.question_id && (
                  <Button
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    onClick={() => navigate(`/question/${it.question_id}`)}
                  >
                    跳到该题修公式
                  </Button>
                )}
                {it.resolved ? (
                  <Button
                    size="small"
                    startIcon={<ReplayIcon />}
                    disabled={resolveMut.isPending}
                    onClick={() => resolveMut.mutate({ rqId: it.id, resolved: false })}
                  >
                    恢复待处理
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<CheckIcon />}
                    disabled={resolveMut.isPending}
                    onClick={() => resolveMut.mutate({ rqId: it.id, resolved: true })}
                  >
                    标记已处理
                  </Button>
                )}
              </Stack>

              <Stack direction="row" spacing={2} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary">
                  来源：{it.file_name ?? '（未知）'}
                </Typography>
                {isDebugMode() && it.reason && (
                  <Typography variant="caption" color="text.secondary">
                    原因：{it.reason}
                  </Typography>
                )}
                {isDebugMode() && it.part && (
                  <Typography variant="caption" color="text.secondary">
                    部件：{it.part}
                  </Typography>
                )}
              </Stack>

              <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                题干：{it.question_text || '（题干缺失）'}
              </Typography>
              {it.latex && <Box sx={{ mt: 1 }}>当前公式 {it.fid}：<KatexFormula latex={it.latex} /></Box>}
              <ReviewPreview key={`${it.id}:${it.preview_url}`} item={it} />
            </Box>
          ))}
        </Stack>

        {pageCount > 1 && (
          <Stack alignItems="center" sx={{ mt: 2 }}>
            <Pagination page={page} count={pageCount} onChange={(_e, p) => setPage(p)} color="primary" />
          </Stack>
        )}
      </Paper>
    </Box>
  )
}
