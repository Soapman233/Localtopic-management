/** P3 双栏组卷工作台（左题库 / 右试卷）。
 *
 * 覆盖需求：P0-6（双栏组卷）、P0-7（题序调整/移除/设分/大题分组）、P0-8（实时汇总 + 无答案预警）、
 * P0-9（试卷元数据）、P0-10（试卷列表抽屉）、P1-10（拖拽加入）、快照锁定语义的 UI 表达、
 * **P3 右栏「排版 / 清单」双视图**（默认排版，记忆上次）、**排版视图内可编辑**
 * （拖拽调序 / 点分值改分 / ✕ 删除）、顶部试卷切换器 + 导出抽屉。
 *
 * 状态一致性（架构设计 §10）：**以后端返回的整卷为准**，前端不做乐观累加。
 *
 * **强制预览门禁（§5-Q3）**：任何组卷编辑动作（加/删/调序/设分/大题增删改移/刷新快照/改元数据）
 * 成功后都会 `useUiStore.invalidatePreview(paperId)` → **重新锁定导出**。漏一个即等于门禁失效。
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FilterListIcon from '@mui/icons-material/FilterList'
import ListAltIcon from '@mui/icons-material/ListAlt'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilterSidebar } from '../components/FilterSidebar'
import { QuestionCard } from '../components/QuestionCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PaperPanel, type PaperActions } from '../components/PaperPanel'
import { PaperSwitcher } from '../components/PaperSwitcher'
import { LivePreviewPanel } from '../components/LivePreviewPanel'
import { ExportDrawer } from '../components/ExportDrawer'
import { useFacetsQuery, useSearchQuery } from '../hooks/useSearch'
import {
  addQuestions,
  addSection,
  createPaper,
  deletePaper,
  deleteSection,
  getPaper,
  listPapers,
  moveQuestion,
  moveSection,
  patchPaper,
  refreshSnapshots,
  removeQuestion,
  renameSection,
  setScore,
  type PaperPatchBody,
} from '../api/papers'
import { ExportDiagnosticsPanel, IssueDetails } from '../components/livePreview/ExportDiagnostics'
import { getExportData } from '../api/export'
import { recreatePaperCopy } from '../api/paperRestore'
import { usePaperStore } from '../store/paperStore'
import { useUiStore } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { readFiltersFromUrl, writeFiltersToUrl } from '../api/searchParams'
import type { SearchParams } from '../api/search'
import { ApiError } from '../api/client'
import type { ExportDiagnostics } from '../api/types'
import type { SearchItem } from '../api/types'

const PAGE_SIZE = 15
/** 排版视图缩放（仅展示；测量层不受影响）。A4 宽 ≈ 794px × 0.72 ≈ 572px，适配右栏。 */
const LAYOUT_SCALE = 0.72

/** 组卷页所需的全部写操作（以后端返回整卷为准）。
 *
 * **每次写操作成功后都会重新锁定导出门禁**（`invalidatePreview`），这是「强制预览」的关键。
 */
function usePaperMutations(paperId: number | null, onError: (error: unknown) => void) {
  const qc = useQueryClient()
  const invalidate = () => {
    if (paperId == null) return
    qc.invalidateQueries({ queryKey: ['paper', paperId] })
    qc.invalidateQueries({ queryKey: ['papers'] })
    // 结构预览（排版视图）随内容变化刷新。
    qc.invalidateQueries({ queryKey: ['export-data'] })
    // ★ 强制预览门禁：任何影响内容的操作都重新锁定导出（§5-Q3②）。
    useUiStore.getState().invalidatePreview(paperId)
  }
  const opts = {
    onSuccess: invalidate,
    onError: (e: unknown) => onError(e),
  }
  const add = useMutation({
    mutationFn: (v: { ids: number[]; sectionId?: number | null; position?: number | null }) => {
      const paper = qc.getQueryData<import('../api/types').Paper>(['paper', paperId])
      const duplicateRows = v.ids.flatMap((qid, index) => {
        const positions = (paper?.items ?? []).filter(item => item.question_id === qid).map(item => item.seq)
        const repeated = v.ids.indexOf(qid) !== index
        return positions.length || repeated ? [`qid ${qid}：已有原序 ${positions.join(' / ') || '无'}${repeated ? '；本次清单内重复' : ''}`] : []
      })
      if (duplicateRows.length && !window.confirm(`清单有重复题，是否继续保留？\n${duplicateRows.join('\n')}`)) return Promise.reject(new Error('已取消加入重复题'))
      return addQuestions(paperId as number, {
        question_ids: v.ids,
        section_id: v.sectionId ?? undefined,
        position: v.position ?? undefined,
      })
    },
    ...opts,
  })
  const remove = useMutation({ mutationFn: (itemId: number) => removeQuestion(paperId as number, itemId), ...opts })
  const move = useMutation({
    mutationFn: (v: { itemId: number; position: number }) => moveQuestion(paperId as number, v.itemId, v.position),
    ...opts,
  })
  const score = useMutation({
    mutationFn: (v: { itemId: number; score: number | null }) => setScore(paperId as number, v.itemId, v.score),
    ...opts,
  })
  const addSec = useMutation({ mutationFn: (name: string) => addSection(paperId as number, { name }), ...opts })
  const renameSec = useMutation({
    mutationFn: (v: { sectionId: number; name: string }) => renameSection(paperId as number, v.sectionId, v.name),
    ...opts,
  })
  const moveSec = useMutation({
    mutationFn: (v: { sectionId: number; position: number }) => moveSection(paperId as number, v.sectionId, v.position),
    ...opts,
  })
  const delSec = useMutation({
    mutationFn: (v: { sectionId: number; force: boolean }) => deleteSection(paperId as number, v.sectionId, v.force),
    ...opts,
  })
  const refresh = useMutation({ mutationFn: () => refreshSnapshots(paperId as number), ...opts })
  const patch = useMutation({
    mutationFn: (body: PaperPatchBody) => patchPaper(paperId as number, body),
    ...opts,
  })
  return { add, remove, move, score, addSec, renameSec, moveSec, delSec, refresh, patch }
}

/** P3 双栏组卷工作台。 */
export default function PaperBuilderPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { currentPaperId, targetSectionId, setCurrentPaperId, setTargetSectionId } = usePaperStore()
  const { strictKp, setStrictKp, builderView, setBuilderView } = useUiStore()

  // 检索条件 ↔ URL（P1-4，与检索页共用实现）：跳详情页返回 / 刷新后条件不丢。
  const [searchParams, setSearchParams] = useSearchParams()
  const [keywordInput, setKeywordInput] = useState(() => searchParams.get('keyword') ?? '')
  const [filters, setFilters] = useState<SearchParams>(() => readFiltersFromUrl(searchParams))
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorDiagnostics, setErrorDiagnostics] = useState<ExportDiagnostics | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [undo, setUndo] = useState<{ msg: string; run: () => void } | null>(null)
  // 删除试卷二次确认（P0-1）：单击不再直接 force 删除，必须先确认（显示将删除的题数）。
  const [confirmDeletePaper, setConfirmDeletePaper] = useState<{ id: number; title: string; itemCount: number } | null>(null)

  // P1-1 响应式：窄屏（<1440px，覆盖 1366×768 教师笔记本主流分辨率）时，
  // 右栏折叠为抽屉、筛选栏可收起，避免固定 640px 右栏把结果区压到 ≈166px。
  const narrow = useMediaQuery('(max-width:1439px)')
  const [rightOpen, setRightOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // P1-3：关键词 300ms 防抖（与检索页一致），避免每击键触发 search + facets。
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => ({ ...f, keyword: keywordInput.trim() || undefined }))
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [keywordInput])

  // P1-4：筛选条件 / 页码写入 URL（replace，避免污染历史）。
  useEffect(() => {
    setSearchParams(writeFiltersToUrl(filters, page), { replace: true })
  }, [filters, page, setSearchParams])

  const queryParams: SearchParams = useMemo(
    () => ({ ...filters, kp_confirmed_only: strictKp || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [filters, strictKp, page],
  )
  const facetsParams: SearchParams = useMemo(
    () => ({ ...filters, kp_confirmed_only: strictKp || undefined }),
    [filters, strictKp],
  )

  const searchQ = useSearchQuery(queryParams)
  const facetsQ = useFacetsQuery(facetsParams)
  const paperQ = useQuery({
    queryKey: ['paper', currentPaperId],
    queryFn: () => getPaper(currentPaperId as number),
    enabled: currentPaperId != null,
  })
  const papersQ = useQuery({
    queryKey: ['papers'],
    queryFn: () => listPapers(),
    // 顶部切换器始终需要列表；抽屉打开时复用同一份缓存。
    enabled: true,
  })

  const paperId = currentPaperId
  const mut = usePaperMutations(paperId, e => { setError((e as Error).message); setErrorDiagnostics(e instanceof ApiError && e.code === 40904 ? e.data as ExportDiagnostics : null) })

  // 门禁状态（响应式订阅，供顶部提示 / 诊断）。
  const previewFresh = useUiStore((s) => (paperId != null ? s.previewFresh[paperId] ?? false : false))
  const previewDegradedOk = useUiStore((s) => (paperId != null ? s.previewDegradedOk[paperId] ?? false : false))

  // 排版视图：结构预览数据（复用现有 #27 端点；answer_mode 取试卷属性）。
  const answerModeForPreview = paperQ.data?.answer_mode
  const exportDataQ = useQuery({
    queryKey: ['export-data', paperId, answerModeForPreview, paperQ.data?.template],
    queryFn: () => getExportData(paperId as number, answerModeForPreview, paperQ.data?.template),
    enabled: paperId != null && paperQ.data != null,
  })

  const createMut = useMutation({
    // P0-2：新建试卷套用设置页的「默认模板」（此前该设置无消费方）。
    mutationFn: (title: string) => createPaper({ title, template: useSettingsStore.getState().defaultTemplate }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['papers'] })
      setCurrentPaperId(p.id)
      setNewTitle('')
    },
    onError: (e) => setError((e as Error).message),
  })
  const deleteMut = useMutation({
    // ★ 先抓取整卷快照（供撤销重建），再删除；删除成功后提供「撤销」入口。
    mutationFn: async (id: number) => {
      const full = await getPaper(id)
      await deletePaper(id, true)
      return full
    },
    onSuccess: (full, id) => {
      qc.invalidateQueries({ queryKey: ['papers'] })
      if (currentPaperId === id) setCurrentPaperId(null)
      // 撤销 = 重建同内容副本（新试卷 id）。后端无恢复接口，故如实标注为「副本」。
      setUndo({
        msg: `已删除试卷「${full.title}」（${full.items.length} 题）`,
        run: () => {
          void (async () => {
            try {
              const copy = await recreatePaperCopy(full)
              qc.invalidateQueries({ queryKey: ['papers'] })
              setCurrentPaperId(copy.id)
            } catch (e) {
              setError(`撤销（重建副本）失败：${(e as Error).message}`)
            }
          })()
        },
      })
    },
    onError: (e) => setError((e as Error).message),
  })

  // P1-2：补 KeyboardSensor（空格拾起 / 方向键移动 / 空格放下），使拖拽调序键盘可达。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const actions: PaperActions = {
    addQuestions: (ids, sectionId) => {
      if (paperId == null) return
      mut.add.mutate({ ids, sectionId: sectionId ?? targetSectionId ?? null })
    },
    removeItem: (itemId) => paperId != null && handleRemove(itemId),
    moveItem: (itemId, position) => paperId != null && mut.move.mutate({ itemId, position }),
    setScore: (itemId, s) => paperId != null && mut.score.mutate({ itemId, score: s }),
    addSection: (name) => paperId != null && mut.addSec.mutate(name),
    renameSection: (sectionId, name) => paperId != null && mut.renameSec.mutate({ sectionId, name }),
    moveSection: (sectionId, position) => paperId != null && mut.moveSec.mutate({ sectionId, position }),
    deleteSection: (sectionId, force) => paperId != null && mut.delSec.mutate({ sectionId, force }),
    refreshSnapshots: () => paperId != null && mut.refresh.mutate(),
    updatePaper: (body) => paperId != null && mut.patch.mutate(body),
  }

  const handleAdd = (item: SearchItem) => {
    if (paperId == null) {
      setError('请先在右栏选择或新建一份试卷')
      return
    }
    mut.add.mutate({ ids: [item.id], sectionId: targetSectionId ?? null })
  }

  /** 移除条目 + 5 秒可撤销（§5-Q9：删除用 undo Toast 兜底）。 */
  function handleRemove(itemId: number) {
    if (paperId == null) return
    const item = (paperQ.data?.items ?? []).find((i) => i.id === itemId)
    if (!item) return
    const { question_id, section_id, seq } = item
    mut.remove.mutate(itemId)
    setUndo({
      msg: `已移除第 ${seq} 题`,
      run: () => mut.add.mutate({ ids: [question_id], sectionId: section_id, position: seq }),
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || paperId == null) return
    const activeData = active.data.current as { type?: string; questionId?: number; itemId?: number } | undefined
    const overData = over.data.current as { type?: string; itemId?: number; sectionId?: number | null } | undefined

    if (activeData?.type === 'library' && activeData.questionId != null) {
      const sectionId =
        overData?.type === 'paper-item' ? overData.sectionId ?? null : targetSectionId ?? null
      mut.add.mutate({ ids: [activeData.questionId], sectionId })
      return
    }

    if (activeData?.type === 'paper-item' && activeData.itemId != null && overData?.type === 'paper-item') {
      const items = (paperQ.data?.items ?? []).slice().sort((a, b) => a.seq - b.seq)
      const from = items.findIndex((i) => i.id === activeData.itemId)
      const to = items.findIndex((i) => i.id === overData.itemId)
      if (from < 0 || to < 0 || from === to) return
      if (items[from].section_id !== items[to].section_id) return // 无跨大题接口，暂不支持
      mut.move.mutate({ itemId: activeData.itemId, position: to + 1 })
    }
  }

  // 诊断信息（只读、无副作用；供取证脚本读取门禁/视图状态）。
  useEffect(() => {
    ;(window as unknown as { __builder?: unknown }).__builder = {
      paperId,
      builderView,
      previewFresh,
      previewDegradedOk,
      unlocked: previewFresh || previewDegradedOk,
      exportOpen,
      itemCount: paperQ.data?.items.length ?? 0,
      firstItemId: paperQ.data?.items.slice().sort((a, b) => a.seq - b.seq)[0]?.id ?? null,
      orderedItemIds: (paperQ.data?.items ?? []).slice().sort((a, b) => a.seq - b.seq).map((i) => i.id),
    }
  })

  const total = searchQ.data?.total ?? 0
  const items = searchQ.data?.items ?? []
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 右栏内容（宽屏内联；窄屏放进右侧抽屉，P1-1）。抽成变量避免重复 JSX。
  const rightPanel = (
    <Box sx={{ width: narrow ? '100%' : builderView === 'layout' ? 640 : 420, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={builderView}
        onChange={(_e, v: 'layout' | 'list' | null) => v && setBuilderView(v)}
        sx={{ mb: 1, alignSelf: 'flex-start' }}
      >
        <ToggleButton value="layout" data-testid="view-layout">排版</ToggleButton>
        <ToggleButton value="list" data-testid="view-list">清单</ToggleButton>
      </ToggleButtonGroup>

      {exportDataQ.isFetching && <Typography variant="caption">正在检查内容…</Typography>}
      {exportDataQ.isError && <Alert severity="error" action={<Button onClick={() => exportDataQ.refetch()}>重试</Button>}>内容检查失败：{(exportDataQ.error as Error).message}</Alert>}
      {paperId != null && exportDataQ.data && <Box sx={{ maxHeight: '35vh', overflow: 'auto' }}><ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={() => setExportOpen(false)} /></Box>}
      {builderView === 'layout' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* 常驻轻提示（§5-Q8③） */}
          <Alert
            severity="info"
            sx={{ mb: 1, py: 0.25 }}
            action={
              <Button size="small" color="inherit" onClick={() => setBuilderView('list')} data-testid="switch-to-list">
                切到清单视图
              </Button>
            }
          >
            需要批量调序 / 批量设分？切到「清单视图」更快。
          </Alert>
          {paperId == null ? (
            <Alert severity="info">还没有试卷，点右上角「试卷列表」新建或选择一份试卷。</Alert>
          ) : exportDataQ.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">加载结构预览…</Typography>
            </Stack>
          ) : exportDataQ.isError ? (
            <Alert severity="error">加载结构预览失败：{(exportDataQ.error as Error).message}</Alert>
          ) : exportDataQ.data && exportDataQ.data.sections.length === 0 ? (
            <Alert severity="info">试卷为空。从左侧题库点「加入」或拖拽题目到此处。</Alert>
          ) : exportDataQ.data ? (
            <LivePreviewPanel
              paperId={paperId}
              data={exportDataQ.data}
              editable
              scale={LAYOUT_SCALE}
              onScoreChange={(itemId, score) => mut.score.mutate({ itemId, score })}
              onRemove={(itemId) => handleRemove(itemId)}
            />
          ) : null}
        </Box>
      ) : (
        <PaperPanel
          paper={paperQ.data ?? null}
          contentQuestions={exportDataQ.data?.sections.flatMap(s => s.questions)}
          loading={paperQ.isLoading}
          error={paperQ.isError ? (paperQ.error as Error).message : null}
          actions={actions}
          targetSectionId={targetSectionId}
          onTargetSectionChange={setTargetSectionId}
          onOpenDrawer={() => setDrawerOpen(true)}
          onGoExport={() => paperId != null && setExportOpen(true)}
          onOpenDetail={(qid) => navigate(`/question/${qid}`)}
        />
      )}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
          {errorDiagnostics && <><Box component="details"><summary>逐条内容诊断</summary>{errorDiagnostics.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}</Box><Box component="details"><summary>完整诊断JSON（可复制）</summary><Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(errorDiagnostics, null, 2)}</Box></Box></>}
        </Alert>
      )}

      {/* 顶部：试卷切换器 + 导出（P3） */}
      <Box sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* P1-1：窄屏下筛选栏与右栏折叠，用按钮开合 */}
          {narrow && (
            <Button
              variant={filtersOpen ? 'contained' : 'outlined'}
              startIcon={<FilterListIcon />}
              onClick={() => setFiltersOpen((v) => !v)}
              data-testid="toggle-filters"
            >
              筛选
            </Button>
          )}
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <PaperSwitcher
              papers={papersQ.data ?? []}
              currentPaperId={currentPaperId}
              onSwitch={(id) => {
                setCurrentPaperId(id)
                setTargetSectionId(null)
              }}
              onOpenList={() => setDrawerOpen(true)}
            />
          </Box>
          {narrow && (
            <Button
              variant="outlined"
              startIcon={<ListAltIcon />}
              disabled={paperId == null}
              onClick={() => setRightOpen(true)}
              data-testid="open-paper-panel"
            >
              试卷面板
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            disabled={paperId == null}
            onClick={() => setExportOpen(true)}
            data-testid="builder-export-button"
          >
            导出
          </Button>
        </Stack>
      </Box>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
          {/* 左栏：题库 */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
              <TextField
                size="small"
                fullWidth
                placeholder="搜题…（点「加入」或拖拽到右栏）"
                value={keywordInput}
                onChange={(e) => {
                  setKeywordInput(e.target.value)
                }}
              />
              {strictKp && <Typography variant="caption" color="primary">严格模式</Typography>}
            </Stack>
            <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
              {/* P1-1：窄屏下筛选栏默认收起（由顶部「筛选」按钮开合） */}
              {(!narrow || filtersOpen) && (
                <Box sx={{ overflow: 'auto', flexShrink: 0 }}>
                  <FilterSidebar
                    facets={facetsQ.data}
                    loading={facetsQ.isLoading}
                    filters={filters}
                    onChange={(patch) => {
                      setFilters((f) => ({ ...f, ...patch }))
                      setPage(1)
                    }}
                    strictKp={strictKp}
                    onStrictKpChange={setStrictKp}
                    onReset={() => {
                      setFilters({})
                      setKeywordInput('')
                      setPage(1)
                    }}
                  />
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', pr: 0.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    共 {total.toLocaleString('zh-CN')} 题
                  </Typography>
                  {searchQ.isFetching && <CircularProgress size={14} />}
                </Stack>
                {searchQ.isError && <Alert severity="error">检索失败：{(searchQ.error as Error).message}</Alert>}
                {items.map((item) => (
                  <QuestionCard
                    key={item.id}
                    item={item}
                    draggable
                    onAdd={handleAdd}
                    onDetail={(it) => navigate(`/question/${it.id}`)}
                  />
                ))}
                {pageCount > 1 && (
                  <Stack alignItems="center" sx={{ mt: 1 }}>
                    <Pagination size="small" page={page} count={pageCount} onChange={(_e, p) => setPage(p)} />
                  </Stack>
                )}
              </Box>
            </Box>
          </Box>

          {/* 右栏：试卷（排版 / 清单 双视图，§5-Q8）——宽屏内联；窄屏见下方右侧抽屉（P1-1） */}
          {!narrow && rightPanel}
        </Box>
      </DndContext>

      {/* P1-1：窄屏下右栏折叠为右侧抽屉（默认关闭，避免挤占结果区） */}
      {narrow && (
        <Drawer anchor="right" open={rightOpen} onClose={() => setRightOpen(false)}>
          <Box sx={{ width: '92vw', maxWidth: 680, p: 1.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ flex: 1 }}>试卷</Typography>
              <Button size="small" onClick={() => setRightOpen(false)}>关闭</Button>
            </Stack>
            {rightPanel}
          </Box>
        </Drawer>
      )}

      {/* 试卷列表抽屉（P0-10：新建 / 删除） */}
      <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 320, p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            试卷列表
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField
              size="small"
              label="新建试卷标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              fullWidth
            />
            <Button variant="contained" onClick={() => createMut.mutate(newTitle.trim() || '未命名试卷')}>
              新建
            </Button>
          </Stack>
          <Divider sx={{ my: 1 }} />
          {papersQ.isLoading && <Typography variant="body2" color="text.secondary">加载中…</Typography>}
          {papersQ.isError && (
            <Alert severity="error">加载失败：{(papersQ.error as Error).message}</Alert>
          )}
          <List dense>
            {(papersQ.data ?? []).map((p) => (
              <ListItemButton
                key={p.id}
                selected={p.id === currentPaperId}
                onClick={() => {
                  setCurrentPaperId(p.id)
                  setTargetSectionId(null)
                  setDrawerOpen(false)
                }}
              >
                <ListItemText
                  primary={p.title}
                  secondary={`${p.item_count ?? 0} 题 · ${p.total_score ?? 0} 分${(p.unscored_count ?? 0) > 0 ? ` · 未设分 ${p.unscored_count}` : ''}`}
                />
                <Button
                  size="small"
                  color="error"
                  onClick={(e) => {
                    e.stopPropagation()
                    // P0-1：先确认（显示将删除的题数），不再单击即 force 删除。
                    setConfirmDeletePaper({ id: p.id, title: p.title, itemCount: p.item_count ?? 0 })
                  }}
                >
                  删除
                </Button>
              </ListItemButton>
            ))}
          </List>
          {(papersQ.data ?? []).length === 0 && !papersQ.isLoading && (
            <Typography variant="body2" color="text.secondary">
              还没有试卷，请新建。
            </Typography>
          )}
        </Box>
      </Drawer>

      {/* 删除试卷二次确认（P0-1）：显示将删除的题数；删除后可用「撤销」重建同内容副本 */}
      <ConfirmDialog
        open={confirmDeletePaper !== null}
        title="删除试卷确认"
        impactPrefix="将删除"
        impactCount={confirmDeletePaper?.itemCount ?? 0}
        impactLabel="道题"
        confirmText="确认删除"
        confirmColor="error"
        loading={deleteMut.isPending}
        onCancel={() => setConfirmDeletePaper(null)}
        onConfirm={() => {
          if (confirmDeletePaper) deleteMut.mutate(confirmDeletePaper.id)
          setConfirmDeletePaper(null)
        }}
      >
        将删除试卷「{confirmDeletePaper?.title}」及其 {confirmDeletePaper?.itemCount ?? 0} 道题（题目本身仍保留在题库中）。
        删除后可在提示条上点「撤销」重建一份同内容副本（新试卷）；若错过提示则无法恢复。
      </ConfirmDialog>

      {/* 导出抽屉（P2 组件；与导出页共用同一份 uiStore 门禁状态） */}
      {paperId != null && (
        <ExportDrawer key={paperId} open={exportOpen} onClose={() => setExportOpen(false)} paperId={paperId} />
      )}

      {/* 删除撤销 Toast（§5-Q9） */}
      <Snackbar
        open={undo !== null}
        autoHideDuration={5000}
        onClose={() => setUndo(null)}
        message={undo?.msg}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              undo?.run()
              setUndo(null)
            }}
          >
            撤销
          </Button>
        }
      />
    </Box>
  )
}
