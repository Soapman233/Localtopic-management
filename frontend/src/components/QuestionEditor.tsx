/** 题目编辑表单（PRD 3.2）。
 *
 * 可编辑三类：文字（题干/答案/解析）、元数据（题型/章节/难度/知识点标签）、公式。
 * ⚠️ 年级/教材是**来源文件级**字段：此处只读展示 + 明确告知影响范围（单题编辑不提供修改入口）。
 * 图片只读。
 * 保存为**显式**操作（不自动保存）；保存前做本地校验（公式可渲染、难度合法）。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import { DIFFICULTIES, type Question } from '../api/types'
import type { QuestionPatchBody } from '../api/questions'
import { FormulaEditor } from './FormulaEditor'
import { KatexFormula } from './KatexFormula'
import { describeMentionScope } from '../lib/glossary'

const QTYPES = ['选择题', '填空题', '计算题', '实验探究题', '作图题', '简答题', '判断题']

export interface QuestionEditorProps {
  question: Question
  saving: boolean
  conflictMessage?: string | null
  onCancel: () => void
  onSave: (patch: QuestionPatchBody) => void
}

/** 题目编辑表单（题干/答案/解析/元数据/公式/知识点）。 */
export function QuestionEditor({
  question,
  saving,
  conflictMessage,
  onCancel,
  onSave,
}: QuestionEditorProps) {
  const [text, setText] = useState(question.text ?? '')
  const [answer, setAnswer] = useState(question.answer ?? '')
  const [analysis, setAnalysis] = useState(question.analysis ?? '')
  const [qtype, setQtype] = useState(question.qtype ?? '')
  const [chapter, setChapter] = useState(question.chapter ?? '')
  const [difficulty, setDifficulty] = useState(question.difficulty ?? '')
  const [labels, setLabels] = useState<string[]>(
    (question.labels ?? []).filter((l) => l.namespace === '知识点').map((l) => l.name),
  )
  const [labelInput, setLabelInput] = useState('')
  const [formulaEdits, setFormulaEdits] = useState<Record<string, string>>({})
  const [editingFid, setEditingFid] = useState<string | null>(null)

  const formulas = question.formulas ?? []

  const dirty = useMemo(() => {
    const textChanged = text !== (question.text ?? '')
    const answerChanged = answer !== (question.answer ?? '')
    const analysisChanged = analysis !== (question.analysis ?? '')
    const qtypeChanged = qtype !== (question.qtype ?? '')
    const chapterChanged = chapter !== (question.chapter ?? '')
    const difficultyChanged = difficulty !== (question.difficulty ?? '')
    const labelsChanged =
      labels.slice().sort().join('|') !==
      (question.labels ?? [])
        .filter((l) => l.namespace === '知识点')
        .map((l) => l.name)
        .sort()
        .join('|')
    const formulasChanged = Object.keys(formulaEdits).length > 0
    return {
      textChanged,
      answerChanged,
      analysisChanged,
      qtypeChanged,
      chapterChanged,
      difficultyChanged,
      labelsChanged,
      formulasChanged,
      any:
        textChanged || answerChanged || analysisChanged || qtypeChanged ||
        chapterChanged || difficultyChanged || labelsChanged || formulasChanged,
    }
  }, [text, answer, analysis, qtype, chapter, difficulty, labels, formulaEdits, question])

  const handleSave = () => {
    const patch: QuestionPatchBody = {}
    if (dirty.textChanged) patch.text = text
    if (dirty.answerChanged) patch.answer = answer
    if (dirty.analysisChanged) patch.analysis = analysis
    if (dirty.qtypeChanged) patch.qtype = qtype
    if (dirty.chapterChanged) patch.chapter = chapter
    if (dirty.difficultyChanged) patch.difficulty = difficulty
    if (dirty.labelsChanged) patch.labels = labels
    if (dirty.formulasChanged) {
      patch.formulas = Object.entries(formulaEdits).map(([fid, latex]) => ({ fid, latex }))
    }
    onSave(patch)
  }

  const addLabel = () => {
    const v = labelInput.trim()
    if (v && !labels.includes(v)) setLabels([...labels, v])
    setLabelInput('')
  }

  return (
    <Box>
      {conflictMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {conflictMessage}
        </Alert>
      )}

      <Typography variant="subtitle2" component="div" gutterBottom>
        题干（保留 ⟦Fn⟧ 占位符，公式单独编辑）
      </Typography>
      <TextField
        value={text}
        onChange={(e) => setText(e.target.value)}
        multiline
        minRows={5}
        fullWidth
        sx={{ mb: 2 }}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="答案"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
        <TextField
          label="解析"
          value={analysis}
          onChange={(e) => setAnalysis(e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" component="div" gutterBottom>
        元数据
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
        <TextField
          select
          label="题型"
          value={qtype}
          onChange={(e) => setQtype(e.target.value)}
          SelectProps={{ native: true }}
          sx={{ minWidth: 160 }}
        >
          <option value="">（未设置）</option>
          {QTYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </TextField>
        <TextField
          label="章节"
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          sx={{ minWidth: 160 }}
        />
        <TextField
          select
          label="难度"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          SelectProps={{ native: true }}
          sx={{ minWidth: 140 }}
          helperText="难度需人工标注，不做自动推断"
        >
          <option value="">未标注</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </TextField>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        年级 / 教材属于<strong>来源文件级</strong>字段：改一道题会影响该来源文件下的全部题目，
        故本题编辑页不提供修改入口（请在「来源文件」页按文件级操作）。
        <Box sx={{ mt: 0.5 }} component="span">
          当前：年级 {question.src_grade || '待补充'}；教材 {question.src_textbook || '待补充'}；来源{' '}
          {question.src_file || '—'}
        </Box>
      </Alert>

      <Typography variant="subtitle2" component="div" gutterBottom>
        知识点（可编辑标签集合）
      </Typography>
      {/* P0-1：把内部「提及口径」翻译成老师能懂的边界说明——标签只是搜索线索，不等于考点。 */}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {describeMentionScope()}。
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }} useFlexGap>
        {labels.map((name) => (
          <Chip
            key={name}
            label={name}
            size="small"
            onDelete={() => setLabels(labels.filter((x) => x !== name))}
          />
        ))}
        {labels.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            暂无知识点标签
          </Typography>
        )}
      </Stack>
      <TextField
        size="small"
        placeholder="新增知识点标签"
        value={labelInput}
        onChange={(e) => setLabelInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addLabel()
          }
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={addLabel} aria-label="添加标签">
                <AddIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2, maxWidth: 320 }}
      />

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" component="div" gutterBottom>
        公式（{formulas.length} 条，仅编辑现有公式的 LaTeX）
      </Typography>
      <Stack spacing={1} sx={{ mb: 2 }}>
        {formulas.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            本题无公式。
          </Typography>
        )}
        {formulas.map((f) => {
          const current = formulaEdits[f.fid] ?? f.latex ?? ''
          const changed = formulaEdits[f.fid] !== undefined
          return (
            <Stack
              key={f.fid}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ p: 1, border: '1px solid', borderColor: changed ? 'primary.main' : 'divider', borderRadius: 1 }}
            >
              <Chip size="small" label={f.fid} variant="outlined" />
              <Box sx={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
                <KatexFormula latex={current} />
              </Box>
              {f.status && f.status !== 'OK' && (
                <Chip size="small" color="warning" label={f.status} />
              )}
              <Tooltip title="编辑该公式 LaTeX">
                <Button size="small" startIcon={<EditIcon />} onClick={() => setEditingFid(f.fid)}>
                  编辑
                </Button>
              </Tooltip>
            </Stack>
          )
        })}
      </Stack>

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !dirty.any}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </Stack>

      <FormulaEditor
        open={editingFid !== null}
        fid={editingFid}
        initialLatex={
          editingFid
            ? formulaEdits[editingFid] ?? formulas.find((f) => f.fid === editingFid)?.latex ?? ''
            : ''
        }
        onClose={() => setEditingFid(null)}
        onConfirm={(latex) => {
          if (editingFid) setFormulaEdits({ ...formulaEdits, [editingFid]: latex })
          setEditingFid(null)
        }}
      />
    </Box>
  )
}

export default QuestionEditor
