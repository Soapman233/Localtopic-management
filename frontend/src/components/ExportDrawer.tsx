/**
 * ExportDrawer —— 导出抽屉 + **强制预览门禁**（P2）。
 *
 * 依据《流程重构设计》§5-Q3 / §Q4：
 *  - **强制先预览**：只有「**当前内容**已成功生成像素预览且其后未变化」时，导出按钮才可点；
 *  - **进抽屉自动生成**像素预览（命中缓存 ≈ 秒回；未命中约 3–8s，有进度提示）；
 *  - **过期即锁**：任何影响内容的操作（含 `answer_mode`/`template` 变化）→ 置 `previewFresh=false`；
 *  - **过期保留旧图 + 标「已过期」横幅 + 重新锁定**（保留「看的对象」，锁住「导出的资格」）；
 *  - **环境降级逃生**：像素预览因**环境原因**失败（无 editor_sdk / 无 Word·WPS）时，
 *    提供**降级门禁**——以「结构预览已确认」替代，明确提示，避免永久锁死 DOCX 导出。
 *
 * ★ R1 重构：门禁逻辑（预览 / 失效 / 降级 / 导出）已抽到 `hooks/useExportGate.ts`，
 *   与导出页共用**唯一实现**；本组件只负责抽屉 UI。
 * 门禁状态存于 `uiStore`（按 paperId 分组），供 P3 的组卷页编辑操作直接置 false。
 * 复用现有端点：#28 preview / #29 export / #30 jobs / #31 page_N.png。**未新增端点。**
 */
import { useCallback } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { usePaperStore } from '../store/paperStore'
import { ExportDiagnosticsPanel } from './livePreview/ExportDiagnostics'
import { PreviewViewer } from './PreviewViewer'
import { LivePreviewPanel } from './LivePreviewPanel'
import { ExportResultPanel } from './ExportResultPanel'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { ProgressStages } from './ProgressStages'
import { describeEnvFailure, useExportGate, type EnvFailure } from '../hooks/useExportGate'
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

export type { EnvFailure }

export interface ExportDrawerProps {
  open: boolean
  onClose: () => void
  paperId: number
  /** 打开抽屉时是否自动开始生成像素预览（默认 true，§Q3③）。 */
  autoPreview?: boolean
  onRevised?: (id: number) => void
  /**
   * **仅用于演示/验证**：强制模拟环境失败，跳过真实请求，抛出与后端一致的错误。
   * 生产传入 `null`/省略。
   */
  simulateEnvFailure?: EnvFailure
}

export function ExportDrawer(props: ExportDrawerProps) {
  return <ExportDrawerForPaper key={props.paperId} {...props} />
}

function ExportDrawerForPaper(props: ExportDrawerProps) {
  const { open, onClose, paperId, autoPreview = true, simulateEnvFailure = null } = props

  const gate = useExportGate({ paperId, enabled: open, autoPreview, simulateEnvFailure, debugKey: '__exportDrawer' })
  const {
    paperQ,
    exportDataQ,
    contentAllowed,
    contentDigest,
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
    showStale,
    exportStages,
    exportStage,
    exportRunning,
    exportElapsed,
    exportTimedOut,
  } = gate

  // 门禁三态 key 与文案**唯一来源**：抽屉与导出中心共用 `exportGateState` + `describeExportGate`，
  // 保证「同一状态下两个入口说法一致」（T3-2）。
  const gateState = exportGateState(unlocked, degradedOk)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <Drawer anchor="right" open={open} onClose={handleClose}
      aria-labelledby="export-drawer-title">
      <Box sx={{ width: { xs: '92vw', sm: 720 }, p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* 头部 */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {/* P5-3：抽屉标题是编辑 chrome 而非文档章节，显式降为 <div>，避免 h1→h6 跳级（视觉不变）。
              但仍给它 id 供 Drawer 的 aria-labelledby 引用——**可访问名比标题层级重要**。 */}
          <Typography id="export-drawer-title" variant="h6" component="div" sx={{ flex: 1 }}>
            导出 · {paperQ.data?.title ?? `试卷 #${paperId}`}
          </Typography>
          <IconButton size="small" onClick={handleClose} aria-label="关闭">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {exportDataQ.isFetching && <Alert severity="info">正在检查当前锁定内容…</Alert>}
        {exportDataQ.isError && <Alert severity="error" action={<Button onClick={refreshDiagnostics}>重试</Button>}>内容检查失败：{(exportDataQ.error as Error).message}</Alert>}
        {exportDataQ.data && <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={id => { props.onRevised?.(id); usePaperStore.getState().setCurrentPaperId(id); onClose() }} />}
        {/* 门禁状态徽标（三态文案与导出中心同源；锁定态**就地给出可执行动作**） */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
          {gateState === 'degraded' ? (
            <Chip size="small" color="warning" variant="outlined" label={describeExportGate('degraded')} />
          ) : gateState === 'ready' ? (
            <Chip size="small" color="success" variant="outlined" label={describeExportGate('ready')} />
          ) : (
            <Chip size="small" color="default" variant="outlined" label={describeExportGate('locked')} />
          )}
          {/* 锁定态：直接把「生成预览」按钮摆在门禁提示旁，老师无需自己找预览入口。 */}
          {gateState === 'locked' && (
            <Button
              size="small"
              variant="contained"
              startIcon={<RefreshIcon />}
              disabled={previewing || !contentAllowed}
              onClick={() => runPreview()}
              data-testid="gate-generate-preview"
            >
              {describeExportGateAction('locked')}
            </Button>
          )}
          {previewCached && <Chip size="small" color="success" variant="outlined" label={describePreviewReused()} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {gateState === 'locked'
            ? `${describePreviewRetention()}（预览通常秒回，仅内容有改动时需约 3–8 秒）。`
            : '预览通常秒回；仅当内容有改动时才需约 3–8 秒。'}
        </Typography>

        {/* 导出设置 */}
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 1.5 }}>
          <Box data-testid="export-answer-mode">
            <Typography variant="caption" color="text.secondary">
              答案模式
            </Typography>
            <Select
              size="small"
              value={answerMode ?? ''}
              onChange={(e) => setAnswerMode(e.target.value)}
              sx={{ minWidth: 140, display: 'block' }}
            >
              {ANSWER_MODES.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box data-testid="export-template">
            <Typography variant="caption" color="text.secondary">
              模板
            </Typography>
            <Select
              size="small"
              value={template ?? ''}
              onChange={(e) => setTemplate(e.target.value)}
              sx={{ minWidth: 120, display: 'block' }}
            >
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
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={exportFormats.docx}
                    onChange={(e) => setExportFormats({ docx: e.target.checked })}
                  />
                }
                label="DOCX"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={exportFormats.pdf}
                    onChange={(e) => setExportFormats({ pdf: e.target.checked })}
                  />
                }
                label="PDF"
              />
            </Stack>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={previewing || !contentAllowed}
            onClick={() => runPreview()}
            data-testid="regen-button"
          >
            {previewPages.length > 0 ? GLOSSARY.regeneratePreview : GLOSSARY.generatePreview}
          </Button>
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* 预览区（滚动） */}
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
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

          {/* 环境降级逃生：像素预览不可用时，以「结构预览确认」替代 */}
          {envFail !== null && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" component="div">
                当前电脑无法生成像素预览，已改用结构预览确认
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                原因：{describeEnvFailure(envFail)}。
                {previewError ? `（${previewError}）` : ''}
              </Typography>
              {!degradedOk ? (
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  disabled={!contentAllowed}
                  onClick={confirmDegraded}
                  data-testid="confirm-degraded"
                >
                  我已确认下方结构预览 → 允许导出
                </Button>
              ) : (
                <Chip size="small" color="warning" label={describeExportGate('degraded')} />
              )}
              <Box sx={{ mt: 1.5 }}>
                {exportDataQ.isLoading && <LoadingState dense label="正在加载结构预览数据…" />}
                {exportDataQ.isError && (
                  <ErrorState
                    dense
                    error={exportDataQ.error}
                    title="结构预览数据加载失败"
                    onRetry={() => exportDataQ.refetch()}
                  />
                )}
                {exportDataQ.data && (
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                    <LivePreviewPanel paperId={paperId} data={exportDataQ.data} template={(template ?? '考试') as '考试' | '测验' | '作业'} debug={false} />
                  </Box>
                )}
              </Box>
            </Alert>
          )}

          {previewError && envFail === null && (
            <Box sx={{ mb: 1.5 }}>
              <ErrorState
                error={new Error(previewError)}
                title="预览生成失败"
                onRetry={() => runPreview()}
              />
            </Box>
          )}

          {/* 过期横幅：保留旧图 + 重新锁定（§Q4） */}
          {showStale && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1.5 }}>
              ⚠ 内容已变更，此为旧版本预览，导出已锁定
              {previewing ? '（正在重新生成…）' : `；请点「${GLOSSARY.regeneratePreview}」`}。
            </Alert>
          )}

          {previewPages.length > 0 ? (
            // L2：不再把 `cached` 透传给 PreviewViewer（其内部会渲染技术词「命中缓存」），
            // 改为在本组件用教师语言 Chip（见上方 describePreviewReused）。
            <PreviewViewer pages={previewPages} />
          ) : (
            !previewing &&
            envFail === null && (
              <EmptyState
                title="还没有像素预览"
                description={
                  contentAllowed
                    ? '生成后在此展示 A4 分页预览。'
                    : '请先处理上方阻断项，通过内容检查后可生成预览。'
                }
                actionLabel={contentAllowed ? GLOSSARY.generatePreview : undefined}
                onAction={contentAllowed ? () => runPreview() : undefined}
              />
            )
          )}
        </Box>

        {/* 底部：导出按钮 + 结果 */}
        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            disabled={exportDisabled}
            onClick={() => exportMut.mutate()}
            data-testid="export-button"
          >
            {previewing ? '预览生成中…' : '导出'}
          </Button>
          {exportHint && (
            <Typography variant="caption" color="text.secondary">
              {exportHint}
            </Typography>
          )}
        </Stack>

        {exportMut.isError && (
          <Box sx={{ mt: 1 }}>
            <ErrorState
              error={exportMut.error}
              title="导出请求失败"
              onRetry={() => exportMut.mutate()}
            />
          </Box>
        )}
        {(exportRunning || exportMut.isPending) && (
          <Box sx={{ mt: 1 }}>
            {/* L4：导出阶段（内容检查→渲染文档→写出 DOCX/PDF），**前端推断**，后端不上报阶段名。 */}
            <ProgressStages stages={exportStages} currentStage={exportStage} elapsedSec={exportElapsed} title="正在导出" />
          </Box>
        )}
        {exportTimedOut && (
          // L5 接线：作业超时不再无限转圈，给出可重试出路。
          <Box sx={{ mt: 1 }}>
            <ErrorState error={new Error(describeJobTimeout())} title="导出超时" onRetry={() => exportMut.mutate()} />
          </Box>
        )}
        {exportJob.data?.status === 'error' && (
          <Box sx={{ mt: 1 }}>
            <ErrorState error={new Error(exportJob.data.error || '导出失败')} title="导出失败" />
          </Box>
        )}
        {exportResult && (
          <Box sx={{ mt: 1 }}>
            <ExportResultPanel result={exportResult} />
          </Box>
        )}
      </Box>
    </Drawer>
  )
}

export default ExportDrawer
