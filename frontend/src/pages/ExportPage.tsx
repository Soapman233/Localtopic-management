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
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LivePreviewPanel } from '../components/LivePreviewPanel'
import { ExportDiagnosticsPanel } from '../components/livePreview/ExportDiagnostics'
import { PreviewViewer } from '../components/PreviewViewer'
import { ExportResultPanel } from '../components/ExportResultPanel'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { ProgressStages } from '../components/ProgressStages'
import { usePaperStore } from '../store/paperStore'
import { describeEnvFailure, useExportGate } from '../hooks/useExportGate'
import {
  GLOSSARY,
  describeExportGate,
  describeExportGateAction,
  describeJobTimeout,
  describePreviewRetention,
  describePreviewReused,
  exportGateState,
} from '../lib/glossary'

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
  const navigate = useNavigate()

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
    elapsed,
    runPreview,
    previewStages,
    previewStage,
    exportMut,
    exportJob,
    exportResult,
    exportDisabled,
    exportHint,
    exportFormats,
    setExportFormats,
    exportStages,
    exportStage,
    exportRunning,
    exportElapsed,
    exportTimedOut,
  } = gate

  // 门禁三态 key 与文案**唯一来源**：与导出抽屉共用 `exportGateState` + `describeExportGate`，
  // 保证「同一状态下两个入口说法一致」（T3-2）。
  const gateState = exportGateState(unlocked, degradedOk)

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
        <EmptyState
          title="尚未选择试卷"
          description="请先在「组卷」页选择一份试卷，或从组卷页点击「导出」进入。"
        />
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
        {/* 三态文案与导出抽屉**同源**（exportGateState + describeExportGate）。 */}
        {gateState === 'degraded' ? (
          <Chip size="small" color="warning" variant="outlined" label={describeExportGate('degraded')} />
        ) : gateState === 'ready' ? (
          <Chip size="small" color="success" variant="outlined" label={describeExportGate('ready')} />
        ) : (
          <Chip size="small" variant="outlined" label={describeExportGate('locked')} />
        )}
        {/* 单一入口原则：导出抽屉才是组卷流程里的**唯一**导出入口；本页定位「全屏预览 / 导出历史」。 */}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/builder')}
          data-testid="back-to-builder"
        >
          回到组卷工作台
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        定位：**全屏预览 / 导出历史**。日常导出请回「组卷工作台」用导出抽屉完成（单一入口）；
        本页与导出抽屉**共用同一份门禁状态**，此处仅用于全屏查看与结果留档。
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
      {exportDataQ.isError && (
        <ErrorState
          error={exportDataQ.error}
          title="内容检查失败"
          onRetry={refreshDiagnostics}
        />
      )}
      {exportDataQ.data && <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={onRevised} />}
      {envFail !== null && contentAllowed && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          当前环境无法生成像素预览（原因：{describeEnvFailure(envFail)}）。请查看下方结构预览后确认。
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
            {previewPages.length > 0 ? GLOSSARY.regeneratePreview : GLOSSARY.generatePreview}
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
        </Stack>
        {/* 锁定态：与抽屉同源的**可执行下一步**（生成预览）+「刷新即锁」解释。 */}
        {gateState === 'locked' && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<PreviewIcon />}
              disabled={!contentAllowed || previewing}
              onClick={runPreview}
              data-testid="gate-generate-preview"
            >
              {describeExportGateAction('locked')}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {describePreviewRetention()}
            </Typography>
          </Stack>
        )}
        {exportHint && gateState !== 'locked' && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {exportHint}
          </Typography>
        )}
        {paperQ.data?.answer_mode === '答案解析版' && noAnswerCount > 0 && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            当前为「答案解析版」，但卷中有 {noAnswerCount} 题无答案；导出时这些题只会显示题干（库中无答案的题不会被硬造）。
          </Alert>
        )}
      </Paper>

      {/* 过期横幅：保留旧图 + 重新锁定（§Q4） */}
      {previewPages.length > 0 && !unlocked && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          ⚠ 内容已变更，此为旧版本预览，导出已锁定；请点「{GLOSSARY.regeneratePreview}」重新生成。
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
            {previewError && (
              <Box sx={{ mb: 1 }}>
                <ErrorState
                  error={new Error(previewError)}
                  title="预览失败"
                  onRetry={runPreview}
                />
              </Box>
            )}
            {previewing && (
              <Box sx={{ mb: 1 }}>
                {/* L4：使用 hook 暴露的**前端推断**阶段（内容检查→渲染文档→生成 PDF→生成预览图）。 */}
                <ProgressStages
                  stages={previewStages}
                  currentStage={previewStage}
                  elapsedSec={elapsed}
                  title="正在生成像素预览"
                />
              </Box>
            )}
            {previewPages.length > 0 ? (
              <Box>
                {/* L2：命中缓存用教师语言（不再透传 cached 给 PreviewViewer 的技术词 Chip）。 */}
                {previewCached && (
                  <Chip size="small" color="success" variant="outlined" label={describePreviewReused()} sx={{ mb: 1 }} />
                )}
                <PreviewViewer pages={previewPages} />
              </Box>
            ) : (
              !previewing && (
                <EmptyState
                  title="还没有像素预览"
                  description="生成后在此展示 A4 分页预览（卷头 / 题号 / 分值 / 答案区）。"
                  actionLabel={contentAllowed ? GLOSSARY.generatePreview : undefined}
                  onAction={contentAllowed ? runPreview : undefined}
                />
              )
            )}
          </Box>
        )}

        {tab === 1 && (
          <Box>
            {exportDataQ.isLoading && <LoadingState label="正在加载导出数据…" />}
            {exportDataQ.isError && (
              <ErrorState
                error={exportDataQ.error}
                title="加载导出数据失败"
                onRetry={() => exportDataQ.refetch()}
              />
            )}
            {exportDataQ.data && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  模板：{template ?? '考试'}；答案模式：{answerMode ?? '学生版'}；共 {summary?.item_count ?? 0} 题，总分 {summary?.total_score ?? 0}。
                  （题号按全卷连续重排；学生版不含答案区。）
                </Typography>
                <LivePreviewPanel paperId={paperId} data={exportDataQ.data} template={(template ?? '考试') as '考试' | '测验' | '作业'} />
                {sections.length === 0 && (
                  <EmptyState dense title="该试卷暂无题目" description="从「组卷」页加入题目后再导出。" />
                )}
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* 导出结果（P2-6 导出历史记录：本页展示本次产物） */}
      {(exportMut.isError || exportJob.data?.status === 'error' || exportResult || exportRunning || exportMut.isPending || exportTimedOut) && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            导出结果
          </Typography>
          {exportMut.isError && (
            <ErrorState
              error={exportMut.error}
              title="导出请求失败"
              onRetry={() => exportMut.mutate()}
            />
          )}
          {exportJob.data?.status === 'error' && (
            <ErrorState error={new Error(exportJob.data.error || '导出失败')} title="导出失败" />
          )}
          {(exportRunning || exportMut.isPending) && (
            // L4：导出阶段（内容检查→渲染文档→写出 DOCX/PDF），**前端推断**，后端不上报阶段名。
            <ProgressStages stages={exportStages} currentStage={exportStage} elapsedSec={exportElapsed} title="正在导出" />
          )}
          {exportTimedOut && (
            // L5 接线：作业超时不再无限转圈，给出可重试出路。
            <ErrorState error={new Error(describeJobTimeout())} title="导出超时" onRetry={() => exportMut.mutate()} />
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
