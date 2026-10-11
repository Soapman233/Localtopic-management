/**
 * `api/client` 的 401 去重测试（P0-1 请求风暴修复的**第二道保险**）。
 *
 * 风暴闭环：401 → `onUnauthorized` → 清会话 → 重取 `/api/auth/me` → 401 → …
 * 这里守住的点：**仅当本次请求确实带着令牌**却仍被拒时才回调一次；
 * 令牌已清（登出后 / 上一次失效已处理）再收到的 401 **不再回调**，
 * 从而不会触发下一轮清会话/重取。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, setAuthToken, setUnauthorizedHandler } from '../../src/api/client'

/** 构造一个 401 的信封响应（`client` 会读 status 与 text）。 */
function resp401(): Response {
  return {
    status: 401,
    ok: false,
    text: async () =>
      JSON.stringify({ code: 40102, data: null, message: '未授权：会话缺失或已过期，请重新登录' }),
  } as unknown as Response
}

describe('api/client · 401 去重', () => {
  beforeEach(() => {
    setAuthToken(null)
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setAuthToken(null)
    setUnauthorizedHandler(null)
  })

  it('带着令牌收到 401 → 只回调一次；令牌清空后再收到 401 不再回调', async () => {
    // 回调模拟 AuthProvider：清掉令牌（这会同步反映到 client 的 authToken）。
    const handler = vi.fn(() => setAuthToken(null))
    setUnauthorizedHandler(handler)
    setAuthToken('tok-123')
    vi.stubGlobal('fetch', vi.fn(async () => resp401()))

    await api.get('/api/whatever').catch(() => {})
    expect(handler).toHaveBeenCalledTimes(1)

    // 第二次（令牌已清）不得再回调——否则就是风暴的燃料。
    await api.get('/api/whatever').catch(() => {})
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('无令牌收到 401 → 完全不回调（未登录态不触发清会话）', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    setAuthToken(null)
    vi.stubGlobal('fetch', vi.fn(async () => resp401()))

    await api.get('/api/whatever').catch(() => {})
    expect(handler).not.toHaveBeenCalled()
  })
})
