/** P7 来源文件管理页（PRD P1-7 / P2-3）。
 *
 * 覆盖需求：
 * - P1-7：文件列表（题量 / 覆盖 / 状态）+ 单文件详情；
 * - P2-3：文件级元数据（年级 / 教材）批量回填（一次改该文件全部题）；
 * - PRD 5.1：能看出**哪些文件的元数据缺失**（帮助老师知道去哪补）。
 *
 * 关键产品约束（PRD 3.2 / Q3）：年级、教材是**文件级**字段——改一题 = 改该来源文件下全部题。
 * 故保存前必须先经 ``/api/sources/{id}/impact`` 预检影响题数，并二次确认（``confirm=true``）。
 *
 * T05（评审 F5 / 规范 §4.2 Table）落地：
 * - **分页**：默认每页 25 行（可选 25/50），消除 209 行全量渲染导致的 9,788px 页高；
 *   分页只改「渲染多少行」，数据来源 / 筛选 / 排序口径不变。
 * - **「元数据状态」列去徽章化**：该列 174/209 行同值（83% > 60% 阈值），不再逐行渲染
 *   Chip；缺失信号改由行级标记（缺失处 `—`）+ 顶部「仅看元数据缺失」筛选承载。
 * - **数字列**（题量 / 公式）右对齐 + 等宽字体。
 *
 * 标题层级：父页 h1（`DataMaintenancePage`）；本页 `PageHeader level="section"` → h2；内部区块 h3。
 * 移动端：宽表格由 `TableContainer`（`overflow-x: auto`）内部横向滚动，不撑宽文档。
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import { useNavigate } from 'react-router-dom'
import { getSource, getSourceImpact, listSources, updateSourceMetadata } from '../api/sources'
import type { SourceDetail, SourceFileMeta, SourceRow } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { qk } from '../api/queryKeys'
import { GLOSSARY, describeTableRange } from '../lib/glossary'

/** 判断文件级字段是否缺失（``NULL`` / 空串 / 哨兵值「待补充」）。 */
function isMissing(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  return s === '' || s === '待补充'
}

function pctText(bucket?: { n: number; total: number; pct: number } | null): string {
  if (!bucket) return '—'
  return `${bucket.pct}%（${bucket.n}/${bucket.total}）`
}

// --------------------------------------------------------------------------- //
// T05（评审 F5 / 规范 §4.2 Table）：分页
//
// 背景：本表实测 209 行全量渲染，页高 9,788px（1366 视口）——全站第二名的 5.8 倍。
// 规范 §4.2 Table：「行数 > 50 必须分页或虚拟滚动」。
//
// ⚠️ 分页**只改「渲染多少行」**：数据来源（`listSources(0)` 全量）、筛选（关键词 /
// 仅看缺失）、排序一律不动，因此「共 N 行 / 缺失 M 份」等口径与分页前**逐字节一致**。
// --------------------------------------------------------------------------- //

/** 默认每页条数（规范允许 20–50；取 25 兼顾一屏可读与页高上限）。 */
const PAGE_SIZE_DEFAULT = 25
/** 可选每页条数档位（均 ≤ 50，保证 1366 视口下单页页高可控）。 */
const PAGE_SIZE_CHOICES = [25, 50]

/**
 * 分页控件文案。
 *
 * ⚠️ 文案**不在本文件定义**，而是引用 `lib/glossary.ts`（术语唯一来源）——
 * 这里只做一层「本页用到的键」的收拢，避免散落在 JSX 里。
 * （原先受「只改一个文件」的并行约束曾就地内联，串行合并时已收敛回 glossary。）
 */
const PAGE_COPY = {
  perPageLabel: GLOSSARY.tablePerPage,
  perPageUnit: GLOSSARY.tablePerPageUnit,
  rangeLabel: describeTableRange,
  ariaPage: {
    first: GLOSSARY.tableFirstPage,
    previous: GLOSSARY.tablePreviousPage,
    next: GLOSSARY.tableNextPage,
    last: GLOSSARY.tableLastPage,
  },
} as const

/** `TablePagination` 的每页条数选项（模块级常量，避免每次渲染重建数组）。 */
const PAGE_SIZE_OPTIONS = PAGE_SIZE_CHOICES.map((value) => ({
  value,
  label: `${value} ${PAGE_COPY.perPageUnit}`,
}))

/** 数字列单元格样式：右对齐 + 等宽字体（规范 §4.2 Table）。 */
const NUMERIC_CELL_SX = { fontFamily: 'Consolas, Menlo, monospace' } as const

/** 文件级元数据编辑对话框（含影响题数二次确认）。 */
function SourceDetailDialog({
  sourceId,
  onClose,
  onToast,
}: {
  sourceId: number | null
  onClose: () => void
  onToast: (kind: 'success' | 'error', text: string) => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [grade, setGrade] = useState('')
  const [textbook, setTextbook] = useState('')
  const [inited, setInited] = useState(false)
  // 绝对路径属低频信息，默认收起（B4 渐进披露 §3.7）。
  const [pathOpen, setPathOpen] = useState(false)
  // 文件级元数据编辑的二次确认状态。
  const [confirmState, setConfirmState] = useState<{
    patch: { grade?: string; textbook?: string }
    affected: number
  } | null>(null)

  const detailQ = useQuery({
    queryKey: qk.source(sourceId),
    queryFn: () => getSource(sourceId as number),
    enabled: sourceId != null,
  })

  const detail = detailQ.data as SourceDetail | undefined
  // 首次拿到详情后回填表单。
  //
  // ★ P0-3 修复：此前在**渲染期**做 `if (detail && !inited)` 赋值，且组件未按 sourceId 重挂载
  //   → 打开第 2 个来源文件时 `inited` 仍为 true，年级/教材输入框**仍是上一个文件的值**，
  //   误保存会写错文件（数据污染风险）。现改为：
  //   ① 用 effect 回填（不在渲染期 setState）；② 父级以 `key={sourceId}` 重挂载（见文件末尾）。
  useEffect(() => {
    if (detail && !inited) {
      setGrade(detail.source.grade ?? '')
      setTextbook(detail.source.textbook ?? '')
      setInited(true)
    }
  }, [detail, inited])

  const saveMut = useMutation({
    mutationFn: (args: { patch: { grade?: string; textbook?: string } }) =>
      updateSourceMetadata(sourceId as number, { ...args.patch, confirm: true }),
    onSuccess: (res) => {
      onToast('success', `已更新文件级元数据，影响 ${res.affected_questions} 道题`)
      setConfirmState(null)
      qc.invalidateQueries({ queryKey: qk.source(sourceId) })
      qc.invalidateQueries({ queryKey: qk.sources() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
      qc.invalidateQueries({ queryKey: qk.stats() })
      qc.invalidateQueries({ queryKey: qk.facetsRoot() })
    },
    onError: (err) => {
      onToast('error', `保存失败：${(err as Error).message}`)
      setConfirmState(null)
    },
  })

  /** 点击保存：先算变更字段，再预检影响题数，弹二次确认。 */
  const handleSave = async () => {
    if (!detail) return
    const patch: { grade?: string; textbook?: string } = {}
    const g = grade.trim()
    const t = textbook.trim()
    if (g !== (detail.source.grade ?? '')) patch.grade = g
    if (t !== (detail.source.textbook ?? '')) patch.textbook = t
    if (Object.keys(patch).length === 0) {
      onToast('error', '没有检测到变更')
      return
    }
    try {
      const field: 'grade' | 'textbook' = patch.grade !== undefined ? 'grade' : 'textbook'
      const impact = await getSourceImpact(sourceId as number, field)
      setConfirmState({ patch, affected: impact.affected_questions })
    } catch (err) {
      onToast('error', `预检失败：${(err as Error).message}`)
    }
  }

  const src: SourceFileMeta | undefined = detail?.source

  return (
    <>
      <Dialog open={sourceId != null} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>来源文件详情</DialogTitle>
        <DialogContent dividers>
          {detailQ.isLoading && <LoadingState dense label="正在加载来源文件详情…" />}
          {detailQ.isError && (
            <ErrorState
              error={detailQ.error}
              title="加载失败"
              onRetry={() => detailQ.refetch()}
              retryLabel="重试"
            />
          )}
          {detail && src && (
            <Box>
              <Typography variant="subtitle1" component="h3" fontWeight={500} gutterBottom>
                {src.file_name}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                <Chip size="small" label={`题量 ${detail.questions_count}`} />
                <Chip size="small" label={`公式 ${detail.formulas_count}`} />
                {src.stage && <Chip size="small" variant="outlined" label={src.stage} />}
                {src.subject && <Chip size="small" variant="outlined" label={src.subject} />}
                {src.imported_at && <Chip size="small" variant="outlined" label={`导入 ${src.imported_at}`} />}
              </Stack>
              <Button
                size="small"
                sx={{ mt: 0.5 }}
                onClick={() => setPathOpen((v) => !v)}
                aria-expanded={pathOpen}
                aria-controls="source-detail-path"
              >
                {pathOpen ? '收起文件位置' : '查看文件位置'}
              </Button>
              <Collapse in={pathOpen} id="source-detail-path">
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
                  文件位置：{src.path ?? '（未知）'}
                </Typography>
              </Collapse>

              {/* 该来源内的覆盖率 */}
              <SectionCard variant="plain" level="subsection" title="该来源覆盖率" sx={{ mt: 2 }}>
                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                  <Typography variant="body2">章节 {pctText(detail.coverage.chapter)}</Typography>
                  <Typography variant="body2">题型 {pctText(detail.coverage.qtype)}</Typography>
                  <Typography variant="body2">答案 {pctText(detail.coverage.answer)}</Typography>
                </Stack>
              </SectionCard>

              {/* 文件级元数据编辑（P2-3） */}
              <SectionCard
                level="subsection"
                sx={{ mt: 2 }}
                title="文件级元数据（年级 / 教材）"
                actions={<EditIcon fontSize="small" color="action" />}
              >
                <Alert severity="warning" sx={{ mb: 1 }}>
                  年级 / 教材属于<strong>来源文件级</strong>字段：修改将影响该文件下全部{' '}
                  <strong>{detail.questions_count}</strong> 道题（不是只改一道）。保存前会再次确认。
                </Alert>
                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-end">
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      年级
                    </Typography>
                    <TextField
                      size="small"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                      placeholder="如 八年级下册"
                      sx={{ display: 'block', minWidth: 180 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      当前来源：{src.grade_source ?? '（无）'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      教材
                    </Typography>
                    <TextField
                      size="small"
                      value={textbook}
                      onChange={(e) => setTextbook(e.target.value)}
                      placeholder="如 苏科版"
                      sx={{ display: 'block', minWidth: 180 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      当前来源：{src.textbook_source ?? '（无）'}
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    disabled={saveMut.isPending}
                    onClick={handleSave}
                  >
                    保存文件级元数据
                  </Button>
                </Stack>
              </SectionCard>

              {/* 题目 id 预览 */}
              <SectionCard
                variant="plain"
                level="subsection"
                sx={{ mt: 2 }}
                title={`题目预览（前 ${detail.question_ids_preview.length} 题）`}
              >
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {detail.question_ids_preview.map((qid) => (
                    <Chip
                      key={qid}
                      size="small"
                      variant="outlined"
                      label={`题 ${qid}`}
                      onClick={() => navigate(`/question/${qid}`)}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Stack>
              </SectionCard>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 文件级元数据编辑：显示影响题数并二次确认（PRD 3.2） */}
      <ConfirmDialog
        open={confirmState !== null}
        title="文件级元数据修改确认"
        impactPrefix="将影响"
        impactCount={confirmState?.affected ?? 0}
        impactLabel="道题"
        confirmText="确认修改"
        confirmColor="warning"
        loading={saveMut.isPending}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => confirmState && saveMut.mutate({ patch: confirmState.patch })}
      >
        年级 / 教材是<strong>来源文件级</strong>字段，本次修改将同步作用于该来源文件下的
        全部 {confirmState?.affected ?? 0} 道题。若只想改单题，需新增「题目级覆盖」（待确认 Q3）。
      </ConfirmDialog>
    </>
  )
}

/** P7 来源文件管理页。 */
export default function SourcesPage() {
  const [keyword, setKeyword] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  // 分页状态：`page` 为 0 起（与 `TablePagination` 一致）。
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState<number>(PAGE_SIZE_DEFAULT)

  const sourcesQ = useQuery({ queryKey: qk.sources(), queryFn: () => listSources(0) })

  const rows = useMemo(() => {
    const all = sourcesQ.data ?? []
    const kw = keyword.trim()
    return all.filter((r) => {
      if (onlyMissing && !(isMissing(r.grade) || isMissing(r.textbook))) return false
      if (kw && !r.file_name.includes(kw)) return false
      return true
    })
  }, [sourcesQ.data, keyword, onlyMissing])

  const totalFiles = sourcesQ.data?.length ?? 0
  const missingFiles = (sourcesQ.data ?? []).filter(
    (r) => isMissing(r.grade) || isMissing(r.textbook),
  ).length

  // 分页只影响「渲染多少行」：`rows` 是筛选后的全量结果，这里只切片。
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage))
  // 夹紧页码：筛选后行数变少时不会停在越界页（否则会渲染出一页空白）。
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => rows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage),
    [rows, safePage, rowsPerPage],
  )

  return (
    <Box>
      <PageHeader
        level="section"
        title="来源文件管理"
        meta={
          <>
            <Chip size="small" label={`文件 ${totalFiles}`} />
            <Chip
              size="small"
              color={missingFiles > 0 ? 'warning' : 'success'}
              variant={missingFiles > 0 ? 'filled' : 'outlined'}
              label={`元数据缺失 ${missingFiles}`}
            />
          </>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        共 {totalFiles} 份来源文件；其中 <strong>{missingFiles}</strong> 份的年级 / 教材元数据缺失
        （显示为「待补充」）。缺失不影响关键词检索，但无法按该维度筛出——可在此逐份回填。
      </Alert>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="按文件名筛选…"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              // 筛选变化后回到第 1 页（避免停在一个已不存在的页码上）。
              setPage(0)
            }}
            sx={{ minWidth: 260 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={onlyMissing}
                onChange={(e) => {
                  setOnlyMissing(e.target.checked)
                  setPage(0)
                }}
              />
            }
            label="仅看元数据缺失"
          />
          <Typography variant="body2" color="text.secondary">
            显示 {rows.length} / {totalFiles}
          </Typography>
        </Stack>
      </Paper>

      {sourcesQ.isLoading && <LoadingState label="正在加载来源文件…" />}
      {sourcesQ.isError && (
        <ErrorState
          error={sourcesQ.error}
          title="加载来源文件失败"
          onRetry={() => sourcesQ.refetch()}
        />
      )}

      {sourcesQ.data && (
        // 外层 Paper 同时承载表格与分页条（MUI 推荐结构），圆角走 `MuiPaper` 的 `radius.lg`。
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small" stickyHeader>
              {/* 表格 caption：为读屏提供整体说明，视觉隐藏（避免重复噪声）。 */}
              <Box
                component="caption"
                sx={{
                  position: 'absolute',
                  width: '1px',
                  height: '1px',
                  p: 0,
                  m: '-1px',
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              >
                来源文件列表：文件名、学段/学科、年级、教材、题量与公式数
              </Box>
              {/* 表头底色区分：用语义槽 `action.hover`（随明暗模式自适应，不新增色值）。
                  `nowrap` 让表头单行显示（窄屏下由 TableContainer 内部横向滚动承载）。
                  sx 命中 `& .MuiTableCell-head`，特异性高于 stickyHeader 的 `.MuiTableCell-stickyHeader`，
                  可覆盖其 `background.paper`。 */}
              <TableHead sx={{ '& .MuiTableCell-head': { bgcolor: 'action.hover', fontWeight: 500, whiteSpace: 'nowrap' } }}>
                <TableRow>
                  <TableCell>文件名</TableCell>
                  <TableCell>学段/学科</TableCell>
                  <TableCell>年级</TableCell>
                  <TableCell>教材</TableCell>
                  <TableCell align="right">题量</TableCell>
                  <TableCell align="right">公式</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r: SourceRow) => {
                  const gMissing = isMissing(r.grade)
                  const tMissing = isMissing(r.textbook)
                  return (
                    <TableRow
                      key={r.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setActiveId(r.id)}
                    >
                      <TableCell sx={{ maxWidth: 320, wordBreak: 'break-all' }}>{r.file_name}</TableCell>
                      <TableCell>
                        {[r.stage, r.subject].filter(Boolean).join(' / ') || '—'}
                      </TableCell>
                      <TableCell>
                        {gMissing ? (
                          <Box component="span" aria-label="年级元数据缺失" title="年级元数据缺失">—</Box>
                        ) : (
                          r.grade
                        )}
                      </TableCell>
                      <TableCell>
                        {tMissing ? (
                          <Box component="span" aria-label="教材元数据缺失" title="教材元数据缺失">—</Box>
                        ) : (
                          r.textbook
                        )}
                      </TableCell>
                      <TableCell align="right" sx={NUMERIC_CELL_SX}>{r.questions_count}</TableCell>
                      <TableCell align="right" sx={NUMERIC_CELL_SX}>{r.formulas_count}</TableCell>
                    </TableRow>
                  )
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        dense
                        title="没有匹配的来源文件"
                        description={
                          keyword.trim() || onlyMissing
                            ? '试试清除筛选条件，或换个文件名关键词。'
                            : '当前题库还没有来源文件。'
                        }
                        actionLabel={keyword.trim() || onlyMissing ? '清除筛选' : undefined}
                        onAction={() => {
                          setKeyword('')
                          setOnlyMissing(false)
                          setPage(0)
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {/* 分页条：仅在有行时渲染（0 行时范围文案「第 0–0 行」无意义，空态已由表格内承载）。 */}
          {rows.length > 0 && (
            <TablePagination
              component="div"
              count={rows.length}
              page={safePage}
              onPageChange={(_event, next) => setPage(next)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(Number.parseInt(e.target.value, 10))
                setPage(0)
              }}
              rowsPerPageOptions={PAGE_SIZE_OPTIONS}
              labelRowsPerPage={PAGE_COPY.perPageLabel}
              labelDisplayedRows={({ from, to, count }) => PAGE_COPY.rangeLabel(from, to, count)}
              getItemAriaLabel={(type) => PAGE_COPY.ariaPage[type]}
              sx={{ borderTop: '1px solid', borderColor: 'divider' }}
            />
          )}
        </Paper>
      )}

      <SourceDetailDialog
        key={activeId ?? 'none'}
        sourceId={activeId}
        onClose={() => setActiveId(null)}
        onToast={(kind, text) => setToast({ kind, text })}
      />
    </Box>
  )
}
