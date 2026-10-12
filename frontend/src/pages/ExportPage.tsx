/** 全屏试卷预览辅助页。
 * 保留双预览、答案模式、模板和只读诊断；导出提交及修订仅在工作台抽屉操作。
 * useExportGate 的作业状态属于当前组件，不能在此承诺历史或抽屉的本次结果。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import PreviewIcon from '@mui/icons-material/Preview'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { LivePreviewPanel } from '../components/LivePreviewPanel'
import { ExportDiagnosticsPanel } from '../components/livePreview/ExportDiagnostics'
import { PreviewViewer } from '../components/PreviewViewer'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { ProgressStages } from '../components/ProgressStages'
import { usePaperStore } from '../store/paperStore'
import { usePaperLibraryStore } from '../store/paperLibraryStore'
import { describeEnvFailure, useExportGate } from '../hooks/useExportGate'
import {
  GLOSSARY,
  describeExportGate,
  describePreviewRetention,
  describePreviewReused,
  exportGateState,
} from '../lib/glossary'

const ANSWER_MODES = ['学生版', '答案解析版', '仅答案']
const TEMPLATES = ['考试', '测验', '作业']

/** P4 导出页。 */
export default function ExportPage() {
  const [params] = useSearchParams()
  const { currentPaperId } = usePaperStore()
  const requested = params.has('paper_id') ? Number(params.get('paper_id')) : currentPaperId
  // 指定卷非法或不存在时不能退回全局旧卷，避免预览及回程误用另一份试卷。
  const paperId = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : 0
  return <PaperExportPage key={paperId} paperId={paperId} />
}

function PaperExportPage({ paperId }: { paperId: number }) {
  const [tab, setTab] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const openPaperLibrary = usePaperLibraryStore(s => s.openPaperLibrary)

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
    previewPages,
    previewCached,
    previewing,
    previewError,
    envFail,
    elapsed,
    runPreview,
    previewStages,
    previewStage,
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
        <Typography variant="h6" component="h1" gutterBottom>
          试卷预览
        </Typography>
        <EmptyState
          title="尚未选择试卷"
          description="请在「试卷管理」选择一份试卷。"
          actionLabel="选择试卷"
          onAction={openPaperLibrary}
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
        <Typography variant="h6" component="h1">
          试卷预览 · {paperQ.data?.title ?? `试卷 #${paperId}`}
        </Typography>
        {/* 三态文案与导出抽屉**同源**（exportGateState + describeExportGate）。 */}
        {gateState === 'degraded' ? (
          <Chip size="small" color="warning" variant="outlined" label={describeExportGate('degraded')} />
        ) : gateState === 'ready' ? (
          <Chip size="small" color="success" variant="outlined" label={describeExportGate('ready')} />
        ) : (
          <Chip size="small" variant="outlined" label={describeExportGate('locked')} />
        )}
        {/* 一次性回程意图由工作台消费；不通过会被筛选同步覆盖的查询参数触发导出。 */}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ pathname: '/builder', search: location.search }, { state: { ...(location.state ?? {}), openExportForPaperId: paperId } })}
          data-testid="back-to-builder"
        >
          回到组卷工作台
        </Button>
      </Stack>

      {summary && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Chip size="small" label={`题数 ${summary.item_count}`} />
          <Chip size="small" label={`总分 ${summary.total_score}`} />
          {summary.unscored_count > 0 && <Chip size="small" color="warning" label={`未设分 ${summary.unscored_count}`} />}
          {noAnswerCount > 0 && <Chip size="small" color="warning" label={`无答案 ${noAnswerCount}`} />}
        </Stack>
      )}

      {paperQ.isError && <ErrorState error={paperQ.error} title="指定试卷加载失败" onRetry={() => paperQ.refetch()} />}
      {exportDataQ.isFetching && <Alert severity="info">正在检查当前锁定内容…</Alert>}
      {exportDataQ.isError && (
        <ErrorState
          error={exportDataQ.error}
          title="内容检查失败"
          onRetry={refreshDiagnostics}
        />
      )}
      {exportDataQ.data && <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} readOnly />}
      {envFail !== null && contentAllowed && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          当前环境无法生成像素预览（原因：{describeEnvFailure(envFail)}）。请查看下方结构预览，回到工作台后进行导出确认。
          <Button onClick={() => setTab(1)}>查看当前结构预览</Button>
        </Alert>
      )}
      {/* 预览模式及模板只影响当前预览，不写回试卷。 */}
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
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            startIcon={<PreviewIcon />}
            disabled={!contentAllowed || previewing}
            onClick={runPreview}
          >
            {previewPages.length > 0 ? GLOSSARY.regeneratePreview : GLOSSARY.generatePreview}
          </Button>
        </Stack>
        {gateState === 'locked' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{describePreviewRetention()}</Typography>}
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
                  <EmptyState
                    dense
                    title="该试卷暂无题目"
                    description="这份试卷还没有题目，先到「组卷」页加入题目。"
                    actionLabel="去组卷"
                    onAction={() => navigate({ pathname: '/builder', search: location.search }, { state: { ...(location.state ?? {}), openExportForPaperId: paperId } })}
                  />
                )}
              </Box>
            )}
          </Box>
        )}
      </Paper>

    </Box>
  )
}
