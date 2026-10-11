/**
 * 测试公共工具（**非测试文件**，不被 `include` 收集）。
 *
 * `renderWithTheme` 提供与生产一致的 MUI 主题包裹；本项目这 4 个被测组件均不依赖
 * react-query，故未包裹 `QueryClientProvider`（后续若测页面级组件再按需扩展）。
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { buildTheme } from '../../src/theme'

/** 用真实设计令牌（`buildTheme`）包裹渲染，保证主题相关行为与生产一致。 */
export function renderWithTheme(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const theme = buildTheme()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider theme={theme}>{children}</ThemeProvider>
  )
  return render(ui, { wrapper, ...options })
}
