/**
 * 阶段 5 性能优化（P5-1）护栏测试：**路由级代码分割** + **Suspense 加载态**。
 *
 * 背景：改前 `router.tsx` 同步 import 全部 9 个页面，入口单 chunk 达 1.12 MB，
 * 首屏被迫下载并解析全部页面（含 4 个低频治理页）。本测试从两个层面守住这次优化：
 * 1. **配置不变量**（读源码）：`router.tsx` 不得再出现静态页面 import，9 个页面必须
 *    全部走 React.lazy + 动态import（builder直接加载，其他经routePages二层延迟）；`App.tsx` 的 `<Suspense>` 必须包住 `<Outlet/>`
 *    且仍在 `ErrorBoundary` 之内。
 * 2. **真实行为**：挂一个懒加载子路由，验证「先出现统一加载态、外壳不消失、随后渲染页面」。
 *
 * 若有人把某个页面改回静态 import，或用裸文字替换 `LoadingState`，用例会直接变红。
 */
import { lazy, type ComponentType } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../src/app/auth/AuthProvider'
import App from '../../src/App'
// 用 Vite 的 `?raw` 把生产源码作为**文本**读进来做「配置不变量」断言
// （无需 Node fs，也避免 tsconfig 未引入 node 类型的问题）。
import routerSrc from '../../src/router.tsx?raw'
import appSrc from '../../src/App.tsx?raw'
import routePagesSrc from '../../src/app/routePages.ts?raw'
import { renderWithTheme } from './testUtils'

/** 9 个页面组件文件名（与 `router.tsx` 的 lazy 目标一一对应）。 */
const PAGE_FILES = [
  'SearchPage',
  'QuestionDetailPage',
  'PaperBuilderPage',
  'ExportPage',
  'KnowledgeReviewPage',
  'FormulaReviewPage',
  'SourcesPage',
  'StatsPage',
  'SettingsPage',
]

describe('路由级代码分割：配置不变量', () => {
  it('router.tsx 不再有任何静态页面 import（全部改为按需加载）', () => {
    // 匹配 `import X from './pages/...'` 这类静态导入；不应再出现。
    const staticPageImports = routerSrc.match(/^import\s+\w+\s+from\s+'\.\/pages\//gm) ?? []
    expect(staticPageImports).toEqual([])
  })

  it('页面全部使用 React.lazy + 动态 import（不得存在同步 import）', () => {
    for (const page of PAGE_FILES) {
      expect(page === 'PaperBuilderPage' ? routerSrc : routePagesSrc).toContain(page === 'PaperBuilderPage' ? `lazy(() => import('./pages/${page}'))` : `import('../pages/${page}')`)
    }
    // 不变量：**不得**存在对 `./pages/` 的同步 import——那会让该页面回到首屏 chunk，
    // 把代码分割的收益吃掉。
    //
    // ⚠️ 这里刻意**不断言懒加载的数量**：阶段 4 新增了 `LoginPage` 也走懒加载，
    // 若把数量写死（原来是 9），每加一个页面就要改测试——而"数量"根本不是我们要守的性质。
    expect(routerSrc).not.toMatch(/^import\s+\w+\s+from\s+'\.\/pages\//m)
    expect(routePagesSrc).not.toMatch(/^import\s+\w+\s+from\s+'\.\.\/pages\//m)
  })

  it('登录页（阶段 4）同样走懒加载（本地版永不下载它）', () => {
    expect(routerSrc).toContain("const LoginPage = page('LoginPage')")
    expect(routePagesSrc).toContain("import('../pages/LoginPage')")
  })

  it('默认落地页仍是 /builder（代码分割不得改变落地行为）', () => {
    expect(routerSrc).toContain("export const DEFAULT_LANDING_PATH = '/builder'")
  })
})

describe('加载态边界：Suspense 位置不变量', () => {
  it('Suspense 的 fallback 复用统一 LoadingState（不是裸文字）', () => {
    expect(appSrc).toContain('fallback={<LoadingState')
    expect(appSrc).toContain("import LoadingState from './components/LoadingState'")
  })

  it('Suspense 包住 <Outlet/>，且仍处于 ErrorBoundary 之内', () => {
    const boundaryAt = appSrc.indexOf('<ErrorBoundary resetKeys=')
    const suspenseAt = appSrc.indexOf('<Suspense')
    const outletAt = appSrc.indexOf('<Outlet />')
    // 三者都存在，且顺序为 ErrorBoundary → Suspense → Outlet。
    expect(boundaryAt).toBeGreaterThanOrEqual(0)
    expect(suspenseAt).toBeGreaterThan(boundaryAt)
    expect(outletAt).toBeGreaterThan(suspenseAt)
  })
})

// ---- 行为验证：懒加载页面挂载时的加载态与外壳保持 ----

/**
 * 造一个**手动放行**的懒加载页面组件。
 *
 * 刻意**不用 `setTimeout` 造加载窗口**：那会引入时序竞态——窗口太窄时（尤其并行跑多文件、
 * 机器繁忙时），`render()` 自身耗时可能就超过窗口，等断言执行时 fallback 早已卸载，
 * `findByRole` 即便拿到节点也随即失效（"element could not be found"）。
 *
 * 这里改成可控 Promise：在测试显式 `release()` 之前，组件**必定**处于挂起态，
 * 加载态稳定存在，断言与机器快慢完全无关。
 */
function makeLazyPage() {
  let release!: () => void
  const Comp = lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((resolve) => {
        release = () => resolve({ default: () => <div>懒加载页面内容</div> })
      }),
  )
  return { Comp, release: () => release() }
}

// mock API 客户端：健康检查 / 试卷列表都返回可用的空数据，测试不触网。
vi.mock('../../src/api/client', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })),
    post: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    del: vi.fn(() => Promise.resolve({})),
  },
  api: {
    get: vi.fn(() => Promise.resolve({ degraded: false, messages: [] })),
    post: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    del: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  // 阶段 4：AuthProvider 依赖这些导出；测试替身需同步（否则 vitest 会报
  // "No ... export is defined on the mock"）。返回 no-op，让被测组件按本地版语义渲染。
  setAuthToken: vi.fn(),
  getAuthToken: vi.fn(() => null),
  setUnauthorizedHandler: vi.fn(),
}))

describe('懒加载页面：加载态与外壳保持', () => {
  function renderAppWithLazyChild(Child: ComponentType) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return renderWithTheme(
      <QueryClientProvider client={queryClient}>
        {/* 阶段 4：App 内含 SessionControls/SessionNotice，需要 AuthProvider（与生产 main.tsx 同构）。 */}
        <AuthProvider>
        <MemoryRouter initialEntries={['/builder']}>
          <Routes>
            <Route path="/builder" element={<App />}>
              <Route index element={<Child />} />
            </Route>
          </Routes>
        </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )
  }

  it('懒加载期间先显示统一加载态且侧栏外壳不消失，放行后渲染页面内容', async () => {
    const { Comp, release } = makeLazyPage()
    renderAppWithLazyChild(Comp)

    // 组件仍挂起（尚未 release）→ fallback 必定存在，不存在竞态窗口。
    // LoadingState 以 role="status" 暴露给读屏与测试。
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('页面加载中…')
    // 关键：加载期间 App 外壳仍在——若 Suspense 放在 App 之外，侧栏会整体卸载。
    expect(screen.getByText('组卷工作台')).toBeInTheDocument()

    // 放行懒加载 → 页面内容渲染，加载态随之消失。
    await act(async () => {
      release()
    })
    expect(await screen.findByText('懒加载页面内容')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
