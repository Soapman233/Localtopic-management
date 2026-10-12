/** 局域网访问（方案 A）域 API。
 *
 * 让老师在「设置」里一键开启手机访问：开启后监听全网卡，
 * 手机连同一 WiFi 即可通过链接 / 二维码使用。
 *
 * ⚠️ 令牌只由 ``/api/network/link`` 返回——**仅用户主动索取时调用**，
 * 常规轮询走 ``/api/network/status``（不含令牌）。
 */
import { api } from './client'

/** ``GET /api/network/status``：网络状态（**不含令牌明文**）。 */
export interface NetworkStatus {
  lan_enabled: boolean
  lan_ip: string | null
  port: number
  host: string
  /** ``local``（仅本机）/ ``lan``（局域网）/ ``public``（线上版）。 */
  exposure: 'local' | 'lan' | 'public'
  token_set: boolean
  /** 掩码后的令牌（如 ``abcd…wxyz``），用于界面显示。 */
  token_masked: string | null
  auth_enabled: boolean
  /** 配置与**当前实际监听**是否不一致——不一致说明需重启生效。 */
  restart_required: boolean
  /** 局域网是否走 HTTPS（自签证书）。**默认 true**。 */
  https: boolean
  /** 实际协议。 */
  scheme: 'http' | 'https'
  /** 是否具备证书生成能力（缺 cryptography 时为 false，会退回明文 HTTP）。 */
  tls_available: boolean
  /** 自签证书指纹（SHA-256 前 16 位），供人工核对；无证书为 null。 */
  cert_fingerprint: string | null
}

/** ``GET /api/network/link``：含令牌的手机链接与二维码。 */
export interface NetworkLink extends NetworkStatus {
  /** 形如 ``http://192.168.0.103:8720/?t=<token>``；无局域网地址时为 null。 */
  lan_url: string | null
  /** 内联 SVG 二维码；生成失败为 null。 */
  qr_svg: string | null
}

/** 开关 / 换令牌的统一响应。 */
export interface NetworkActionResult {
  lan_enabled: boolean
  token_set?: boolean
  restart_required: boolean
  message: string
}

/** ``GET /api/network/status``。 */
export function getNetworkStatus(): Promise<NetworkStatus> {
  return api.get<NetworkStatus>('/api/network/status')
}

/** ``GET /api/network/link``（含令牌与二维码）。 */
export function getNetworkLink(): Promise<NetworkLink> {
  return api.get<NetworkLink>('/api/network/link')
}

/** ``POST /api/network/enable``：开启局域网访问（无令牌则自动生成）。 */
export function enableLan(): Promise<NetworkActionResult> {
  return api.post<NetworkActionResult>('/api/network/enable')
}

/** ``POST /api/network/disable``：关闭局域网访问（令牌保留）。 */
export function disableLan(): Promise<NetworkActionResult> {
  return api.post<NetworkActionResult>('/api/network/disable')
}

/** ``POST /api/network/rotate``：更换令牌，旧链接立即失效。 */
export function rotateLanToken(): Promise<NetworkActionResult> {
  return api.post<NetworkActionResult>('/api/network/rotate')
}

/** ``POST /api/network/https`` 的响应。 */
export interface HttpsToggleResult {
  https: boolean
  restart_required: boolean
  message: string
}

/** ``POST /api/network/https``：开关「局域网使用 HTTPS（自签证书）」。 */
export function setLanHttps(enabled: boolean): Promise<HttpsToggleResult> {
  return api.post<HttpsToggleResult>('/api/network/https', { enabled })
}
