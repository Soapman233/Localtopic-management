import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { SnackbarProvider } from 'notistack'
import { MutationCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import 'katex/dist/katex.min.css'
import './index.css'
import { buildTheme } from './theme'
import { getSettings } from './api/settings'
import { qk } from './api/queryKeys'
import { useSettingsStore } from './store/settingsStore'
import { useThemeModeStore } from './store/themeStore'
import {
  SYSTEM_DARK_QUERY,
  effectiveDark,
  readStoredThemeMode,
  resolveThemeMode,
  systemPrefersDark,
} from './lib/themeMode'
import { notify } from './lib/feedback'
import { AuthProvider } from './app/auth/AuthProvider'
import ErrorBoundary from './components/ErrorBoundary'
import NotifierBridge from './components/NotifierBridge'
import AppRouter from './router'
import { bootstrapLanToken } from './lib/lanToken'

// 🔴 必须在渲染之前：局域网扫码链接里的 `?t=<令牌>` 要在**任何 API 调用之前**
// 落到存储与 api 客户端，否则 AuthProvider 初始化时读不到令牌 → 首屏全 401。
// 本地版（无该参数）此调用为空操作。
bootstrapLanToken()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
  // 全局兜底：**只对没有本地 onError 的 mutation** 弹提示，避免与页面自己的处理重复。
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!mutation.options.onError) notify.errorFrom(error)
    },
  }),
})

/** 系统深色偏好（`matchMedia` 监听：系统切换时**实时**生效，无需刷新）。 */
function useSystemDark(): boolean {
  const [dark, setDark] = React.useState(systemPrefersDark)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(SYSTEM_DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    // 首挂载同步一次：首次渲染与订阅之间用户可能改过系统设置。
    setDark(mql.matches)
    // addEventListener 在旧 Safari 上不存在，回退 addListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])
  return dark
}

/** 设置保存后直接使用共享缓存；刷新页面也会恢复已保存主题。 */
function ApplicationTheme() {
  const { data } = useQuery({ queryKey: qk.settings(), queryFn: getSettings })
  // §4.5 第 7 条：三态模式（localStorage）+ 系统深色 → 实际深浅。
  const mode = useThemeModeStore((s) => s.mode)
  const setMode = useThemeModeStore((s) => s.setMode)
  const systemDark = useSystemDark()

  // 旧安装迁移：设置首次到达、且本地**没有**三态偏好时，用后端旧布尔播种一次
  // （`dark:true` 保留深色；`false`/缺失视为未选过 → 跟随系统）。理由见 `lib/themeMode.ts`。
  React.useEffect(() => {
    if (!data) return
    if (readStoredThemeMode() == null) setMode(resolveThemeMode(null, data.theme?.dark))
  }, [data, setMode])

  const dark = effectiveDark(mode, systemDark)
  const theme = React.useMemo(
    () => buildTheme({ primary: data?.theme?.primary, dark }),
    [data?.theme?.primary, dark],
  )
  // P0-2：把设置镜像到 store，供 KatexFormula（渲染开关）与建卷（默认模板）消费。
  React.useEffect(() => {
    if (data) useSettingsStore.getState().syncFrom(data)
  }, [data])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* 全局反馈底座（阶段 0）：统一 toast，替换分散的 Alert / Snackbar / 页内 state。 */}
      <SnackbarProvider
        maxSnack={3}
        autoHideDuration={3000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <NotifierBridge />
        <AppRouter />
      </SnackbarProvider>
    </ThemeProvider>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      {/* 顶层错误边界：兜住应用外壳（主题 / 路由）自身的异常。 */}
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {/* 鉴权（阶段 4）：必须在 QueryClientProvider **内**——它用 useQuery 读 `/api/auth/me`。
              本地版后端返回 `auth_enabled:false`，此处的存在感为零（角色按 admin、路由透传）。 */}
          <AuthProvider>
            <ApplicationTheme />
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
