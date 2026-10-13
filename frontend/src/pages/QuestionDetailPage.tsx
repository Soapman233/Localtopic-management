/** P2 单题详情页（含在线编辑态）。
 *
 * 覆盖需求：P0-4（题干 KaTeX 渲染 / 公式列表 / 图片 / 标签 / 答案 / 解析 / 来源定位）、
 * P0-5（只读版本历史，无回滚按钮）、P1-1~P1-5（在线编辑题干/答案/解析/元数据/公式）、
 * P1-4（难度标注）、P1-11（自动留版）。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/Edit'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '../hooks/useAppNavigate'
import {
  getQuestion,
  mediaUrl,
  setDifficulty,
  updateQuestion,
  type QuestionPatchBody,
} from '../api/questions'
import { DIFFICULTIES, type Formula } from '../api/types'
import { FormulaText, KatexFormula } from '../components/KatexFormula'
import { AnswerBadge, AnalysisBadge, DifficultyBadge, LabelStatusBadge, ReviewBadge } from '../components/StatusBadges'
import { QuestionEditor } from '../components/QuestionEditor'
import { VersionHistory } from '../components/VersionHistory'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { ErrorCode, errorCodeOf, errorDataOf } from '../api/errors'
import { qk } from '../api/queryKeys'
import { describeMentionScope, describeFormulaStatus } from '../lib/glossary'
import { usePermissionGuard } from '../hooks/usePermission'

/** 单条公式展示块。`fid` 退为**次级定位**（B2 §3.4）：小号灰字，不再是显眼的独立徽章；
 * 非 OK 状态经 `describeFormulaStatus` 中文化。 */
function FormulaRow({ formula }: { formula: Formula }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 28 }}>
        {formula.fid}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <KatexFormula latex={formula.latex} />
      </Box>
      {formula.status !== 'OK' && (
        <Chip size="small" color="warning" label={describeFormulaStatus(formula.status)} title={formula.preview ?? undefined} />
      )}
      {formula.needs_review ? <ReviewBadge /> : null}
    </Stack>
  )
}

/** P2 单题详情页。 */
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const questionId = Number(id)
  const navigate = useAppNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [annotateOpen, setAnnotateOpen] = useState(false)
  const [level, setLevel] = useState<string>('中')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const qQuery = useQuery({
    queryKey: qk.question(questionId),
    queryFn: () => getQuestion(questionId),
    enabled: Number.isFinite(questionId),
  })

  // 阶段 4：只读账号保存时给出教师语言提示（服务端也会拒，这里先拦住以免白跑一趟）。
  const guardEdit = usePermissionGuard('question.edit')

  const saveMutation = useMutation({
    mutationFn: (patch: QuestionPatchBody) => updateQuestion(questionId, patch),
    onSuccess: (data) => {
      setEditing(false)
      setConflict(null)
      qc.setQueryData(['question', questionId], data.question)
      qc.invalidateQueries({ queryKey: qk.question(questionId) })
      qc.invalidateQueries({ queryKey: qk.searchRoot() })
      setSaveMsg(
        data.warnings && data.warnings.length > 0
          ? `已保存（v${data.version}）。${data.warnings.join('；')}`
          : `已保存，新版本 v${data.version}；系统已自动保留旧版。`,
      )
      window.setTimeout(() => setSaveMsg(null), 4000)
    },
    onError: (err) => {
      if (errorCodeOf(err) === ErrorCode.ContentConflict) {
        const d = errorDataOf(err) as { question_id?: number; number?: string; snippet?: string } | null
        setConflict(
          `内容冲突：该修改与同一来源文件内的另一题（第 ${d?.number ?? '?'} 题）内容重复。${d?.snippet ? `片段：${d.snippet}` : ''}`,
        )
      } else {
        setConflict((err as Error).message)
      }
    },
  })

  const difficultyMutation = useMutation({
    mutationFn: () => setDifficulty(questionId, level),
    onSuccess: (data) => {
      qc.setQueryData(['question', questionId], data.question)
      qc.invalidateQueries({ queryKey: qk.question(questionId) })
      qc.invalidateQueries({ queryKey: qk.searchRoot() })
      setAnnotateOpen(false)
    },
  })

  if (qQuery.isLoading) {
    return <LoadingState label="正在加载题目…" />
  }

  if (qQuery.isError || !qQuery.data) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>
          返回
        </Button>
        <ErrorState
          error={qQuery.error ?? new Error('题目不存在或已被删除。')}
          title="题目加载失败"
          onRetry={() => qQuery.refetch()}
        />
      </Box>
    )
  }

  const q = qQuery.data
  const hasAnswer = Boolean(q.answer && q.answer.trim())
  const hasAnalysis = Boolean(q.analysis && q.analysis.trim())
  const needsReviewCount = (q.formulas ?? []).filter((f) => f.needs_review).length
  const formulaCount = (q.formulas ?? []).length

  return (
    // B2 §3.4：正文收窄到 720 并在主内容区居中（原 maxWidth 1100 左对齐）。
    <Box data-testid="detail-container" sx={{ maxWidth: 720, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <Typography variant="h6" component="h1">题 {q.number || q.id}</Typography>
        {q.qtype && <Chip size="small" label={q.qtype} variant="outlined" />}
        {/* B2 §3.4：顶部只保留两个**主要状态**——难度与待复核风险。
            答案/解析状态移到各自正文标题旁（见下）。 */}
        <DifficultyBadge difficulty={q.difficulty} onAnnotate={() => setAnnotateOpen(true)} />
        {needsReviewCount > 0 && <ReviewBadge count={needsReviewCount} />}
        <Box sx={{ flex: 1 }} />
        {!editing && (
          <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
            编辑
          </Button>
        )}
      </Stack>

      {/* 默认来源摘要只显示文件名（B2 §3.4）；六项完整来源放进「更多信息」。 */}
      {q.src_file && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          来源文件：{q.src_file}
        </Typography>
      )}

      {saveMsg && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {saveMsg}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        {editing ? (
          <QuestionEditor
            question={q}
            saving={saveMutation.isPending}
            conflictMessage={conflict}
            onCancel={() => {
              setEditing(false)
              setConflict(null)
            }}
            onSave={(patch) => guardEdit(() => saveMutation.mutate(patch))}
          />
        ) : (
          <>
            <Typography variant="subtitle2" component="h2" color="text.secondary" gutterBottom>
              题干
            </Typography>
            <Box sx={{ fontSize: 15, mb: 2 }}>
              <FormulaText text={q.text} formulas={q.formulas} />
            </Box>

            {(q.images ?? []).length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" component="h2" color="text.secondary" gutterBottom>
                  图片（只读）
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {(q.images ?? []).map((img, i) => (
                    <Box
                      key={img.id ?? i}
                      component="img"
                      src={img.id != null ? mediaUrl(q.id, img.id) : (img.media_path ?? '')}
                      alt={`题图 ${i + 1}`}
                      sx={{ maxWidth: '100%', maxHeight: 260, height: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* B2 §3.4：题干 / 图片 / 答案 / 解析**顺序纵排**（原答案、解析为左右双列）。
                答案/解析状态徽章就地放在各自标题旁。 */}
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" component="h2" color="text.secondary">
                答案
              </Typography>
              <AnswerBadge hasAnswer={hasAnswer} />
            </Stack>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
              <FormulaText text={q.answer || '（本题库中无答案）'} formulas={q.formulas} />
            </Box>

            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" component="h2" color="text.secondary">
                解析
              </Typography>
              <AnalysisBadge hasAnalysis={hasAnalysis} />
            </Stack>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
              <FormulaText text={q.analysis || '（本题库中无解析）'} formulas={q.formulas} />
            </Box>

            <Typography variant="subtitle2" component="h2" color="text.secondary" gutterBottom>
              知识点标签（三态）
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {describeMentionScope()}。
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              {(q.labels ?? []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  无标签
                </Typography>
              )}
              {(q.labels ?? []).map((l) => (
                <Stack key={`${l.namespace}:${l.name}`} direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={l.name} variant="outlined" />
                  <LabelStatusBadge status={l.review_status} />
                </Stack>
              ))}
            </Stack>

            {/* B2 §3.4：公式与完整来源放进**默认关闭**的「更多信息」（键盘可展开）。
                ⚠️ 未知字形 / 待核对风险不随它隐藏——顶部的「待复核公式 N」徽章始终可见。 */}
            <Accordion
              disableGutters
              elevation={0}
              data-testid="more-info"
              sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2" fontWeight={600}>
                  更多信息（公式与来源）
                </Typography>
                {formulaCount > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    公式 {formulaCount} 条{needsReviewCount > 0 ? ` · ${needsReviewCount} 条待核对` : ''}
                  </Typography>
                )}
              </AccordionSummary>
              <AccordionDetails>
                {formulaCount > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" component="h3" color="text.secondary" gutterBottom>
                      公式列表（{formulaCount} 条）
                    </Typography>
                    <Stack spacing={1}>
                      {(q.formulas ?? []).map((f) => (
                        <FormulaRow key={f.fid} formula={f} />
                      ))}
                    </Stack>
                  </Box>
                )}
                <Typography variant="subtitle2" component="h3" color="text.secondary" gutterBottom>
                  来源定位
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  来源文件：{q.src_file || '—'}；学段 {q.src_stage || '待补充'}；学科 {q.src_subject || '待补充'}；
                  年级 {q.src_grade || '待补充'}；教材 {q.src_textbook || '待补充'}；章节 {q.chapter || '待补充'}
                </Typography>
              </AccordionDetails>
            </Accordion>
          </>
        )}
      </Paper>

      {/* B2 §3.4：版本历史入口**折叠**，仍只读（展开某版才拉取该版快照，无回滚按钮）。 */}
      <Accordion
        disableGutters
        elevation={0}
        data-testid="version-history"
        sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" component="h2">
            版本历史（只读）
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            共 {(q.versions ?? []).length} 版
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <VersionHistory questionId={q.id} versions={q.versions} />
        </AccordionDetails>
      </Accordion>

      {/* 难度标注 */}
      <Dialog open={annotateOpen} onClose={() => setAnnotateOpen(false)}>
        <DialogTitle>标注难度</DialogTitle>
        <DialogContent>
          <Select size="small" value={level} onChange={(e) => setLevel(e.target.value)} fullWidth sx={{ mt: 1, minWidth: 200 }}>
            {DIFFICULTIES.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotateOpen(false)}>取消</Button>
          <Button variant="contained" disabled={difficultyMutation.isPending} onClick={() => difficultyMutation.mutate()}>
            确定
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
