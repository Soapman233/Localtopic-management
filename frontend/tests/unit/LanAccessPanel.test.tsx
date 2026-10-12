/**
 * `LanAccessPanel`（局域网访问 / 方案 A）组件测试。
 *
 * 覆盖三条关键行为：
 * 1. **风险提示必须存在**——开启即对同网络开放，界面不能静默；
 * 2. 开关切换会调用后端（enable / disable）；
 * 3. 开启后「查看手机访问方式」才去拉**含令牌**的链接与二维码
 *    （常规状态查询不带令牌，避免令牌出现在轮询里）。
 *
 * mock 方案与既有页面测试一致：在 `fetch` 边界返回 `{code,data,message}` 信封。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import LanAccessPanel from '../../src/components/LanAccessPanel'
import { renderPage, jsonResponse } from './pages/pageTestUtils'

// 组件在成功/失败后会弹提示；测试里屏蔽掉，避免依赖 Snackbar 容器。
vi.mock('../../src/lib/feedback', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), errorFrom: vi.fn() },
}))

const OFF = {
  lan_enabled: false, lan_ip: '192.168.0.103', port: 8720, host: '127.0.0.1',
  exposure: 'local', token_set: false, token_masked: null, auth_enabled: false,
  restart_required: false,
  https: true, scheme: 'https', tls_available: true, cert_fingerprint: null,
}
const ON = {
  ...OFF, lan_enabled: true, exposure: 'lan', token_set: true,
  token_masked: 'abcd…wxyz', auth_enabled: true, restart_required: false,
  cert_fingerprint: 'D5B500671F6E1498',
}
const LINK = {
  ...ON, lan_url: 'https://192.168.0.103:8720/?t=tok-abc',
  qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>',
}

/** 记录请求过的 URL，便于断言「何时拉了含令牌的链接」。 */
let requested: string[] = []

function stubFetch(status: unknown, link: unknown = LINK) {
  requested = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input)
    requested.push(u)
    if (u.includes('/api/network/link')) return jsonResponse(link)
    if (u.includes('/api/network/https')) return jsonResponse({ https: true, restart_required: true, message: '已更新加密设置' })
    if (u.includes('/api/network/enable')) return jsonResponse({ lan_enabled: true, token_set: true, restart_required: true, message: '已开启' })
    if (u.includes('/api/network/disable')) return jsonResponse({ lan_enabled: false, restart_required: true, message: '已关闭' })
    if (u.includes('/api/network/rotate')) return jsonResponse({ lan_enabled: true, token_set: true, restart_required: true, message: '已更换' })
    if (u.includes('/api/network/status')) return jsonResponse(status)
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('LanAccessPanel', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('关闭态：说明仅本机可用，且**必须**显示风险提示', async () => {
    stubFetch(OFF)
    renderPage(<LanAccessPanel />)
    expect(await screen.findByText(/当前仅本机可用/)).toBeTruthy()
    // 🔴 风险提示是硬要求：开启即对同网络开放
    expect(screen.getByText(/同一网络下的任何设备/)).toBeTruthy()
  })

  it('关闭态：不请求含令牌的链接接口', async () => {
    stubFetch(OFF)
    renderPage(<LanAccessPanel />)
    await screen.findByText(/当前仅本机可用/)
    expect(requested.some((u) => u.includes('/api/network/link'))).toBe(false)
  })

  it('切换开关 → 调用开启接口', async () => {
    stubFetch(OFF)
    renderPage(<LanAccessPanel />)
    const sw = await screen.findByRole('checkbox')
    fireEvent.click(sw)
    await waitFor(() =>
      expect(requested.some((u) => u.includes('/api/network/enable'))).toBe(true),
    )
  })

  it('开启态：显示已开启说明，且切换会调用关闭接口', async () => {
    stubFetch(ON)
    renderPage(<LanAccessPanel />)
    expect(await screen.findByText(/已开启/)).toBeTruthy()
    // ⚠️ 开启态下页面有**两个**开关（局域网 + 加密），必须按标签精确定位
    fireEvent.click(screen.getByLabelText('手机 / 其他设备访问'))
    await waitFor(() =>
      expect(requested.some((u) => u.includes('/api/network/disable'))).toBe(true),
    )
  })

  it('开启态：点「查看手机访问方式」才拉链接与二维码并展示', async () => {
    stubFetch(ON)
    renderPage(<LanAccessPanel />)
    const btn = await screen.findByRole('button', { name: /查看手机访问方式/ })
    expect(requested.some((u) => u.includes('/api/network/link'))).toBe(false)

    fireEvent.click(btn)
    // 链接以文本形式展示，且二维码 SVG 被内联
    expect(await screen.findByText('https://192.168.0.103:8720/?t=tok-abc')).toBeTruthy()
    expect(screen.getByLabelText('手机访问二维码').querySelector('svg')).toBeTruthy()
  })

  it('配置与实际监听不一致时提示需重启', async () => {
    stubFetch({ ...ON, restart_required: true })
    renderPage(<LanAccessPanel />)
    expect(await screen.findByText(/重启题库/)).toBeTruthy()
  })

  // ---- 加密（HTTPS）------------------------------------------------------ //
  it('开启态 + 已加密：解释证书警告（否则老师会被"不安全"提示吓退）', async () => {
    stubFetch(ON)
    renderPage(<LanAccessPanel />)
    expect(await screen.findByText(/加密传输（HTTPS）/)).toBeTruthy()
    expect(screen.getByText(/点「继续访问」即可/)).toBeTruthy()
    expect(screen.getByText(/D5B500671F6E1498/)).toBeTruthy()
  })

  it('🔴 关闭加密：必须给出明确风险提示', async () => {
    stubFetch({ ...ON, https: false, scheme: 'http', cert_fingerprint: null })
    renderPage(<LanAccessPanel />)
    expect(await screen.findByText(/已关闭加密/)).toBeTruthy()
    expect(screen.getByText(/截获/)).toBeTruthy()
  })

  it('切换加密开关 → 调用 /api/network/https', async () => {
    stubFetch(ON)
    renderPage(<LanAccessPanel />)
    const httpsSwitch = await screen.findByLabelText('加密传输（HTTPS）')
    fireEvent.click(httpsSwitch)
    await waitFor(() =>
      expect(requested.some((u) => u.includes('/api/network/https'))).toBe(true),
    )
  })

  it('缺少证书能力时禁用开关并说明原因', async () => {
    stubFetch({ ...ON, tls_available: false, cert_fingerprint: null })
    renderPage(<LanAccessPanel />)
    const sw = await screen.findByLabelText('加密传输（HTTPS）')
    expect((sw as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/缺少证书生成组件/)).toBeTruthy()
  })
})
