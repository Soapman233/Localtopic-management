/** P1 检索页（题库浏览）。
 *
 * 覆盖需求：P0-1（关键词检索 + 分页）、P0-2（左侧固定筛选栏）、P0-3（结果卡 + 状态徽章）、
 * P0-13（数据状态可见性：覆盖率提示 + 待补充桶 + 徽章）、P1-6（严格模式）、P1-4（难度标注入口）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Pagination,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import FilterListIcon from '@mui/icons-material/FilterList'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { PageHeader } from '../components/PageHeader'
import { FilterSidebar } from '../components/FilterSidebar'
import { CoverageBanner } from '../components/CoverageBanner'
import { GradeGapNotice } from '../components/GradeGapNotice'
import { QuestionCard } from '../components/QuestionCard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import AnimatedList from '../components/AnimatedList'
import { useCoverageQuery, useFacetsQuery, useSearchQuery } from '../hooks/useSearch'
import { addQuestions, createPaper, listPapers } from '../api/papers'
import { setDifficulty } from '../api/questions'
import { DIFFICULTIES, type SearchItem } from '../api/types'
import type { SearchParams } from '../api/search'
import { usePaperStore } from '../store/paperStore'
import { useUiStore } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { notify } from '../lib/feedback'
import { isDebugMode } from '../lib/glossary'
import { useAppNavigate } from '../lib/navigation'
import { useSearchParams } from 'react-router-dom'
import { usePermissionGuard } from '../hooks/usePermission'
import { useQuestionFilters } from '../hooks/useQuestionFilters'
import { qk } from '../api/queryKeys'

const PAGE_SIZE = 20

/**
 * 列表动效开关（B2 §5）：**只播「同一页内的小幅增删」**。
 *
 * 以下情况一律关闭，避免把「换一页」变成缓慢位移，反而更难用：
 *  1. 首批加载——还没有上一帧可比（`prev` 为空）；
 *  2. 整页翻页——`page` 变化；
 *  3. 大量结果替换——增删条目超过阈值。
 */
const LIST_ANIMATION_MAX_DELTA = 3

function useListAnimationEnabled(itemIds: number[], page: number): boolean {
  const [enabled, setEnabled] = useState(false)
  const prev = useRef<{ ids: number[]; page: number } | null>(null)
  useEffect(() => {
    const p = prev.current
    let next = false
    if (p && p.ids.length > 0 && itemIds.length > 0 && p.page === page) {
      const before = new Set(p.ids)
      const after = new Set(itemIds)
      let delta = 0
      for (const id of after) if (!before.has(id)) delta += 1
      for (const id of before) if (!after.has(id)) delta += 1
      next = delta > 0 && delta <= LIST_ANIMATION_MAX_DELTA
    }
    prev.current = { ids: itemIds, page }
    setEnabled(next)
  }, [itemIds, page])
  return enabled
}

/** 维度筛选键 → 中文名（用于页头「当前筛选摘要」）。 */
const FILTER_DIM_LABELS: ReadonlyArray<readonly [keyof SearchParams, string]> = [
  ['stage', '学段'],
  ['subject', '学科'],
  ['grade', '年级'],
  ['textbook', '教材'],
  ['chapter', '章节'],
  ['qtype', '题型'],
  ['difficulty', '难度'],
]

/** 「待补充」桶筛选键 → 中文名。 */
const FILTER_MISSING_LABELS: ReadonlyArray<readonly [keyof SearchParams, string]> = [
  ['grade_missing', '年级待补充'],
  ['textbook_missing', '教材待补充'],
  ['chapter_missing', '章节待补充'],
  ['qtype_missing', '题型待补充'],
  ['difficulty_missing', '难度待补充'],
]

/**
 * 当前生效筛选条件 → 可读摘要片段（纯表现层，**不改任何检索语义**）。
 *
 * 只读地罗列 `filters` / `strictKp` 里已生效的条件，用于页头元信息行与窄屏
 * 「筛选」按钮上的数量徽标；不参与任何请求参数构造。
 */
function activeFilterParts(filters: SearchParams, strictKp: boolean): string[] {
  const parts: string[] = []
  if (filters.keyword) parts.push(`关键词「${filters.keyword}」`)
  for (const [key, label] of FILTER_DIM_LABELS) {
    const v = filters[key]
    if (typeof v === 'string' && v) parts.push(`${label} ${v}`)
  }
  for (const [key, label] of FILTER_MISSING_LABELS) {
    if (filters[key]) parts.push(label)
  }
  if (filters.has_answer) parts.push('仅看有答案')
  if (filters.has_analysis) parts.push('仅看有解析')
  if (filters.needs_review) parts.push('仅看含待复核公式')
  if (strictKp) parts.push('仅看已确认知识点')
  return parts
}

/** 难度标注对话框（P1-4 单题入口）。 */
function DifficultyDialog({
  target,
  onClose,
  onDone,
}: {
  target: SearchItem | null
  onClose: () => void
  onDone: () => void
}) {
  const [level, setLevel] = useState<string>('中')
  const mutation = useMutation({
    mutationFn: () => setDifficulty(target!.id, level),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  return (
    <Dialog open={target !== null} onClose={onClose}>
      <DialogTitle>标注难度（题 {target?.number ?? target?.id}）</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          难度需教研组人工标注，系统不做自动推断。
        </Typography>
        <Select size="small" value={level} onChange={(e) => setLevel(e.target.value)} fullWidth>
          {DIFFICULTIES.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </Select>
        {mutation.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {(mutation.error as Error).message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          确定
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** 「加入试卷」选择对话框：无当前试卷时选择或新建。 */
function PickPaperDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (paperId: number) => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [papers, setPapers] = useState<{ id: number; title: string }[]>([])
  useEffect(() => {
    if (open) {
      listPapers()
        .then((list) => setPapers(list.map((p) => ({ id: p.id, title: p.title }))))
        .catch(() => setPapers([]))
    }
  }, [open])
  const createMutation = useMutation({
    // P0-2：新建试卷套用设置页的「默认模板」。
    mutationFn: () => createPaper({ title: title.trim() || '未命名试卷', template: useSettingsStore.getState().defaultTemplate }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.papers() })
      onPick(p.id)
      onClose()
    },
  })
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>选择试卷</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {papers.length === 0 && (
            <EmptyState dense title="还没有试卷" description="在下方输入标题新建一份试卷。" />
          )}
          {papers.map((p) => (
            <Button
              key={p.id}
              variant="outlined"
              onClick={() => {
                onPick(p.id)
                onClose()
              }}
            >
              {p.title}
            </Button>
          ))}
          <TextField
            size="small"
            label="新建试卷标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            variant="contained"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            新建并加入
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
      </DialogActions>
    </Dialog>
  )
}

/** P1 检索页。 */
export default function SearchPage() {
  // 明确页面跳转走统一导航 helper（带 View Transition 增强，reduce / 不支持时自动降级）。
  const appNavigate = useAppNavigate()
  const qc = useQueryClient()
  const { currentPaperId, targetSectionId, setCurrentPaperId } = usePaperStore()
  const { coverageDismissed, setCoverageDismissed, strictKp, setStrictKp } = useUiStore()

  // 窄屏（<md，即 <900px）时筛选栏收进可折叠面板，默认收起；桌面保持常驻左栏。
  // 折叠状态用**本地 state**（不进 store）：它只是这一屏的临时视图开关。
  const theme = useTheme()
  const isNarrowFilters = useMediaQuery(theme.breakpoints.down('md'))
  const [filtersOpen, setFiltersOpen] = useState(false)

  // 检索条件状态（关键词防抖 / URL 同步 / query 与 facets 参数）——与组卷页共用同一实现（§1.6）。
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
    hasActiveFilters,
  } = useQuestionFilters({ pageSize: PAGE_SIZE })

  // 只读地取当前 URL 查询串，用于消费「外部带进来的关键词」（见下方 effect）。
  const [searchParams] = useSearchParams()

  const [annotateTarget, setAnnotateTarget] = useState<SearchItem | null>(null)
  const [pickOpen, setPickOpen] = useState(false)

  // P2：接受「从外部带关键词进来」——全局快速跳转（⌘K）会跳到 `/search?keyword=xxx`。
  //
  // 为什么需要这个 effect：`useQuestionFilters` 只在**挂载时**从 URL 还原条件
  // （它的契约是「条件 → URL」单向同步）。若老师**本来就在找题页**，再经 ⌘K 搜一次
  // 不会让组件重挂载，URL 上的新 keyword 就没人消费；更糟的是 hook 的写回 effect
  // 会把刚写进去的 `keyword` 覆盖掉（表现为「跳过来但关键词没了」）。
  //
  // 稳定性：应用后 `filters.keyword === urlKeyword`，本 effect 再跑也会被守卫拦住，
  // 不会与「输入框防抖 → 写回 URL」形成回环。
  const urlKeyword = searchParams.get('keyword') ?? ''
  useEffect(() => {
    if (urlKeyword && urlKeyword !== (filters.keyword ?? '')) {
      setKeywordInput(urlKeyword)
      setFilters((f) => ({ ...f, keyword: urlKeyword }))
      setPage(1)
    }
    // 只依赖 urlKeyword：filters 变化由守卫兜住，避免每次筛选都重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKeyword])
  // P1-3：批量加题——待加入的题目 id（无当前试卷时先选/建卷）+ 已勾选的题目 id。
  const [pendingAddIds, setPendingAddIds] = useState<number[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [addedPaperId, setAddedPaperId] = useState<number | null>(null)

  const searchQ = useSearchQuery(queryParams)
  const facetsQ = useFacetsQuery(facetsParams)
  const coverageQ = useCoverageQuery()

  const addMutation = useMutation({
    // P1-3：支持一次加入多题（后端 `addQuestions` 已支持 question_ids 数组）。
    mutationFn: ({ paperId, questionIds }: { paperId: number; questionIds: number[] }) =>
      addQuestions(paperId, { question_ids: questionIds, section_id: targetSectionId ?? undefined }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.paper(vars.paperId) })
      qc.invalidateQueries({ queryKey: qk.papers() })
      qc.invalidateQueries({ queryKey: qk.exportDataRoot() })
      // 加入即改变试卷内容 → 重新锁定导出（§5-Q3②）。
      useUiStore.getState().invalidatePreview(vars.paperId)
      setAddedPaperId(vars.paperId)
      setSelectedIds(new Set())
    },
    onError: (err) => notify.errorFrom(err, { persist: false }),
  })

  // 阶段 4：只读账号点「加入」时给出教师语言提示，而不是发一个注定被服务端拒绝的请求。
  // ⚠️ 这只是体验层——**真正的强制在后端**（服务端会以 403 拒绝写操作）。
  const guardAdd = usePermissionGuard('paper.edit')

  const handleAdd = (item: SearchItem) => {
    guardAdd(() => {
      if (currentPaperId) {
        addMutation.mutate({ paperId: currentPaperId, questionIds: [item.id] })
      } else {
        setPendingAddIds([item.id])
        setPickOpen(true)
      }
    })
  }

  /** P1-3：把已勾选的题目一次性加入当前试卷。 */
  const handleAddSelected = () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    guardAdd(() => {
      if (currentPaperId) {
        addMutation.mutate({ paperId: currentPaperId, questionIds: ids })
      } else {
        setPendingAddIds(ids)
        setPickOpen(true)
      }
    })
  }

  const toggleSelect = (item: SearchItem, checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(item.id)
      else next.delete(item.id)
      return next
    })

  const total = searchQ.data?.total ?? 0
  const items = searchQ.data?.items ?? []
  // 当前生效筛选的可读摘要（页头元信息行 + 窄屏「筛选」按钮数量徽标）。
  const filterParts = useMemo(() => activeFilterParts(filters, strictKp), [filters, strictKp])
  const filterSummary = filterParts.length > 0 ? filterParts.join(' · ') : '全部题目'
  // 筛选栏 props（桌面左栏 / 窄屏折叠面板共用同一份；切换筛选一律把页码归 1）。
  const sidebarProps = {
    facets: facetsQ.data,
    loading: facetsQ.isLoading,
    filters,
    onChange: (patch: Partial<SearchParams>) => {
      setFilters((f) => ({ ...f, ...patch }))
      setPage(1)
    },
    strictKp,
    onStrictKpChange: setStrictKp,
    onReset: resetFilters,
  }
  // 题卡列表的稳定 ID 序列（引用随数据变化，避免每次渲染都重算动效开关）。
  const itemIds = useMemo(() => items.map((i) => i.id), [items])
  const listAnimationEnabled = useListAnimationEnabled(itemIds, page)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // /api/search 现已下发 per-item 的 has_answer / has_analysis（B2 已修），结果卡正常展示
  // 答案/解析徽章；此判断仅作防御性兜底——若后端某次未下发，则不展示徽章（绝不猜成「无答案」）。
  const answerStatusAvailable = items.some((i) => i.has_answer !== undefined || i.answer != null)

  return (
    <Box>
      <PageHeader
        title="找题"
        meta={
          <>
            <span>
              共 <strong>{total.toLocaleString('zh-CN')}</strong> 题
            </span>
            <span aria-hidden>·</span>
            <span>
              已选 <strong>{selectedIds.size}</strong> 题
            </span>
            <span aria-hidden>·</span>
            <span>{filterSummary}</span>
            {searchQ.isFetching && <CircularProgress size={14} />}
          </>
        }
        actions={
          <>
            {/* 窄屏（<md）才出现：筛选栏收进可折叠面板，默认收起。 */}
            {isNarrowFilters && (
              <Button
                variant="outlined"
                startIcon={<FilterListIcon />}
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                aria-controls="search-filter-panel"
                data-testid="toggle-filters"
              >
                筛选{filterParts.length > 0 ? `（${filterParts.length}）` : ''}
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<RestartAltIcon />}
              onClick={resetFilters}
              disabled={!hasActiveFilters && keywordInput.trim() === ''}
            >
              重置筛选
            </Button>
          </>
        }
      />

      <TextField
        size="small"
        placeholder="搜索题干关键词"
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        fullWidth
        sx={{ mb: 1.5 }}
      />

      <CoverageBanner
        coverage={coverageQ.data ?? facetsQ.data?.coverage}
        dismissed={coverageDismissed}
        onDismiss={() => setCoverageDismissed(true)}
      />

      {/* 加入成功后的「已加入 · 去看看试卷 →」入口（§1.3①，新增交互） */}
      {addedPaperId != null && (
        <Alert
          severity="success"
          sx={{ mb: 1, py: 0.25, alignItems: 'center' }}
          onClose={() => setAddedPaperId(null)}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => appNavigate('/builder')}
              data-testid="go-to-paper"
            >
              查看试卷
            </Button>
          }
        >
          已加入试卷（#{addedPaperId}）
        </Alert>
      )}

      {/* 窄屏：筛选栏收进可折叠面板（默认收起），由页头「筛选」按钮开合；桌面常驻左栏。 */}
      {isNarrowFilters && (
        <Collapse in={filtersOpen} timeout="auto" unmountOnExit>
          <Box id="search-filter-panel" sx={{ mb: 2 }}>
            <FilterSidebar {...sidebarProps} fullWidth />
          </Box>
        </Collapse>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        {!isNarrowFilters && <FilterSidebar {...sidebarProps} />}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <GradeGapNotice
            gap={searchQ.data?.grade_gap}
            filters={filters}
            pending={searchQ.isFetching || searchQ.isPlaceholderData || searchQ.isError}
            onChange={(patch) => {
              setFilters((f) => ({ ...f, ...patch }))
              setPage(1)
            }}
          />

          {!answerStatusAvailable && items.length > 0 && (
            isDebugMode() ? (
              // 技术细节只在 debug 模式暴露（§3.3 / §4-#5）。
              <Alert severity="info" sx={{ mb: 1, py: 0.25 }}>
                未能从 <code>/api/search</code> 获取 <code>has_answer / has_analysis</code> 标志，
                结果卡暂不展示答案/解析徽章（避免误标为「无答案」）。
                可用左侧「仅看有答案 / 仅看有解析」按内容筛选。
              </Alert>
            ) : (
              <Alert severity="info" sx={{ mb: 1, py: 0.25 }}>
                答案信息暂不可用：本题库暂无法判断题目是否含答案/解析。
                可用左侧「仅看有答案 / 仅看有解析」按内容筛选。
              </Alert>
            )
          )}

          {searchQ.isError && (
            <Box sx={{ mb: 2 }}>
              <ErrorState
                error={searchQ.error}
                title="检索失败"
                description="请确认后端服务已启动，或稍后重试。"
                onRetry={() => searchQ.refetch()}
              />
            </Box>
          )}

          {!searchQ.isLoading && items.length === 0 && !searchQ.isError && (
            <EmptyState
              title="没有匹配的题目"
              description="试试调整关键词，或清除筛选条件。"
              actionLabel={hasActiveFilters ? '清除筛选' : undefined}
              onAction={resetFilters}
            />
          )}

          {/* P1-3：批量加题工具条——仅在勾选后出现（B2 §3.3），避免常驻占掉首屏。
              外层用 AnimatedList 只过渡工具条的显隐（同页小幅增删）。 */}
          <AnimatedList>
            {items.length > 0 && selectedIds.size > 0 && (
              <Alert
                severity="info"
                sx={{ mb: 1, py: 0.25 }}
                icon={false}
                action={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={addMutation.isPending}
                      onClick={handleAddSelected}
                      data-testid="add-selected"
                    >
                      加入所选（{selectedIds.size}）
                    </Button>
                    <Button
                      size="small"
                      disabled={addMutation.isPending}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      清空
                    </Button>
                  </Stack>
                }
              >
                勾选多题可一次加入当前试卷{targetSectionId ? '（目标大题已选）' : ''}。
              </Alert>
            )}
          </AnimatedList>

          {/* B2 §5：题卡列表用稳定外层容器包裹，直接子项以 item.id 为 key。
              仅「同页少量增删」时播放动效；首批加载 / 整页翻页 / 大量结果替换关闭。 */}
          <AnimatedList enabled={listAnimationEnabled}>
            {items.map((item) => (
              <QuestionCard
                key={item.id}
                item={item}
                onAdd={handleAdd}
                onDetail={(it) => appNavigate(`/question/${it.id}`)}
                onAnnotate={(it) => setAnnotateTarget(it)}
                selectable
                selected={selectedIds.has(item.id)}
                onSelectChange={toggleSelect}
                adding={addMutation.isPending && (addMutation.variables?.questionIds ?? []).includes(item.id)}
              />
            ))}
          </AnimatedList>

          {pageCount > 1 && (
            <Stack alignItems="center" sx={{ mt: 2 }}>
              <Pagination page={page} count={pageCount} onChange={(_e, p) => setPage(p)} color="primary" />
            </Stack>
          )}
        </Box>
      </Box>

      <DifficultyDialog
        target={annotateTarget}
        onClose={() => setAnnotateTarget(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: qk.searchRoot() })
          qc.invalidateQueries({ queryKey: qk.facetsRoot() })
        }}
      />

      <PickPaperDialog
        open={pickOpen}
        onClose={() => {
          setPickOpen(false)
          setPendingAddIds([])
        }}
        onPick={(paperId) => {
          setCurrentPaperId(paperId)
          if (pendingAddIds.length > 0) addMutation.mutate({ paperId, questionIds: pendingAddIds })
          setPendingAddIds([])
        }}
      />
    </Box>
  )
}
