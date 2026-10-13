/**
 * T25 只读态 · 组卷工作台（`PaperBuilderPage`）。
 *
 * 审计原文：**组卷页连 `usePermissionGuard` 都没有**——只读账号可点写操作，仅靠后端 403 兜底。
 * 本文件用「捕获子组件 props」的方式，证明组卷页把只读态**下传到了真正的写操作控件**：
 * - 「加入」卡片：`addDisabledReason` 有值 + `draggable=false`（禁用并说明为什么）；
 * - 排版预览：`editable=false`（只读账号不进入可编辑模式）；
 * - 试卷设置：`canEdit=false`（元数据控件禁用）。
 *
 * 同时断言有权限（本地版等价路径）时**三个 prop 都不施加任何禁用**（零影响）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PaperBuilderPage from '../../src/pages/PaperBuilderPage'
import { buildTheme } from '../../src/theme'
import { usePaperStore } from '../../src/store/paperStore'
import { useUiStore } from '../../src/store/uiStore'
import { usePaperLibraryStore } from '../../src/store/paperLibraryStore'
import { AuthProvider } from '../../src/app/auth/AuthProvider'

const perms = vi.hoisted(() => ({ allow: true }))
vi.mock('../../src/lib/permissions', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/permissions')>()
  return { ...orig, roleCan: () => perms.allow }
})

const seen = vi.hoisted(() => ({
  card: [] as Array<Record<string, unknown>>,
  preview: [] as Array<Record<string, unknown>>,
  settings: [] as Array<Record<string, unknown>>,
}))

const paper = {
  id: 2, title: '卷B', template: '考试', answer_mode: '学生版',
  items: [], sections: [], summary: { item_count: 0, total_score: 0, unscored_count: 0 },
}
vi.mock('../../src/api/papers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPaper: vi.fn(async () => paper),
}))
vi.mock('../../src/api/export', () => ({
  getExportData: vi.fn(async () => ({ sections: [], paper: { title: '卷B' }, diagnostics: { export_allowed: true, warning_count: 0, blocker_count: 0 } })),
}))
vi.mock('../../src/hooks/useSearch', () => ({
  useSearchQuery: () => ({ data: { items: [{ id: 7, number: '7', plain_text: '题干' }], total: 1 } }),
  useFacetsQuery: () => ({ data: {} }),
}))
vi.mock('../../src/components/FilterSidebar', () => ({ FilterSidebar: () => null }))
vi.mock('../../src/components/QuestionCard', () => ({
  QuestionCard: (p: Record<string, unknown>) => { seen.card.push(p); return null },
}))
vi.mock('../../src/components/LivePreviewPanel', () => ({
  LivePreviewPanel: (p: Record<string, unknown>) => { seen.preview.push(p); return null },
}))
vi.mock('../../src/components/PaperSettings', () => ({
  PaperSettings: (p: Record<string, unknown>) => { seen.settings.push(p); return null },
}))
vi.mock('../../src/components/ExportDrawer', () => {
  const Drawer = () => null
  return { ExportDrawer: Drawer, default: Drawer }
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={buildTheme()}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/builder']}><PaperBuilderPage /></MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  seen.card.length = 0; seen.preview.length = 0; seen.settings.length = 0
  usePaperStore.setState({ currentPaperId: 2, targetSectionId: null })
  useUiStore.setState({ builderView: 'layout' })
  usePaperLibraryStore.setState({ open: false })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('T25 · PaperBuilderPage 只读态', () => {
  it('只读账号：加入卡片禁用并说明为什么、排版预览只读、试卷设置禁用', async () => {
    perms.allow = false
    mount()
    await vi.waitFor(() => {
      expect(seen.card.length).toBeGreaterThan(0)
      expect(seen.preview.length).toBeGreaterThan(0)
      expect(seen.settings.length).toBeGreaterThan(0)
    })
    const card = seen.card[seen.card.length - 1]
    expect(card.addDisabledReason).toContain('只读权限')
    expect(card.draggable).toBe(false)
    expect(seen.preview[seen.preview.length - 1].editable).toBe(false)
    expect(seen.settings[seen.settings.length - 1].canEdit).toBe(false)
  })

  it('有权限（本地版等价路径）：三个 prop 均不施加任何禁用（零影响）', async () => {
    perms.allow = true
    mount()
    await vi.waitFor(() => {
      expect(seen.card.length).toBeGreaterThan(0)
      expect(seen.preview.length).toBeGreaterThan(0)
      expect(seen.settings.length).toBeGreaterThan(0)
    })
    const card = seen.card[seen.card.length - 1]
    expect(card.addDisabledReason).toBeUndefined()
    expect(card.draggable).toBe(true)
    expect(seen.preview[seen.preview.length - 1].editable).toBe(true)
    expect(seen.settings[seen.settings.length - 1].canEdit).toBe(true)
  })

  it('只读账号：即便调用写操作也不发出任何写请求（在 mutationFn 之前即被拒绝）', async () => {
    perms.allow = false
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: {}, message: 'ok' }) } as unknown as Response
    }))
    mount()
    await vi.waitFor(() => expect(seen.card.length).toBeGreaterThan(0))
    const onAdd = seen.card[seen.card.length - 1].onAdd as (i: { id: number }) => void
    onAdd({ id: 7 })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.some((u) => /questions|sections|snapshots/.test(u))).toBe(false)
  })
})
