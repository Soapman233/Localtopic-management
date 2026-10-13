/**
 * 独立复核四项修复的**回归护栏**（FIX-1 ~ FIX-4）。
 *
 * 每条都先复现「改前确实有问题」的行为，再断言修复后的安全结果：
 * - FIX-1：批量确认弹窗与提交**同源**（用弹窗展示的标签写库），拒绝迟到预检响应；
 * - FIX-2：done 且无页面时，**仅** PDF 生成失败且明确指向环境原因才给出降级入口，且确认前仍锁定；
 * - FIX-3：取消动画后**清掉**插件插入的待移除临时节点（不误删 React 正常节点）；
 * - FIX-4：卸载 / 偏好切换时 `destroy()` 断开观察器，销毁实例不留在 `controller.current`。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import KnowledgeReviewPage from '../../src/pages/KnowledgeReviewPage'
import { renderPage, jsonResponse } from './pages/pageTestUtils'
import { useExportGate } from '../../src/hooks/useExportGate'
import { detectNoPageEnvFailure } from '../../src/hooks/exportGateShared'
import { AnimatedList } from '../../src/components/AnimatedList'
import { renderWithTheme } from './testUtils'
import { useUiStore } from '../../src/store/uiStore'

// ───────────────────────────── 公共：fetch 信封桩 ─────────────────────────────
interface Call { url: string; method: string; body: unknown }
function stubFetch(calls: Call[], routes: Array<[string, (url: string) => Response | Promise<Response>]>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    for (const [frag, make] of routes) if (url.includes(frag)) return make(url)
    return jsonResponse(null)
  }))
}

// ───────────────────────────── FIX-1 ─────────────────────────────
const labelSummary = {
  summary: [
    { label_id: 1, label_name: '太阳能', total: 2, pending: 2, confirmed: 0, rejected: 0 },
    { label_id: 2, label_name: '音调', total: 4, pending: 4, confirmed: 0, rejected: 0 },
  ],
  counts: { 待复核: 6, 已确认: 0, 已否决: 0 },
  namespace: '知识点',
  status: null,
}
const itemsOf = (name: string) => ({
  total: 1,
  items: [{ question_id: 101, number: '1', snippet: `${name}题干`, source: 'A.docx', review_status: '待复核' }],
  limit: 50, offset: 0, label_id: 1, label_name: name, status: '待复核',
})

describe('FIX-1 批量确认同源 + 拒绝迟到响应', () => {
  let pending: Array<(r: Response) => void>
  beforeEach(() => { pending = [] })
  afterEach(() => vi.unstubAllGlobals())

  function routes() {
    return [
      ['/api/labels/decision/preview', () => new Promise<Response>((res) => pending.push(res))],
      ['/api/labels/decision', () => jsonResponse({ label_id: 1, label_name: 'x', decision: '确认', updated: 2, matched: 2, already_decided: 0 })],
      ['/api/labels/review-summary', () => jsonResponse(labelSummary)],
      ['/api/labels/review-items', (url: string) =>
        jsonResponse(itemsOf(decodeURIComponent(url).match(/label_name=([^&]+)/)?.[1] ?? '未知'))],
    ] as Array<[string, (url: string) => Response | Promise<Response>]>
  }
  const pick = (name: string) => fireEvent.click(screen.getByText(name))
  it('切标签后迟到的预检响应被丢弃：不弹旧弹窗、不发决定请求', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<KnowledgeReviewPage />)
    await screen.findByText('太阳能')
    pick('太阳能')
    await screen.findByText('太阳能题干')

    // 发起「太阳能」预检（挂起），随后切到「音调」。
    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    await waitFor(() => expect(pending.length).toBe(1))
    pick('音调')

    // 迟到的「太阳能」预检此刻才返回 → 必须被丢弃。
    await act(async () => { pending[0](jsonResponse({ found: true, label_id: 1, label_name: '太阳能', decision: '确认', matched: 2, pending: 2, will_update: 2, question_id: null })) })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/api/labels/decision'))).toBe(false)
  })

  it('A→B→A：仅比较标签字符串无法识别，代次校验使旧响应失效', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<KnowledgeReviewPage />)
    await screen.findByText('太阳能')
    pick('太阳能')
    await screen.findByText('太阳能题干')

    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    await waitFor(() => expect(pending.length).toBe(1))
    pick('音调')
    pick('太阳能') // 回到同名标签

    await act(async () => { pending[0](jsonResponse({ found: true, label_id: 1, label_name: '太阳能', decision: '确认', matched: 2, pending: 2, will_update: 2, question_id: null })) })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/api/labels/decision'))).toBe(false)
  })

  it('弹窗展示的标签即实际提交的标签（同源）；取消不发决定请求', async () => {
    const calls: Call[] = []
    stubFetch(calls, routes())
    renderPage(<KnowledgeReviewPage />)
    await screen.findByText('音调')
    pick('音调')
    await screen.findByText('音调题干')

    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    await waitFor(() => expect(pending.length).toBe(1))
    await act(async () => { pending[0](jsonResponse({ found: true, label_id: 2, label_name: '音调', decision: '确认', matched: 4, pending: 4, will_update: 4, question_id: null })) })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('音调', { exact: false })).toBeInTheDocument()
    expect(within(dialog).getByText('4')).toBeInTheDocument()

    // 取消 → 零写。
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.some((c) => c.url.endsWith('/api/labels/decision'))).toBe(false)

    // 重新预检并确认 → 提交的 label_name 与弹窗一致。
    fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
    await waitFor(() => expect(pending.length).toBe(2))
    await act(async () => { pending[1](jsonResponse({ found: true, label_id: 2, label_name: '音调', decision: '确认', matched: 4, pending: 4, will_update: 4, question_id: null })) })
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/labels/decision'))).toBe(true))
    const post = calls.find((c) => c.url.endsWith('/api/labels/decision'))!
    expect(post.body).toMatchObject({ label_name: '音调', decision: '确认', confirm: true })
  })
})

// ───────────────────────────── FIX-2 ─────────────────────────────
describe('FIX-2 done 无页时的环境降级识别（从严）', () => {
  it('仅 PDF 生成失败且指向 Word/WPS/editor_sdk 才算环境失败', () => {
    expect(detectNoPageEnvFailure({ warnings: ['PDF 生成失败（预览不可用）：KWPS.Application: 拒绝访问'] })).toBe('office')
    expect(detectNoPageEnvFailure({ warnings: ['PDF 生成失败（预览不可用）：Word.Application: 错误'] })).toBe('office')
    expect(detectNoPageEnvFailure({ warnings: ['PDF 生成失败（预览不可用）：editor_sdk 不可用'] })).toBe('editor_sdk')
  })
  it('位图化失败 / 未知原因 / 无 warning / 非对象 一律 null（保持锁定）', () => {
    expect(detectNoPageEnvFailure({ warnings: ['PDF 位图化失败：缺少 pypdfium2'] })).toBeNull()
    expect(detectNoPageEnvFailure({ warnings: ['PDF 生成失败（预览不可用）：未知异常'] })).toBeNull()
    expect(detectNoPageEnvFailure({ warnings: ['某来源文件 WPS 命名.docx 版本不同'] })).toBeNull()
    expect(detectNoPageEnvFailure({ warnings: [] })).toBeNull()
    expect(detectNoPageEnvFailure(undefined)).toBeNull()
    expect(detectNoPageEnvFailure({ pages: [] })).toBeNull()
  })
})

// ── FIX-2 钩子级：done+空页（Office warning）→ 有降级入口，确认前仍锁定 ──
const hStubs = vi.hoisted(() => ({ getPaper: vi.fn(), getExportData: vi.fn(), startPreview: vi.fn(), startExport: vi.fn(), job: vi.fn() }))
vi.mock('../../src/api/papers', async (orig) => ({ ...(await orig<object>()), getPaper: hStubs.getPaper }))
vi.mock('../../src/api/export', async (orig) => ({
  ...(await orig<object>()), getExportData: hStubs.getExportData, startPreview: hStubs.startPreview, startExport: hStubs.startExport,
}))
vi.mock('../../src/hooks/useJob', () => ({ useJob: (id: string | null) => hStubs.job(id), isTerminalStatus: () => true, shouldKeepPolling: () => false }))

const exportData = {
  paper: { title: '卷1' }, sections: [], content_digest: 'CD1',
  diagnostics: { export_allowed: true, blocker_count: 0, warning_count: 1, diagnostic_digest: 'DG1', issues: [] },
}
function hookWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
describe('FIX-2 钩子：done 空页给出降级入口但不自动放行', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 门禁为会话内脏标记：清空，避免上一条用例的降级确认污染本条。
    useUiStore.setState({ previewFresh: {}, previewDegradedOk: {}, previewRevision: {}, previewSettings: {}, previewContent: {}, previewAllowed: {} })
    hStubs.getPaper.mockResolvedValue({ answer_mode: '学生版', template: '考试' })
    hStubs.getExportData.mockResolvedValue(exportData)
    hStubs.startPreview.mockResolvedValue({ cached: false, job_id: 'J1', key: 'k', pages: [] })
    hStubs.job.mockImplementation((id: string | null) => ({
      data: id ? { job_id: 'J1', kind: 'preview', status: 'done', progress: 1, result: {
        content_digest: 'CD1', page_count: 0, pages: [], pdf: null,
        warnings: ['PDF 生成失败（预览不可用）：KWPS.Application: 拒绝访问'],
      } } : undefined,
      isError: false, error: null, timedOut: false,
    }))
  })
  it('done+空页(Office warning)：envFail=office、确认前锁定、确认后可导出', async () => {
    const hook = renderHook(() => useExportGate({ paperId: 1, autoPreview: true }), { wrapper: hookWrapper() })
    await waitFor(() => expect(hook.result.current.envFail).toBe('office'))
    expect(hook.result.current.contentAllowed).toBe(true)
    expect(hook.result.current.unlocked).toBe(false)
    expect(hook.result.current.exportDisabled).toBe(true)

    act(() => hook.result.current.confirmDegraded())
    await waitFor(() => expect(hook.result.current.unlocked).toBe(true))
    expect(hook.result.current.exportDisabled).toBe(false)
  })
  it('done+空页(位图化失败)：envFail=null，仍锁定（未知原因不降级）', async () => {
    hStubs.job.mockImplementation((id: string | null) => ({
      data: id ? { job_id: 'J1', kind: 'preview', status: 'done', progress: 1, result: {
        content_digest: 'CD1', page_count: 0, pages: [], pdf: null, warnings: ['PDF 位图化失败：缺少 pypdfium2'],
      } } : undefined,
      isError: false, error: null, timedOut: false,
    }))
    const hook = renderHook(() => useExportGate({ paperId: 1, autoPreview: true }), { wrapper: hookWrapper() })
    await waitFor(() => expect(hook.result.current.previewError).toContain('未返回页面'))
    expect(hook.result.current.envFail).toBeNull()
    expect(hook.result.current.exportDisabled).toBe(true)
  })
})

// ───────────────────────────── FIX-3 / FIX-4 ─────────────────────────────
const aStubs = vi.hoisted(() => ({ created: [] as Array<{ disable: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> }))
vi.mock('@formkit/auto-animate', () => ({
  default: () => {
    const ctrl = { enable: vi.fn(), disable: vi.fn(), isEnabled: () => true, destroy: vi.fn() }
    aStubs.created.push(ctrl)
    return ctrl
  },
}))

const originalMedia = window.matchMedia
function media(initial = false) {
  const handlers = new Set<() => void>()
  const m = { matches: initial, addEventListener: (_e: string, fn: () => void) => handlers.add(fn), removeEventListener: (_e: string, fn: () => void) => handlers.delete(fn), addListener: (fn: () => void) => handlers.add(fn), removeListener: (fn: () => void) => handlers.delete(fn) }
  window.matchMedia = vi.fn(() => m as unknown as MediaQueryList)
  return { m, change(value: boolean) { act(() => { m.matches = value; handlers.forEach((fn) => fn()) }) } }
}
afterEach(() => { window.matchMedia = originalMedia; aStubs.created.length = 0 })

describe('FIX-3 取消动画清掉待移除临时节点；FIX-4 卸载 destroy', () => {
  it('stop() 移除插件标记的待移除节点，且不误删 React 正常节点', async () => {
    const pref = media(false)
    renderWithTheme(
      <AnimatedList scope="s" stable ids={['a']} testId="motion"><div data-testid="legit">ok</div></AnimatedList>,
    )
    await waitFor(() => expect(aStubs.created.length).toBe(1))

    // 模拟库在「移除动画」中重新挂回的待移除节点（带私有删除标记）。
    const root = screen.getByTestId('motion')
    const ghost = document.createElement('div')
    Object.defineProperty(ghost, '__aa_del', { value: true, configurable: true })
    ghost.setAttribute('data-testid', 'ghost')
    root.appendChild(ghost)

    // 切到 reduce → stop() → 清理。
    pref.change(true)
    await waitFor(() => expect(screen.queryByTestId('ghost')).not.toBeInTheDocument())
    expect(screen.getByTestId('legit')).toBeInTheDocument()
    expect(aStubs.created[0].disable).toHaveBeenCalled()
  })

  it('卸载时调用 destroy()（断开观察器），不只是 disable()', async () => {
    media(false)
    const view = renderWithTheme(
      <AnimatedList scope="s" stable ids={['a']} testId="motion"><div>ok</div></AnimatedList>,
    )
    await waitFor(() => expect(aStubs.created.length).toBe(1))
    view.unmount()
    expect(aStubs.created[0].destroy).toHaveBeenCalled()
    expect(aStubs.created[0].disable).toHaveBeenCalled()
  })

  it('偏好切到 reduce 触发 effect 清理时同样 destroy', async () => {
    const pref = media(false)
    renderWithTheme(
      <AnimatedList scope="s" stable ids={['a']} testId="motion"><div>ok</div></AnimatedList>,
    )
    await waitFor(() => expect(aStubs.created.length).toBe(1))
    pref.change(true)
    await waitFor(() => expect(aStubs.created[0].destroy).toHaveBeenCalled())
  })
})
