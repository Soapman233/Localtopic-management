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
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Paper,
  Stack,
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
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [importResult, setImportResult] = useState<LabelImportResult | null>(null)

  // 批量确认状态：先预检影响条数，再二次确认。
  const [batch, setBatch] = useState<{ decision: string; preview: LabelDecisionPreview } | null>(
    null,
  )

  const summaryQ = useQuery({
    queryKey: ['labels', 'summary'],
    queryFn: () => getReviewSummary({ status: null }),
  })

  const itemsQ = useQuery({
    queryKey: ['labels', 'items', selected, itemStatus, page],
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
      qc.invalidateQueries({ queryKey: ['labels'] })
      qc.invalidateQueries({ queryKey: ['coverage'] })
      qc.invalidateQueries({ queryKey: ['facets'] })
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
      qc.invalidateQueries({ queryKey: ['labels'] })
      qc.invalidateQueries({ queryKey: ['coverage'] })
    },
    onError: (err) => setToast({ kind: 'error', text: `CSV 导入失败：${(err as Error).message}` }),
  })

  const counts = summaryQ.data?.counts ?? {}
  const labels = useMemo(() => {
    const all = summaryQ.data?.summary ?? []
    const kw = labelFilter.trim()
    return kw ? all.filter((l) => l.label_name.includes(kw)) : all
  }, [summaryQ.data, labelFilter])

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
        <Typography variant="h6">知识点复核</Typography>
        <Chip size="small" color="warning" variant="outlined" label={`待复核 ${(counts['待复核'] ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" color="success" variant="outlined" label={`已确认 ${(counts['已确认'] ?? 0).toLocaleString('zh-CN')}`} />
        <Chip size="small" label={`已否决 ${(counts['已否决'] ?? 0).toLocaleString('zh-CN')}`} />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileDownloadIcon />}
          href={exportReviewUrl('待复核')}
          download
        >
          导出待复核 CSV
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileUploadIcon />}
          disabled={importMut.isPending}
          onClick={() => fileRef.current?.click()}
        >
          导入复核 CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importMut.mutate(f)
            e.target.value = ''
          }}
        />
      </Stack>

      <Alert severity="info" sx={{ mb: 1 }}>
        知识点为「<strong>提及</strong>」口径：系统自动识别题干中<strong>出现过</strong>的知识词，
        <strong>不代表</strong>本题在<strong>考查</strong>它（平均 4.26 个/题，可能误标）。
        例如一道「原子结构」题因选项出现「太阳系」被打上「太阳系」标签。
      </Alert>
      <Alert severity="warning" sx={{ mb: 2 }}>
        严格模式「仅看已确认知识点」开关在<Button size="small" onClick={() => navigate('/search')}>检索页</Button>
        （对应 <code>--kp-confirmed-only</code>），<strong>默认关闭</strong>——否则复核完成前检索不可用。
        当前已确认 {(counts['已确认'] ?? 0).toLocaleString('zh-CN')} / 待复核 {(counts['待复核'] ?? 0).toLocaleString('zh-CN')}。
      </Alert>

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
            />
            <Typography variant="caption" color="text.secondary">
              共 {labels.length} 个标签（点击查看逐条）
            </Typography>
          </Box>
          <Divider />
          <List dense sx={{ overflow: 'auto', flex: 1 }}>
            {summaryQ.isLoading && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <CircularProgress size={20} />
              </Box>
            )}
            {summaryQ.isError && (
              <Box sx={{ p: 2 }}>
                <Alert severity="error">加载标签汇总失败：{(summaryQ.error as Error).message}</Alert>
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
                  secondary={`命中 ${l.total.toLocaleString('zh-CN')} 题`}
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

        {/* 右：逐条复核 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <Alert severity="info">请从左侧选择一个知识点标签，查看其逐条关联并确认 / 否决。</Alert>
          ) : (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1" fontWeight={600}>
                  {selected}
                </Typography>
                {selectedRow && (
                  <Typography variant="body2" color="text.secondary">
                    命中 {selectedRow.total} · 待复核 {selectedRow.pending} · 已确认 {selectedRow.confirmed} · 已否决 {selectedRow.rejected}
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

              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
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

              {itemsQ.isLoading && <CircularProgress size={20} />}
              {itemsQ.isError && (
                <Alert severity="error">加载逐条清单失败：{(itemsQ.error as Error).message}</Alert>
              )}
              {itemsQ.data && itemsQ.data.items.length === 0 && (
                <Alert severity="info">该标签下没有「{itemStatus}」的关联。</Alert>
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
