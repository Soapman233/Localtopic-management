/**
 * `ImportPage`（Phase 2.3）+ `lib/importFile` 校验逻辑测试。
 *
 * 覆盖验收要求的三项：
 * 1. **扩展名校验**：非 `.docx` 被前端拦下，不发上传请求；
 * 2. **大小校验**：超过 `status.max_bytes` 被拦下；
 * 3. **enabled=false 时禁用**：入口禁用并说明原因。
 * 另补：上传成功 → 轮询作业 → 展示结果（新增 / 更新 / 跳过 / 待复核 / 耗时）。
 *
 * mock 方案与既有页面测试一致：在 `fetch` 边界返回 `{code,data,message}` 信封。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import ImportPage from '../../../src/pages/ImportPage'
import { formatBytes, suffixOf, validateImportFile } from '../../../src/lib/importFile'
import type { ImportStatus } from '../../../src/api/types'
import { renderPage, jsonResponse } from './pageTestUtils'

/** 功能开启、上限刻意设小（100 B）便于构造「超限」用例。 */
const STATUS_ENABLED: ImportStatus = {
  enabled: true,
  allowed_suffixes: ['.docx'],
  max_bytes: 100,
  timeout_seconds: 300,
}

const STATUS_DISABLED: ImportStatus = { ...STATUS_ENABLED, enabled: false }

/** 构造指定字节数的假文件。 */
function makeFile(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name)
}

describe('lib/importFile 纯函数', () => {
  it('suffixOf 取小写扩展名，无扩展名返回空串', () => {
    expect(suffixOf('八年级期末.DOCX')).toBe('.docx')
    expect(suffixOf('无扩展名')).toBe('')
  })

  it('formatBytes 按量级给出人类可读单位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(100)).toBe('100 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('validateImportFile：扩展名不在白名单 → 失败并给出中文提示', () => {
    const v = validateImportFile({ name: '笔记.pdf', size: 10 }, STATUS_ENABLED)
    expect(v.ok).toBe(false)
    expect(v.message).toContain('.docx')
    expect(v.message).toContain('.pdf')
  })

  it('validateImportFile：超过 max_bytes → 失败并给出中文提示', () => {
    const v = validateImportFile({ name: '大卷.docx', size: 200 }, STATUS_ENABLED)
    expect(v.ok).toBe(false)
    expect(v.message).toContain('太大')
  })

  it('validateImportFile：空文件 → 失败', () => {
    expect(validateImportFile({ name: '空.docx', size: 0 }, STATUS_ENABLED).ok).toBe(false)
  })

  it('validateImportFile：合法文件 → 通过', () => {
    expect(validateImportFile({ name: '试卷.docx', size: 50 }, STATUS_ENABLED)).toEqual({ ok: true })
  })
})

describe('ImportPage 页面级集成', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  /** 记录所有 fetch 调用，便于断言「是否真的上传了」。 */
  function stubFetch(status: ImportStatus, jobResult: unknown) {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method ?? 'GET'} ${u}`)
      if (u.includes('/api/import/status')) return jsonResponse(status)
      if (u.includes('/api/import/docx')) {
        return jsonResponse({ job_id: 'job-1', filename: '试卷.docx', size_bytes: 50 })
      }
      if (u.includes('/api/jobs/')) {
        return jsonResponse({
          job_id: 'job-1',
          kind: 'import',
          status: 'done',
          progress: 1,
          result: jobResult,
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  it('enabled=false → 入口禁用并说明原因', async () => {
    stubFetch(STATUS_DISABLED, null)
    const { container } = renderPage(<ImportPage />)

    expect(await screen.findByText('导入功能已关闭')).toBeInTheDocument()
    expect(screen.getByText('本机已关闭导入功能，暂时不能导入试卷。')).toBeInTheDocument()
    // 拖拽区被标记为禁用；原生文件选择器也被禁用。
    expect(screen.getByRole('button', { name: /选择要导入的试卷文件/ })).toHaveAttribute('aria-disabled', 'true')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeDisabled()
  })

  it('扩展名校验：选中 .pdf 时被拦下，且不发上传请求', async () => {
    const calls = stubFetch(STATUS_ENABLED, null)
    const { container } = renderPage(<ImportPage />)
    await screen.findByText(/支持 .docx/)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('笔记.pdf', 10)] } })

    expect(await screen.findByText(/只支持 .docx 格式/)).toBeInTheDocument()
    expect(screen.queryByText('开始导入')).not.toBeInTheDocument()
    expect(calls.some((c) => c.includes('/api/import/docx'))).toBe(false)
  })

  it('大小校验：超过 max_bytes 时被拦下', async () => {
    stubFetch(STATUS_ENABLED, null)
    const { container } = renderPage(<ImportPage />)
    await screen.findByText(/支持 .docx/)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('大卷.docx', 200)] } })

    expect(await screen.findByText(/文件太大/)).toBeInTheDocument()
    expect(screen.queryByText('开始导入')).not.toBeInTheDocument()
  })

  it('合法文件：上传 → 轮询作业 → 展示结果（新增 / 更新 / 跳过 / 待复核 / 耗时）', async () => {
    const calls = stubFetch(STATUS_ENABLED, {
      status: 'OK',
      filename: '试卷.docx',
      inserted: 3,
      updated: 1,
      skipped: 2,
      review_count: 4,
      seconds: 0.05,
      junk: 0,
      imported: 4,
    })
    const { container } = renderPage(<ImportPage />)
    await screen.findByText(/支持 .docx/)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('试卷.docx', 50)] } })

    const startBtn = await screen.findByText('开始导入')
    fireEvent.click(startBtn)

    expect(await screen.findByText('导入完成')).toBeInTheDocument()
    expect(screen.getByText('新增 3')).toBeInTheDocument()
    expect(screen.getByText('更新 1')).toBeInTheDocument()
    expect(screen.getByText('跳过 2')).toBeInTheDocument()
    expect(screen.getByText('待复核 4')).toBeInTheDocument()
    expect(screen.getByText('耗时 0.05 秒')).toBeInTheDocument()
    // 完成后提供「去看题库」跳转。
    expect(screen.getByRole('button', { name: '去看题库' })).toBeInTheDocument()

    await waitFor(() => expect(calls.some((c) => c.startsWith('POST /api/import/docx'))).toBe(true))
  })

  it('提交被后端拒绝（40011）→ 展示教师可读错误，且不泄露内部开关名', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/api/import/status')) return jsonResponse(STATUS_ENABLED)
      if (u.includes('/api/import/docx')) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              code: 40011,
              data: null,
              message: '导入功能已关闭（QB_IMPORT_ENABLED=0）。',
            }),
        } as unknown as Response
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = renderPage(<ImportPage />)
    await screen.findByText(/支持 .docx/)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('试卷.docx', 50)] } })
    fireEvent.click(await screen.findByText('开始导入'))

    expect(await screen.findByText('提交失败')).toBeInTheDocument()
    expect(screen.getByText('本机已关闭导入功能，暂时不能导入试卷。')).toBeInTheDocument()
    expect(screen.queryByText(/QB_IMPORT_ENABLED/)).not.toBeInTheDocument()
  })
})
