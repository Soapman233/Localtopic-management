/**
 * useExportGate —— 导出「像素预览 + 强制门禁 + 导出」的**共享逻辑**（R1 重构）。
 *
 * 背景：导出抽屉（`components/ExportDrawer.tsx`）与导出页（`pages/ExportPage.tsx`）
 * 原先各自复制了约 400 行门禁逻辑，两处已经出现**行为不一致**（导出页的环境失败判定
 * 只认 `Word|WPS`，漏了 `editor_sdk` → 缺 editor_sdk 时导出页不出现降级入口，DOCX 导出被永久锁死）。
 * 本 hook 把这段安全关键路径**收敛为唯一实现**，两处共用，行为差异自然消解。
 *
 * 门禁语义（《流程重构设计》§5-Q3 / §Q4）：
 *  - `unlocked = contentAllowed && (fresh || degradedOk) && 设置一致 && 内容摘要一致`；
 *  - 任何影响内容的操作 / 设置变化 → `invalidatePreview` → 重新锁定；
 *  - 像素预览作业 `done` 且摘要匹配 → `markPreviewFresh` 解锁；
 *  - **环境降级逃生**：预览因环境原因（无 editor_sdk / 无 Word·WPS）失败时，
 *    用户确认结构预览 → `markPreviewDegraded` 解锁（否则会永久锁死 DOCX 导出）。
 *
 * 复用现有端点：#28 preview / #29 export / #30 jobs / #31 page_N.png。**未新增端点。**
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getExportData, startExport, startPreview } from '../api/export'
import { getPaper } from '../api/papers'
import { ApiError } from '../api/client'
import { isContentGuardCode, isContentGuardError } from '../api/errors'
import { qk } from '../api/queryKeys'
import { useJob } from './useJob'
import { useUiStore, previewSettingsKey, type PreviewTicket } from '../store/uiStore'
import { describeJobTimeout } from '../lib/glossary'
import {
  detectEnvFailure,
  detectNoPageEnvFailure,
  extractPages,
  inferExportStage,
  inferPreviewStage,
  EXPORT_STAGES,
  PREVIEW_STAGES,
  type EnvFailure,
} from './exportGateShared'
import type { ExportJobResult, ExportPayload, PreviewPage } from '../api/types'

// 环境失败判定 / 预览页归一化 / 环境失败教师语言（L1）/ 长任务阶段（L4）均为**纯函数或常量**，
// 抽到 `exportGateShared.ts` 以便独立测试；这里 re-export，保持既有 import 路径不变，
// 并让导出抽屉与导出中心**共用同一份阶段定义与推断**（避免两处各写一份阶段名）。
export {
  detectEnvFailure,
  detectNoPageEnvFailure,
  describeEnvFailure,
  extractPages,
  envReason,
  PREVIEW_STAGES,
  EXPORT_STAGES,
  inferPreviewStage,
  inferExportStage,
  type EnvFailure,
  type StageInput,
} from './exportGateShared'

export interface ExportGateOptions {
  paperId: number
  /** 是否激活（抽屉传 `open`；导出页恒为 true）。为 false 时不发起请求、不自动预览。 */
  enabled?: boolean
  /** 是否在激活后自动生成像素预览（抽屉 true；导出页 false）。 */
  autoPreview?: boolean
  /** **仅用于演示/验证**：强制模拟环境失败（生产省略）。 */
  simulateEnvFailure?: EnvFailure
  /** 若提供，则把门禁诊断对象挂到 `window[debugKey]`（供取证脚本读取）。 */
  debugKey?: string
}

/** 导出「预览 + 门禁 + 导出」共享状态与动作。 */
export function useExportGate(options: ExportGateOptions) {
  const { paperId, enabled = true, autoPreview = false, simulateEnvFailure = null, debugKey } = options

  // ---- 门禁（uiStore，按 paperId 分组） ------------------------------------
  const fresh = useUiStore((s) => s.previewFresh[paperId] ?? false)
  const degradedOk = useUiStore((s) => s.previewDegradedOk[paperId] ?? false)
  const markPreviewFresh = useUiStore((s) => s.markPreviewFresh)
  const markPreviewDegraded = useUiStore((s) => s.markPreviewDegraded)
  const invalidatePreview = useUiStore((s) => s.invalidatePreview)
  const exportFormats = useUiStore((s) => s.exportFormats)
  const setExportFormats = useUiStore((s) => s.setExportFormats)
  const previewSettings = useUiStore((s) => s.previewSettings[paperId])
  const savedDigest = useUiStore((s) => s.previewContent[paperId])

  // ---- 导出设置（本地态；由试卷属性初始化） --------------------------------
  const [answerMode, setAnswerModeRaw] = useState<string | null>(null)
  const [template, setTemplateRaw] = useState<string | null>(null)
  const settingsKey = previewSettingsKey(answerMode ?? '学生版', template ?? '考试')

  const activePreview = useRef<PreviewTicket | null>(null)
  const activeDiagnostic = useRef('')
  const lastDiagnostic = useRef<string | undefined>(undefined)
  const payloadRef = useRef<ExportPayload | undefined>(undefined)

  /** 门禁请求有效性：票据未过期 + 摘要与诊断均与当前内容一致。 */
  const accepts = (ticket: PreviewTicket | null) =>
    ticket !== null &&
    activePreview.current === ticket &&
    useUiStore.getState().previewRevision[ticket.paperId] === ticket.revision &&
    payloadRef.current?.content_digest === ticket.contentDigest &&
    payloadRef.current?.diagnostics.export_allowed === true &&
    payloadRef.current?.diagnostics.diagnostic_digest === activeDiagnostic.current

  useEffect(() => {
    if (!enabled) activePreview.current = null
    return () => {
      activePreview.current = null
    }
  }, [enabled])

  // ---- 预览 / 导出状态 -----------------------------------------------------
  const [previewPages, setPreviewPages] = useState<PreviewPage[]>([])
  const [previewCached, setPreviewCached] = useState(false)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [envFail, setEnvFail] = useState<EnvFailure>(null)
  const [exportJobId, setExportJobId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  /** 导出作业已用秒数（与预览分开计时，供 L4 阶段推断）。 */
  const [exportElapsed, setExportElapsed] = useState(0)

  const paperQ = useQuery({
    queryKey: qk.paper(paperId),
    queryFn: () => getPaper(paperId),
    enabled: enabled && paperId > 0,
  })

  const exportDataQ = useQuery({
    queryKey: qk.exportData(paperId, answerMode, template),
    queryFn: () => getExportData(paperId, answerMode ?? undefined, template ?? undefined),
    enabled: enabled && paperId > 0 && answerMode !== null && template !== null,
  })
  payloadRef.current = exportDataQ.data
  const contentAllowed = Boolean(
    exportDataQ.data?.diagnostics.export_allowed && !exportDataQ.isFetching && !exportDataQ.isError,
  )
  const contentDigest = exportDataQ.data?.content_digest ?? ''
  const unlocked =
    contentAllowed &&
    (fresh || degradedOk) &&
    previewSettings === settingsKey &&
    savedDigest === contentDigest

  useEffect(() => {
    useUiStore.getState().observeContent(paperId, contentDigest, contentAllowed)
  }, [paperId, contentDigest, contentAllowed])

  useEffect(() => {
    const diagnostic = exportDataQ.data?.diagnostics.diagnostic_digest
    if (lastDiagnostic.current !== undefined && lastDiagnostic.current !== diagnostic) invalidatePreview(paperId)
    lastDiagnostic.current = diagnostic
  }, [exportDataQ.data?.diagnostics.diagnostic_digest, paperId, invalidatePreview])

  const refreshDiagnostics = useCallback(() => {
    invalidatePreview(paperId)
    exportDataQ.refetch()
  }, [invalidatePreview, paperId, exportDataQ])

  const handleContentError = useCallback(
    (err: unknown) => {
      if (isContentGuardError(err)) {
        setEnvFail(null)
        refreshDiagnostics()
      }
    },
    [refreshDiagnostics],
  )

  // 载入试卷后同步默认答案模式 / 模板（仅一次，避免覆盖用户选择）。
  useEffect(() => {
    if (paperQ.data && answerMode === null && template === null) {
      setAnswerModeRaw(paperQ.data.answer_mode || '学生版')
      setTemplateRaw(paperQ.data.template || '考试')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperQ.data])

  /** 切换设置：先重新锁定导出（设置变化会改变渲染结果与指纹，§5-Q3②）。 */
  const setAnswerMode = useCallback(
    (m: string) => {
      invalidatePreview(paperId)
      setAnswerModeRaw(m)
    },
    [invalidatePreview, paperId],
  )
  const setTemplate = useCallback(
    (t: string) => {
      invalidatePreview(paperId)
      setTemplateRaw(t)
    },
    [invalidatePreview, paperId],
  )

  // ---- 像素预览 ------------------------------------------------------------
  const previewMut = useMutation({
    mutationFn: async (ticket: PreviewTicket) => {
      // 演示钩子：模拟环境失败（抛出与后端一致的 ApiError）。
      if (simulateEnvFailure) {
        const msg =
          simulateEnvFailure === 'office'
            ? '未检测到 Microsoft Word / WPS：无法生成 PDF，像素级预览不可用。可改用「导出 DOCX」，或安装 Word/WPS 后重试。'
            : '未检测到 editor_sdk 服务（127.0.0.1:39099 起）：公式渲染与 DOCX 生成不可用。请先启动 editor_sdk 后重试。'
        throw new ApiError(msg, 50001, 200, null)
      }
      return startPreview(ticket.paperId, {
        answer_mode: ticket.answerMode,
        template: ticket.template,
      })
    },
    onSuccess: (data, ticket) => {
      if (!accepts(ticket)) return
      setEnvFail(null)
      setPreviewError(null)
      if (data.pages && data.pages.length > 0) {
        // 命中缓存：同步返回页面 → 立即解锁。
        setPreviewPages(data.pages)
        setPreviewCached(Boolean(data.cached))
        setPreviewJobId(null)
        markPreviewFresh(ticket, data.content_digest)
        if (data.content_digest !== ticket.contentDigest) {
          setPreviewError('预览依据已变化，请刷新内容检查后重新预览。')
          refreshDiagnostics()
        }
      } else if (data.job_id) {
        // 未命中：轮询作业；**保留旧图**，成功后再替换并解锁。
        setPreviewJobId(data.job_id)
      } else {
        setPreviewJobId(null)
        setPreviewError('预览请求未返回页面或作业 id。')
        invalidatePreview(paperId)
      }
    },
    onError: (err, ticket) => {
      if (!accepts(ticket)) return
      handleContentError(err)
      const t = isContentGuardError(err) ? null : detectEnvFailure(err)
      setEnvFail(t)
      setPreviewError((err as Error).message)
      setPreviewJobId(null)
      invalidatePreview(paperId) // 失败 → 保持锁定
    },
  })
  const mutatePreview = previewMut.mutate
  const runPreview = useCallback(() => {
    if (!contentAllowed || !contentDigest) return
    const ticket = useUiStore.getState().beginPreview(paperId, answerMode ?? '学生版', template ?? '考试', contentDigest)
    activePreview.current = ticket
    activeDiagnostic.current = exportDataQ.data?.diagnostics.diagnostic_digest ?? ''
    setPreviewJobId(null)
    mutatePreview(ticket)
  }, [paperId, answerMode, template, mutatePreview, contentAllowed, contentDigest, exportDataQ.data?.diagnostics.diagnostic_digest])

  // 去重：避免 React StrictMode（dev）双调用 effect 造成重复预览请求；同参数只请求一次。
  const lastReqRef = useRef<string>('')
  useEffect(() => {
    if (!enabled) lastReqRef.current = ''
  }, [enabled])

  // 激活 / 设置变化 → 先失效（重新锁定），再自动生成（§Q3②③）。
  useEffect(() => {
    if (!enabled || !autoPreview || !contentAllowed) return
    if (answerMode === null || template === null) return
    const key = `${paperId}|${answerMode}|${template}|${contentDigest}|${simulateEnvFailure ?? ''}`
    if (lastReqRef.current === key) return
    lastReqRef.current = key
    runPreview()
  }, [enabled, paperId, answerMode, template, autoPreview, simulateEnvFailure, invalidatePreview, runPreview, contentAllowed, contentDigest])

  const previewJob = useJob(previewJobId)

  useEffect(() => {
    if (previewJob.isError && accepts(activePreview.current)) {
      setPreviewError((previewJob.error as Error).message)
      invalidatePreview(paperId)
      setPreviewJobId(null)
    }
  }, [previewJob.isError, previewJob.error, paperId, invalidatePreview])

  // L5 接线：预览作业超时（后端作业线程消失 → 永远 running）→ 停止等待、**重新锁定**并提示重试。
  // 不再无限转圈：`previewJob.timedOut` 由 useJob 在超过最大轮询时长后置真。
  useEffect(() => {
    if (!previewJob.timedOut) return
    if (!accepts(activePreview.current)) return
    setPreviewError(describeJobTimeout())
    invalidatePreview(paperId) // 从未拿到像素预览 → 保持锁定
    setPreviewJobId(null) // 停止轮询（jobId 置空即停）
  }, [previewJob.timedOut, paperId, invalidatePreview])

  // 预览作业完成 → 提取页面 + 解锁；失败 → 锁定 + 错误。
  useEffect(() => {
    const info = previewJob.data
    if (!info) return
    const ticket = activePreview.current
    if (!accepts(ticket) || info.job_id !== previewJobId) {
      setPreviewJobId(null)
      return
    }
    if (info.status === 'done') {
      const { pages } = extractPages(info.result)
      if (pages.length > 0) {
        setPreviewPages(pages)
        setPreviewCached(false)
        markPreviewFresh(ticket!, (info.result as ExportJobResult)?.content_digest)
        if ((info.result as ExportJobResult)?.content_digest !== ticket!.contentDigest) {
          setPreviewError('预览依据已变化，请重新检查。')
          refreshDiagnostics()
        }
        setPreviewError(null)
        setEnvFail(null)
      } else {
        // done 却没有页面：PDF 未生成（DOCX 可能已生成，见后端 render()）。
        // 仅当 warning 明确指向环境原因（Word/WPS/editor_sdk）时，才给出与 error 分支
        // **同等**的降级确认入口；未知原因继续锁定——「给降级入口」≠「自动放行」，
        // 用户仍须显式确认才能越过门禁（export_allowed 不放宽）。
        setPreviewError('预览作业完成但未返回页面（可能 PDF 生成失败）。')
        setEnvFail(detectNoPageEnvFailure(info.result))
        invalidatePreview(paperId)
      }
      setPreviewJobId(null)
    } else if (info.status === 'error') {
      setPreviewError(info.error || '预览作业失败')
      if (isContentGuardCode(info.error_code)) {
        setEnvFail(null)
        refreshDiagnostics()
      } else setEnvFail(detectEnvFailure(new Error(info.error || '')))
      invalidatePreview(paperId)
      setPreviewJobId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewJob.data])

  const previewing =
    previewMut.isPending ||
    Boolean(previewJobId) ||
    previewJob.data?.status === 'running' ||
    previewJob.data?.status === 'pending'

  // 预览进行中：计时（用于「约 3–8 秒」进度提示）。
  useEffect(() => {
    if (!previewing) {
      setElapsed(0)
      return
    }
    const t0 = Date.now()
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [previewing])

  /**
   * L4：预览当前阶段索引（0 起）——**前端推断**，非后端真实阶段。
   *
   * 输入全部是前端**可观测**的调用状态；后端作业不上报阶段名（见 `exportGateShared.ts` 注释）。
   * 抽屉与导出中心共用同一推断，保证两处阶段一致。
   */
  const previewStage = inferPreviewStage({
    checking: exportDataQ.isFetching,
    requesting: previewMut.isPending,
    running: Boolean(previewJobId) && (previewJob.data?.status === 'pending' || previewJob.data?.status === 'running'),
    elapsedSec: elapsed,
  })

  /** 环境降级逃生：用户确认「结构预览」后以之替代像素预览解锁导出。 */
  const confirmDegraded = useCallback(
    () => markPreviewDegraded(paperId, settingsKey, contentDigest),
    [markPreviewDegraded, paperId, settingsKey, contentDigest],
  )

  // ---- 导出 ----------------------------------------------------------------
  const noFormats = !exportFormats.docx && !exportFormats.pdf
  const exportMut = useMutation({
    mutationFn: () => {
      if (!contentAllowed || !unlocked) throw new Error('当前内容未通过检查或预览未确认')
      return startExport(paperId, {
        answer_mode: answerMode ?? undefined,
        template: template ?? undefined,
        formats: [exportFormats.docx ? 'docx' : null, exportFormats.pdf ? 'pdf' : null].filter(Boolean) as string[],
      })
    },
    onSuccess: (data) => setExportJobId(data.job_id),
    onError: handleContentError,
  })
  const exportJob = useJob(exportJobId)
  useEffect(() => {
    const info = exportJob.data
    if (info?.status === 'error') {
      invalidatePreview(paperId)
      if (isContentGuardCode(info.error_code)) refreshDiagnostics()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportJob.data])

  /** L5 接线：导出作业超时（后端作业线程消失 → 永远 running）→ 不再无限转圈。 */
  const exportTimedOut = exportJob.timedOut

  /** 导出作业是否在运行（pending/running）；超时后视为已停止（供进度条与禁用判定）。 */
  const exportRunning =
    exportJobId !== null &&
    !exportTimedOut &&
    (exportJob.data?.status === 'pending' || exportJob.data?.status === 'running')

  // 导出进行中：单独计时（供 L4 阶段推断）。
  useEffect(() => {
    if (!exportRunning) {
      setExportElapsed(0)
      return
    }
    const t0 = Date.now()
    const id = window.setInterval(() => setExportElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [exportRunning])

  /**
   * L4：导出当前阶段索引（0 起）——**前端推断**，非后端真实阶段。
   *
   * `内容检查`（诊断请求）→ `渲染文档`（POST /export 已发出）→ `写出 DOCX/PDF`（作业运行）。
   * 后端不上报阶段名，运行内部按已用时长推断（见 `exportGateShared.ts` 注释）。
   */
  const exportStage = inferExportStage({
    checking: exportDataQ.isFetching,
    requesting: exportMut.isPending,
    running: exportRunning,
    elapsedSec: exportElapsed,
  })

  const exportResult = useMemo<ExportJobResult | null>(() => {
    const info = exportJob.data
    if (info?.status === 'done' && info.result && typeof info.result === 'object') {
      return info.result as ExportJobResult
    }
    return null
  }, [exportJob.data])

  const exportDisabled =
    !contentAllowed ||
    !unlocked ||
    previewing ||
    noFormats ||
    exportMut.isPending ||
    // 作业进行中禁用；但**超时**后应放行以便重试（否则超时会永久锁死导出按钮）。
    (exportJobId !== null && !exportTimedOut && exportJob.data?.status !== 'done' && exportJob.data?.status !== 'error')

  const exportHint = useMemo(() => {
    if (!contentAllowed) return '请先完成内容检查并处理阻断条目'
    if (noFormats) return '请至少选择一种导出格式'
    if (previewing) return '预览生成中，完成后可导出'
    if (!unlocked) return '请先生成 / 刷新像素预览'
    return ''
  }, [noFormats, previewing, unlocked, contentAllowed])

  // 过期横幅：只要「有旧图 + 门禁未解锁」即展示（含重新生成进行中），§Q4。
  const showStale = previewPages.length > 0 && !unlocked && envFail === null

  // 诊断信息（只读、无副作用；供取证脚本读取门禁/预览/导出状态）。
  useEffect(() => {
    if (!debugKey) return
    ;(window as unknown as Record<string, unknown>)[debugKey] = {
      paperId,
      enabled,
      unlocked,
      fresh,
      degradedOk,
      previewing,
      previewCached,
      pages: previewPages.length,
      envFail,
      previewError,
      exportDisabled,
      contentDigest,
      contentAllowed,
      exportStatus: exportJob.data?.status ?? null,
      exportResult: exportResult ?? null,
      exportTimedOut,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  return {
    // 试卷 / 内容
    paperQ,
    exportDataQ,
    contentAllowed,
    contentDigest,
    // 设置
    answerMode,
    template,
    setAnswerMode,
    setTemplate,
    settingsKey,
    // 门禁
    fresh,
    degradedOk,
    unlocked,
    invalidatePreview: () => invalidatePreview(paperId),
    refreshDiagnostics,
    confirmDegraded,
    // 预览
    previewPages,
    previewCached,
    previewing,
    previewError,
    envFail,
    elapsed,
    runPreview,
    // L4：长任务阶段（**前端推断**，非后端真实阶段）——抽屉与导出中心共用。
    previewStages: PREVIEW_STAGES,
    previewStage,
    exportStages: EXPORT_STAGES,
    exportStage,
    exportRunning,
    exportElapsed,
    exportTimedOut,
    // 导出
    exportMut,
    exportJob,
    exportResult,
    exportDisabled,
    exportHint,
    exportFormats,
    setExportFormats,
    noFormats,
    showStale,
  }
}

export type ExportGate = ReturnType<typeof useExportGate>
