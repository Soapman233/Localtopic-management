/** 作业轮询 hook：预览/导出作业提交后，轮询 ``GET /api/jobs/{job_id}`` 直到终态。 */
import { useQuery } from '@tanstack/react-query'
import { getJob } from '../api/export'
import type { JobInfo } from '../api/types'

export interface UseJobOptions {
  /** 轮询间隔（毫秒），默认 1200。 */
  intervalMs?: number
}

/** 轮询作业状态；`jobId` 为空时不发起请求。 */
export function useJob(jobId: string | null, options: UseJobOptions = {}) {
  const interval = options.intervalMs ?? 1200
  return useQuery<JobInfo>({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = (query.state.data as JobInfo | undefined)?.status
      return status === 'pending' || status === 'running' ? interval : false
    },
  })
}
