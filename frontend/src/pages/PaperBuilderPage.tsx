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
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  ListItemButton,
  ListItemText,
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
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PaperPanel, type PaperActions } from '../components/PaperPanel'
import { LivePreviewPanel } from '../components/LivePreviewPanel'
import { ExportDrawer } from '../components/ExportDrawer'
import AnimatedList from '../components/AnimatedList'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { FirstRunImportGuide } from '../components/FirstRunImportGuide'
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
import { usePermission } from '../hooks/usePermission'
import { useUiStore } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
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
  const qc = useQueryClient()
  const theme = useTheme()
  const { currentPaperId, targetSectionId, setCurrentPaperId, setTargetSectionId } = usePaperStore()
  const { strictKp, setStrictKp, builderView, setBuilderView } = useUiStore()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorDiagnostics, setErrorDiagnostics] = useState<ExportDiagnostics | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [undo, setUndo] = useState<{ msg: string; run: () => void } | null>(null)
  // 试卷管理抽屉列表的增删动效（§5）：**首批加载不播放**，仅在加载完成后的少量增删时启用。
  const [papersLoadedOnce, setPapersLoadedOnce] = useState(false)
  // 删除试卷二次确认（P0-1）：单击不再直接 force 删除，必须先确认（显示将删除的题数）。
  const [confirmDeletePaper, setConfirmDeletePaper] = useState<{ id: number; title: string; itemCount: number } | null>(null)

  // P0-3 响应式（断点统一）：窄屏用 MUI 标准断点 `<lg`（<1200px）折叠右栏，
  // **不再用 1439 魔法值**——否则 1366×768（教师笔记本主流分辨率）会被误判为窄屏，
  // 把默认「排版」视图折进默认关闭的抽屉，与《流程重构设计》Q8「默认排版视图」直接冲突。
  // 改用标准断点后：1366 与 1440 都保持双栏「边组边看」，仅 <1200 才折叠。
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))
  // 「紧凑」= 视口不足以同时舒适容纳「筛选栏(248) + 题目列表 + 右栏」。
  // 实测题卡宽度：1366→338px、1280→281px、1440→386px、1920→716px。
  // 这里给老师一个**可收回 264px**（筛选栏 248 + 间距 16）的开关；
  // 紧凑视口首次默认收起（§3.1），宽屏保持常驻——不改变既有宽屏默认行为。
  const compact = useMediaQuery('(max-width:1439px)')
  const [rightOpen, setRightOpen] = useState(false)
  // §3.1：紧凑视口（<1440）**首次默认收起**筛选，把宽度让给题目列表；宽屏（≥1440）继续常驻。
  // 之后由顶部「筛选」按钮手动开合（用户选择优先，不再被媒体查询覆盖）。
  //
  // ★ 1366×768 双栏判定（可复算，避免"看起来没问题"）：
  //  1. `narrow` = MUI `down('lg')` = max-width:1199.95px → 1366 为 **false** ⇒ 右栏内联、双栏成立；
  //  2. 可用内容宽 = 1366 − 侧栏 232（App DRAWER_WIDTH）− main 内边距 2×24 = **1086px**；
  //  3. 右栏（排版视图）= clamp(360px, 34vw, 640px) = 34vw = **464px**；
  //     左栏 = 1086 − 16(gap) − 464 = **606px** > 0；
  //  4. 所有 flex 子项均为 `minWidth:0` / `flexShrink:0`，固定宽合计 232+48+16+464 = 760 < 1366
  //     ⇒ `documentElement.scrollWidth <= clientWidth`，**不产生横向溢出**。
  const [filtersOpen, setFiltersOpen] = useState(!compact)

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
  } = useQuestionFilters({ pageSize: PAGE_SIZE })

  const searchQ = useSearchQuery(queryParams)
  const facetsQ = useFacetsQuery(facetsParams)
  const paperQ = useQuery({
    queryKey: qk.paper(currentPaperId),
    queryFn: () => getPaper(currentPaperId as number),
    enabled: currentPaperId != null,
  })
  const papersQ = useQuery({
    queryKey: qk.papers(),
    queryFn: () => listPapers(),
    // 顶部切换器始终需要列表；抽屉打开时复用同一份缓存。
    enabled: true,
  })

  // L6：`targetSectionId` 是**持久化**的——目标大题被删除后，它仍可能指向一个不存在的 section id，
  // 老师点「加入」就会落到不存在的大题而报错。这里在**整卷加载后立即校验**，
  // 不依赖用户是否切到「清单」视图（`PaperPanel` 里那处只在渲染清单时才触发）。
  useEffect(() => {
    usePaperStore.getState().validateTargetSection((paperQ.data?.sections ?? []).map((s) => s.id))
  }, [paperQ.data])

  // 试卷列表加载完成后再启用增删动效（§5「首批加载关闭」）。
  useEffect(() => {
    if (!papersQ.isLoading && papersQ.data) setPapersLoadedOnce(true)
  }, [papersQ.isLoading, papersQ.data])

  // §2.4：导出辅助页（`/export`）返回时携带一次性路由 state `{ openExportForPaperId: X }`。
  // 消费后：① 选中 X；② 清除目标大题；③ 打开 X 的导出抽屉；④ `replace` 清除该 state（保留查询参数）。
  // 用 `key={paperId}` 的抽屉保证卷 A 的局部状态不会串到卷 B。
  const location = useLocation()
  useEffect(() => {
    const state = location.state as { openExportForPaperId?: number } | null
    const targetId = state?.openExportForPaperId
    if (targetId == null) return
    setCurrentPaperId(targetId)
    setTargetSectionId(null)
    setExportOpen(true)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location, navigate, setCurrentPaperId, setTargetSectionId])

  const paperId = currentPaperId
  const mut = usePaperMutations(paperId, e => {
    setError((e as Error).message)
    setErrorDiagnostics(errorCodeOf(e) === ErrorCode.ExportContentBlocked
      ? (errorDataOf(e) as ExportDiagnostics)
      : null)
  })

  // 阶段 4：只读账号禁用「删除试卷」（比"点了才被拒"更好的体验）。
  // ⚠️ 前端禁用只是体验层，**真正的强制在后端**。
  const canDeletePaper = usePermission('paper.delete')

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

  const createMut = useMutation({
    // P0-2：新建试卷套用设置页的「默认模板」（此前该设置无消费方）。
    mutationFn: (title: string) => createPaper({ title, template: useSettingsStore.getState().defaultTemplate }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.papers() })
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
      qc.invalidateQueries({ queryKey: qk.papers() })
      if (currentPaperId === id) setCurrentPaperId(null)
      // 撤销 = 重建同内容副本（新试卷 id）。后端无恢复接口，故如实标注为「副本」。
      setUndo({
        msg: `已删除试卷「${full.title}」（${full.items.length} 题）`,
        run: () => {
          void (async () => {
            try {
              const copy = await recreatePaperCopy(full)
              qc.invalidateQueries({ queryKey: qk.papers() })
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

  // 右栏内容检查状态（§3.1）：通过用小状态；阻断显示「需处理 N 项」按钮展开原诊断。
  // ⚠️ 收起诊断**只改变展示**，不改变 `diagnostics.export_allowed` 判定（导出门禁不变）。
  const diag = exportDataQ.data?.diagnostics
  const contentBlocked = Boolean(diag && !diag.export_allowed)

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
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 右栏一行（§3.1）：排版/清单 + 内容检查状态；「约 N 页」由 LivePreviewPanel 工具条给出。 */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={builderView}
          onChange={(_e, v: 'layout' | 'list' | null) => v && setBuilderView(v)}
        >
          <ToggleButton value="layout" data-testid="view-layout">排版</ToggleButton>
          <ToggleButton value="list" data-testid="view-list">清单</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        {exportDataQ.isFetching ? (
          <Chip size="small" variant="outlined" label="正在检查内容…" />
        ) : diag ? (
          contentBlocked ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={() => setDiagOpen((o) => !o)}
              aria-expanded={diagOpen}
              aria-controls="builder-diagnostics"
              data-testid="builder-content-blocked"
            >
              需处理 {diag.blocker_count} 项
            </Button>
          ) : diag.warning_count > 0 ? (
            <Button
              size="small"
              color="warning"
              variant="outlined"
              onClick={() => setDiagOpen((o) => !o)}
              aria-expanded={diagOpen}
              aria-controls="builder-diagnostics"
            >
              {diag.warning_count} 条提示
            </Button>
          ) : (
            <Chip size="small" color="success" variant="outlined" label="内容检查通过" />
          )
        ) : exportDataQ.isError ? (
          <Chip size="small" color="error" variant="outlined" label="内容检查失败" />
        ) : null}
      </Stack>

      {/* 内容检查失败：保留既有错误契约（含重试）。 */}
      {exportDataQ.isError && (
        <Alert severity="error" sx={{ mb: 1 }} action={<Button onClick={() => exportDataQ.refetch()}>重试</Button>}>
          内容检查失败：{(exportDataQ.error as Error).message}
        </Alert>
      )}

      {/* 诊断展开层：仅阻断 / 有提示时按需展开，收回常驻纵向空间。 */}
      {paperId != null && exportDataQ.data && diagOpen && (
        <Box id="builder-diagnostics" sx={{ maxHeight: '35vh', overflow: 'auto', mb: 1 }}>
          <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={() => setExportOpen(false)} />
        </Box>
      )}

      {builderView === 'layout' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {paperId == null ? (
            <EmptyState
              title="还没有试卷"
              description="点右上角「试卷列表」新建或选择一份试卷。"
              actionLabel="打开试卷列表"
              onAction={() => setDrawerOpen(true)}
            />
          ) : exportDataQ.isLoading ? (
            <LoadingState label="加载结构预览…" />
          ) : exportDataQ.isError ? (
            <ErrorState
              error={exportDataQ.error}
              title="加载结构预览失败"
              onRetry={() => exportDataQ.refetch()}
            />
          ) : exportDataQ.data && exportDataQ.data.sections.length === 0 ? (
            <EmptyState title="试卷为空" description="从左侧题库点「加入」或拖拽题目到此处。" />
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
          onOpenDetail={(qid) => navigate(`/question/${qid}`)}
        />
      )}
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

      {/* 首启引导（Phase 2.4）：题库为空时引导导入第一份旧卷（可关闭；有数据不显示）。 */}
      <FirstRunImportGuide />

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

      {/* 试卷管理抽屉（P0-10：新建 / 删除 + 撤销）。
          与全局「切换试卷」区分：这里多了**删除与撤销**，命名体现能力差异。 */}
      <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}
        PaperProps={{ role: 'dialog', 'aria-labelledby': 'paper-manage-drawer-title' }}>
        <Box sx={{ width: 320, p: 2 }}>
          {/* 同上：避免被固定顶栏遮住标题与新建表单。 */}
          <Toolbar variant="dense" />
          <Typography id="paper-manage-drawer-title" variant="subtitle1" component="h2" gutterBottom>
            试卷管理
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
          {papersQ.isLoading && <LoadingState dense label="加载中…" />}
          {papersQ.isError && (
            <ErrorState dense error={papersQ.error} title="加载失败" onRetry={() => papersQ.refetch()} />
          )}
          {/* §5：试卷列表增删动效（AutoAnimate）。**首批加载关闭**（enabled 于加载完成后才置真），
              仅对新建 / 删除的少量增删播放；此节点**不**受 DnD transform 或纸面缩放影响（安全接入点）。 */}
          <AnimatedList
            enabled={papersLoadedOnce}
            role="list"
            style={{ margin: 0, padding: 0, listStyle: 'none' }}
          >
            {(papersQ.data ?? []).map((p) => (
              <Box component="li" key={p.id} style={{ listStyle: 'none' }}>
                <ListItemButton
                  dense
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
                    disabled={!canDeletePaper}
                    onClick={(e) => {
                      e.stopPropagation()
                      // P0-1：先确认（显示将删除的题数），不再单击即 force 删除。
                      setConfirmDeletePaper({ id: p.id, title: p.title, itemCount: p.item_count ?? 0 })
                    }}
                  >
                    删除
                  </Button>
                </ListItemButton>
              </Box>
            ))}
          </AnimatedList>
          {(papersQ.data ?? []).length === 0 && !papersQ.isLoading && !papersQ.isError && (
            <EmptyState dense title="还没有试卷" description="在上方输入标题新建一份试卷。" />
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
