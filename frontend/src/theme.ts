import { alpha, createTheme } from '@mui/material/styles'

// ── M3 动效令牌的类型补充 ──────────────────────────────────────────────────────
// MUI 的 `transitions.duration` / `easing` 只声明了 M2 档位键（shortest…leavingScreen /
// easeInOut…sharp）。M3 用的是 short/medium/long/extra-long + standard/emphasized 命名，
// 这里就地扩展声明，使 `createTheme` 能接受并让 `theme.transitions` 上带出完整 M3 档位。
declare module '@mui/material/styles/createTransitions' {
  interface Duration {
    /** M3 short1 = 50ms */
    short1: number
    /** M3 short2 = 100ms */
    short2: number
    /** M3 short3 = 150ms */
    short3: number
    /** M3 short4 = 200ms */
    short4: number
    /** M3 medium1 = 250ms */
    medium1: number
    /** M3 medium2 = 300ms */
    medium2: number
    /** M3 medium3 = 350ms */
    medium3: number
    /** M3 medium4 = 400ms */
    medium4: number
    /** M3 long1 = 450ms */
    long1: number
    /** M3 long2 = 500ms */
    long2: number
    /** M3 long3 = 550ms */
    long3: number
    /** M3 long4 = 600ms */
    long4: number
    /** M3 extra-long1 = 700ms */
    extraLong1: number
    /** M3 extra-long2 = 800ms */
    extraLong2: number
    /** M3 extra-long3 = 900ms */
    extraLong3: number
    /** M3 extra-long4 = 1000ms */
    extraLong4: number
  }

  interface Easing {
    /** M3 standard：常规元素进出场 */
    standard: string
    /** M3 standard-decelerate：元素入场 */
    standardDecelerate: string
    /** M3 standard-accelerate：元素离场 */
    standardAccelerate: string
    /** M3 emphasized：需要更多表现力的转场 */
    emphasized: string
    /** M3 emphasized-decelerate */
    emphasizedDecelerate: string
    /** M3 emphasized-accelerate */
    emphasizedAccelerate: string
    /** M3 linear：进度类、恒定速率 */
    linear: string
  }
}

/**
 * 设计令牌单一来源（Single Source of Truth）。
 *
 * 背景：此前 `tailwind.config.js` 与 `theme.ts` 各自维护一套 token，但全库 0 处使用 Tailwind
 * 工具类，形成「第二套设计 token + 无消费方」的冗余。现已移除 Tailwind，所有 token 收敛到此处。
 *
 * 约定：本常量是**纯数据**（`as const`），不得写入 React 或副作用，便于被测试直接加载与跨端消费。
 * 组件通过 `useTheme()` 读取（下方 `buildTheme` 把 token 映射到 MUI `palette`）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 本次升级：向 Material Design 3（Material You）对齐
 * ══════════════════════════════════════════════════════════════════════════════
 * 对齐的 M3 原则（逐条对应改动）：
 *  1. **Motion（动效）**：M3 把时长拆成 short / medium / long / extra-long 四档，
 *     缓动拆成 standard / emphasized 两大族。此前主题**没有任何动效 token**（只有 MUI 的 M2 默认值），
 *     故新增 `motion` 补齐 M3 完整档位并接入 `theme.transitions`，供后续动效接入复用。
 *  2. **Shape（形状）**：M3 形状刻度为 4/8/12/16/28/full，整体比 M2 大。
 *     基础圆角 10 → 12（M3 medium，即卡片 / 输入框档位）。未取 16 或 full：全库有 30+ 处
 *     `borderRadius: 1` 的派生用法（`shape.borderRadius × 1`），再放大会让紧凑控件过度圆润。
 *  3. **Elevation（高度）**：M3 用 **tonal elevation**——极淡阴影 + 表面色调，取代 M2 的厚重投影。
 *     这里只把 level-1 阴影（默认 Paper/Card 的高度）换成更淡的一档，并给卡片补 1px 描边，
 *     保证「卡片仍可辨识」；level ≥ 2（Menu / Dialog / AppBar）保持 MUI 原值，不削弱浮层分离度。
 *  4. **State layer（状态层）**：M3 用内容色按 8%（hover）/ 12%（focus / pressed）叠加，
 *     取代 M2 的 4% 悬停底色（落点在 `MuiListItemButton`）。
 *
 * ── 刻意**没有**改的东西，以及原因 ────────────────────────────────────────────
 *  · **颜色一律不动**：`tokens` 里每个色值都对应 `tests/visual/contrast-pairs.json` 的一条实测比值
 *    （65 组，`npm run contrast` 门禁），且 `tests/unit/ThemeContrast.test.ts` 会对构建出的
 *    `palette` 真实复算 WCAG 对比度。改任一色值都会同时击穿这两道门禁。
 *  · **不引入 M3 surface tint（表面色调叠加）**：MUI 的 tonal overlay 会改变 Paper 的**实际渲染色**，
 *    而对比度门禁是按纯 `#FFFFFF` / `#1E1E1E` 计算的；叠加后文字的实际对比度会低于门禁保证值。
 *    故 `MuiPaper` 继续 `backgroundImage: 'none'`，M3 的「高度」改由阴影 + 描边表达。
 *  · **`MuiButton.disableElevation` 保持 `true`**：M3 的 **filled button 本来就是无高度的**
 *    （只有 Elevated button 才带 1 级阴影），保留即是对齐 M3；且它正是焦点环不可见的根因，
 *    改动会连带破坏键盘焦点指示（见 `MuiButton` 内注释）。
 *  · **`MuiButton` 不做全圆角（pill）**：M3 filled 按钮是 pill 形，但本应用按钮密集出现在工具栏 /
 *    表格行 / 抽屉底栏，全圆角会削弱密集区的紧凑与对齐感；沿用 `shape.borderRadius`（12）。
 *  · **`MuiSwitch` 尺寸不动**：MUI 默认轨道已是 pill、滑块已是正圆，几何与 M3 一致；把 34×14 放大到
 *    M3 的 52×32 会挤坏设置页与筛选栏的紧凑行高（这两处我无权改组件文件）。
 *  · **`MuiTab` 本体不做圆角**：M3 的 tab 本体就是直角（圆角只体现在顶部 active indicator），
 *    故形状改动落在 `MuiTabs.indicator` 上。
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
  /**
   * 基础圆角，接入 MUI `shape.borderRadius`。
   * 10 → 12：对齐 M3 形状刻度的 **medium(12dp)**（M3 卡片/输入框档位）。
   * 未取 16（M3 large）：全库 30+ 处 `borderRadius: 1`（即 `× shape.borderRadius`）的派生用法，
   * 16 会让紧凑控件（筛选框、抽屉内小面板）过度圆润。
   */
  radius: 12,

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
 * M3 动效令牌（duration 单位 ms；easing 为 `cubic-bezier` 字符串）。
 *
 * 来源：Material Design 3 —— Motion / Easing & duration tokens。
 * 说明：M3 规范里 `standard` 与 `emphasized` 的**已发布取值相同**（都是 `0.2, 0, 0, 1`），
 * 两者区别在使用语境（emphasized 用于需要更多表现力的转场）与配套时长，不是数值差异，故此处同值。
 */
export const motion = {
  duration: {
    short1: 50,
    short2: 100,
    short3: 150,
    short4: 200,
    medium1: 250,
    medium2: 300,
    medium3: 350,
    medium4: 400,
    long1: 450,
    long2: 500,
    long3: 550,
    long4: 600,
    extraLong1: 700,
    extraLong2: 800,
    extraLong3: 900,
    extraLong4: 1000,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    standardDecelerate: 'cubic-bezier(0, 0, 0, 1)',
    standardAccelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    emphasizedAccelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
    linear: 'cubic-bezier(0, 0, 1, 1)',
  },
} as const

/**
 * M3 tonal elevation：**level-1 阴影减淡**。
 *
 * MUI 默认 `shadows[1]` 是 M2 的厚重三层投影（alpha 0.2 / 0.14 / 0.12）；
 * M3 主张高度由表面色调 + 极淡阴影表达，故换成单层极淡值。
 * 仅改 level-1（默认 Paper/Card）；level ≥ 2 保持 MUI 原值，避免 Menu/Dialog/AppBar 的浮层分离度下降。
 *
 * 基准数组取自 `createTheme()` 的默认 25 级阴影（数组会被 `deepmerge` 整体替换，故需先取全量）。
 */
const DEFAULT_SHADOWS = createTheme().shadows
const M3_SHADOWS = [
  DEFAULT_SHADOWS[0],
  '0 1px 2px 0 rgba(0, 0, 0, 0.06), 0 1px 3px 1px rgba(0, 0, 0, 0.04)',
  ...DEFAULT_SHADOWS.slice(2),
] as typeof DEFAULT_SHADOWS

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

/** M3 chip 圆角：M3 把 chip 从 M2 的 pill（16dp）改为 8dp。 */
const CHIP_RADIUS = 8

/** M3 active indicator：3dp 高、顶部圆角（M2/MUI 默认是 2px 直角）。 */
const TAB_INDICATOR_RADIUS = 3

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
    /**
     * M3 tonal elevation：只减淡 level-1 阴影（默认 Paper/Card 的高度）。
     * 这是「M3 高度靠极淡阴影表达」的落地点，且**不改颜色**，不影响对比度门禁。
     */
    shadows: M3_SHADOWS,
    shape: {
      borderRadius: tokens.radius,
    },
    /**
     * M3 动效：完整档位（short/medium/long/extra-long + standard/emphasized）供后续接入复用。
     *
     * 同时把 MUI 的**旧档位键重映射**到 M3 刻度——因为 MUI 组件内部（`transitions.create()`、
     * Button/Paper/Drawer 等的过渡）读的是 `shortest/shorter/short/standard/complex/
     * enteringScreen/leavingScreen` 与 `easeInOut/easeOut/easeIn/sharp`，不重映射的话
     * 组件实际仍在跑 M2 的 150–375ms，M3 档位就只是「声明了但没人用」。
     */
    transitions: {
      duration: {
        ...motion.duration,
        // MUI 旧键 → M3 刻度（原 M2 值：150 / 200 / 250 / 300 / 375 / 225 / 195）
        shortest: motion.duration.short2, // 100
        shorter: motion.duration.short3, // 150
        short: motion.duration.short4, // 200
        standard: motion.duration.medium2, // 300
        complex: motion.duration.medium4, // 400
        enteringScreen: motion.duration.medium1, // 250
        leavingScreen: motion.duration.short4, // 200
      },
      easing: {
        ...motion.easing,
        // MUI 旧键 → M3 缓动族
        easeInOut: motion.easing.standard,
        easeOut: motion.easing.standardDecelerate,
        easeIn: motion.easing.standardAccelerate,
        sharp: motion.easing.emphasizedAccelerate,
      },
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
        /**
         * **保留** `disableElevation: true`（对齐 M3 的 filled button：M3 只有 Elevated button 才有
         * 1 级阴影，filled button 本体就是无高度的）。改动此值会连带破坏下面的焦点环，见其注释。
         */
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
           *
           * ⚠️ 本规则是 M3 升级的**硬约束**：任何对 `disableElevation` / 阴影的改动都必须保留它。
           */
          root: ({ theme }) => ({
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }),
        },
      },
      /**
       * M3 不引入 surface tint（表面色调叠加）：它会改变 Paper 的**实际渲染色**，
       * 而对比度门禁是按纯 `#FFFFFF` / `#1E1E1E` 计算的，叠加后实际文字对比度会低于门禁保证值。
       * 故保持 `backgroundImage: 'none'`（同时去掉 MUI 深色模式的默认 overlay），
       * M3 的「高度」改由上面减淡的 level-1 阴影 + 下面卡片的 1px 描边表达。
       */
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      /**
       * M3 tonal elevation 的「可辨识边界」落点。
       *
       * M3 的 **outlined card** 本就是「1px 描边、无高度」，本应用主流卡片（`QuestionCard` 等）
       * 正是 `variant="outlined"`，已符合 M3，故**不动**；只给默认（elevation）卡片补 1px 描边，
       * 让它在减淡阴影后仍与页面底色 `#F5F6F8` 有明确分界。
       * 描边用 `palette.divider`，浅色/深色模式各自取到合适的半透明灰（深色下是白 12%），
       * 且全局 `box-sizing: border-box`（CssBaseline）下不改变盒模型尺寸。
       */
      MuiCard: {
        styleOverrides: {
          root: ({ ownerState, theme }: { ownerState: { variant?: string }; theme: { palette: { divider: string } } }) =>
            ownerState.variant === 'outlined' ? {} : { border: `1px solid ${theme.palette.divider}` },
        },
      },
      /**
       * M3 **状态层（state layer）**：用「内容色」按 8%（hover）/ 12%（focus / pressed）叠加，
       * 取代 M2 的 `action.hover`（仅 4%）。用 `text.primary` 而非主色：M3 的导航/列表项状态层
       * 取 on-surface 色，只有「选中」态才用主色（MUI 默认的 `selected` 已是主色 8%，这里对齐到 12%）。
       */
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.08),
              // 与 MUI 一致：触屏设备不保留 hover 底色，避免点按后「粘住」
              '@media (hover: none)': { backgroundColor: 'transparent' },
            },
            '&.Mui-focusVisible': { backgroundColor: alpha(theme.palette.text.primary, 0.12) },
            '&.Mui-selected': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
            '&.Mui-selected:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.16) },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          /**
           * M3 chip 圆角：M3 把 chip 从 M2 的 pill（16dp）收敛为 **8dp**（`CHIP_RADIUS`）。
           * 大/小两种尺寸都生效（`size="small"` 高度 24，8dp 同样成立）。
           *
           * 同时，这里是「填充 vs 文字」分离的落地点：
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
            const base = { borderRadius: CHIP_RADIUS }
            if (ownerState.variant !== 'filled') return base
            const fill: Partial<Record<string, string>> = {
              success: tokens.success,
              warning: tokens.warning,
              error: tokens.error,
            }
            const bg = ownerState.color ? fill[ownerState.color] : undefined
            return bg ? { ...base, backgroundColor: bg, color: ON_VIVID_FILL } : base
          },
        },
      },
      /**
       * M3 tab 的圆角体现在 **active indicator**（tab 本体是直角，故不改 `MuiTab`）：
       * 高度 2 → 3、顶部加圆角，与 M3 的「indicator 为圆角短条」一致。
       */
      MuiTabs: {
        styleOverrides: {
          indicator: { height: TAB_INDICATOR_RADIUS, borderTopLeftRadius: TAB_INDICATOR_RADIUS, borderTopRightRadius: TAB_INDICATOR_RADIUS },
        },
      },
    },
  })
}

export const theme = buildTheme()

export default theme
