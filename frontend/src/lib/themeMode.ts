/**
 * 主题模式三态（设计规范 §4.5 第 7 条：客户端**必须跟随系统深色**）。
 *
 * 为什么要有这一层
 * ---------------
 * 客户端外壳没有浏览器地址栏作参照，深色不一致会更刺眼——因此「跟随系统」是**默认**；
 * 但用户**显式选择过**浅色 / 深色时，就以用户为准。
 *
 * 存储位置与兼容性判断（**关键取舍**）
 * ---------------------------------
 * - 三态存 **`localStorage`**（键 `qb_theme_mode`），**不写后端**：
 *   后端 `settings.json` 的 `theme.dark` 是**布尔**，塞不下第三态；本模块也不改后端契约。
 * - **旧安装兼容**：后端 `settings.json` 的 `dark` 由 `webui/config.py` 的
 *   `DEFAULT_SETTINGS` 提供且 `load_settings()` 会合并默认值，**任何安装读到的都是 `false`**
 *   （历史默认），无法据此区分「旧装选过浅色」与「从未选过」。因此迁移规则为：
 *     · `dark === true` → `'dark'`（用户曾**显式**选过深色，保留）；
 *     · `dark === false` / 缺失 → `'system'`（视为未选过，按规范默认跟随系统）。
 *   代价：极少数「旧装 + 系统为深色」的用户升级后会跟随系统变深色。
 *   要在**任何**系统下都严格保持旧的浅色，必须由后端提供三态字段——本轮明确不做
 *   （不新建后端字段、不动 `bank.db`）。此处优先保证「默认跟随系统」这一规范核心。
 */

/** 主题三态。 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 三态偏好的 localStorage 键。 */
export const THEME_MODE_STORAGE_KEY = 'qb_theme_mode'

/** 系统深色媒体查询串。 */
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/** 默认模式（规范：默认跟随系统）。 */
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

/** 是否为合法三态取值。 */
export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark'
}

/** 读取已存的三态偏好；无值 / 存储不可用时返回 `null`（**不**在此处做迁移）。 */
export function readStoredThemeMode(): ThemeMode | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_MODE_STORAGE_KEY) : null
    return isThemeMode(raw) ? raw : null
  } catch {
    return null
  }
}

/** 写入三态偏好（存储不可用时静默：仅当次会话生效）。 */
export function writeStoredThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode)
  } catch {
    /* 隐私模式 / 存储禁用：忽略 */
  }
}

/**
 * 由「已存三态」+「后端旧布尔」解析出最终模式（**纯函数**，便于单测）。
 *
 * @param stored 已存三态（非法 / 缺失传 `null`）。
 * @param legacyDark 后端 `theme.dark`（旧布尔值；缺失传 `undefined`）。
 */
export function resolveThemeMode(stored: unknown, legacyDark: boolean | undefined): ThemeMode {
  if (isThemeMode(stored)) return stored
  // 只有「显式选过深色」才是可保留的旧选择；false 是历史默认值，按「未选过」处理 → 跟随系统。
  return legacyDark === true ? 'dark' : DEFAULT_THEME_MODE
}

/** 当前模式是否应渲染为深色（`system` 时看系统偏好）。 */
export function effectiveDark(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemDark
}

/** 读取一次系统深色偏好（SSR / 无 `matchMedia` 环境返回 `false`）。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches
  } catch {
    return false
  }
}
