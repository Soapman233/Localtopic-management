/** P5 知识点复核页（PRD P0-14 / P1-6）。
 *
 * 覆盖需求：
 * - P0-14：按标签汇总（标签名 + 命中题数 + 待复核/已确认/已否决计数）、逐条确认/否决、
 *   导出/导入 CSV（供老师离线填写后读回）；
 * - P1-6：「仅看已确认知识点」严格模式说明（开关在检索页，本页给出说明与入口）；
 * - PRD 5.3：知识点为「提及」口径——必须用大白话 + 反例说明，避免被误当「考查范围」。
 *
 * 关键约束（PRD Q6）：**批量否决/确认必须先显示影响条数并要求二次确认**。本页通过
 * ``/api/labels/decision/preview`` 预检影响条数，再以 ``confirm=true`` 提交。
 *
 * B4 渐进披露（方案 §3.5）：本页作为「数据维护」Tab 子页嵌入。
 * - 标题层级：父页 h1；本页标题 h2；内部区块 h3。
 * - 口径说明默认收成一行 + 「口径说明」折叠；CSV 收进「批量处理」菜单。
 * - 标签按待复核降序，可只看有待复核；未选择时给出待复核最多的前五个标签。
 * - 取数、预检、提交逻辑一律不变。
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import { useNavigate } from 'react-router-dom'
import {
  decideLabel,
  exportReviewUrl,
  getReviewItems,
  getReviewSummary,
  importReviewCsv,
  previewDecision,
} from '../api/labels'
import type { DecisionBody } from '../api/labels'
import type { LabelDecisionPreview, LabelImportResult } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LabelStatusBadge } from '../components/StatusBadges'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { qk } from '../api/queryKeys'

const ITEM_PAGE_SIZE = 50
const STATUS_TABS: { key: string; label: string }[] = [
  { key: '待复核', label: '待复核' },
  { key: '已确认', label: '已确认' },
  { key: '已否决', label: '已否决' },
]

/** P5 知识点复核页。 */
export default function KnowledgeReviewPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [itemStatus, setItemStatus] = useState<string>('待复核')
  const [page, setPage] = useState(1)
  const [labelFilter, setLabelFilter] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [importResult, setImportResult] = useState<LabelImportResult | null>(null)

  // 批量确认状态：先预检影响条数，再二次确认。
  const [batch, setBatch] = useState<{ decision: string; preview: LabelDecisionPreview } | null>(
    null,
  )

  const summaryQ = useQuery({
    queryKey: qk.labelsSummary(),
    queryFn: () => getReviewSummary({ status: null }),
  })

  const itemsQ = useQuery({
    queryKey: qk.labelsItems(selected, itemStatus, page),
    queryFn: () =>
      getReviewItems({
        label_name: selected as string,
        status: itemStatus,
        limit: ITEM_PAGE_SIZE,
        offset: (page - 1) * ITEM_PAGE_SIZE,
      }),
    enabled: Boolean(selected),
  })

  const decideMut = useMutation({
    mutationFn: (body: DecisionBody) => decideLabel(body),
    onSuccess: (res, body) => {
      const verb = body.decision === '否决' ? '否决' : '确认'
      const scope = body.question_id ? '该题该标签' : `标签「${body.label_name}」全部待复核`
      setToast({ kind: 'success', text: `已${verb} ${res.updated} 条（${scope}）` })
      setBatch(null)
      qc.invalidateQueries({ queryKey: qk.labelsRoot() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
      qc.invalidateQueries({ queryKey: qk.facetsRoot() })
    },
    onError: (err) => {
      setToast({ kind: 'error', text: `操作失败：${(err as Error).message}` })
      setBatch(null)
    },
  })

  const importMut = useMutation({
    mutationFn: (file: File) => importReviewCsv(file, false),
    onSuccess: (res) => {
      setImportResult(res)
      setToast({
        kind: res.errors.length > 0 ? 'error' : 'success',
        text: `CSV 导入完成：共 ${res.total} 行，应用 ${res.applied}，跳过 ${res.skipped}`,
      })
      qc.invalidateQueries({ queryKey: qk.labelsRoot() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
    },
    onError: (err) => setToast({ kind: 'error', text: `CSV 导入失败：${(err as Error).message}` }),
  })

  const counts = summaryQ.data?.counts ?? {}
  // 标签按待复核降序；可只看「有待复核」。
  const labels = useMemo(() => {
    const all = summaryQ.data?.summary ?? []
    const kw = labelFilter.trim()
    const filtered = kw ? all.filter((l) => l.label_name.includes(kw)) : all
    const sorted = [...filtered].sort((a, b) => b.pending - a.pending)
    return onlyPending ? sorted.filter((l) => l.pending > 0) : sorted
  }, [summaryQ.data, labelFilter, onlyPending])

  // 未选择标签时给出「待复核最多」的前五个，点击直接进入。
  const topPending = useMemo(
    () =>
      [...(summaryQ.data?.summary ?? [])]
        .filter((l) => l.pending > 0)
        .sort((a, b) => b.pending - a.pending)
        .slice(0, 5),
    [summaryQ.data],
  )

  /** 打开批量确认：先预检影响条数（只读，不写库）。 */
  const openBatch = async (decision: string) => {
    if (!selected) return
    try {
      const pv = await previewDecision({ label_name: selected, decision })
      setBatch({ decision, preview: pv })
    } catch (err) {
      setToast({ kind: 'error', text: `预检失败：${(err as Error).message}` })
    }
  }

  const selectedRow = summaryQ.data?.summary.find((l) => l.label_name === selected)
  const itemTotal = itemsQ.data?.total ?? 0
  const itemPageCount = Math.max(1, Math.ceil(itemTotal / ITEM_PAGE_SIZE))

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" component="h2">知识点复核</Typography>
        <Chip size="small" color="warning" variant="outlined" label={`待复核 ${(counts['待复核'] ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" color="success" variant="outlined" label={`已确认 ${(counts['已确认'] ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" label={`已否决 ${(counts['已否决'] ?? 0).toLocaleString('zh-CN')}`} />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileDownloadIcon />}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== null}
        >
          批量处理
        </Button>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            component="a"
            href={exportReviewUrl('待复核')}
            download
            onClick={() => setMenuAnchor(null)}
          >
            导出待复核 CSV
          </MenuItem>
          <MenuItem
            disabled={importMut.isPending}
            onClick={() => {
              setMenuAnchor(null)
              fileRef.current?.click()
            }}
          >
            <FileUploadIcon fontSize="small" style={{ marginRight: 8 }} />
            导入复核 CSV
          </MenuItem>
        </Menu>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          aria-label="选择要导入的复核 CSV 文件"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importMut.mutate(f)
            e.target.value = ''
          }}
        />
      </Stack>

      {/* 口径说明收成一行；详细说明（含严格模式入口）按需展开 */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 220 }}>
          知识点为「提及」口径：题干中出现过的知识词，不代表本题在考查它，可能有误标。
        </Typography>
        <Button
          size="small"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          aria-controls="knowledge-help"
        >
          {helpOpen ? '收起说明' : '口径说明'}
        </Button>
      </Stack>
      <Collapse in={helpOpen} id="knowledge-help">
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" component="div" sx={{ mb: 0.5 }}>
            系统自动识别题干中<strong>出现过</strong>的知识词，<strong>不代表</strong>本题在<strong>考查</strong>它
            （平均 4.26 个/题，可能误标）。例如一道「原子结构」题因选项出现「太阳系」被打上「太阳系」标签。
          </Typography>
          <Typography variant="body2" component="div">
            严格模式「仅看已确认知识点」开关在
            <Button size="small" onClick={() => navigate('/search')}>检索页</Button>
            ，<strong>默认关闭</strong>——否则复核完成前检索不可用。
            当前已确认 {(counts['已确认'] ?? 0).toLocaleString('zh-CN')} / 待复核 {(counts['待复核'] ?? 0).toLocaleString('zh-CN')}。
          </Typography>
        </Alert>
      </Collapse>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}
      {importResult && importResult.errors.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setImportResult(null)}>
          导入跳过 {importResult.skipped} 行，原因（最多 50 条）：
          {importResult.errors.map((e, i) => (
            <div key={i}>· {e}</div>
          ))}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        {/* 左：标签汇总 */}
        <Paper variant="outlined" sx={{ width: 340, flexShrink: 0, maxHeight: '72vh', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 1.5, pb: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="筛选标签名…"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              inputProps={{ 'aria-label': '按标签名筛选' }}
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                共 {labels.length} 个标签（点击查看逐条）
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={onlyPending}
                    onChange={(e) => setOnlyPending(e.target.checked)}
                  />
                }
                label={<Typography variant="caption">仅看有待复核</Typography>}
              />
            </Stack>
          </Box>
          <Divider />
          <List dense sx={{ overflow: 'auto', flex: 1 }}>
            {summaryQ.isLoading && (
              <Box sx={{ p: 2 }}>
                <LoadingState dense label="正在加载标签汇总…" />
              </Box>
            )}
            {summaryQ.isError && (
              <Box sx={{ p: 2 }}>
                <ErrorState
                  dense
                  error={summaryQ.error}
                  title="加载标签汇总失败"
                  onRetry={() => summaryQ.refetch()}
                />
              </Box>
            )}
            {!summaryQ.isLoading && !summaryQ.isError && labels.length === 0 && (
              <Box sx={{ p: 2 }}>
                <EmptyState
                  dense
                  title="没有匹配的标签"
                  description={onlyPending ? '当前没有「有待复核」的标签。' : '换个关键词试试。'}
                  actionLabel={onlyPending ? '显示全部标签' : undefined}
                  onAction={() => setOnlyPending(false)}
                />
              </Box>
            )}
            {labels.map((l) => (
              <ListItemButton
                key={l.label_id}
                selected={selected === l.label_name}
                onClick={() => {
                  setSelected(l.label_name)
                  setPage(1)
                }}
              >
                <ListItemText
                  primary={l.label_name}
                  secondary={`关联 ${l.total.toLocaleString('zh-CN')} 条`}
                />
                <Stack direction="row" spacing={0.5}>
                  {l.pending > 0 && <Chip size="small" color="warning" label={l.pending} />}
                  {l.confirmed > 0 && <Chip size="small" color="success" variant="outlined" label={l.confirmed} />}
                  {l.rejected > 0 && <Chip size="small" label={l.rejected} />}
                </Stack>
              </ListItemButton>
            ))}
          </List>
        </Paper>

        {/* 右：逐条复核 / 未选择时的入口 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" component="h3" gutterBottom>
                待复核最多的标签
              </Typography>
              {topPending.length === 0 ? (
                <EmptyState
                  title="请选择一个知识点标签"
                  description="从左侧选择一个标签，查看其逐条关联并确认 / 否决。"
                />
              ) : (
                <List dense>
                  {topPending.map((l) => (
                    <ListItemButton
                      key={l.label_id}
                      onClick={() => {
                        setSelected(l.label_name)
                        setPage(1)
                      }}
                    >
                      <ListItemText
                        primary={l.label_name}
                        secondary={`关联 ${l.total.toLocaleString('zh-CN')} 条`}
                      />
                      <Chip size="small" color="warning" label={`待复核 ${l.pending}`} />
                    </ListItemButton>
                  ))}
                </List>
              )}
              <Typography variant="caption" color="text.secondary">
                也可从左侧完整列表选择任意标签。
              </Typography>
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1" component="h3" fontWeight={600}>
                  {selected}
                </Typography>
                {selectedRow && (
                  <Typography variant="body2" color="text.secondary">
                    关联 {selectedRow.total} · 待复核 {selectedRow.pending} · 已确认 {selectedRow.confirmed} · 已否决 {selectedRow.rejected}
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  color="success"
                  variant="outlined"
                  startIcon={<CheckCircleOutlineIcon />}
                  disabled={decideMut.isPending}
                  onClick={() => openBatch('确认')}
                >
                  批量确认待复核
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<CancelOutlinedIcon />}
                  disabled={decideMut.isPending}
                  onClick={() => openBatch('否决')}
                >
                  批量否决待复核
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mb: 1 }} role="group" aria-label="逐条复核状态">
                {STATUS_TABS.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    color={itemStatus === t.key ? 'primary' : 'default'}
                    variant={itemStatus === t.key ? 'filled' : 'outlined'}
                    onClick={() => {
                      setItemStatus(t.key)
                      setPage(1)
                    }}
                  />
                ))}
              </Stack>

              {itemsQ.isLoading && <LoadingState label="正在加载逐条清单…" />}
              {itemsQ.isError && (
                <ErrorState
                  error={itemsQ.error}
                  title="加载逐条清单失败"
                  onRetry={() => itemsQ.refetch()}
                />
              )}
              {itemsQ.data && itemsQ.data.items.length === 0 && (
                <EmptyState dense title={`该标签下没有「${itemStatus}」的关联`} />
              )}

              <Stack divider={<Divider flexItem />} spacing={0}>
                {itemsQ.data?.items.map((it) => (
                  <Box key={it.question_id} sx={{ py: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`题 ${it.number ?? it.question_id}`}
                        onClick={() => navigate(`/question/${it.question_id}`)}
                        sx={{ cursor: 'pointer' }}
                      />
                      <LabelStatusBadge status={it.review_status} />
                      {it.source && <Chip size="small" variant="outlined" label={it.source} />}
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        color="success"
                        disabled={decideMut.isPending || it.review_status === '已确认'}
                        onClick={() =>
                          decideMut.mutate({ label_name: selected, decision: '确认', question_id: it.question_id })
                        }
                      >
                        确认
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={decideMut.isPending || it.review_status === '已否决'}
                        onClick={() =>
                          decideMut.mutate({ label_name: selected, decision: '否决', question_id: it.question_id })
                        }
                      >
                        否决
                      </Button>
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, cursor: 'pointer' }}
                      onClick={() => navigate(`/question/${it.question_id}`)}
                    >
                      {it.snippet || '（无题干片段）'}
                    </Typography>
                  </Box>
                ))}
              </Stack>

              {itemPageCount > 1 && (
                <Stack alignItems="center" sx={{ mt: 2 }}>
                  <Pagination page={page} count={itemPageCount} onChange={(_e, p) => setPage(p)} color="primary" />
                </Stack>
              )}
            </Paper>
          )}
        </Box>
      </Box>

      {/* 批量二次确认：显示影响条数 */}
      <ConfirmDialog
        open={batch !== null}
        title={batch?.decision === '否决' ? '批量否决确认' : '批量确认确认'}
        impactPrefix={batch?.decision === '否决' ? '将否决' : '将确认'}
        impactCount={batch?.preview.will_update ?? 0}
        impactLabel="条关联"
        confirmText={batch?.decision === '否决' ? '确认否决' : '确认'}
        confirmColor={batch?.decision === '否决' ? 'error' : 'success'}
        loading={decideMut.isPending}
        onCancel={() => setBatch(null)}
        onConfirm={() => {
          if (selected && batch) {
            decideMut.mutate({ label_name: selected, decision: batch.decision, confirm: true })
          }
        }}
      >
        标签「{batch?.preview.label_name}」共命中 {batch?.preview.matched.toLocaleString('zh-CN')} 条关联，
        其中 {batch?.preview.pending.toLocaleString('zh-CN')} 条为「待复核」。
        批量操作<strong>只处理待复核项，绝不覆盖已有决定</strong>（如需覆盖请使用强制模式）。
      </ConfirmDialog>
    </Box>
  )
}
