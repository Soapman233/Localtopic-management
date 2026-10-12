/**
 * 局域网访问（方案 A）：从链接接收访问令牌。
 *
 * 场景：老师开启「局域网访问」后，用手机**扫二维码**打开链接
 *
 *     http://192.168.0.103:8720/?t=<访问令牌>
 *
 * 本模块在应用启动**最早期**把 `?t=` 收进 localStorage，并**从地址栏抹掉**——
 * 抹掉是为了不让令牌留在浏览历史/分享出去的地址里。
 *
 * ⚠️ 必须在任何 API 调用之前执行：`AuthProvider` 初始化时会读取令牌，
 *    晚一步就会出现「扫了码仍提示未授权」。故在 `main.tsx` 渲染前调用。
 */
import { setAuthToken } from '../api/client'
import { storeToken } from './authStorage'

/** 链接中承载令牌的查询参数名。 */
export const LAN_TOKEN_QUERY = 't'

export interface LanTokenResult {
  /** 是否从链接中取到了令牌。 */
  applied: boolean
  /** 是否成功把参数从地址栏抹掉。 */
  cleaned: boolean
}

/**
 * 从当前地址读取 `?t=`，写入存储并抹掉地址栏参数。
 *
 * @param search 地址查询串（默认取当前 location，便于测试注入）
 * @param href   完整地址（默认取当前 location，便于测试注入）
 */
export function bootstrapLanToken(
  search: string = window.location.search,
  href: string = window.location.href,
): LanTokenResult {
  let token: string | null = null
  try {
    token = new URLSearchParams(search).get(LAN_TOKEN_QUERY)
  } catch {
    return { applied: false, cleaned: false }
  }
  if (!token) return { applied: false, cleaned: false }

  // ① 先落到存储与 API 客户端（后续所有请求自动携带）
  storeToken(token)
  setAuthToken(token)

  // ② 再从地址栏抹掉，避免令牌留在历史记录 / 被转发出去
  let cleaned = false
  try {
    const url = new URL(href)
    url.searchParams.delete(LAN_TOKEN_QUERY)
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash
    window.history.replaceState(null, '', next)
    cleaned = true
  } catch {
    /* 抹不掉也不影响功能 */
  }
  return { applied: true, cleaned }
}
