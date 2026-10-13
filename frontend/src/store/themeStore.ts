/**
 * 主题三态偏好 store（设计规范 §4.5 第 7 条）。
 *
 * 为什么用 store 而非页面局部 state：模式要**同时**驱动两处——
 *  `main.tsx` 的 `ApplicationTheme`（建主题）与设置页的控件；设置页改一次，
 *  主题必须立刻跟着变（无需刷新）。zustand 提供一个无 Provider 依赖的共享源。
 *
 * 为什么**不用** zustand `persist`：`persist` 会把值包成 `{"state":{...}}` JSON；
 * 而 `lib/themeMode.ts` 的读写约定是**裸字符串**（`qb_theme_mode = 'dark'`），
 * 二者混用会让「已存值」判定（`readStoredThemeMode()`）读不到裸值。
 * 故这里手工在 `setMode` 里落盘，读写口径完全收敛到 `lib/themeMode.ts`。
 */
import { create } from 'zustand'
import {
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  writeStoredThemeMode,
  type ThemeMode,
} from '../lib/themeMode'

interface ThemeModeState {
  /** 当前主题模式（初值 = 已存偏好；无值则「跟随系统」）。 */
  mode: ThemeMode
  /** 设置模式并落盘（存储不可用时仅当次会话生效）。 */
  setMode: (mode: ThemeMode) => void
}

export const useThemeModeStore = create<ThemeModeState>((set) => ({
  mode: readStoredThemeMode() ?? DEFAULT_THEME_MODE,
  setMode: (mode) => {
    writeStoredThemeMode(mode)
    set({ mode })
  },
}))
