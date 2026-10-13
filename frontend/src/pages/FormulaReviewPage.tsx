/** P6 待复核公式队列页（PRD P0-15 / P1-12）。
 *
 * 覆盖需求：
 * - P0-15：按状态分 tab（UNSUPPORTED / EMPTY / FAIL）、显示预览、跳转处理；
 * - P1-12：逐条「标记已处理」（回写 ``review_queue.resolved``）；
 * - PRD 5.4：全局「可见但不阻塞」的计数 + 可清零的处理动作 + 已处理/待处理进度。
 *
 * 说明：``review_queue.preview`` 为源 DOCX 包内的预览媒体路径（如 ``media/image17.wmf``），
 * 后端提供源图直链并转换为 PNG；转换失败时显示明确提示与修复入口。
 *
 * B4 渐进披露（方案 §3.6）：本页作为「数据维护」Tab 子页嵌入。
 * - 标题层级：父页 h1（`DataMaintenancePage`）；本页标题 `PageHeader level="section"` → h2；内部区块 h3。
 * - 计数与处理进度合成一行；左侧短列表 + 右侧当前项详情，仅挂载当前详情。
 * - 当前项题干默认四行，可按需展开完整文本。
 * - kind / part / 原始技术原因进入调试折叠层；标记已处理与「内容正确」分开表达。
 * - 取数、resolve 提交逻辑一律不变。
 *
 * 移动端（<md，实测 390px 视口）：左右双栏改为**上下堆叠**（左栏此前固定 300px，
 * 右栏被压到 ~10px 并撑宽文档）；内层状态 Tab 加 `scrollable` 防溢出。
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReplayIcon from '@mui/icons-material/Replay'
import { useNavigate } from 'react-router-dom'
import { getReviewQueueSummary, listReview, resolveReview } from '../api/review'
import type { ReviewItem } from '../api/types'
import { KatexFormula } from '../components/KatexFormula'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { qk } from '../api/queryKeys'

const PAGE_SIZE = 50

/** 加载失败仍给出处理入口，不把缺失图伪装成可用预览。 */
function ReviewPreview({ item }: { item: ReviewItem }) {
  const [failed, setFailed] = useState(false)
  if (!item.preview_url || failed) return <Alert severity="warning" sx={{ mt: 1 }}>源预览图缺失或无法转换，请打开该题核对来源文件。</Alert>
  return (
    // ⚠️ 这里曾是硬编码 `bgcolor: '#fff'`（设计评审 F1）：容器**不随主题切换**，
    //    深色模式下 `text.secondary` 变浅色、压在白底上 → **白底白字、内容完全不可见**。
    //    改用语义槽 `background.paper`：浅色下仍是纯白（观感不变），深色下随主题变深，
    //    容器内的预览图（自带底色的 PNG）与说明文字都保持可读。
    <Box sx={{ mt: 1, p: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box component="img" src={item.preview_url} alt={`公式 ${item.fid ?? ''} 的源预览`}
        loading="lazy" onError={() => setFailed(true)} sx={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
      <Typography variant="caption" color="text.secondary" display="block">
        转换预览可能出现字距或重叠失真；请用 Word 打开来源试卷核对，不能仅凭此图确认公式正确。
      </Typography>
    </Box>
  )
}

/** 状态代码 → 中文说明（三类原因处理方式不同，见 PRD 5.4）。 */
const STATUS_LABEL: Record<string, string> = {
  UNSUPPORTED: '不支持',
  EMPTY: '未提取到内容',
  FAIL: '转换失败',
}

/** 状态代码 → 处理提示。 */
const STATUS_HINT: Record<string, string> = {
  UNSUPPORTED: '该公式尚无经核对的自动转换结果，请打开来源试卷核对后，在详情页手工填写 LaTeX。',
  EMPTY: '转换未提取到内容，不代表来源公式为空。请打开来源试卷核对，不要猜测或直接标记已处理。',
  FAIL: '公式转换失败，请对照来源试卷核对内容后，在详情页修正 LaTeX。',
}

/** 当前复核项详情（仅挂载当前项；技术字段收进调试折叠层）。 */
function ReviewDetail({
  item,
  onJump,
  onResolve,
  resolving,
}: {
  item: ReviewItem
  onJump: (questionId: number) => void
  onResolve: (rqId: number, resolved: boolean) => void
  resolving: boolean
}) {
  const [textExpanded, setTextExpanded] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const questionText = item.question_text || '（题干缺失）'
  const canExpand = questionText.length > 100

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          color={item.resolved ? 'success' : 'warning'}
          label={STATUS_LABEL[item.status ?? ''] ?? item.status ?? '未知'}
        />
        {item.resolved === 1 && <Chip size="small" variant="outlined" label="已处理" />}
        <Chip
          size="small"
          variant="outlined"
          label={`题 ${item.number ?? item.question_id}`}
          onClick={() => item.question_id && onJump(item.question_id)}
          sx={{ cursor: item.question_id ? 'pointer' : 'default' }}
        />
        {item.chapter && <Chip size="small" variant="outlined" label={`章节 ${item.chapter}`} />}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        来源：{item.file_name ?? '（未知）'}
      </Typography>

      <SectionCard variant="plain" level="subsection" title="题干" sx={{ mt: 1.5 }}>
        <Typography
          variant="body2"
          sx={
            textExpanded
              ? { whiteSpace: 'pre-wrap' }
              : {
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  whiteSpace: 'pre-wrap',
                }
          }
        >
          {questionText}
        </Typography>
        {canExpand && (
          <Button size="small" onClick={() => setTextExpanded((v) => !v)} aria-expanded={textExpanded}>
            {textExpanded ? '收起题干' : '展开完整题干'}
          </Button>
        )}
      </SectionCard>

      {item.latex && (
        <SectionCard variant="plain" level="subsection" title={`当前公式 ${item.fid}`} sx={{ mt: 1 }}>
          <KatexFormula latex={item.latex} />
        </SectionCard>
      )}
      <ReviewPreview key={`${item.id}:${item.preview_url}`} item={item} />

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
        {item.question_id && (
          <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => onJump(item.question_id as number)}>
            跳到该题修公式
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {item.resolved ? (
          <Button
            size="small"
            startIcon={<ReplayIcon />}
            disabled={resolving}
            onClick={() => onResolve(item.id, false)}
          >
            恢复待处理
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            startIcon={<CheckIcon />}
            disabled={resolving}
            onClick={() => onResolve(item.id, true)}
          >
            标记已处理
          </Button>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        「标记已处理」仅表示已看过该项，不代表公式内容已核对正确。
      </Typography>

      <Accordion
        expanded={debugOpen}
        onChange={(_e, v) => setDebugOpen(v)}
        disableGutters
        elevation={0}
        sx={{ mt: 1, bgcolor: 'transparent', '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 0 }}>
          <Typography variant="caption" color="text.secondary">
            技术信息（调试）
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <Stack spacing={0.5}>
            {item.fid && <Typography variant="caption" color="text.secondary">fid：{item.fid}</Typography>}
            {item.kind && <Typography variant="caption" color="text.secondary">kind：{item.kind}</Typography>}
            {item.part && <Typography variant="caption" color="text.secondary">部件：{item.part}</Typography>}
            {item.reason && <Typography variant="caption" color="text.secondary">原因：{item.reason}</Typography>}
            {!item.fid && !item.kind && !item.part && !item.reason && (
              <Typography variant="caption" color="text.secondary">无附加技术字段。</Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Paper>
  )
}

/** P6 待复核公式队列页。 */
export default function FormulaReviewPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<string>('UNSUPPORTED')
  const [showResolved, setShowResolved] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
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

  // 当前详情由「选中项」派生：切 tab / 分页 / 已处理开关时清理失效选中，避免旧详情串用。
  const current = items.find((i) => i.id === selectedId) ?? items[0] ?? null

  /** 切换筛选条件时清空选中，让详情回落到新列表首项。 */
  const resetSelection = () => setSelectedId(null)

  const allEmpty = total === 0
  const emptyTitle = showResolved
    ? '暂无已处理项'
    : allEmpty
      ? '队列已清零'
      : '该分类暂无待处理项'
  const emptyDescription = showResolved
    ? '还没有被标记为已处理的复核项。'
    : allEmpty
      ? '该状态下没有待处理项，公式队列已清零。'
      : '该分类下没有待处理项，可切换到其他分类查看。'

  return (
    <Box>
      <PageHeader
        level="section"
        title="待复核公式队列"
        meta={
          <>
            <Chip size="small" color="warning" label={`待处理 ${(summary?.open ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" color="success" variant="outlined" label={`已处理 ${(summary?.resolved ?? 0).toLocaleString('zh-CN')}`} />
            <Chip size="small" variant="outlined" label={`总计 ${total.toLocaleString('zh-CN')}`} />
          </>
        }
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        处理进度 {resolvedPct}%（{summary?.resolved ?? 0}/{total}）
      </Typography>
      <LinearProgress
        variant="determinate"
        value={resolvedPct}
        color="success"
        sx={{ mb: 0.5, height: 8, borderRadius: 4 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        非 OK 公式「可见但不阻塞」主链路；处理进度仅表示已看过，不代表公式内容已核对正确。
      </Typography>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          {/* 内层状态 Tab 也须可横向滚动：3 个 Tab + 右侧开关在 390px 下排不下时，
              滚动而非撑宽文档。`minWidth: 0` 允许它收缩（否则 flex 项按内容宽撑开）。 */}
          <Tabs
            value={tab}
            onChange={(_e, v) => { setTab(v); setPage(1); resetSelection() }}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ minWidth: 0, flex: '1 1 auto' }}
          >
            {tabs.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                label={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <span>{STATUS_LABEL[t.key] ?? t.key}</span>
                    {/*
                      ⚠️ 2026-10-13（R07 = ③ / 规范 §2.1 铁律 2）：**选中态原为 `color="warning"`**——
                      但 `t.count` 是**纯中性计数**（如「不支持 130」），而 `warning` 表达的是
                      「需要立刻注意的状态」。**借用状态色表达「选中」会让真正的警告脱敏**
                      （老师会学会忽略橙色）。选中是**选择态**，语义色应为 `primary`。
                      🔴 这一处是**门禁③ 抓出来的**：我先手工读代码判定「剩下 5 处全是真状态、
                      无需再改」，**漏了它**——规则比人工清点可靠。
                    */}
                    <Chip size="small" label={t.count} color={tab === t.key ? 'primary' : 'default'} />
                  </Stack>
                }
              />
            ))}
          </Tabs>
          <FormControlLabel
            sx={{ flexShrink: 0 }}
            control={
              <Switch
                checked={showResolved}
                onChange={(e) => { setShowResolved(e.target.checked); setPage(1); resetSelection() }}
              />
            }
            label="显示已处理"
          />
        </Stack>

        {tab && STATUS_HINT[tab] && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {STATUS_LABEL[tab]}：{STATUS_HINT[tab]}
          </Alert>
        )}

        {listQ.isLoading && <LoadingState label="正在加载复核队列…" />}
        {listQ.isError && (
          <ErrorState error={listQ.error} title="加载队列失败" onRetry={() => listQ.refetch()} />
        )}
        {!listQ.isLoading && !listQ.isError && items.length === 0 && (
          <EmptyState
            icon={<CheckCircleOutlineIcon sx={{ fontSize: 44 }} color="success" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        )}

        {!listQ.isLoading && !listQ.isError && items.length > 0 && (
          // 窄屏上下堆叠、宽屏左右分栏（移动端缺陷修复：右栏不再被压成窄条）。
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', md: 'flex-start' }}
          >
            {/* 左：短列表 */}
            <Paper variant="outlined" sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, maxHeight: { xs: '50vh', md: '68vh' }, display: 'flex', flexDirection: 'column' }}>
              <List dense sx={{ overflow: 'auto', flex: 1 }}>
                {items.map((it: ReviewItem) => (
                  <ListItemButton
                    key={it.id}
                    selected={current?.id === it.id}
                    onClick={() => setSelectedId(it.id)}
                    sx={{ py: 1 }}
                  >
                    <ListItemText primary={`题 ${it.number ?? it.question_id ?? '—'}`} />
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                      <Chip
                        size="small"
                        color={it.resolved ? 'success' : 'warning'}
                        label={STATUS_LABEL[it.status ?? ''] ?? it.status ?? '未知'}
                      />
                      {it.resolved === 1 && <Chip size="small" variant="outlined" label="已处理" />}
                    </Stack>
                  </ListItemButton>
                ))}
              </List>
            </Paper>

            {/* 右：当前项详情（仅挂载当前项） */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {current && (
                <ReviewDetail
                  key={current.id}
                  item={current}
                  onJump={(qid) => navigate(`/question/${qid}`)}
                  onResolve={(rqId, resolved) => resolveMut.mutate({ rqId, resolved })}
                  resolving={resolveMut.isPending}
                />
              )}
            </Box>
          </Stack>
        )}

        {pageCount > 1 && (
          <Stack alignItems="center" sx={{ mt: 2 }}>
            <Pagination
              page={page}
              count={pageCount}
              onChange={(_e, p) => { setPage(p); resetSelection() }}
              color="primary"
            />
          </Stack>
        )}
      </Paper>
    </Box>
  )
}
