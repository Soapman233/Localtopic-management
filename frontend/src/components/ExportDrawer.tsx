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
  CircularProgress,
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
import { envReason, useExportGate, type EnvFailure } from '../hooks/useExportGate'

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
    exportMut,
    exportJob,
    exportResult,
    exportDisabled,
    exportHint,
    exportFormats,
    setExportFormats,
    showStale,
  } = gate

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <Drawer anchor="right" open={open} onClose={handleClose}>
      <Box sx={{ width: { xs: '92vw', sm: 720 }, p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* 头部 */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            导出 · {paperQ.data?.title ?? `试卷 #${paperId}`}
          </Typography>
          <IconButton size="small" onClick={handleClose} aria-label="关闭">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {exportDataQ.isFetching && <Alert severity="info">正在检查当前锁定内容…</Alert>}
        {exportDataQ.isError && <Alert severity="error" action={<Button onClick={refreshDiagnostics}>重试</Button>}>内容检查失败：{(exportDataQ.error as Error).message}</Alert>}
        {exportDataQ.data && <ExportDiagnosticsPanel paperId={paperId} data={exportDataQ.data} onRevised={id => { props.onRevised?.(id); usePaperStore.getState().setCurrentPaperId(id); onClose() }} />}
        {/* 门禁状态徽标 */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {unlocked ? (
            degradedOk ? (
              <Chip size="small" color="warning" variant="outlined" label="降级解锁（结构预览已确认）" />
            ) : (
              <Chip size="small" color="success" variant="outlined" label="门禁已解锁（像素预览为当前内容）" />
            )
          ) : (
            <Chip size="small" color="default" variant="outlined" label="导出已锁定（需先预览当前内容）" />
          )}
          {previewCached && <Chip size="small" color="success" variant="outlined" label="命中缓存" />}
          <Typography variant="caption" color="text.secondary">
            预览通常秒回；仅当内容有改动时才需约 3–8 秒。
          </Typography>
        </Stack>

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
            {previewPages.length > 0 ? '重新生成预览' : '生成预览'}
          </Button>
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* 预览区（滚动） */}
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {previewing && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                正在渲染像素预览，约 3–8 秒…（未改动内容时通常秒回）
                {elapsed > 0 ? ` 已用 ${elapsed}s` : ''}
              </Typography>
            </Stack>
          )}

          {/* 环境降级逃生：像素预览不可用时，以「结构预览确认」替代 */}
          {envFail !== null && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2">
                当前环境不支持像素预览，已降级为「结构预览确认」
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                原因：{envReason(envFail)}。
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
                <Chip size="small" color="warning" label="已确认结构预览（降级解锁）" />
              )}
              <Box sx={{ mt: 1.5 }}>
                {exportDataQ.isLoading && <CircularProgress size={18} />}
                {exportDataQ.isError && (
                  <Alert severity="error">结构预览数据加载失败：{(exportDataQ.error as Error).message}</Alert>
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
            <Alert severity="error" sx={{ mb: 1.5 }}>
              预览生成失败：{previewError}
            </Alert>
          )}

          {/* 过期横幅：保留旧图 + 重新锁定（§Q4） */}
          {showStale && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1.5 }}>
              ⚠ 内容已变更，此为旧版本预览，导出已锁定
              {previewing ? '（正在重新生成…）' : '；请点「重新生成预览」'}。
            </Alert>
          )}

          {previewPages.length > 0 ? (
            <PreviewViewer pages={previewPages} cached={previewCached} />
          ) : (
            !previewing &&
            envFail === null && (
              <Alert severity="info">内容检查通过后可生成像素预览；请先处理上方阻断项。</Alert>
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
          <Alert severity="error" sx={{ mt: 1 }}>
            导出请求失败：{(exportMut.error as Error).message}
          </Alert>
        )}
        {exportJob.data?.status === 'running' && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              正在导出…
            </Typography>
          </Stack>
        )}
        {exportJob.data?.status === 'error' && (
          <Alert severity="error" sx={{ mt: 1 }}>
            导出失败：{exportJob.data.error}
          </Alert>
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
