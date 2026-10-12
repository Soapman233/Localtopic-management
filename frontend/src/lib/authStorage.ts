/**
 * 访问令牌的本地存储（**单一来源**）。
 *
 * 为什么单独抽出来：令牌有两个来源——① 用户登录（`AuthProvider`）；
 * ② **局域网扫码链接里的 `?t=`**（见 `lib/lanToken.ts`）。
 * 两处若各写一遍存储键，一旦漂移就会出现「扫了码但还是未登录」这类难查问题。
 */

/** localStorage 中存放访问令牌的键。 */
export const TOKEN_KEY = 'qb-auth-token'

/** 读取已保存的令牌（无则 null）。 */
export function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // 隐私模式 / 禁用存储：降级为「无令牌」，不影响页面渲染
    return null
  }
}

/** 写入或清除令牌。 */
export function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略存储异常 */
  }
}
