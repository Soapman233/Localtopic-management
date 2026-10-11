import { createTheme } from '@mui/material/styles'

/** 设计令牌单一来源：主色 #3370FF、圆角、语义色（与 tailwind.config.js 对齐）。 */
export const tokens = {
  primary: '#3370FF',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  neutral: '#9CA3AF',
  bg: '#F5F6F8',
  radius: 10,
} as const

/** 读取已保存偏好；历史非法主色安全回退，避免主题构建导致白屏。 */
export function buildTheme(preferences?: { primary?: string; dark?: boolean }) {
  const dark = preferences?.dark === true
  const color = preferences?.primary ?? ''
  const primary = /^#[0-9a-fA-F]{6}$/.test(color) ? color : tokens.primary
  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: primary },
      success: { main: tokens.success },
      warning: { main: tokens.warning },
      error: { main: tokens.error },
      background: dark ? { default: '#121212', paper: '#1E1E1E' } : { default: tokens.bg, paper: '#FFFFFF' },
    },
    shape: { borderRadius: tokens.radius },
    typography: {
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, Arial, sans-serif",
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    },
  })
}

export const theme = buildTheme()

export default theme
