/** P4 导出页（先预览再导出）。
 *
 * 覆盖需求：P0-11（导出预览：分页/卷头/题号重排/分值/答案区/无答案标注）、
 * P0-12（学生版/答案解析版/仅答案 × DOCX/PDF × 模板）、P2-6（导出历史记录：本页展示本次产物路径）。
 *
 * 两条预览路径：
 * 1. 「像素预览」：调 `/api/papers/{id}/preview` → 轮询作业 → 展示 `page_N.png`（与导出同一渲染器）；
 * 2. 「内容结构预览」：读 `/api/papers/{id}/export-data`，逐题列出题号/分值/题干/答案区/无答案标注。
 *
 * ★ R1 重构：像素预览 + 门禁 + 导出逻辑已抽到 `hooks/useExportGate.ts`，与导出抽屉共用
 *   **唯一实现**（此前导出页的环境失败判定漏了 `editor_sdk`，导致 DOCX 导出被永久锁死）。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import PreviewIcon from '@mui/icons-material/Preview'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useSearchParams } from 'react-router-dom'
import { LivePreviewPanel } from '../components/LivePreviewPanel'
import { ExportDiagnosticsPanel } from '../components/livePreview/ExportDiagnostics'
import { PreviewViewer } from '../components/PreviewViewer'
import { ExportResultPanel } from '../components/ExportResultPanel'
import { usePaperStore } from '../store/paperStore'
import { useExportGate } from '../hooks/useExportGate'
import { describeExportGate } from '../lib/glossary'

const ANSWER_MODES = ['学生版', '答案解析版', '仅答案']
const TEMPLATES = ['考试', '测验', '作业']

/** P4 导出页。 */
export default function ExportPage() {
  const [params, setParams] = useSearchParams()
  const { currentPaperId } = usePaperStore()
  const paperId = Number(params.get('paper_id')) || currentPaperId || 0
  return <PaperExportPage key={paperId} paperId={paperId} onRevised={id => setParams({ paper_id: String(id) })} />
}

function PaperExportPage({ paperId, onRevised }: { paperId: number; onRevised: (id: number) => void }) {
  const [tab, setTab] = useState(0)

  // 与导出抽屉**共用同一份门禁逻辑与 uiStore 状态**（§Q7）。
  const gate = useExportGate({ paperId, enabled: paperId > 0, autoPreview: false })
  const {
    paperQ,
    exportDataQ,
    contentAllowed,
    answerMode,
    template,
    setAnswerMode,
    setTemplate,
    degradedOk,
    unlocked,
    refreshDiagnostics,
    confirmDegraded,
    previewPages,
    previewCached,
    previewing,
    previewError,
    envFail,
    runPreview,
    exportMut,
    exportJob,
    exportResult,
    exportDisabled,
    exportFormats,
    setExportFormats,
  } = gate

  // 「是否无答案」必须以**试卷快照**为准：导出数据里 `answer` 会随答案模式被置空
  // （学生版恒为 null），若用它判断会把学生版全部误判为「无答案」。
  const hasAnswerById = useMemo(() => {
    const m = new Map<number, boolean>()
    for (const it of paperQ.data?.items ?? []) m.set(it.id, Boolean(it.has_answer))
    return m
  }, [paperQ.data])

  if (paperId <= 0) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          导出
        </Typography>
        <Alert severity="info">请先在「组卷」页选择一份试卷，或从组卷页点击「导出」进入。</Alert>
      </Box>
    )
  }

  const sections = exportDataQ.data?.sections ?? []
  const summary = paperQ.data?.summary ?? exportDataQ.data?.summary
  const allQuestions = sections.flatMap((s) => s.questions)
  const noAnswerCount =
    hasAnswerById.size > 0
      ? allQuestions.filter((q) => hasAnswerById.get(q.item_id) === false).length
      : allQuestions.filter((q) => !q.answer || !q.answer.trim()).length

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
        <Typography variant="h6">
          导出中心 · {paperQ.data?.title ?? `试卷 #${paperId}`}
        </Typography>
        {unlocked ? (
          degradedOk ? (
            <Chip size="small" color="warning" variant="outlined" label={describeExportGate('degraded')} />
          ) : (
            <Chip size="small" color="success" variant="outlined" label={describeExportGate('ready')} />
          )
        ) : (
          <Chip size="small" variant="outlined" label={describeExportGate('locked')} />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        定位：全屏像素预览 / 导出中心（**非必经路径**，门禁在导出抽屉内亦可完成）；与导出抽屉**共用同一份门禁状态**。
        预览通常秒回；仅当内容有改动时才需约 3–8 秒。
      </Typography>

      {summary && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Chip size="small" label={`题数 ${summary.item_count}`} />
          <Chip size="small" label={`总分 ${summary.total_score}`} />
          {summary.unscored_count > 0 && <Chip size="small" color="warning" label={`未设分 ${summary.unscored_count}`} />}
          {noAnswerCount > 0 && <Chip size="small" color="warning" label={`无答案 ${noAnswerCount}`} />}
        </Stack>
      )}

      {exportDataQ.isFetching && <Alert severity="info">正在检查当前锁定内容…</Alert>}
      {exportDataQ.isError && <Alert severity="error" action={<Button onClick={refreshDiagnostics}>重试</Button>}>内容检查失败：{(exportDataQ.error as Error).message}</Alert>}
      {exportDataQ.data && <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={onRevised} />}
      {envFail !== null && contentAllowed && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          当前环境无法生成像素预览。请查看下方结构预览后确认。
          <Button onClick={() => setTab(1)}>查看当前结构预览</Button>
          <Button disabled={tab !== 1 || degradedOk} onClick={() => { confirmDegraded(); setExportFormats({ pdf: false }) }}>
            确认当前结构预览并允许DOCX导出
          </Button>
        </Alert>
      )}
      {/* 导出选项（P0-12） */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <Box>
            <Typography variant="caption" color="text.secondary">
              答案模式
            </Typography>
            <Select size="small" value={answerMode ?? '学生版'} onChange={(e) => setAnswerMode(e.target.value)} sx={{ minWidth: 140, display: 'block' }}>
              {ANSWER_MODES.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              模板
            </Typography>
            <Select size="small" value={template ?? '考试'} onChange={(e) => setTemplate(e.target.value)} sx={{ minWidth: 120, display: 'block' }}>
              {TEMPLATES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              格式
            </Typography>
            <Stack direction="row">
              <FormControlLabel control={<Checkbox size="small" checked={exportFormats.docx} onChange={(e) => setExportFormats({ docx: e.target.checked })} />} label="DOCX" />
              <FormControlLabel control={<Checkbox size="small" checked={exportFormats.pdf} onChange={(e) => setExportFormats({ pdf: e.target.checked })} />} label="PDF" />
            </Stack>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            startIcon={<PreviewIcon />}
            disabled={!contentAllowed || previewing}
            onClick={runPreview}
          >
            生成预览
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            disabled={exportDisabled}
            onClick={() => exportMut.mutate()}
            data-testid="export-page-export-button"
          >
            导出
          </Button>
          {!unlocked && (
            <Typography variant="caption" color="text.secondary">
              请先生成 / 刷新像素预览
            </Typography>
          )}
        </Stack>
        {paperQ.data?.answer_mode === '答案解析版' && noAnswerCount > 0 && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            当前为「答案解析版」，但卷中有 {noAnswerCount} 题无答案；导出时这些题只会显示题干（库中无答案的题不会被硬造）。
          </Alert>
        )}
      </Paper>

      {/* 过期横幅：保留旧图 + 重新锁定（§Q4） */}
      {previewPages.length > 0 && !unlocked && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          ⚠ 内容已变更，此为旧版本预览，导出已锁定；请点「生成预览」重新生成。
        </Alert>
      )}

      {/* 预览区（先预览再导出） */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="像素预览" />
          <Tab label="内容结构预览" />
        </Tabs>

        {tab === 0 && (
          <Box>
            {previewError && <Alert severity="error" sx={{ mb: 1 }}>预览失败：{previewError}</Alert>}
            {previewing && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  正在渲染预览（首次约 3–8 秒）…
                </Typography>
              </Stack>
            )}
            {previewPages.length > 0 ? (
              <PreviewViewer pages={previewPages} cached={previewCached} />
            ) : (
              !previewing && (
                <Alert severity="info">点击「生成预览」后在此展示 A4 分页预览（卷头/题号/分值/答案区）。</Alert>
              )
            )}
          </Box>
        )}

        {tab === 1 && (
          <Box>
            {exportDataQ.isLoading && <CircularProgress size={20} />}
            {exportDataQ.isError && <Alert severity="error">加载导出数据失败：{(exportDataQ.error as Error).message}</Alert>}
            {exportDataQ.data && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  模板：{template ?? '考试'}；答案模式：{answerMode ?? '学生版'}；共 {summary?.item_count ?? 0} 题，总分 {summary?.total_score ?? 0}。
                  （题号按全卷连续重排；学生版不含答案区。）
                </Typography>
                <LivePreviewPanel paperId={paperId} data={exportDataQ.data} template={(template ?? '考试') as '考试' | '测验' | '作业'} />
                {sections.length === 0 && <Alert severity="info">该试卷暂无题目。</Alert>}
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* 导出结果（P2-6 导出历史记录：本页展示本次产物） */}
      {(exportMut.isError || exportJob.data?.status === 'error' || exportResult) && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            导出结果
          </Typography>
          {exportMut.isError && <Alert severity="error">导出请求失败：{(exportMut.error as Error).message}</Alert>}
          {exportJob.data?.status === 'error' && <Alert severity="error">导出失败：{exportJob.data.error}</Alert>}
          {exportJob.data?.status === 'running' && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">正在导出…</Typography>
            </Stack>
          )}
          {exportResult && (
            <ExportResultPanel result={exportResult} />
          )}
        </Paper>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        提示：预览与导出走同一份文档计划与同一个 DOCX 渲染器，因此像素预览与导出结果逐像素一致；
        若修改试卷内容（加题/删题/重排/设分/改模板/刷新快照）后需重新生成预览。
      </Typography>
    </Box>
  )
}
