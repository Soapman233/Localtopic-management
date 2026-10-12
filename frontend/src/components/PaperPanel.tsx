/** 右栏试卷面板（P0-7/P0-8/P0-9 / PRD 3.1）。
 *
 * 按大题分区展示；每题一行，行内 `⋮` 菜单（上移/下移/移除/设分/详情）；
 * 支持拖拽排序（同大题内，由组卷页的 DndContext 驱动）；
 * 底部**实时汇总**：题数、总分、未设分题数、**无答案题数预警**；
 * 「题库已更新但本卷仍用旧版」的提示 + 「刷新快照」按钮（快照锁定语义的 UI 表达）。
 *
 * ⚠️ 状态一致性：所有写操作**以后端返回的整卷为准**（前端不做乐观累加）。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import RefreshIcon from '@mui/icons-material/Refresh'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Paper as PaperModel, PaperItem, PaperSection, ExportQuestion } from '../api/types'
import type { PaperPatchBody } from '../api/papers'
import { ConfirmDialog } from './ConfirmDialog'
import { SortableItemRow, isStale } from './PaperPanelItemRow'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { GLOSSARY, describeSnapshotStale } from '../lib/glossary'
import { usePaperStore } from '../store/paperStore'

const TEMPLATES = ['考试', '测验', '作业']
const ANSWER_MODES = ['学生版', '答案解析版', '仅答案']

export interface PaperActions {
  addQuestions: (questionIds: number[], sectionId?: number | null) => void
  removeItem: (itemId: number) => void
  moveItem: (itemId: number, position: number) => void
  setScore: (itemId: number, score: number | null) => void
  addSection: (name: string) => void
  renameSection: (sectionId: number, name: string) => void
  moveSection: (sectionId: number, position: number) => void
  deleteSection: (sectionId: number, force: boolean) => void
  refreshSnapshots: () => void
  updatePaper: (patch: PaperPatchBody) => void
}

export interface PaperPanelProps {
  paper: PaperModel | null
  loading: boolean
  error?: string | null
  actions: PaperActions
  targetSectionId: number | null
  onTargetSectionChange: (id: number | null) => void
  onOpenDrawer: () => void
  onGoExport: () => void
  onOpenDetail: (questionId: number) => void
  contentQuestions?: ExportQuestion[]
}

interface Group {
  section: PaperSection | null
  items: PaperItem[]
}

/** 按大题分组（大题按 seq；未分组置末），组内按题序。 */
function groupItems(ordered: PaperItem[], sections: PaperSection[]): Group[] {
  const groups: Group[] = sections
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({ section: s, items: [] as PaperItem[] }))
  const ungrouped: Group = { section: null, items: [] }
  for (const it of ordered) {
    const g = it.section_id != null ? groups.find((x) => x.section?.id === it.section_id) : undefined
    ;(g ?? ungrouped).items.push(it)
  }
  const out = groups.filter((g) => g.items.length > 0)
  if (ungrouped.items.length > 0) out.push(ungrouped)
  return out
}

/** 右栏试卷面板。 */
export function PaperPanel({
  paper,
  loading,
  error,
  actions,
  targetSectionId,
  onTargetSectionChange,
  onOpenDrawer,
  onGoExport,
  onOpenDetail,
  contentQuestions,
}: PaperPanelProps) {
  const [scoreEdit, setScoreEdit] = useState<{ itemId: number; value: string } | null>(null)
  const [newSection, setNewSection] = useState<string | null>(null)
  const [rename, setRename] = useState<{ id: number; name: string } | null>(null)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  // 删除大题二次确认（P0-1）：单击不再直接 force 删除，先确认（显示该大题题数）。
  const [confirmSection, setConfirmSection] = useState<{ id: number; name: string; count: number } | null>(null)

  const { setNodeRef, isOver } = useDroppable({ id: 'paper-dropzone', data: { type: 'paper-panel' } })

  // L6：`targetSectionId` 是持久化的——目标大题被删除后它仍指向不存在的 id，
  // 老师点「加入」时题目会落到不存在的大题、被后端拒绝。此处（本组件能拿到最新
  // 大题列表）在每次 sections 变化后调用 store 守卫，失效即置 null（回到「卷末/未分组」）。
  const validateTargetSection = usePaperStore((s) => s.validateTargetSection)
  useEffect(() => {
    if (!paper) return
    validateTargetSection((paper.sections ?? []).map((s) => s.id))
  }, [paper, validateTargetSection])

  const ordered = useMemo(
    () => (paper?.items ?? []).slice().sort((a, b) => a.seq - b.seq),
    [paper],
  )
  const groups = useMemo(() => groupItems(ordered, paper?.sections ?? []), [ordered, paper])

  if (!paper) {
    return (
      <Paper
        ref={setNodeRef}
        variant="outlined"
        sx={{ p: 3, height: '100%', borderStyle: isOver ? 'dashed' : 'solid', borderColor: isOver ? 'primary.main' : 'divider' }}
      >
        {/* P5-3：`variant="subtitle2"` 在 MUI 默认渲染为 <h6>，会造成页内 h1→h6 跳级；
            这是面板小标题而非文档章节标题，显式降为 <div>（视觉不变）。 */}
        <Typography variant="subtitle2" component="div" gutterBottom>
          试卷
        </Typography>
        {loading ? (
          <LoadingState dense label="加载中…" />
        ) : error ? (
          <ErrorState dense error={new Error(error)} title="加载失败" />
        ) : (
          <EmptyState
            dense
            title="还没有试卷"
            description="点右上角「切换试卷」新建或选择一份试卷。"
          />
        )}
        <Button sx={{ mt: 2 }} variant="outlined" onClick={onOpenDrawer}>
          打开试卷列表
        </Button>
      </Paper>
    )
  }

  const items = ordered
  const noAnswerCount = items.filter((i) => !i.has_answer).length
  const staleCount = items.filter(isStale).length
  const summary = paper.summary

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderStyle: isOver ? 'dashed' : 'solid',
        borderColor: isOver ? 'primary.main' : 'divider',
      }}
    >
      {/* 试卷元数据（P0-9） */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          variant="standard"
          value={titleDraft ?? paper.title}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft != null && titleDraft.trim() && titleDraft !== paper.title) {
              actions.updatePaper({ title: titleDraft.trim() })
            }
            setTitleDraft(null)
          }}
          sx={{ flex: 1, minWidth: 140 }}
        />
        <Button size="small" onClick={onOpenDrawer}>
          试卷管理
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Select
          size="small"
          value={paper.template}
          onChange={(e) => actions.updatePaper({ template: e.target.value })}
          sx={{ minWidth: 96 }}
        >
          {TEMPLATES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={paper.answer_mode}
          onChange={(e) => actions.updatePaper({ answer_mode: e.target.value })}
          sx={{ minWidth: 128 }}
        >
          {ANSWER_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={targetSectionId ?? ''}
          onChange={(e) => onTargetSectionChange(e.target.value === '' ? null : Number(e.target.value))}
          displayEmpty
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">加入目标：卷末/未分组</MenuItem>
          {(paper.sections ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              加入目标：{s.name}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {/* 预警：无答案（尤其解析版） */}
      {paper.answer_mode === '答案解析版' && noAnswerCount > 0 && (
        <Alert severity="warning" sx={{ mb: 1, py: 0.25 }}>
          本卷 {items.length} 题中 <strong>{noAnswerCount}</strong> 题无答案；导出解析版时这些题只会显示题干。
          建议替换为带答案的题或改选「学生版」。
        </Alert>
      )}
      {staleCount > 0 && (
        <Alert
          severity="info"
          sx={{ mb: 1, py: 0.25 }}
          action={
            <Button
              size="small"
              color="inherit"
              startIcon={<RefreshIcon />}
              onClick={() => actions.refreshSnapshots()}
            >
              {GLOSSARY.lockedSnapshotAction}
            </Button>
          }
        >
          {describeSnapshotStale(staleCount)}
        </Alert>
      )}

      {/* 大题与条目 */}
      <Box sx={{ flex: 1, overflow: 'auto', pr: 0.5 }}>
        {items.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">试卷为空。从左侧题库点「加入」或拖拽题目到此处。</Typography>
          </Box>
        )}
        {groups.map((g) => {
          const groupIds = g.items.map((i) => `item-${i.id}`)
          const globalIndex = (item: PaperItem) => ordered.findIndex((x) => x.id === item.id)
          return (
            <Box key={g.section?.id ?? 'ungrouped'} sx={{ mb: 1.5 }}>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.75 }}>
                <Typography variant="subtitle2" component="div" sx={{ flex: 1 }}>
                  {g.section?.name ?? '未分组'}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' '}
                    （{g.items.length} 题 · 小计 {g.section?.subtotal ?? g.items.reduce((s, i) => s + (i.score ?? 0), 0)} 分
                    {g.section && g.section.unscored_count > 0 ? ` · 未设分 ${g.section.unscored_count}` : ''}）
                  </Typography>
                </Typography>
                {g.section && (
                  <>
                    <IconButton
                      size="small"
                      onClick={() => setRename({ id: g.section!.id, name: g.section!.name })}
                      aria-label="重命名大题"
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => setConfirmSection({ id: g.section!.id, name: g.section!.name, count: g.items.length })}
                      aria-label="删除大题"
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
              <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
                {g.items.map((item, idx) => {
                  const gi = globalIndex(item)
                  const prev = idx > 0 ? g.items[idx - 1] : null
                  const next = idx < g.items.length - 1 ? g.items[idx + 1] : null
                  return (
                    <SortableItemRow
                      key={item.id}
                      item={item}
                      contentQuestion={contentQuestions?.find(q => q.item_id === item.id)}
                      seq={gi + 1}
                      canUp={Boolean(prev)}
                      canDown={Boolean(next)}
                      onUp={() => {
                        if (prev) actions.moveItem(item.id, globalIndex(prev) + 1)
                      }}
                      onDown={() => {
                        if (next) actions.moveItem(item.id, globalIndex(next) + 1)
                      }}
                      onRemove={() => actions.removeItem(item.id)}
                      onScore={() =>
                        setScoreEdit({ itemId: item.id, value: item.score == null ? '' : String(item.score) })
                      }
                      onDetail={() => onOpenDetail(item.question_id)}
                    />
                  )
                })}
              </SortableContext>
            </Box>
          )
        })}
        <Button size="small" startIcon={<AddIcon />} onClick={() => setNewSection('')}>
          新增大题
        </Button>
      </Box>

      {/* 实时汇总（P0-8） */}
      <Divider sx={{ my: 1 }} />
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2">
          题数 <strong>{summary.item_count}</strong>
        </Typography>
        <Typography variant="body2">
          总分 <strong>{summary.total_score}</strong>
        </Typography>
        <Typography variant="body2" color={summary.unscored_count > 0 ? 'warning.main' : 'text.secondary'}>
          未设分 <strong>{summary.unscored_count}</strong> 题
        </Typography>
        <Typography variant="body2" color={noAnswerCount > 0 ? 'warning.main' : 'text.secondary'}>
          无答案 <strong>{noAnswerCount}</strong> 题
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<FileDownloadIcon />} onClick={onGoExport}>
          导出
        </Button>
      </Stack>

      {/* 设分对话框 */}
      <Dialog open={scoreEdit !== null} onClose={() => setScoreEdit(null)}>
        <DialogTitle>设置分值</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            type="number"
            label="分值（0–1000，允许小数；留空=未设分）"
            value={scoreEdit?.value ?? ''}
            onChange={(e) => setScoreEdit((s) => (s ? { ...s, value: e.target.value } : s))}
            fullWidth
            sx={{ mt: 1, minWidth: 320 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScoreEdit(null)}>取消</Button>
          <Button
            onClick={() => {
              if (scoreEdit) {
                const v = scoreEdit.value.trim()
                actions.setScore(scoreEdit.itemId, v === '' ? null : Number(v))
              }
              setScoreEdit(null)
            }}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>

      {/* 新增大题对话框 */}
      <Dialog open={newSection !== null} onClose={() => setNewSection(null)}>
        <DialogTitle>新增大题</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="大题名称（如「一、选择题」）"
            value={newSection ?? ''}
            onChange={(e) => setNewSection(e.target.value)}
            fullWidth
            sx={{ mt: 1, minWidth: 320 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewSection(null)}>取消</Button>
          <Button
            onClick={() => {
              if (newSection && newSection.trim()) actions.addSection(newSection.trim())
              setNewSection(null)
            }}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>

      {/* 重命名大题对话框 */}
      <Dialog open={rename !== null} onClose={() => setRename(null)}>
        <DialogTitle>重命名大题</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="大题名称"
            value={rename?.name ?? ''}
            onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))}
            fullWidth
            sx={{ mt: 1, minWidth: 320 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRename(null)}>取消</Button>
          <Button
            onClick={() => {
              if (rename && rename.name.trim()) actions.renameSection(rename.id, rename.name.trim())
              setRename(null)
            }}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除大题二次确认（P0-1）：显示该大题题数；删除后题目保留并移至「未分组」 */}
      <ConfirmDialog
        open={confirmSection !== null}
        title="删除大题确认"
        impactPrefix="该大题共"
        impactCount={confirmSection?.count ?? 0}
        impactLabel="道题（题目保留，将移至「未分组」）"
        confirmText="确认删除大题"
        confirmColor="error"
        onCancel={() => setConfirmSection(null)}
        onConfirm={() => {
          if (confirmSection) actions.deleteSection(confirmSection.id, true)
          setConfirmSection(null)
        }}
      >
        将删除大题「{confirmSection?.name}」。其中的 {confirmSection?.count ?? 0} 道题<strong>不会丢失</strong>，
        会移到「未分组」；但大题分组本身无法通过撤销恢复（如需，请重新新增大题并设为目标）。
      </ConfirmDialog>
    </Paper>
  )
}

export default PaperPanel
