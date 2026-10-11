import { createTheme } from '@mui/material/styles'

/**
 * 设计令牌单一来源（Single Source of Truth）。
 *
 * 背景：此前 `tailwind.config.js` 与 `theme.ts` 各自维护一套 token，但全库 0 处使用 Tailwind
 * 工具类，形成「第二套设计 token + 无消费方」的冗余。现已移除 Tailwind，所有 token 收敛到此处。
 *
 * 约定：本常量是**纯数据**（`as const`），不得写入 React 或副作用，便于被测试直接加载与跨端消费。
 * 组件通过 `useTheme()` 读取（见下方 module augmentation 的 `theme.designTokens` 等挂载点）。
 */
export const tokens = {
  // ── 语义色（来源：原 theme.ts，保持既有取值不变）────────────────────────────
  /** 品牌主色；历史非法主色会安全回退到该值。 */
  primary: '#3370FF',
  /** 成功 / 正向语义色（绿）。 */
  success: '#22C55E',
  /** 警示 / 待处理语义色（橙）。 */
  warning: '#F59E0B',
  /** 错误 / 危险语义色（红）。 */
  error: '#EF4444',
  /** 中性灰，用于禁用、次要文本等。 */
  neutral: '#9CA3AF',
  /** 页面底色（浅色模式）。 */
  bg: '#F5F6F8',

  // ── 难度色（来源：原 tailwind.config.js difficulty；M6 裁定：易=绿 / 中=橙 / 难=红）──
  difficulty: {
    /** 易：绿。 */
    easy: '#22C55E',
    /** 中：橙。 */
    medium: '#F59E0B',
    /** 难：红。 */
    hard: '#EF4444',
  },

  // ── 状态徽章色（来源：原 tailwind.config.js badge）──────────────────────────
  badge: {
    /** 待复核：橙。 */
    review: '#F59E0B',
    /** 已确认：绿。 */
    confirmed: '#22C55E',
    /** 已否决：灰。 */
    rejected: '#9CA3AF',
    /** 缺失：浅灰（作底色使用）。 */
    missing: '#E5E7EB',
  },

  // ── 间距：8px 栅格（来源：原 tailwind.config.js spacing；与 MUI 默认 spacing=8 对齐）──
  /** 数值为 px；MUI 的 `theme.spacing(n)` 默认即 8px 栅格，故无需覆写，仅作为显式常量供参考/消费。 */
  space: {
    1: 8,
    2: 16,
    3: 24,
    4: 32,
  },

  // ── 圆角（来源：原 theme.ts radius + 原 tailwind.config.js borderRadius.card）──
  /** 基础圆角，接入 MUI `shape.borderRadius`。 */
  radius: 10,
  /** 圆角档位：小（标签/输入）/ 中（卡片，等同 radius）/ 大（抽屉/模态）。 */
  radiusScale: {
    sm: 6,
    md: 10,
    lg: 14,
  },

  // ── 字号：5 档（来源：与 MUI 默认字号对齐，避免引入视觉变化）──────────────────
  /** 数值为 px。h6/subtitle1/body2/caption 与 MUI 默认值一致；micro 为补充档。 */
  fontSize: {
    /** 区块标题（对应 MUI h6，默认 1.25rem = 20px）。 */
    h6: 20,
    /** 卡片/小标题（对应 MUI subtitle1，默认 1rem = 16px）。 */
    subtitle1: 16,
    /** 次要正文（对应 MUI body2，默认 0.875rem = 14px）。 */
    body2: 14,
    /** 辅助说明（对应 MUI caption，默认 0.75rem = 12px）。 */
    caption: 12,
    /** 极小标注（无 MUI 默认对应档，供紧凑场景使用）。 */
    micro: 11,
  },

  // ── 阴影：3 档（来源：新增，统一此前散落的 box-shadow 语义）──────────────────
  shadow: {
    /** 卡片 hover：轻微抬升。 */
    cardHover: '0 2px 8px rgba(0, 0, 0, 0.08)',
    /** 抽屉（Drawer）：中等高度。 */
    drawer: '0 8px 24px rgba(0, 0, 0, 0.12)',
    /** 模态（Dialog）：最高层级。 */
    modal: '0 16px 48px rgba(0, 0, 0, 0.2)',
  },
} as const

/**
 * 把自定义 token 挂到 MUI 主题类型上，使组件可用 `useTheme()` / `sx` 直接消费：
 * - `palette.difficulty` / `palette.badge`：语义色，可在 `sx={{ color: 'difficulty.hard' }}` 中使用；
 * - `designTokens`：完整 token 对象的引用（圆角档位、字号、间距、阴影等纯数据入口）。
 *
 * 说明：这些是**运行时会被 createTheme 原样保留**的扩展键（MUI 对未知 palette/theme 键做深合并）。
 * 圆角档位（sm/md/lg）放在 `designTokens.radiusScale`：MUI 的 `Shape` 接口声明在 `@mui/system`
 * 而非 `@mui/material/styles`，直接扩展 shape 需深路径模块增强、风险高，故不改动 shape 结构，
 * `shape.borderRadius` 仍保持既有取值（= tokens.radius）。
 * 注意：**未覆写 `typography` 各 variant 的字号**——MUI 默认值已与 tokens.fontSize 对齐，
 * 覆写会改变构建产出的 CSS（如 1.25rem → 20px），违背「本轮视觉零变化」的要求。
 */
declare module '@mui/material/styles' {
  interface Palette {
    difficulty: typeof tokens.difficulty
    badge: typeof tokens.badge
  }
  interface PaletteOptions {
    difficulty?: typeof tokens.difficulty
    badge?: typeof tokens.badge
  }
  interface Theme {
    designTokens: typeof tokens
  }
  interface ThemeOptions {
    designTokens?: typeof tokens
  }
}

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
      // 难度色 / 徽章色：供组件以 palette 路径消费，保持单一来源。
      difficulty: tokens.difficulty,
      badge: tokens.badge,
    },
    shape: {
      borderRadius: tokens.radius,
    },
    typography: {
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, Arial, sans-serif",
    },
    // 完整 token 引用：字号、间距、阴影等纯数据入口。
    designTokens: tokens,
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    },
  })
}

export const theme = buildTheme()

export default theme
