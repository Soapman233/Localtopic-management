/** P1 检索页（题库浏览）。
 *
 * 覆盖需求：P0-1（关键词检索 + 分页）、P0-2（左侧固定筛选栏）、P0-3（结果卡 + 状态徽章）、
 * P0-13（数据状态可见性：覆盖率提示 + 待补充桶 + 徽章）、P1-6（严格模式）、P1-4（难度标注入口）。
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { FilterSidebar } from '../components/FilterSidebar'
import { CoverageBanner } from '../components/CoverageBanner'
import { GradeGapNotice } from '../components/GradeGapNotice'
import { QuestionCard } from '../components/QuestionCard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { useCoverageQuery, useFacetsQuery, useSearchQuery } from '../hooks/useSearch'
import { addQuestions, createPaper, listPapers } from '../api/papers'
import { setDifficulty } from '../api/questions'
import { DIFFICULTIES, type SearchItem } from '../api/types'
import { usePaperStore } from '../store/paperStore'
import { useUiStore } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { notify } from '../lib/feedback'
import { usePermissionGuard } from '../hooks/usePermission'
import { useQuestionFilters } from '../hooks/useQuestionFilters'
import { isDebugMode } from '../lib/glossary'
import { qk } from '../api/queryKeys'

const PAGE_SIZE = 20

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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { currentPaperId, targetSectionId, setCurrentPaperId } = usePaperStore()
  const { coverageDismissed, setCoverageDismissed, strictKp, setStrictKp } = useUiStore()

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

  const [annotateTarget, setAnnotateTarget] = useState<SearchItem | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
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
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // /api/search 现已下发 per-item 的 has_answer / has_analysis（B2 已修），结果卡正常展示
  // 答案/解析徽章；此判断仅作防御性兜底——若后端某次未下发，则不展示徽章（绝不猜成「无答案」）。
  const answerStatusAvailable = items.some((i) => i.has_answer !== undefined || i.answer != null)

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" component="h1" sx={{ flexShrink: 0 }}>
          检索题库
        </Typography>
        <TextField
          size="small"
          placeholder="搜索题干关键词"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          sx={{ minWidth: 320, flex: 1 }}
        />
      </Stack>

      <CoverageBanner
        coverage={coverageQ.data ?? facetsQ.data?.coverage}
        dismissed={coverageDismissed}
        onDismiss={() => setCoverageDismissed(true)}
      />

      {/* 加入成功：短反馈 + 「查看试卷」行动（B2 §3.3，原「已加入 · 去看看试卷 →」精简）。 */}
      {addedPaperId != null && (
        <Alert
          severity="success"
          sx={{ mb: 1, py: 0.25 }}
          onClose={() => setAddedPaperId(null)}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => navigate('/builder')}
              data-testid="go-to-paper"
            >
              查看试卷
            </Button>
          }
        >
          已加入试卷（#{addedPaperId}）
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
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

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              共 <strong>{total.toLocaleString('zh-CN')}</strong> 题
            </Typography>
            {searchQ.isFetching && <CircularProgress size={16} />}
          </Stack>

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
            <Alert severity="info" sx={{ mb: 1, py: 0.25 }}>
              答案/解析信息暂不可用，结果卡暂不显示相关标记。
              {isDebugMode() && <>未能从 <code>/api/search</code> 获取 <code>has_answer / has_analysis</code> 标志。</>}
              可用左侧「仅看有答案 / 仅看有解析」按内容筛选。
            </Alert>
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

          {/* P1-3：批量加题工具条——**仅在勾选了题目时出现**（B2 §3.3）。
              未选题时不再常驻一条「加入所选（0）」，减少对结果区的干扰；
              题卡复选框始终可用，勾选后本工具条才出现。 */}
          {selectedIds.size > 0 && (
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
              已勾选 {selectedIds.size} 题，可一次加入当前试卷{targetSectionId ? '（目标大题已选）' : ''}。
            </Alert>
          )}

          {items.map((item) => (
            <QuestionCard
              key={item.id}
              item={item}
              onAdd={handleAdd}
              onDetail={(it) => navigate(`/question/${it.id}`)}
              onAnnotate={(it) => setAnnotateTarget(it)}
              selectable
              selected={selectedIds.has(item.id)}
              onSelectChange={toggleSelect}
              adding={addMutation.isPending && (addMutation.variables?.questionIds ?? []).includes(item.id)}
            />
          ))}

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
