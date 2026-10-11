/**
 * L5 `useJob` 轮询超时行为测试。
 *
 * 覆盖两类：
 * 1. 抽出的**纯函数** `shouldKeepPolling` / `isTerminalStatus`（确定性、无定时器）；
 * 2. hook 的**集成行为**：作业永远 running 时，超过 `timeoutMs` 必须置 `timedOut`
 *    并**停止继续请求**；正常到达 done 则不应误标超时。
 *
 * 用真实定时器 + 短超时（80ms）而非假定时器：react-query 内部也依赖定时器，
 * 假定时器需与它的调度精确配合，易脆；短真实超时更稳且更贴近线上语义。
 * 用 `renderHook`（而非渲染 JSX 探针）以保持本文件为 `.ts`。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { shouldKeepPolling, isTerminalStatus, useJob } from '../../src/hooks/useJob'
import { getJob } from '../../src/api/export'
import type { JobInfo } from '../../src/api/types'

// 在模块边界打桩，避免真实网络。
vi.mock('../../src/api/export', () => ({ getJob: vi.fn() }))
const getJobMock = vi.mocked(getJob)

function job(status: JobInfo['status']): JobInfo {
  return { job_id: 'j1', kind: 'export', status }
}

/** 每次新建 QueryClient（retry:false），避免用例间串缓存。 */
function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

/** 用 createElement 构造 Provider 包裹，避免在 `.ts` 文件里写 JSX。 */
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

describe('shouldKeepPolling（L5 纯函数）', () => {
  it('pending / running 在超时前继续轮询', () => {
    expect(shouldKeepPolling('pending', 0, 300_000)).toBe(true)
    expect(shouldKeepPolling('running', 299_999, 300_000)).toBe(true)
  })

  it('正常终态（done / error）→ 停止轮询', () => {
    expect(shouldKeepPolling('done', 0, 300_000)).toBe(false)
    expect(shouldKeepPolling('error', 0, 300_000)).toBe(false)
  })

  it('超过最大时长仍未终态 → 停止轮询（超时）', () => {
    expect(shouldKeepPolling('running', 300_000, 300_000)).toBe(false)
    expect(shouldKeepPolling('pending', 300_001, 300_000)).toBe(false)
  })

  it('状态未知（首次请求未返回）→ 继续轮询，否则永远拿不到结果', () => {
    expect(shouldKeepPolling(undefined, 0, 300_000)).toBe(true)
  })

  it('timeoutMs<=0 → 不设上限，只要未终态就继续', () => {
    expect(shouldKeepPolling('running', 10 ** 9, 0)).toBe(true)
  })

  it('isTerminalStatus 只认 done / error', () => {
    expect(isTerminalStatus('done')).toBe(true)
    expect(isTerminalStatus('error')).toBe(true)
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus(undefined)).toBe(false)
  })
})

describe('useJob 集成（L5：超时停止轮询并标记 timedOut）', () => {
  beforeEach(() => {
    getJobMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('作业永远 running → 达到 timeoutMs 后 timedOut 为真，且不再继续请求', async () => {
    getJobMock.mockResolvedValue(job('running'))
    const { result } = renderHook(() => useJob('j1', { intervalMs: 10, timeoutMs: 80 }), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.timedOut).toBe(true), { timeout: 2000 })

    const callsAtTimeout = getJobMock.mock.calls.length
    await new Promise((r) => setTimeout(r, 200))
    // 超时后应停止轮询：若未停止，intervalMs=10 在这 200ms 内会再拉约 20 次。
    expect(getJobMock.mock.calls.length).toBeLessThanOrEqual(callsAtTimeout + 1)
  })

  it('作业正常到达 done → 不标记超时', async () => {
    getJobMock.mockResolvedValue(job('done'))
    const { result } = renderHook(() => useJob('j1', { intervalMs: 10, timeoutMs: 5_000 }), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.data?.status).toBe('done'), { timeout: 2000 })
    expect(result.current.timedOut).toBe(false)
  })
})
