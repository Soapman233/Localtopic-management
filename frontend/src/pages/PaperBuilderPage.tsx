/** P3 双栏组卷工作台（左题库 / 右试卷）。
 *
 * 覆盖需求：P0-6（双栏组卷）、P0-7（题序调整/移除/设分/大题分组）、P0-8（实时汇总 + 无答案预警）、
 * P0-9（试卷元数据）、P0-10（全局试卷管理入口）、P1-10（拖拽加入）、快照锁定语义的 UI 表达、
 * **P3 右栏「排版 / 清单」双视图**（默认排版，记忆上次）、**排版视图内可编辑**
 * （拖拽调序 / 点分值改分 / ✕ 删除）、顶部试卷切换器 + 导出抽屉。
 *
 * 状态一致性（架构设计 §10）：**以后端返回的整卷为准**，前端不做乐观累加。
 *
 * **强制预览门禁（§5-Q3）**：任何组卷编辑动作（加/删/调序/设分/大题增删改移/刷新快照/改元数据）
 * 成功后都会 `useUiStore.invalidatePreview(paperId)` → **重新锁定导出**。漏一个即等于门禁失效。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  Pagination,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
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
import { useLocation, useNavigate } from 'react-router-dom'
import { FilterSidebar } from '../components/FilterSidebar'
import { QuestionCard } from '../components/QuestionCard'
import { PaperPanel, type PaperActions } from '../components/PaperPanel'
import { LivePreviewPanel, type LivePreviewPageSummary } from '../components/LivePreviewPanel'
import { PaperSettings } from '../components/PaperSettings'
// 首次打开才加载导出业务；打开后保持挂载，关闭抽屉不丢本次结果。
const ExportDrawer = lazy(() => import('../components/ExportDrawer'))
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { useFacetsQuery, useSearchQuery } from '../hooks/useSearch'
import {
  addQuestions,
  addSection,
  deleteSection,
  getPaper,
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
import { usePaperStore } from '../store/paperStore'
import { usePaperLibraryStore } from '../store/paperLibraryStore'
import { useUiStore } from '../store/uiStore'
import { useQuestionFilters } from '../hooks/useQuestionFilters'
import { ErrorCode, errorCodeOf, errorDataOf } from '../api/errors'
import type { ExportDiagnostics } from '../api/types'
import type { SearchItem } from '../api/types'
import { qk } from '../api/queryKeys'

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
    qc.invalidateQueries({ queryKey: qk.paper(paperId) })
    qc.invalidateQueries({ queryKey: qk.papers() })
    // 结构预览（排版视图）随内容变化刷新。
    qc.invalidateQueries({ queryKey: qk.exportDataRoot() })
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
  const location = useLocation()
  const openPaperLibrary = usePaperLibraryStore(s => s.openPaperLibrary)
  // 先捕获回程意图，再运行会同步 URL 的筛选 hook；不能等 effect 才读 state。
  // 以 location entry 为单位消费，StrictMode 重跑 effect 也不会重复打开。
  const returnIntent = useRef<{ key: string; paperId: number | null; search: string; state: Record<string, unknown>; consumed: boolean } | null>(null)
  const routeState = location.state as Record<string, unknown> | null
  if (routeState && Object.prototype.hasOwnProperty.call(routeState, 'openExportForPaperId') && returnIntent.current?.key !== location.key) {
    const requestedId = routeState.openExportForPaperId
    returnIntent.current = {
      key: location.key,
      paperId: typeof requestedId === 'number' && Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : null,
      search: location.search,
      state: routeState,
      consumed: false,
    }
  }
  const theme = useTheme()
  const { currentPaperId, targetSectionId, setCurrentPaperId, setTargetSectionId } = usePaperStore()
  const { strictKp, setStrictKp, builderView, setBuilderView } = useUiStore()

  const [error, setError] = useState<string | null>(null)
  const [errorDiagnostics, setErrorDiagnostics] = useState<ExportDiagnostics | null>(null)
  const [exportOpen, setExportOpen] = useState(() => returnIntent.current?.paperId != null)
  const exportEverOpened = useRef(exportOpen)
  if (exportOpen) exportEverOpened.current = true
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [pageSummary, setPageSummary] = useState<LivePreviewPageSummary | null>(null)
  const receivePageSummary = useCallback((summary: LivePreviewPageSummary) => setPageSummary(summary), [])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [undo, setUndo] = useState<{ msg: string; run: () => void } | null>(null)
  // P0-3 响应式（断点统一）：窄屏用 MUI 标准断点 `<lg`（<1200px）折叠右栏，
  // **不再用 1439 魔法值**——否则 1366×768（教师笔记本主流分辨率）会被误判为窄屏，
  // 把默认「排版」视图折进默认关闭的抽屉，与《流程重构设计》Q8「默认排版视图」直接冲突。
  // 改用标准断点后：1366 与 1440 都保持双栏「边组边看」，仅 <1200 才折叠。
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))
  // 「紧凑」= 视口不足以同时舒适容纳「筛选栏(248) + 题目列表 + 右栏」。
  // 实测题卡宽度：1366→338px、1280→281px、1440→386px、1920→716px。
  // 这里给老师一个**可收回 264px**（筛选栏 248 + 间距 16）的开关；
  // 紧凑视口首次收起；用户主动展开后保留选择，宽屏始终常驻。
  const compact = useMediaQuery('(max-width:1439px)')
  const [rightOpen, setRightOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(() => !compact)

  // 检索条件状态（关键词防抖 / URL 同步 / query 与 facets 参数）——与检索页共用同一实现（§1.6）。
  const {
    keywordInput,
    setKeywordInput,
    filters,
    setFilters,
    page,
    setPage,
    queryParams,
    facetsParams,
    reset: resetFilters,
  } = useQuestionFilters({
    pageSize: PAGE_SIZE,
    // 仅本挂载捕获过回程意图时锁存保留策略；包括非法意图的清理，普通组卷沿用 B0。
    preserveLocation: returnIntent.current != null,
  })

  // 注册在筛选同步之后，清掉已消费字段，同时保留此次完整查询串与其他路由 state。
  useEffect(() => {
    const intent = returnIntent.current
    if (!intent || intent.consumed) return
    intent.consumed = true
    if (intent.paperId != null) {
      setCurrentPaperId(intent.paperId)
      setTargetSectionId(null)
      setExportOpen(true)
    } else {
      // 非法意图不沿用之前已打开的抽屉，防止继续请求旧卷导出数据。
      setExportOpen(false)
    }
    const { openExportForPaperId: _consumed, ...remainingState } = intent.state
    navigate({ pathname: '/builder', search: intent.search }, {
      replace: true,
      state: Object.keys(remainingState).length ? remainingState : null,
    })
  }, [location.key, navigate, setCurrentPaperId, setTargetSectionId])

  // 首次渲染就使用指定卷，避免全局旧卷 A 的查询及抽屉短暂出现；不存在的 X 明确报错。
  const paperId = returnIntent.current && !returnIntent.current.consumed && returnIntent.current.paperId != null
    ? returnIntent.current.paperId
    : currentPaperId
  const searchQ = useSearchQuery(queryParams)
  const facetsQ = useFacetsQuery(facetsParams)
  const paperQ = useQuery({
    queryKey: qk.paper(paperId),
    queryFn: () => getPaper(paperId as number),
    enabled: paperId != null,
  })

  // L6：`targetSectionId` 是**持久化**的——目标大题被删除后，它仍可能指向一个不存在的 section id，
  // 老师点「加入」就会落到不存在的大题而报错。这里在**整卷加载后立即校验**，
  // 不依赖用户是否切到「清单」视图（`PaperPanel` 里那处只在渲染清单时才触发）。
  useEffect(() => {
    usePaperStore.getState().validateTargetSection((paperQ.data?.sections ?? []).map((s) => s.id))
  }, [paperQ.data])

  const mut = usePaperMutations(paperId, e => {
    setError((e as Error).message)
    setErrorDiagnostics(errorCodeOf(e) === ErrorCode.ExportContentBlocked
      ? (errorDataOf(e) as ExportDiagnostics)
      : null)
  })

  // 门禁状态（响应式订阅，供顶部提示 / 诊断）。
  const previewFresh = useUiStore((s) => (paperId != null ? s.previewFresh[paperId] ?? false : false))
  const previewDegradedOk = useUiStore((s) => (paperId != null ? s.previewDegradedOk[paperId] ?? false : false))

  // 排版视图：结构预览数据（复用现有 #27 端点；answer_mode 取试卷属性）。
  const answerModeForPreview = paperQ.data?.answer_mode
  const exportDataQ = useQuery({
    queryKey: qk.exportData(paperId, answerModeForPreview, paperQ.data?.template),
    queryFn: () => getExportData(paperId as number, answerModeForPreview, paperQ.data?.template),
    enabled: paperId != null && paperQ.data != null,
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
    <Box
      sx={{
        // P0-3：右栏宽度改为**自适应**（原为固定 640 / 420，会在 1366 把左栏题库压到 ≈166px）。
        // 宽屏（≥1200px）用 clamp：下限保证右栏可用，上限沿用原 640（排版）/ 420（清单）。
        // 1366 下 34vw≈464px → 左栏≈606px，结果区较原先明显变宽；1920 时封顶 640，不再无谓变宽。
        width: narrow
          ? '100%'
          : builderView === 'layout'
            ? 'clamp(360px, 34vw, 640px)'
            : 'clamp(320px, 30vw, 420px)',
        flexShrink: 0,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 一行保留视图、分页与内容状态；收起详情只影响展示，不触碰 export_allowed。 */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} data-testid="builder-summary">
        <ToggleButtonGroup size="small" exclusive value={builderView}
          onChange={(_e, v: 'layout' | 'list' | null) => v && setBuilderView(v)} aria-label="试卷视图">
          <ToggleButton value="layout" data-testid="view-layout">排版</ToggleButton>
          <ToggleButton value="list" data-testid="view-list">清单</ToggleButton>
        </ToggleButtonGroup>
        {paperId != null && <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }} title={pageSummary?.overflowPages ? '含长题，结构分页近似，最终以像素预览为准' : '结构分页近似'}>
          {pageSummary?.paperId === paperId && pageSummary.contentDigest === exportDataQ.data?.content_digest && pageSummary.ready ? '约 ' + pageSummary.pageCount + ' 页' : '计算页数…'}
        </Typography>}
        {exportDataQ.isFetching ? <Typography variant="caption">正在检查…</Typography> : exportDataQ.data && <>
          <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
            {exportDataQ.data.diagnostics.export_allowed ? '检查通过' + (exportDataQ.data.diagnostics.warning_count ? ' · ' + exportDataQ.data.diagnostics.warning_count + ' 条提示' : '') : '需处理 ' + exportDataQ.data.diagnostics.blocker_count + ' 项'}
          </Typography>
          <Button size="small" sx={{ minWidth: 0, whiteSpace: 'nowrap' }} aria-expanded={diagnosticsOpen} aria-controls="builder-diagnostics" onClick={() => setDiagnosticsOpen(v => !v)}>
            {diagnosticsOpen ? '收起' : exportDataQ.data.diagnostics.export_allowed ? '详情' : '查看问题'}
          </Button>
        </>}
      </Stack>
      {paperQ.data && <PaperSettings key={paperId} paper={paperQ.data} onUpdate={actions.updatePaper}
        targetSectionId={targetSectionId} onTargetSectionChange={setTargetSectionId} onOpenLibrary={openPaperLibrary} />}
      {exportDataQ.isError && <Alert severity="error" action={<Button onClick={() => exportDataQ.refetch()}>重试</Button>}>内容检查失败：{(exportDataQ.error as Error).message}</Alert>}
      {paperId != null && exportDataQ.data && diagnosticsOpen && <Box id="builder-diagnostics" sx={{ maxHeight: '35vh', overflow: 'auto' }}>
        <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} readOnly />
        {!exportDataQ.data.diagnostics.export_allowed && <Button size="small" onClick={() => setExportOpen(true)}>到导出处理</Button>}
      </Box>}
      <Box sx={{ flex: builderView === 'layout' ? 1 : undefined, minHeight: 0, overflow: 'auto' }}>
        {builderView === 'layout' && <>
          {paperId == null ? (
            <EmptyState
              title="还没有试卷"
              description="点「试卷管理」新建或选择一份试卷。"
              actionLabel="试卷管理"
              onAction={openPaperLibrary}
            />
          ) : paperQ.isError ? (
            <ErrorState error={paperQ.error} title="指定试卷加载失败" onRetry={() => paperQ.refetch()} />
          ) : exportDataQ.isLoading ? (
            <LoadingState label="加载结构预览…" />
          ) : exportDataQ.isError ? (
            <ErrorState
              error={exportDataQ.error}
              title="加载结构预览失败"
              onRetry={() => exportDataQ.refetch()}
            />
           ) : exportDataQ.data && exportDataQ.data.sections.every(s => s.questions.length === 0) ? (
             <EmptyState title="试卷为空" description="从左侧题库点「加入」或拖拽题目到本卷。"
               actionLabel="从左加入题目" onAction={() => { setRightOpen(false); searchInputRef.current?.focus() }} />
           ) : null}
        </>}
        {/* 清单态仅不画页面，测量层仍是缩放容器的兄弟，不能放进 display:none。 */}
        {paperId != null && exportDataQ.data && <LivePreviewPanel
          paperId={paperId} data={exportDataQ.data} editable scale={LAYOUT_SCALE}
          toolbarMode="hidden" showPages={builderView === 'layout' && exportDataQ.data.sections.some(s => s.questions.length > 0)}
          onPageSummary={receivePageSummary} onScoreChange={(itemId, score) => mut.score.mutate({ itemId, score })}
          onRemove={handleRemove} />}
      </Box>
      {builderView === 'list' && <Box sx={{ flex: 1, minHeight: 0 }}>

        <PaperPanel paper={paperQ.data ?? null} showSettings={false}
          contentQuestions={exportDataQ.data?.sections.flatMap(s => s.questions)} loading={paperQ.isLoading}
          error={paperQ.isError ? (paperQ.error as Error).message : null} actions={actions}
          targetSectionId={targetSectionId} onTargetSectionChange={setTargetSectionId}
          onOpenDrawer={openPaperLibrary} onOpenDetail={qid => navigate('/question/' + qid)} />
      </Box>}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      {/* P5-3：组卷工作台是双栏工具页、无可见大标题。补一个**仅供读屏**的 h1，
          保证每页都有唯一 h1（视觉版式零变化，纯语义补充）。

          ⚠️ `width`/`height` 必须写**显式 `'1px'` 字符串**，不能写数字 `1`：
          MUI 的 `sx` 会把数字当 spacing 乘数处理，实测 `width: 1` 产出的是
          `width: 1366px`（= 视口宽），导致该 h1 撑出 **248px 横向溢出**
          （`documentElement.scrollWidth 1614 > clientWidth 1366`）。
          由 `.tmp_verify` 的交互走查脚本发现，浏览器实测确认。 */}
      <Typography
        variant="h6"
        component="h1"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1px',
          height: '1px',
          p: 0,
          m: '-1px',
          border: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        组卷工作台
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
          {errorDiagnostics && <><Box component="details"><summary>逐条内容诊断</summary>{errorDiagnostics.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}</Box><Box component="details"><summary>完整诊断JSON（可复制）</summary><Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(errorDiagnostics, null, 2)}</Box></Box></>}
        </Alert>
      )}

      {/* 窄屏提示（P0-3）：<lg（<1200px）时右栏折叠为抽屉，给出轻提示避免困惑。 */}
      {narrow && (
        <Alert severity="info" sx={{ mb: 1, py: 0.25 }}>
          当前窗口较窄，已折叠试卷面板；建议将窗口拉宽至 1200px 以上，使用双栏「边组边看」。
        </Alert>
      )}

      {/* 顶部工具条（P3）：筛选 / 试卷面板 / 导出。试卷切换器已提升至全局顶栏（P1-6）。 */}
      <Box sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* P1-1 / P0-3：紧凑视口（<1440）下提供筛选栏开合，便于把宽度让给题目列表 */}
          {compact && (
            <Button
              variant={filtersOpen ? 'contained' : 'outlined'}
              startIcon={<FilterListIcon />}
              onClick={() => setFiltersOpen((v) => !v)}
              data-testid="toggle-filters"
              aria-expanded={filtersOpen}
              aria-controls="builder-filters"
            >
              筛选
            </Button>
          )}
          {/* 弹性占位：试卷切换器移走后，把「试卷面板 / 导出」推到右侧，避免留空洞。 */}
          <Box sx={{ flex: 1 }} />
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
                inputRef={searchInputRef}
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
              {/* P1-1 / P0-3：紧凑视口下筛选栏由顶部「筛选」按钮开合；宽屏（≥1440）常驻 */}
              {(!compact || filtersOpen) && (
                <Box id="builder-filters" sx={{ overflow: 'auto', flexShrink: 0 }}>
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
                    onReset={resetFilters}
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
                {searchQ.isError && (
                  <ErrorState error={searchQ.error} title="检索失败" onRetry={() => searchQ.refetch()} />
                )}
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
        <Drawer anchor="right" open={rightOpen} onClose={() => setRightOpen(false)}
          PaperProps={{ role: 'dialog', 'aria-labelledby': 'builder-panel-drawer-title' }}>
          <Box sx={{ width: '92vw', maxWidth: 680, p: 1.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* ⚠️ 固定顶栏（AppBar）的 zIndex 比 Drawer 高（项目刻意设置），会**遮住抽屉顶部**，
                导致「关闭」按钮鼠标点不到（Esc/点遮罩仍可关，但那是"能关"不是"好关"）。
                按 MUI 惯例放一个 Toolbar 占位，把内容推到顶栏之下。 */}
            <Toolbar variant="dense" />
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography id="builder-panel-drawer-title" variant="subtitle1" component="h2" sx={{ flex: 1 }}>试卷</Typography>
              <Button size="small" onClick={() => setRightOpen(false)}>关闭</Button>
            </Stack>
            {rightPanel}
          </Box>
        </Drawer>
      )}

      {/* 导出抽屉（P2 组件；与导出页共用同一份 uiStore 门禁状态） */}
      {paperId != null && exportEverOpened.current && <Suspense fallback={exportOpen ? <LoadingState dense label="加载导出面板…" /> : null}>
        <ExportDrawer key={paperId} open={exportOpen} onClose={() => setExportOpen(false)} paperId={paperId} />
      </Suspense>}

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
