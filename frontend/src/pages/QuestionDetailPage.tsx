/** P2 单题详情页（含在线编辑态）。
 *
 * 覆盖需求：P0-4（题干 KaTeX 渲染 / 公式列表 / 图片 / 标签 / 答案 / 解析 / 来源定位）、
 * P0-5（只读版本历史，无回滚按钮）、P1-1~P1-5（在线编辑题干/答案/解析/元数据/公式）、
 * P1-4（难度标注）、P1-11（自动留版）。
 *
 * B2 §3.4：正文**单栏可读**；顶部只留主要状态；题干/图片/答案/解析纵排；
 * 只读上下文（来源文件 / 公式与来源定位 / 版本历史）收进**右侧可折叠上下文面板**，
 * 窄屏自动上下堆叠（信息不隐藏）。编辑与历史仍可达。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
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
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { SlideOver } from '../components/SlideOver'
import { ErrorCode, errorCodeOf, errorDataOf } from '../api/errors'
import { qk } from '../api/queryKeys'
import { describeMentionScope } from '../lib/glossary'
import { stripEmbeddedAnswer } from '../lib/questionText'
import { usePermissionGuard } from '../hooks/usePermission'

/** 公式状态代码 → 中文（非 OK 状态不再直接暴露原始码，见 §3.4）。 */
const FORMULA_STATUS_LABEL: Record<string, string> = {
  UNSUPPORTED: '公式不支持',
  EMPTY: '未提取到内容',
  FAIL: '转换失败',
}

/** 非 OK 状态的中文标签；OK / 空状态返回 null（不渲染徽章）。 */
function formulaStatusLabel(status?: string | null): string | null {
  if (!status || status === 'OK') return null
  return FORMULA_STATUS_LABEL[status] ?? '公式状态待核对'
}

/** 顶部状态徽章的统一尺寸（与结果卡元信息行口径一致）。 */
const HEADER_CHIP_SX = { fontSize: 12, height: 22 } as const

/** 单条公式展示块（fid 退为次级定位信息）。 */
function FormulaRow({ formula }: { formula: Formula }) {
  const statusLabel = formulaStatusLabel(formula.status)
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontFamily: 'monospace' }}>
        {formula.fid}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <KatexFormula latex={formula.latex} />
      </Box>
      {statusLabel && (
        <Chip size="small" color="warning" label={statusLabel} title={formula.preview ?? undefined} />
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
  // B2 §3.4：只读上下文（来源 / 公式与来源定位 / 历史）收进右栏，默认展开、可折叠。
  // R05：右栏内容改抽屉后，`contextOpen` 即抽屉开合；原先「更多信息 / 版本历史」
  // 两级折叠的 state 已无用（抽屉自身即展开态），一并删除。
  const [contextOpen, setContextOpen] = useState(false)

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
    return (
      <Box>
        {/* 加载态也保留页面唯一 h1，避免标题大纲在加载期间缺级。 */}
        <PageHeader title="题目详情" />
        <LoadingState label="正在加载题目…" />
      </Box>
    )
  }

  if (qQuery.isError || !qQuery.data) {
    return (
      <Box>
        <PageHeader
          title="题目详情"
          actions={
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
              返回
            </Button>
          }
        />
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
  // 未知字形 / 非 OK 状态的公式数量——必须留在顶部，不能随「更多信息」一起藏掉。
  const abnormalFormulaCount = (q.formulas ?? []).filter((f) => formulaStatusLabel(f.status)).length
  const headerLabel = `题 ${q.number || q.id}`

  return (
    <Box>
      <PageHeader
        title={headerLabel}
        // 面包屑自动派生成「找题 › 题 N」（题号来自数据，路由推导不出）。
        currentLabel={headerLabel}
        meta={
          <>
            {q.qtype && <Chip size="small" variant="outlined" label={q.qtype} sx={HEADER_CHIP_SX} />}
            {/* 顶部只保留两个主要状态：难度（含「未标注」入口）与待复核风险。 */}
            <DifficultyBadge difficulty={q.difficulty} onAnnotate={() => setAnnotateOpen(true)} />
            {needsReviewCount > 0 && <ReviewBadge count={needsReviewCount} />}
            {abnormalFormulaCount > 0 && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`公式异常 ${abnormalFormulaCount}`}
                title="存在非 OK 状态的公式，点页头「来源 / 历史」查看详情"
              />
            )}
          </>
        }
        actions={
          <>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
              返回
            </Button>
            {/* R05：右栏改为抽屉后，必须有一个**显式入口**，否则来源/历史无处可点。 */}
            <Button startIcon={<InfoOutlinedIcon />} onClick={() => setContextOpen(true)}>
              来源 / 历史
            </Button>
            {!editing && (
              <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
                编辑
              </Button>
            )}
          </>
        }
      />

      {saveMsg && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {saveMsg}
        </Alert>
      )}

      {/* 正文：**单栏**。R05（= ③）把原来的「正文 + 右侧上下文面板」双栏改成单栏——
          规范 §4.1 要求「阅读型」页面内容居中、`maxWidth: 720`，双栏装不下 720。
          右栏内容（来源 / 公式 / 版本历史）收进**抽屉**，由页头「来源 / 历史」打开。 */}
      <Box sx={{ minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
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
                  {/* F4：题干可能把答案/详解一起塞在 `text` 里；这里剥离后渲染，
                      答案/解析本就有各自区块，不再重复三遍。不改数据。 */}
                  <FormulaText text={stripEmbeddedAnswer(q.text)} formulas={q.formulas} />
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
                          sx={{ maxWidth: '100%', height: 'auto', maxHeight: 220, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {/* 答案 / 解析：状态徽章就近放在各自标题旁，正文纵排。 */}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2" component="h2" color="text.secondary">
                    答案
                  </Typography>
                  <AnswerBadge hasAnswer={hasAnswer} />
                </Stack>
                <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
                  <FormulaText text={q.answer || '（本题库中无答案）'} formulas={q.formulas} />
                </Box>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
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
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
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
              </>
            )}
          </Paper>
        </Box>

      {/* R05：右栏内容收进**抽屉**。
          抽屉本身就是「已展开」，故不再套一层「更多信息」折叠——
          原先是「点开右栏 → 再点开更多信息」两级折叠，现在一级到位。 */}
      <SlideOver
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        title="来源 / 历史"
        labelledById="question-context-title"
        width={420}
      >
        <Typography variant="subtitle2" component="h3" color="text.secondary" gutterBottom>
          来源文件
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, wordBreak: 'break-word' }}>
          {q.src_file || '—'}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" component="h3" color="text.secondary" gutterBottom>
          更多信息（公式、来源定位）
        </Typography>
        <Typography variant="subtitle2" component="h4" color="text.secondary" sx={{ mt: 1 }} gutterBottom>
          公式列表（{(q.formulas ?? []).length} 条）
        </Typography>
        {(q.formulas ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            本题无公式。
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {q.formulas!.map((f) => (
              <FormulaRow key={f.fid} formula={f} />
            ))}
          </Stack>
        )}
        <Typography variant="subtitle2" component="h4" color="text.secondary" gutterBottom>
          来源定位
        </Typography>
        <Typography variant="body2" color="text.secondary">
          来源文件：{q.src_file || '—'}；学段 {q.src_stage || '待补充'}；学科 {q.src_subject || '待补充'}；
          年级 {q.src_grade || '待补充'}；教材 {q.src_textbook || '待补充'}；章节 {q.chapter || '待补充'}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" component="h3" color="text.secondary" gutterBottom>
          版本历史（只读）
        </Typography>
        <VersionHistory questionId={q.id} versions={q.versions} />
      </SlideOver>

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
