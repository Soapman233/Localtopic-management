/** 系统设置域 API（架构设计 §3.4 #46–#47，PRD P1-9）。
 *
 * 读写 ``outputs/webui/settings.json``（DB 路径 / 导出目录 / 默认模板 / KaTeX / 主题）。
 */
import { api } from './client'
import type { SettingsData } from './types'

/** ``GET /api/settings``：读取系统设置。 */
export function getSettings(): Promise<SettingsData> {
  return api.get<SettingsData>('/api/settings')
}

/** ``PUT /api/settings``：更新部分设置字段，返回更新后的完整设置。 */
export function updateSettings(patch: Partial<SettingsData>): Promise<SettingsData> {
  return api.put<SettingsData>('/api/settings', patch)
}
