import { createTheme } from '@mui/material/styles'

/**
 * 设计令牌单一来源（Single Source of Truth）。
 *
 * 背景：此前 `tailwind.config.js` 与 `theme.ts` 各自维护一套 token，但全库 0 处使用 Tailwind
 * 工具类，形成「第二套设计 token + 无消费方」的冗余。现已移除 Tailwind，所有 token 收敛到此处。
 *
 * 约定：本常量是**纯数据**（`as const`），不得写入 React 或副作用，便于被测试直接加载与跨端消费。
 * 组件通过 `useTheme()` 读取（下方 `buildTheme` 把 token 映射到 MUI `palette`）。
 */
export const tokens = {
  // ══════════════════════════════════════════════════════════════════════════
  // P5-2：WCAG 2 AA 对比度治理（可计算，不靠肉眼）。
  //
  // 核心问题：鲜艳的语义色（绿 #22C55E / 橙 #F59E0B / 红 #EF4444）作**浅色底上的文字**
  // 时对比度只有 2.15–3.76:1，未达 AA 正文 4.5:1。但同一种色作**深色文字的背景填充**
  // 却完全够用（深字压鲜艳底 5.6–9.8:1）。
  //
  // 因此把「填充角色」与「文字角色」拆成两套值：
  //   · `success/warning/error`（鲜艳）  = **填充值**，只作大色块填充（filled 徽章底、图表等）。
  //   · `successText/warningText/errorText`（深色）= **文字值**，作浅底上的文字/图标/描边。
  // MUI 的 `palette.<color>.main` 被 outlined 徽章文字、图标、`Typography color`、Alert 共用，
  // 故 `.main` 统一取**文字安全值**；filled 徽章底色由 `MuiChip.styleOverrides` 回填鲜艳值（见下）。
  //
  // 实测比值见 `tests/visual/contrast-pairs.json`（`npm run contrast` 门禁，0 组不达标）。
  // ══════════════════════════════════════════════════════════════════════════

  // ── 品牌主色 ────────────────────────────────────────────────────────────────
  /**
   * 主色（**文字安全值**）。作主按钮/顶栏底色时白字 5.13:1；
   * 作浅底上的文字：白卡片 5.13:1 / 页面底色 `#F5F6F8` 4.74:1（如「严格模式」caption 直接落在页面底上）。
   * 原值 `#3370FF` 白字仅 4.28:1；团队候选 `#3268F5` 在**页面底色**上仅 4.38:1，故再下调一档。
   */
  primary: '#2F63EA',
  /**
   * 原品牌主色（`#3370FF`）：因白字对比度 4.28:1 不达标而**不再用于白字/正文**。
   *
   * ⚠️ **历史参考值，不参与构建**：本 token **不被 `buildTheme` 消费**，
   * 仅作「主色为何从 `#3370FF` 下调」的**决策留痕**。
   * **不要**拿它去覆盖 `primary`——那会把对比度回退到不达标状态。
   */
  primaryBrand: '#3370FF',

  // ── 语义色：填充值（鲜艳，保留品牌观感；仅作非文字填充）────────────────────
  /** 成功绿「填充值」。作浅底文字仅 2.28:1，**禁止**作文字/图标，仅作 filled 徽章底等填充。 */
  success: '#22C55E',
  /** 警示橙「填充值」。作浅底文字仅 2.15:1，**禁止**作文字/图标。 */
  warning: '#F59E0B',
  /** 错误红「填充值」。作浅底文字仅 3.76:1，**禁止**作文字/图标。 */
  error: '#EF4444',

  // ── 语义色：文字安全值（浅色模式，用于 palette.<color>.main）────────────────
  /** 成功绿「文字值」：白底 5.02:1。 */
  successText: '#15803D',
  /** 警示橙「文字值」：白底 5.22:1 / 页面底色 4.83:1 / 警示 Alert 底 4.68:1。 */
  warningText: '#B15008',
  /** 错误红「文字值」：白底 5.22:1 / 页面底色 4.83:1。 */
  errorText: '#D32222',

  // ── 语义色：文字安全值（深色模式；浅底上的深色值在深底上不达标，故另配浅色）──
  /** 成功绿「深色模式文字值」：`#121212` 上 10.77:1。 */
  successTextDark: '#4ADE80',
  /** 警示橙「深色模式文字值」：`#121212` 上 11.23:1。 */
  warningTextDark: '#FBBF24',
  /** 错误红「深色模式文字值」：`#121212` 上 6.79:1。 */
  errorTextDark: '#F87171',

  // ── 中性灰 ─────────────────────────────────────────────────────────────────
  /**
   * 中性灰「文字值」：白底 4.97:1 / 页面底色 `#F5F6F8` 上 4.60:1，两种底都达标。
   * 注：常见取值 `#6B7280` 在页面底色上仅 4.47:1（差 0.03），故取 `#667085`。
   * 当前 `src/` 内**暂无消费方**（仅声明），保留为规范取值供后续使用。
   */
  neutral: '#667085',
  /** 中性灰「禁用态」值：SC 1.4.3 明确豁免 disabled 控件，故保留浅灰以维持禁用观感。 */
  neutralDisabled: '#9CA3AF',
  /** 页面底色（浅色模式）。 */
  bg: '#F5F6F8',

  // ── 圆角（来源：原 theme.ts radius + 原 tailwind.config.js borderRadius.card）──
  /** 基础圆角，接入 MUI `shape.borderRadius`。 */
  radius: 10,

  // ── 字号：5 档（来源：与 MUI 默认字号对齐，避免引入视觉变化）──────────────────
  /**
   * 数值为 px。h6/subtitle1/body2/caption 与 MUI 默认值一致；micro 为补充档。
   *
   * ⚠️ **仅作类型尺度参照，不参与构建**：本对象**不被 `buildTheme` 消费**
   * （刻意不覆写 MUI 各 variant 字号，理由见 `buildTheme` 内说明）。
   * 保留仅为「设计意图的类型尺度」留档；**改它不会产生任何视觉变化**，勿据此判断生效。
   */
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
} as const

/**
 * 鲜艳填充色上的文字色（深字压鲜艳底）。
 * 实测：#22C55E 9.22:1 / #F59E0B 9.78:1 / #EF4444 5.58:1，均 ≥ 4.5:1。
 * 这是 MUI `getContrastText()` 对这三个鲜艳底色的既有选择，保持与历史 filled 徽章观感一致。
 */
const ON_VIVID_FILL = 'rgba(0, 0, 0, 0.87)'

/**
 * 浅色填充底上的白色文字（用于 filled 主按钮、顶栏等）。
 * 语义色的 `.main` 已是深色，白字实测 4.84–5.02:1；主色白字 4.74:1。
 */
const ON_SOLID_FILL = '#FFFFFF'

/** 读取已保存偏好；历史非法主色安全回退，避免主题构建导致白屏。 */
export function buildTheme(preferences?: { primary?: string; dark?: boolean }) {
  const dark = preferences?.dark === true
  const color = preferences?.primary ?? ''
  const primary = /^#[0-9a-fA-F]{6}$/.test(color) ? color : tokens.primary
  /**
   * 语义色 `.main` 按模式取「文字安全值」：
   * - 浅色模式取深色值（白底/浅底上作文字/图标/描边达标）；
   * - 深色模式取浅色值（`#121212`/`#1E1E1E` 上作文字/图标达标）。
   * `contrastText` 显式指定，**不能**依赖 MUI 自动推导——MUI 的 `getContrastText` 阈值是 3:1，
   * 在深色 `.main` 上会误选深色文字（如 `#15803D` 上深字仅 4.18:1，不达标），必须钉死为白色。
   */
  const semantic = {
    success: dark ? tokens.successTextDark : tokens.successText,
    warning: dark ? tokens.warningTextDark : tokens.warningText,
    error: dark ? tokens.errorTextDark : tokens.errorText,
  }
  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: primary, contrastText: ON_SOLID_FILL },
      success: { main: semantic.success, contrastText: dark ? ON_VIVID_FILL : ON_SOLID_FILL },
      warning: { main: semantic.warning, contrastText: dark ? ON_VIVID_FILL : ON_SOLID_FILL },
      error: { main: semantic.error, contrastText: dark ? ON_VIVID_FILL : ON_SOLID_FILL },
      background: dark ? { default: '#121212', paper: '#1E1E1E' } : { default: tokens.bg, paper: '#FFFFFF' },
    },
    shape: {
      borderRadius: tokens.radius,
    },
    /**
     * 未覆写各 variant 的字号：MUI 默认值已与 tokens.fontSize 对齐，
     * 覆写会改变构建产出的 CSS（如 1.25rem → 20px），违背「视觉零变化」的要求。
     */
    typography: {
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, Arial, sans-serif",
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          /**
           * 补回**键盘焦点指示**（L3 键盘 e2e 发现的真实缺陷）。
           *
           * 根因：MUI `Button` 的焦点样式是 `&.Mui-focusVisible { boxShadow: shadows[6] }`
           * （见 `@mui/material/Button/Button.js:114`），但 `disableElevation: true` 走的分支是
           * `&.Mui-focusVisible { boxShadow: 'none' }`（同文件 :176）——**把焦点指示抹掉了**；
           * 而 `ButtonBase` 又设了 `outline: 0`（`ButtonBase.js:51`）。
           * 两者叠加 ⇒ **所有 MUI Button 的键盘焦点完全不可见**（实测 `outline: none 0px`、背景与阴影无变化）。
           *
           * 这里补一个明确的焦点环。用 `outline` 而非 `box-shadow`：不受 disableElevation 影响，
           * 且不占据布局空间（`outlineOffset` 让它稍微外扩，视觉更清晰）。
           */
          root: ({ theme }) => ({
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }),
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiChip: {
        styleOverrides: {
          /**
           * 「填充 vs 文字」分离的落地点。
           *
           * MUI 的 outlined 与 filled **共用** `palette.<color>.main` 一个槽位
           * （见 `@mui/material/Chip/Chip.js:230` 与 `:168`）：outlined 用 `.main` 作文字/描边，
           * filled 用 `.main` 作底色。但 `.main` 已被定为**文字安全深色**（供浅底文字/图标/Alert），
           * 若不做处理，filled 徽章底色会跟着变深。
           *
           * 这里把 filled 徽章的**底色**回填鲜艳填充值、文字用深色——filled 徽章视觉与改动前一致，
           * 同时 outlined 徽章自动用上文字安全色。实测深字压鲜艳底 9.22 / 9.78 / 5.58:1，均 ≥ 4.5:1。
           * 仅对 success/warning/error 生效；`default`/`primary` 等走 MUI 原逻辑（已达标）。
           */
          root: ({ ownerState }: { ownerState: { variant?: string; color?: string } }) => {
            if (ownerState.variant !== 'filled') return {}
            const fill: Partial<Record<string, string>> = {
              success: tokens.success,
              warning: tokens.warning,
              error: tokens.error,
            }
            const bg = ownerState.color ? fill[ownerState.color] : undefined
            return bg ? { backgroundColor: bg, color: ON_VIVID_FILL } : {}
          },
        },
      },
    },
  })
}

export const theme = buildTheme()

export default theme
