/** P2 单题详情页（含在线编辑态）。
 *
 * 覆盖需求：P0-4（题干 KaTeX 渲染 / 公式列表 / 图片 / 标签 / 答案 / 解析 / 来源定位）、
 * P0-5（只读版本历史，无回滚按钮）、P1-1~P1-5（在线编辑题干/答案/解析/元数据/公式）、
 * P1-4（难度标注）、P1-11（自动留版）。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/Edit'
import { useNavigate, useParams } from 'react-router-dom'
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
import { ErrorCode, errorCodeOf, errorDataOf } from '../api/errors'
import { qk } from '../api/queryKeys'

/** 单条公式展示块（点击可查看 latex 源码）。 */
function FormulaRow({ formula }: { formula: Formula }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Chip size="small" label={formula.fid} variant="outlined" />
      <Box sx={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <KatexFormula latex={formula.latex} />
      </Box>
      {formula.status && formula.status !== 'OK' && (
        <Chip size="small" color="warning" label={formula.status} title={formula.preview ?? undefined} />
      )}
      {formula.needs_review ? <ReviewBadge /> : null}
    </Stack>
  )
}

/** P2 单题详情页。 */
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const questionId = Number(id)
  const navigate = useNavigate()
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
    return (
      <Stack alignItems="center" sx={{ mt: 6 }}>
        <CircularProgress />
      </Stack>
    )
  }

  if (qQuery.isError || !qQuery.data) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>
          返回
        </Button>
        <Alert severity="error">
          题目加载失败：{(qQuery.error as Error)?.message ?? '题目不存在'}。
        </Alert>
      </Box>
    )
  }

  const q = qQuery.data
  const hasAnswer = Boolean(q.answer && q.answer.trim())
  const hasAnalysis = Boolean(q.analysis && q.analysis.trim())
  const needsReviewCount = (q.formulas ?? []).filter((f) => f.needs_review).length

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <Typography variant="h6">题 {q.number || q.id}</Typography>
        {q.qtype && <Chip size="small" label={q.qtype} variant="outlined" />}
        <AnswerBadge hasAnswer={hasAnswer} />
        <AnalysisBadge hasAnalysis={hasAnalysis} />
        <DifficultyBadge difficulty={q.difficulty} onAnnotate={() => setAnnotateOpen(true)} />
        {needsReviewCount > 0 && <ReviewBadge count={needsReviewCount} />}
        <Box sx={{ flex: 1 }} />
        {!editing && (
          <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
            编辑
          </Button>
        )}
      </Stack>

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
            onSave={(patch) => saveMutation.mutate(patch)}
          />
        ) : (
          <>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              题干
            </Typography>
            <Box sx={{ fontSize: 15, mb: 2 }}>
              <FormulaText text={q.text} formulas={q.formulas} />
            </Box>

            {(q.images ?? []).length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  图片（只读）
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {(q.images ?? []).map((img, i) => (
                    <Box
                      key={img.id ?? i}
                      component="img"
                      src={img.id != null ? mediaUrl(q.id, img.id) : (img.media_path ?? '')}
                      alt={`题图 ${i + 1}`}
                      sx={{ maxWidth: 280, maxHeight: 220, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {(q.formulas ?? []).length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  公式列表（{q.formulas!.length} 条）
                </Typography>
                <Stack spacing={1}>
                  {q.formulas!.map((f) => (
                    <FormulaRow key={f.fid} formula={f} />
                  ))}
                </Stack>
              </Box>
            )}

            <Stack direction="row" spacing={3} flexWrap="wrap" sx={{ mb: 2 }}>
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  答案
                </Typography>
                <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <FormulaText text={q.answer || '（本题库中无答案）'} formulas={q.formulas} />
                </Box>
              </Box>
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  解析
                </Typography>
                <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <FormulaText text={q.analysis || '（本题库中无解析）'} formulas={q.formulas} />
                </Box>
              </Box>
            </Stack>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              知识点标签（提及口径，三态）
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

            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              来源定位
            </Typography>
            <Typography variant="body2" color="text.secondary">
              来源文件：{q.src_file || '—'}；学段 {q.src_stage || '待补充'}；学科 {q.src_subject || '待补充'}；
              年级 {q.src_grade || '待补充'}；教材 {q.src_textbook || '待补充'}；章节 {q.chapter || '待补充'}
            </Typography>
          </>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          版本历史（只读）
        </Typography>
        <VersionHistory questionId={q.id} versions={q.versions} />
      </Paper>

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
