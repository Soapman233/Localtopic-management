/** 作业轮询 hook：预览/导出作业提交后，轮询 ``GET /api/jobs/{job_id}`` 直到终态。
 *
 * 为什么要「最大轮询时长」（L5 历史遗留清算）
 * ------------------------------------------
 * 本 hook 此前只按作业状态决定是否继续轮询：`status === 'pending' || 'running'`
 * 时每 1.2 秒拉一次，**没有任何上限**。若后端作业线程消失（进程重启 / 线程池异常），
 * 作业会**永远停在 running**，前端便每 1.2 秒**永久轮询**：既不提示、也不停止，
 * 白白占用请求与 CPU，老师看到的是「一直转圈」却没有任何出路。
 *
 * 现引入 `timeoutMs`（默认 5 分钟）：超过该时长仍未到终态即**停止轮询**，
 * 并通过返回值的 `timedOut` 标记告知调用方（`useExportGate` 等）可据此提示
 * 「任务超时，请重试」，而不是永远转圈。
 *
 * 向后兼容：返回结构在原有 `useQuery` 结果之上**只新增** `timedOut` 字段，
 * 既有调用方 `useJob(jobId)` / `useJob(exportJobId)` 无需改动。
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getJob } from '../api/export'
import { qk } from '../api/queryKeys'
import type { JobInfo } from '../api/types'

export interface UseJobOptions {
  /** 轮询间隔（毫秒），默认 1200。 */
  intervalMs?: number
  /** 最大轮询时长（毫秒），默认 300_000（5 分钟）；<=0 表示不设上限。 */
  timeoutMs?: number
}

/** 作业是否已到终态（done / error，不再需要轮询）。 */
export function isTerminalStatus(status: JobInfo['status'] | undefined): boolean {
  return status === 'done' || status === 'error'
}

/**
 * 纯函数：给定作业状态与已轮询时长，判断**是否应继续轮询**。
 *
 * - 终态（`done` / `error`）→ 停止；
 * - 未到终态但已超过 `timeoutMs`（且设置了上限）→ 停止（超时）；
 * - 其余（含状态未知：首次请求尚未返回）→ 继续。
 *
 * 抽成纯函数便于直接单测，不必挂载 hook、不必操纵假定时器。
 */
export function shouldKeepPolling(
  status: JobInfo['status'] | undefined,
  elapsedMs: number,
  timeoutMs: number,
): boolean {
  if (isTerminalStatus(status)) return false
  if (timeoutMs > 0 && elapsedMs >= timeoutMs) return false
  return true
}

/** 轮询作业状态；`jobId` 为空时不发起请求。 */
export function useJob(jobId: string | null, options: UseJobOptions = {}) {
  const interval = options.intervalMs ?? 1200
  const timeoutMs = options.timeoutMs ?? 300_000

  // 本次作业的轮询起点（jobId 变化时重置，用于计算已轮询时长）。
  const startRef = useRef<number | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const query = useQuery<JobInfo>({
    queryKey: qk.job(jobId),
    queryFn: () => getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const status = (q.state.data as JobInfo | undefined)?.status
      const startedAt = startRef.current
      if (startedAt === null) return false
      return shouldKeepPolling(status, Date.now() - startedAt, timeoutMs) ? interval : false
    },
  })

  const status = query.data?.status

  // jobId 变化：重置计时与超时标记（同一作业不重复计时）。
  useEffect(() => {
    startRef.current = jobId ? Date.now() : null
    setTimedOut(false)
  }, [jobId])

  // 未到终态时启动「最大时长」定时器；到终态 / 卸载 / 换作业则清除。
  useEffect(() => {
    if (!jobId || isTerminalStatus(status)) {
      setTimedOut(false)
      return
    }
    if (timeoutMs <= 0) return
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs)
    return () => window.clearTimeout(timer)
  }, [jobId, timeoutMs, status])

  // 只新增 timedOut 字段，其余沿用 useQuery 结果（向后兼容既有调用方）。
  return { ...query, timedOut }
}
