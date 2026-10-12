/**
 * 局域网扫码令牌引导（`lib/lanToken.ts`）单元测试。
 *
 * 覆盖：从 `?t=` 取令牌 → 写入存储 + 同步 api 客户端 → 抹掉地址栏参数；
 * 以及**无参数时必须是空操作**（本地版每次启动都会走这里，不能有副作用）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapLanToken, LAN_TOKEN_QUERY } from '../../src/lib/lanToken'
import { readStoredToken } from '../../src/lib/authStorage'
import { getAuthToken } from '../../src/api/client'

const BASE = 'http://192.168.0.103:8720/'

describe('bootstrapLanToken', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 取最近一次 replaceState 的 URL 参数。
   * ⚠️ `history.replaceState(data, unused, url)` 有**三个**参数，URL 在**第三个**——
   * 取第二个会拿到空字符串（本测试第一版就踩了这个坑）。 */
  function lastReplacedUrl(): string {
    const calls = (window.history.replaceState as unknown as ReturnType<typeof vi.fn>).mock.calls
    return String(calls[calls.length - 1]?.[2] ?? '')
  }

  it('无 ?t= 时为空操作（不得改动存储与地址栏）', () => {
    const res = bootstrapLanToken('', BASE)
    expect(res.applied).toBe(false)
    expect(res.cleaned).toBe(false)
    expect(readStoredToken()).toBeNull()
    expect(window.history.replaceState).not.toHaveBeenCalled()
  })

  it('空值 ?t= 同样视为未提供', () => {
    const res = bootstrapLanToken(`?${LAN_TOKEN_QUERY}=`, BASE)
    expect(res.applied).toBe(false)
    expect(readStoredToken()).toBeNull()
  })

  it('有令牌：写入存储、同步 api 客户端，并抹掉地址栏参数', () => {
    const res = bootstrapLanToken(`?${LAN_TOKEN_QUERY}=tok-abc-123`, `${BASE}?${LAN_TOKEN_QUERY}=tok-abc-123`)
    expect(res.applied).toBe(true)
    expect(res.cleaned).toBe(true)
    // ① 持久化（刷新后仍登录）
    expect(readStoredToken()).toBe('tok-abc-123')
    // ② 同步到 api 客户端（本次会话的请求立即带上）
    expect(getAuthToken()).toBe('tok-abc-123')
    // ③ 地址栏参数被抹掉（不留令牌在历史里）
    expect(lastReplacedUrl()).not.toContain(LAN_TOKEN_QUERY)
    expect(lastReplacedUrl()).not.toContain('tok-abc-123')
  })

  it('保留其它查询参数（只删令牌）', () => {
    bootstrapLanToken(`?${LAN_TOKEN_QUERY}=tok&foo=bar`, `${BASE}?${LAN_TOKEN_QUERY}=tok&foo=bar`)
    expect(lastReplacedUrl()).toContain('foo=bar')
    expect(lastReplacedUrl()).not.toContain('tok')
  })

  it('保留 hash 路由片段', () => {
    bootstrapLanToken(`?${LAN_TOKEN_QUERY}=tok`, `${BASE}?${LAN_TOKEN_QUERY}=tok#/settings`)
    expect(lastReplacedUrl()).toContain('#/settings')
  })

  it('地址栏抹除失败也不影响令牌生效', () => {
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('blocked')
    })
    const res = bootstrapLanToken(`?${LAN_TOKEN_QUERY}=tok-xyz`, `${BASE}?${LAN_TOKEN_QUERY}=tok-xyz`)
    expect(res.applied).toBe(true)
    expect(res.cleaned).toBe(false)
    expect(readStoredToken()).toBe('tok-xyz')
  })
})
