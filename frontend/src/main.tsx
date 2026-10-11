import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import 'katex/dist/katex.min.css'
import './index.css'
import { buildTheme } from './theme'
import { getSettings } from './api/settings'
import { useSettingsStore } from './store/settingsStore'
import AppRouter from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

/** 设置保存后直接使用共享缓存；刷新页面也会恢复已保存主题。 */
function ApplicationTheme() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const theme = React.useMemo(() => buildTheme(data?.theme), [data?.theme?.primary, data?.theme?.dark])
  // P0-2：把设置镜像到 store，供 KatexFormula（渲染开关）与建卷（默认模板）消费。
  React.useEffect(() => {
    if (data) useSettingsStore.getState().syncFrom(data)
  }, [data])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppRouter />
    </ThemeProvider>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ApplicationTheme />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}
