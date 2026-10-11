/**
 * 测试公共工具（**非测试文件**，不被 `include` 收集）。
 *
 * 两个渲染入口，按被测对象选：
 *
 * - `renderWithTheme`：**只**包 MUI 主题。适合纯组件（不碰 react-query / 鉴权）。
 * - `renderWithProviders`：包 主题 + `QueryClientProvider` + `AuthProvider`，
 *   **与生产 `main.tsx` 的包裹层级一致**。凡是要渲染 `App` / 页面 / 任何用到
 *   `useAuth`（如 `SessionControls`）或 `useQuery` 的组件，都必须用它。
 *
 * ⚠️ 为什么 `useAuth` 在缺 Provider 时**抛错**而不是静默兜底：
 * 静默兜底会让"忘了套 `AuthProvider`"变成**静默放行**（`RequireAuth` 直接透传），
 * 即鉴权被无声绕过——这是**安全相关的失败模式**，必须响亮地失败。
 * 因此这里如实补上 Provider，而不是把组件改成不需要 Provider。
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildTheme } from '../../src/theme'
import { AuthProvider } from '../../src/app/auth/AuthProvider'

/** 用真实设计令牌（`buildTheme`）包裹渲染，保证主题相关行为与生产一致。 */
export function renderWithTheme(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const theme = buildTheme()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider theme={theme}>{children}</ThemeProvider>
  )
  return render(ui, { wrapper, ...options })
}

/**
 * 与生产同构的包裹：主题 + QueryClient + AuthProvider。
 *
 * 说明：`AuthProvider` 会请求 `/api/auth/me`。测试环境没有后端，该请求失败 →
 * `authEnabled` 为 `false` → 各组件按**本地版**语义渲染（不显示登录相关 UI）。
 * 这正好与被测的默认部署形态一致，且**不需要**在测试里额外打桩。
 * （`retry: false` 保证失败态立刻落定，不会拖慢用例。）
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const theme = buildTheme()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
  return render(ui, { wrapper, ...options })
}
