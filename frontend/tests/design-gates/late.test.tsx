import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import KnowledgeReviewPage from '../../src/pages/KnowledgeReviewPage'
import { useExportGate } from '../../src/hooks/useExportGate'
import { useUiStore } from '../../src/store/uiStore'
import { renderPage, jsonResponse } from '../unit/pages/pageTestUtils'

interface Call { url: string; method: string; body: Record<string, unknown> }
interface Held { call: Call; release: (data: unknown) => void }
let calls: Call[] = []
let held: Held[] = []
const summary = { summary: [
  { label_id: 101, label_name: '太阳能', total: 13, pending: 13, confirmed: 0, rejected: 0 },
  { label_id: 202, label_name: '音调', total: 7, pending: 7, confirmed: 0, rejected: 0 },
], counts: { 待复核: 20, 已确认: 0, 已否决: 0 }, namespace: '知识点', status: null }
const preview = (name: string) => ({ found: true, label_id: name === '太阳能' ? 101 : 202,
  label_name: name, decision: '确认', matched: name === '太阳能' ? 13 : 7,
  pending: name === '太阳能' ? 13 : 7, will_update: name === '太阳能' ? 13 : 7, question_id: null })
const targetDigest = (id: number, mode: string) => 'content-' + id + '-' + mode
const page = (id: number, mode: string) => ({ n: 1, url: '/api/preview/' + id + '-' + mode + '/page_1.png', width: 800, height: 1100 })
function intercept() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const call = { url, method, body }; calls.push(call)
    // 所有写API只能进入此拦截器；无真实网络 fallback。
    if (url.endsWith('/api/labels/decision/preview') || new RegExp('/papers/[0-9]+/preview$').test(url)) {
      return new Promise<Response>(resolve => held.push({ call, release: data => resolve(jsonResponse(data)) }))
    }
    if (url.endsWith('/api/labels/decision')) return Promise.resolve(jsonResponse({ updated: body.label_name === '音调' ? 7 : 13 }))
    if (url.includes('/api/labels/review-summary')) return Promise.resolve(jsonResponse(summary))
    if (url.includes('/api/labels/review-items')) {
      const name = new URL(url, 'http://gate.local').searchParams.get('label_name')!
      return Promise.resolve(jsonResponse({ total: 1, items: [{ question_id: 9, number: '1', snippet: name + '题干', source: 'gate.docx', review_status: '待复核' }] }))
    }
    const paperMatch = url.match(new RegExp('/api/papers/([0-9]+)'))
    if (paperMatch) {
      const id = Number(paperMatch[1])
      if (url.includes('/export-data')) {
        const mode = new URL(url, 'http://gate.local').searchParams.get('answer_mode') ?? '学生版'
        return Promise.resolve(jsonResponse({ paper: { title: '卷' + id }, sections: [], content_digest: targetDigest(id, mode),
          diagnostics: { export_allowed: true, blocker_count: 0, warning_count: 0, diagnostic_digest: 'diagnostic-' + id + '-' + mode, issues: [] } }))
      }
      if (url.endsWith('/export')) return Promise.resolve(jsonResponse({ job_id: 'intercepted-export' }))
      return Promise.resolve(jsonResponse({ id, title: '卷' + id, answer_mode: '学生版', template: '考试' }))
    }
    if (url.includes('/api/jobs/')) return Promise.resolve(jsonResponse({ job_id: 'intercepted-export', status: 'done', kind: 'export', result: {} }))
    throw new Error('G-e 环境/未覆盖API: ' + method + ' ' + url)
  }))
}
beforeEach(() => {
  calls = []; held = []; intercept()
  useUiStore.setState({ previewFresh: {}, previewDegradedOk: {}, previewRevision: {}, previewSettings: {}, previewContent: {}, previewAllowed: {}, exportFormats: { docx: true, pdf: false } })
})
afterEach(() => { held.forEach(h => h.release({})); cleanup(); vi.unstubAllGlobals() })
const choose = (name: string) => fireEvent.click(screen.getByText(name))
const settle = async (h: Held, data: unknown) => { await act(async () => { h.release(data); await new Promise(r => setTimeout(r, 30)) }) }

it('G-e 知识点 A挂起→B完成→A迟到→确认，文案数量与写请求同源', async () => {
  renderPage(<KnowledgeReviewPage />)
  await screen.findByText('太阳能'); choose('太阳能'); await screen.findByText('太阳能题干')
  fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
  await waitFor(() => expect(held).toHaveLength(1))
  choose('音调'); await screen.findByText('音调题干')
  fireEvent.click(screen.getByRole('button', { name: '批量确认待复核' }))
  await waitFor(() => expect(held).toHaveLength(2))
  await settle(held[1], preview('音调'))
  await screen.findByRole('dialog')
  await settle(held[0], preview('太阳能'))
  const dialog = screen.getByRole('dialog'), text = dialog.textContent ?? ''
  // 即使反证已覆盖弹窗，仍执行确认并捕捉错误写目标，再一起判定。
  fireEvent.click(within(dialog).getByRole('button', { name: '确认' }))
  await waitFor(() => expect(calls.filter(c => c.url.endsWith('/api/labels/decision'))).toHaveLength(1))
  const writes = calls.filter(c => c.url.endsWith('/api/labels/decision'))
  console.log('G-e knowledge actual=' + JSON.stringify({ dialog: text, writes, expected: { target: '音调', count: 7, decision: '确认' }, threshold: 'same-source', checks: 4 }))
  expect(text).toContain('标签「音调」共命中 7 条关联')
  expect(text).toContain('将确认7条关联')
  expect(text).not.toContain('太阳能')
  expect(writes[0].body).toEqual({ label_name: '音调', decision: '确认', confirm: true })
})

// 交互夹具只提供按钮，将真实Hook的用户状态与动作渲染到DOM；不合成门禁布尔。
function ExportActions() {
  const [paperId, setPaperId] = useState(1)
  const gate = useExportGate({ paperId })
  return <div>
    <button onClick={() => setPaperId(2)}>切卷B</button>
    <button onClick={() => gate.setAnswerMode('答案解析版')}>切答案模式</button>
    <button disabled={!gate.contentAllowed} onClick={gate.runPreview}>生成预览</button>
    <button disabled={gate.exportDisabled} onClick={() => gate.exportMut.mutate()}>导出当前</button>
    <output data-testid="gate-state">{JSON.stringify({ paperId, mode: gate.answerMode, unlocked: gate.unlocked, pages: gate.previewPages, allowed: gate.contentAllowed })}</output>
  </div>
}
const state = () => JSON.parse(screen.getByTestId('gate-state').textContent!)
const requestPreview = async () => {
  const before = held.length
  await waitFor(() => expect(screen.getByRole('button', { name: '生成预览' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(held).toHaveLength(before + 1))
  return held[before]
}
const finishPreview = (h: Held) => {
  const id = Number(h.call.url.match(new RegExp('papers/([0-9]+)'))![1]), mode = String(h.call.body.answer_mode)
  return settle(h, { cached: true, content_digest: targetDigest(id, mode), pages: [page(id, mode)] })
}
for (const change of ['切卷B', '切答案模式']) it('G-e 导出 ' + change + '迟到不能解锁或替换当前预览；写当前目标', async () => {
  renderPage(<ExportActions />)
  const old = await requestPreview()
  fireEvent.click(screen.getByRole('button', { name: change }))
  await waitFor(() => expect(state().allowed).toBe(true))
  const id = change === '切卷B' ? 2 : 1, mode = change === '切卷B' ? '学生版' : '答案解析版'
  await finishPreview(old)
  console.log('G-e late-result actual=' + JSON.stringify({ change, state: state(), expected: { paper_id: id, answer_mode: mode, unlocked: false, pages: [] }, selector: '[data-testid=gate-state]', threshold: 'reject-old-response' }))
  expect(state().unlocked).toBe(false)
  expect(screen.getByRole('button', { name: '导出当前' })).toBeDisabled()
  expect(state().pages).toEqual([])
  const current = await requestPreview()
  await finishPreview(current)
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '导出当前' }))
  await waitFor(() => expect(calls.some(c => c.url.endsWith('/export'))).toBe(true))
  const writes = calls.filter(c => c.url.endsWith('/export'))
  console.log('G-e export actual=' + JSON.stringify({ change, state: state(), writes, expected: { paper_id: id, answer_mode: mode }, threshold: 'current-target-only', checks: 7 }))
  expect(state().pages).toEqual([page(id, mode)])
  expect(writes).toHaveLength(1)
  expect(writes[0].url).toBe('/api/papers/' + id + '/export')
  expect(writes[0].body).toEqual({ answer_mode: mode, template: '考试', formats: ['docx'] })
})
