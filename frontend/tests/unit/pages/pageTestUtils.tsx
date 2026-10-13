/**
 * 页面级集成测试公共工具（**非测试文件**：文件名不含 `.test.`，不被 vitest `include` 收集）。
 *
 * 与 `tests/unit/testUtils.tsx` 的分工：
 * - `testUtils.renderWithTheme`：只提供 MUI 主题包裹，供**组件级**用例；
 * - 本模块 `renderPage`：页面级还需要 **react-query**（每次新建 client、`retry:false`）
 *   与 **react-router**（`MemoryRouter`），并在 `src/api/client.ts` 的 `fetch` 边界打桩。
 *
 * mock 方案（二选一，此处选 **stubGlobal('fetch')**）
 * --------------------------------------------------
 * 四个页面都经 `src/api/*` → `src/api/client.ts` 的 fetch 封装取数。
 * 在 **fetch 边界**返回 `{code,data,message}` 信封，能一并覆盖真实的
 * 「信封解包 / 非 0 code 抛 ApiError」路径，且无需逐个 mock 4 个 api 模块的十几个函数
 * （维护面更小、更贴近生产）。因此本方案下页面测试里断言到的文案，
 * 与线上 `describeApiError` 的教师可读文案口径一致。
 */
import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { buildTheme } from '../../../src/theme'
import { AuthProvider } from '../../../src/app/auth/AuthProvider'

/** 新建测试专用 QueryClient：关闭重试（否则失败态用例会重试很久），不缓存、不标记为新鲜。 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/** 用 QueryClientProvider + MUI 主题 + MemoryRouter 包裹渲染页面。
 *
 * T25：额外包一层 `AuthProvider`——被测页面（如 SourcesPage / FormulaReviewPage）现已使用
 * `usePermission`（读 `useAuth`），缺 Provider 会**抛错**（刻意的安全失败模式）。
 * 测试环境未注入 `VITE_DEPLOY_MODE` → `IS_ONLINE=false` → 角色恒为 `admin`（本地版语义），
 * 与生产默认形态一致，且**不发任何请求**。
 */
export function renderPage(ui: ReactElement, options: { route?: string } = {}) {
  const client = makeTestQueryClient()
  const theme = buildTheme()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme}>
        <AuthProvider>
          <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
  return { client, ...render(ui, { wrapper }) }
}

/** 构造成功响应（`{code:0,data,message}` 信封）。 */
export function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data, message: 'ok' }),
  } as unknown as Response
}

/** 构造失败响应（非 0 code → `client.request` 抛 ApiError，message 为教师可读文案）。 */
export function errorResponse(code: number, message: string, status = 400): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ code, data: null, message }),
  } as unknown as Response
}

/** 可控延迟响应：用于稳定捕获「加载中」态，并在用例收尾时释放以清掉 client 的超时定时器。 */
export function deferredResponse() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
