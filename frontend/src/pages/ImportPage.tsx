/** 导入试卷页（Phase 2.3）。
 *
 * 个人客户端是「**自己建库**」——导入是唯一的建库途径。本页把「选文件 → 上传 → 等作业 → 看结果」
 * 串成一条闭环，替代此前的 4+ 条命令行。
 *
 * 覆盖需求：
 * 1. **拖拽 + 点击**两种方式选择文件，扩展名从 ``GET /api/import/status`` 读（**不硬编码**）；
 * 2. 上传前**前端预校验**扩展名与大小，给出清晰中文提示；
 * 3. 上传后**轮询作业**并展示进度；完成后展示 新增 / 更新 / 跳过 / 待复核 / 耗时；
 * 4. 失败时展示可读错误（40010 / 40011 映射成人话）；
 * 5. ``enabled=false`` 时禁用入口并说明原因；
 * 6. 完成后提供「去看题库」的跳转。
 *
 * 复用既有设施：四态组件（LoadingState / ErrorState / ProgressStages）、
 * ``useJob`` 轮询、``qk`` queryKey 工厂、``describeImportError`` 错误映射。
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import { useNavigate } from 'react-router-dom'
import { getImportStatus, submitImportDocx } from '../api/imports'
import { qk } from '../api/queryKeys'
import { describeImportError } from '../api/errors'
import { useJob } from '../hooks/useJob'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import PageHeader from '../components/PageHeader'
import { ProgressStages } from '../components/ProgressStages'
import {
  describeImportDisabled,
  describeImportGoToLibrary,
  describeImportPendingReview,
} from '../lib/glossary'
import { acceptAttr, formatBytes, validateImportFile } from '../lib/importFile'
import type { ImportJobResult } from '../api/types'

/** 把秒数格式化为「x.xx 秒」。 */
function formatSeconds(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? `${seconds.toFixed(2)} 秒` : '—'
}

/** 导入完成后的结果面板。 */
function ImportResultPanel({ result, onReset }: { result: ImportJobResult; onReset: () => void }) {
  const navigate = useNavigate()
  const inserted = result.inserted ?? 0
  const updated = result.updated ?? 0
  const skipped = result.skipped ?? 0
  const reviewCount = result.review_count ?? 0
  const junk = result.junk ?? 0

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <CheckCircleIcon color="success" />
        <Typography variant="subtitle1" component="h2" fontWeight={600}>
          导入完成
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, wordBreak: 'break-all' }}>
        文件：{result.filename}
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip color="success" variant="outlined" label={`新增 ${inserted}`} />
        <Chip variant="outlined" label={`更新 ${updated}`} />
        <Chip variant="outlined" label={`跳过 ${skipped}`} />
        <Chip color="warning" variant="outlined" label={`${describeImportPendingReview()} ${reviewCount}`} />
        <Chip variant="outlined" label={`耗时 ${formatSeconds(result.seconds)}`} />
        {junk > 0 && <Chip variant="outlined" label={`无效 ${junk}`} />}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" onClick={() => navigate('/search')}>
          {describeImportGoToLibrary()}
        </Button>
        <Button onClick={onReset}>再导入一份</Button>
      </Stack>
    </Paper>
  )
}

/** 导入试卷页。 */
export default function ImportPage() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dragActive, setDragActive] = useState(false)
  const [selected, setSelected] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const statusQ = useQuery({ queryKey: qk.importStatus(), queryFn: () => getImportStatus() })
  const status = statusQ.data
  const enabled = status?.enabled ?? false

  // 上传提交（multipart）。
  const submitMut = useMutation({
    mutationFn: (file: File) => submitImportDocx(file),
    onSuccess: (res) => setJobId(res.job_id),
  })

  // 作业轮询（复用既有 useJob：终态即停，超时给出路）。
  const job = useJob(jobId)
  const jobResult = (job.data?.result ?? null) as ImportJobResult | null

  // 导入成功 → 题库数据变了：刷新统计 / 来源 / 检索域，让首启引导与统计页同步。
  const succeeded = job.data?.status === 'done' && jobResult?.status === 'OK'
  useEffect(() => {
    if (!succeeded) return
    qc.invalidateQueries({ queryKey: qk.stats() })
    qc.invalidateQueries({ queryKey: qk.sources() })
    qc.invalidateQueries({ queryKey: qk.searchRoot() })
    qc.invalidateQueries({ queryKey: qk.facetsRoot() })
  }, [succeeded, qc])

  /** 重置到「待选文件」状态（重新导入一份）。 */
  const reset = () => {
    setSelected(null)
    setClientError(null)
    setJobId(null)
    submitMut.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** 选到文件后的统一入口：前端预校验，通过才进入「待上传」。 */
  const handleFile = (file: File | null | undefined) => {
    setClientError(null)
    setSelected(null)
    setJobId(null)
    submitMut.reset()
    if (!file || !status) return
    const v = validateImportFile(file, status)
    if (!v.ok) {
      setClientError(v.message ?? '这个文件不符合导入要求。')
      return
    }
    setSelected(file)
  }

  const openPicker = () => {
    if (enabled) fileInputRef.current?.click()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (!enabled) return
    handleFile(e.dataTransfer?.files?.[0])
  }

  const suffixes = status?.allowed_suffixes ?? []

  return (
    <Box>
      <PageHeader
        title="导入试卷"
        meta="导入是唯一的建库途径。"
        level="page"
      />

      {statusQ.isLoading && <LoadingState label="正在检查导入功能…" />}
      {statusQ.isError && (
        <ErrorState
          error={statusQ.error}
          title="无法检查导入功能"
          onRetry={() => statusQ.refetch()}
        />
      )}

      {status && (
        <>
          {/* 5) enabled=false：禁用入口并说明原因 */}
          {!enabled && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>导入功能已关闭</AlertTitle>
              {describeImportDisabled()}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            支持 {suffixes.join('、') || '（服务端未声明）'}，单个文件不超过 {formatBytes(status.max_bytes)}。
          </Typography>

          {/* 1) 拖拽 + 点击 两种方式选择文件 */}
          <Paper
            variant="outlined"
            role="button"
            tabIndex={enabled ? 0 : -1}
            aria-disabled={!enabled}
            aria-label={`选择要导入的试卷文件，支持 ${suffixes.join('、')}`}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (!enabled) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openPicker()
              }
            }}
            onDragOver={(e) => {
              if (!enabled) return
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            sx={{
              p: 4,
              textAlign: 'center',
              cursor: enabled ? 'pointer' : 'not-allowed',
              borderStyle: 'dashed',
              borderWidth: 2,
              borderColor: dragActive ? 'primary.main' : 'divider',
              bgcolor: dragActive ? 'action.hover' : 'transparent',
              opacity: enabled ? 1 : 0.6,
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
            <Typography variant="subtitle1" component="div" fontWeight={600} sx={{ mt: 1 }}>
              把试卷文件拖到这里，或点击选择
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {enabled ? '导入后会自动解析题目、公式与图片。' : '本机已关闭导入功能。'}
            </Typography>
          </Paper>

          {/* 隐藏的原生文件选择器：点击/键盘动作都落到它上面 */}
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttr(suffixes)}
            disabled={!enabled}
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFile(e.target.files?.[0])
              // 允许再次选择同一个文件（否则 change 不触发）。
              e.target.value = ''
            }}
          />

          {/* 2) 前端预校验失败 */}
          {clientError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setClientError(null)}>
              {clientError}
            </Alert>
          )}

          {/* 已选文件 + 提交 */}
          {selected && !jobId && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
              <Chip label={`${selected.name}（${formatBytes(selected.size)}）`} variant="outlined" />
              <Button
                variant="contained"
                disabled={submitMut.isPending}
                onClick={() => submitMut.mutate(selected)}
              >
                开始导入
              </Button>
              <Button onClick={reset}>取消</Button>
            </Stack>
          )}

          {/* 4) 提交失败（含 40010 / 40011 映射） */}
          {submitMut.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              <AlertTitle>提交失败</AlertTitle>
              {describeImportError(submitMut.error)}
            </Alert>
          )}

          {/* 3) 轮询作业：进行中展示阶段与进度 */}
          {jobId && (job.data?.status === 'pending' || job.data?.status === 'running' || job.isLoading) && (
            <Box sx={{ mt: 2 }}>
              <ProgressStages
                title="正在导入试卷"
                stages={['解析试卷（公式 / 图片）', '写入题库']}
                currentStage={0}
                expectedHint="通常几秒到 1 分钟；大文件或含大量公式时会更久"
              />
              <LinearProgress sx={{ mt: 1 }} />
            </Box>
          )}

          {/* 作业超时：给出可执行出路 */}
          {job.timedOut && (
            <Alert
              severity="warning"
              sx={{ mt: 2 }}
              action={<Button color="inherit" size="small" onClick={reset}>重新导入</Button>}
            >
              导入耗时过长，可能仍在后台处理。可稍后到「题库统计」查看，或重新导入。
            </Alert>
          )}

          {/* 作业失败 */}
          {job.data?.status === 'error' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              <AlertTitle>导入失败</AlertTitle>
              {describeImportError({ error_code: job.data.error_code, error: job.data.error })}
            </Alert>
          )}

          {/* 作业完成但预处理失败（作业本身是 done，故须按 result.status 分支） */}
          {job.data?.status === 'done' && jobResult?.status === 'ERROR' && (
            <ErrorState
              title="导入失败"
              error={new Error(jobResult.error || '试卷预处理失败，请检查文件是否损坏。')}
              onRetry={reset}
              retryLabel="重新导入"
            />
          )}

          {/* 3) 完成：结果面板 */}
          {succeeded && jobResult && <ImportResultPanel result={jobResult} onReset={reset} />}
        </>
      )}
    </Box>
  )
}
