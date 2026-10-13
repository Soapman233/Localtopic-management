/** P6 待复核公式队列页（PRD P0-15 / P1-12）。
 *
 * 覆盖需求：
 * - P0-15：按状态分 tab（UNSUPPORTED / EMPTY / FAIL）、显示预览、跳转处理；
 * - P1-12：逐条「标记已处理」（回写 ``review_queue.resolved``）；
 * - PRD 5.4：全局「可见但不阻塞」的计数 + 可清零的处理动作 + 已处理/待处理进度。
 *
 * B4-2 重构（内容优先的工具型极简）：
 * - 计数与处理进度**合成一行**（去掉独立进度卡与两条大 Alert）；
 * - 改为**左侧短列表 + 右侧当前项详情**，**只挂载当前详情**（50 个长卡 → 1 个详情）；
 * - 当前项题干默认 **4 行**，按钮展开完整文本；
 * - ``kind`` / ``part`` / 原始技术原因收进 **debug 折叠层**；
 * - 「标记已处理」与「内容正确」**分开表达**（处理进度 ≠ 正确率）；
 * - 单一状态为空只写「该分类暂无待处理项」，**不宣称全队列清零**。
 *
 * ⚠️ 风险边界：不能凭 PNG 标记内容正确；保留源图失真提醒与 EMPTY 的
 * 「未提取不等于来源为空」；切状态 / 翻页 / 已处理切换时**清理失效选中项**，避免旧图串用。
 *
 * 说明：``review_queue.preview`` 为源 DOCX 包内的预览媒体路径（如 ``media/image17.wmf``），
 * 后端提供源图直链并转换为 PNG；转换失败时显示明确提示与修复入口。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  Pagination,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ListAltIcon from '@mui/icons-material/ListAlt'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReplayIcon from '@mui/icons-material/Replay'
import { useAppNavigate } from '../hooks/useAppNavigate'
import { getReviewQueueSummary, listReview, resolveReview } from '../api/review'
import type { ReviewItem } from '../api/types'
import { KatexFormula } from '../components/KatexFormula'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { describeFormulaStatus, describeTechnicalInfo, isDebugMode } from '../lib/glossary'
import { stripAnswerSections } from '../lib/questionText'
import { usePermission } from '../hooks/usePermission'
import { describeDenied } from '../lib/permissions'
import { qk } from '../api/queryKeys'

const PAGE_SIZE = 50
/** 题干折叠阈值：超过该长度才显示「展开全文」。 */
const TEXT_CLAMP_CHARS = 80

/** 只读态包装（§3.2/§4.2）：无权限时用 Tooltip 说明「为什么不能操作」，
 *  有权限时**原样返回子元素**（DOM 与布局零变化）。⚠️ 子元素须自行 `disabled`。 */
function hint(node: ReactElement, reason?: string): ReactElement {
  return reason == null ? node : (
    <Tooltip title={reason}>
      <span style={{ display: 'inline-flex' }}>{node}</span>
    </Tooltip>
  )
}

/** 加载失败仍给出处理入口，不把缺失图伪装成可用预览。 */
function ReviewPreview({ item }: { item: ReviewItem }) {
  const [failed, setFailed] = useState(false)
  if (!item.preview_url || failed) return <Alert severity="warning" sx={{ mt: 1 }}>源预览图缺失或无法转换，请打开该题核对来源文件。</Alert>
  // P0/T01：原 `bgcolor: '#fff'` 是硬编码浅底，深色模式下 `text.secondary`（白）压白底
  // → 对比度 1:1、文字完全不可见。改用语义槽位 `background.paper`：
  // 浅色模式仍是白（与改前逐像素一致），深色模式随主题变 `#1E1E1E`，caption 恢复可读。
  return (
    <Box sx={{ mt: 1, p: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box component="img" src={item.preview_url} alt={`公式 ${item.fid ?? ''} 的源预览`}
        loading="lazy" onError={() => setFailed(true)} sx={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
      <Typography variant="caption" color="text.secondary" display="block">
        转换预览可能出现字距或重叠失真；请用 Word 打开来源试卷核对，不能仅凭此图确认公式正确。
      </Typography>
    </Box>
  )
}

/** 状态代码 → 处理提示（当前项详情内就地呈现，不占全局横幅）。 */
const STATUS_HINT: Record<string, string> = {
  UNSUPPORTED: '该公式尚无经核对的自动转换结果，请打开来源试卷核对后，在详情页手工填写 LaTeX。',
  EMPTY: '转换未提取到内容，不代表来源公式为空。请打开来源试卷核对，不要猜测或直接标记已处理。',
  FAIL: '公式转换失败，请对照来源试卷核对内容后，在详情页修正 LaTeX。',
}

/** P6 待复核公式队列页。 */
/** 嵌入维护父页时主标题为 h2；独立使用保留 h1，不改变视觉排版。 */
export default function FormulaReviewPage({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const pageHeading = headingLevel === 1 ? 'h1' : 'h2'
  const navigate = useAppNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<string>('UNSUPPORTED')
  const [showResolved, setShowResolved] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showFullText, setShowFullText] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // T24c 响应式（规范 §2.8 断点）：`<lg`（<1200px）时左侧短列表折叠为抽屉（默认关闭），
  // 右侧当前项详情独占整宽；`≥1200px` 保持「左列表 + 右详情」双栏。
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))
  const [listOpen, setListOpen] = useState(false)

  // T25 只读态：只读账号无 `governance.review` → 「标记已处理 / 恢复待处理」不可用并说明原因。
  const canReview = usePermission('governance.review')
  const reviewDenied = canReview ? undefined : describeDenied('governance.review')

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

  const tabs = [
    { key: 'UNSUPPORTED', count: byStatus.UNSUPPORTED ?? 0 },
    { key: 'EMPTY', count: byStatus.EMPTY ?? 0 },
    { key: 'FAIL', count: byStatus.FAIL ?? 0 },
  ]

  const items = listQ.data?.items ?? []
  const itemTotal = listQ.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(itemTotal / PAGE_SIZE))

  // 选中项失效即清理：翻页 / 切状态 / 已处理切换后，旧的正文 / fid / 源图不再残留。
  // 列表非空且当前无有效选中时，自动聚焦第一条（避免右侧长期空白）。
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!items.some((it) => it.id === selectedId)) setSelectedId(items[0].id)
  }, [items, selectedId])

  // 切换上下文时重置展开态，避免上一条的展开状态串到新项。
  useEffect(() => {
    setShowFullText(false)
  }, [selectedId])

  const current = items.find((it) => it.id === selectedId) ?? null
  // T05：复核项的题干同样来自 `questions.text`，可能内嵌 `【答案】/【详解】…`；
  // 这里是**题干区**，只展示「题干 + 选项」，答案/解析不属于本页职责。
  const currentText = stripAnswerSections(current?.question_text ?? '')
  const canExpandText = currentText.length > TEXT_CLAMP_CHARS

  /** 切换状态 / 已处理开关 / 翻页时清空选中，保证不串用旧详情。 */
  const resetSelection = () => setSelectedId(null)

  // 左栏短列表：宽屏内联定宽 300；窄屏放进抽屉（T24c），宽度铺满抽屉。
  // 抽成变量避免重复 JSX——同一时刻只渲染其中一个分支。
  const listPanel = (
    <Paper
      variant="outlined"
      sx={{
        width: narrow ? '100%' : 300,
        flexShrink: 0,
        maxHeight: narrow ? 'none' : '68vh',
        display: 'flex',
        flexDirection: 'column',
        // 窄屏放进抽屉（flex 列）时占满剩余高度，让内层 List 自身滚动。
        ...(narrow ? { flexGrow: 1, minHeight: 0 } : {}),
      }}
    >
      <List dense sx={{ overflow: 'auto', flex: 1, py: 0 }}>
        {items.map((it: ReviewItem) => (
          <ListItemButton
            key={it.id}
            selected={it.id === selectedId}
            // 窄屏（抽屉内）选中后自动收起抽屉，直接露出右侧详情。
            onClick={() => {
              setSelectedId(it.id)
              if (narrow) setListOpen(false)
            }}
          >
            <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                {/* T04：**不再逐行渲染状态徽章**——列表已按状态 tab 过滤，130 行会堆叠出
                    130 个同值橙色「不支持」徽章（F3 实测）。状态由当前 tab 与右侧详情表达。
                    只保留「已处理」标记，用于区分同一 tab 内是否已核对。 */}
                {it.resolved === 1 && <Chip size="small" variant="outlined" label="已处理" />}
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                题 {it.number ?? it.question_id ?? '—'}
                {it.chapter ? ` · ${it.chapter}` : ''}
              </Typography>
            </Stack>
          </ListItemButton>
        ))}
      </List>
    </Paper>
  )

  return (
    <Box>
      {/* 计数与处理进度合成一行 */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" component={pageHeading}>待复核公式队列</Typography>
        <Typography variant="body2" color="text.secondary">
          待处理 <strong>{(summary?.open ?? 0).toLocaleString('zh-CN')}</strong>
          {' · '}已处理 {(summary?.resolved ?? 0).toLocaleString('zh-CN')}
          {' · '}共 {total.toLocaleString('zh-CN')}
          {' · '}处理进度 {resolvedPct}%
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={resolvedPct} sx={{ mb: 1, height: 6, borderRadius: 3 }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        待核对公式<strong>可见但不阻塞</strong>主链路；「处理进度」只表示已核对动作的比例，<strong>不代表公式内容正确</strong>。
      </Typography>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Tabs aria-label="公式复核状态" value={tab} onChange={(_e, v) => { setTab(v); setPage(1); resetSelection() }}>
            {tabs.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                label={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <span>{describeFormulaStatus(t.key)}</span>
                    {/* T04：这是**计数**不是状态 → 中性描边，不再把未选中的 tab 计数染成警告橙
                        （选中态由 Tabs 自身的指示条表达）。 */}
                    <Chip size="small" variant="outlined" label={t.count} />
                  </Stack>
                }
              />
            ))}
          </Tabs>
          <Box sx={{ flex: 1 }} />
          {/* T24c：窄屏（<1200px）下左列表收进抽屉，用此按钮开合（规范 §2.8）。 */}
          {narrow && (
            <Button
              variant="outlined"
              startIcon={<ListAltIcon />}
              onClick={() => setListOpen(true)}
              data-testid="open-review-list"
              aria-expanded={listOpen}
              aria-controls="formula-review-list-drawer"
            >
              待处理列表
            </Button>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={showResolved}
                onChange={(e) => { setShowResolved(e.target.checked); setPage(1); resetSelection() }}
              />
            }
            label="显示已处理"
          />
        </Stack>

        {listQ.isLoading && <LoadingState label="正在加载复核队列…" />}
        {listQ.isError && (
          <ErrorState error={listQ.error} title="加载队列失败" onRetry={() => listQ.refetch()} />
        )}
        {!listQ.isLoading && !listQ.isError && items.length === 0 && (
          <EmptyState
            icon={<CheckCircleOutlineIcon sx={{ fontSize: 44 }} color="success" />}
            title={showResolved ? '暂无已处理项' : '该分类暂无待处理项'}
            description={
              showResolved
                ? '还没有被标记为已处理的复核项。'
                : '该状态下没有待处理项；其他状态或「显示已处理」中可能仍有记录。'
            }
          />
        )}

        {!listQ.isLoading && !listQ.isError && items.length > 0 && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            {/* 左：短列表——宽屏内联（T24c：窄屏折叠为抽屉，见文件末尾）。 */}
            {!narrow && listPanel}

            {/* 右：当前项详情（只挂载当前项） */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {current && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" color={current.resolved ? 'success' : 'warning'} label={describeFormulaStatus(current.status)} />
                    {current.resolved === 1 && <Chip size="small" variant="outlined" label="已处理" />}
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`题 ${current.number ?? current.question_id ?? '—'}`}
                      onClick={() => current.question_id && navigate(`/question/${current.question_id}`)}
                      sx={{ cursor: current.question_id ? 'pointer' : 'default' }}
                    />
                    {current.chapter && <Chip size="small" variant="outlined" label={`章节 ${current.chapter}`} />}
                    <Box sx={{ flex: 1 }} />
                    {current.question_id && (
                      <Button
                        size="small"
                        startIcon={<OpenInNewIcon />}
                        onClick={() => navigate(`/question/${current.question_id}`)}
                      >
                        跳到该题修公式
                      </Button>
                    )}
                    {current.resolved ? (
                      hint(
                        <Button
                          size="small"
                          startIcon={<ReplayIcon />}
                          disabled={!canReview || resolveMut.isPending}
                          onClick={() => resolveMut.mutate({ rqId: current.id, resolved: false })}
                        >
                          恢复待处理
                        </Button>,
                        reviewDenied,
                      )
                    ) : (
                      hint(
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<CheckIcon />}
                          disabled={!canReview || resolveMut.isPending}
                          onClick={() => resolveMut.mutate({ rqId: current.id, resolved: true })}
                        >
                          标记已处理
                        </Button>,
                        reviewDenied,
                      )
                    )}
                  </Stack>

                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    来源：{current.file_name ?? '（未知）'}
                  </Typography>

                  {/* 处理提示（当前状态就地呈现） */}
                  {current.status && STATUS_HINT[current.status] && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {describeFormulaStatus(current.status)}：{STATUS_HINT[current.status]}
                    </Alert>
                  )}

                  <Typography
                    variant="body2"
                    sx={{
                      mt: 1,
                      whiteSpace: 'pre-wrap',
                      ...(showFullText || !canExpandText
                        ? {}
                        : {
                            display: '-webkit-box',
                            WebkitLineClamp: 4,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }),
                    }}
                  >
                    题干：{currentText || '（题干缺失）'}
                  </Typography>
                  {canExpandText && (
                    <Button size="small" sx={{ mt: 0.5 }} onClick={() => setShowFullText((v) => !v)}>
                      {showFullText ? '收起全文' : '展开全文'}
                    </Button>
                  )}

                  {current.latex && (
                    <Box sx={{ mt: 1 }}>
                      当前公式 {current.fid}：<KatexFormula latex={current.latex} />
                    </Box>
                  )}
                  <ReviewPreview key={`${current.id}:${current.preview_url}`} item={current} />

                  {/* 标记已处理 ≠ 内容正确：把两条语义分开表达 */}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    「标记已处理」只记录本次核对动作，<strong>不代表公式内容已被确认正确</strong>；内容判定仍需对照来源试卷。
                  </Typography>

                  {/* debug 折叠层：kind / part / 原始技术原因 */}
                  {isDebugMode() && (
                    <Box component="details" sx={{ mt: 1 }}>
                      <Box component="summary" sx={{ cursor: 'pointer', fontSize: 12, color: 'text.secondary' }}>
                        {describeTechnicalInfo()}
                      </Box>
                      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                        {current.kind && (
                          <Typography variant="caption" color="text.secondary">kind: {current.kind}</Typography>
                        )}
                        {current.part && (
                          <Typography variant="caption" color="text.secondary">part: {current.part}</Typography>
                        )}
                        {current.reason && (
                          <Typography variant="caption" color="text.secondary">原因：{current.reason}</Typography>
                        )}
                      </Stack>
                    </Box>
                  )}
                </Paper>
              )}
            </Box>
          </Box>
        )}

        {pageCount > 1 && (
          <Stack alignItems="center" sx={{ mt: 2 }}>
            <Pagination page={page} count={pageCount} onChange={(_e, p) => { setPage(p); resetSelection() }} color="primary" />
          </Stack>
        )}
      </Paper>

      {/* T24c：窄屏（<1200px）左列表折叠为左侧抽屉（规范 §2.8）。默认关闭，由顶部「待处理列表」按钮打开；
          选中一项后自动收起，露出右侧详情。 */}
      {narrow && (
        <Drawer
          anchor="left"
          open={listOpen}
          onClose={() => setListOpen(false)}
          PaperProps={{ role: 'dialog', 'aria-labelledby': 'formula-review-list-drawer-title' }}
        >
          <Box id="formula-review-list-drawer" sx={{ width: 320, p: 1.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* ⚠️ 固定顶栏（AppBar）的 zIndex 比 Drawer 高（项目刻意设置），会遮住抽屉顶部；
                按 MUI 惯例放一个 Toolbar 占位（见规范 §2.7）。 */}
            <Toolbar variant="dense" />
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography id="formula-review-list-drawer-title" variant="subtitle1" component="h2" sx={{ flex: 1 }}>
                待处理列表
              </Typography>
              <Button size="small" onClick={() => setListOpen(false)}>关闭</Button>
            </Stack>
            {listPanel}
          </Box>
        </Drawer>
      )}
    </Box>
  )
}
