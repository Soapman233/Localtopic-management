/**
 * 导出「环境失败判定 / 预览页归一化」的**纯函数**（R1/R3）。
 *
 * 从 `useExportGate.ts` 抽出为独立模块，便于**无 React 依赖**地单元测试
 * （门禁安全关键路径，必须有独立测试）。
 */
import type { PreviewPage } from '../api/types'

/** 环境失败类型：editor_sdk 不可用 / 无 Word·WPS / 其他（非环境原因）。 */
export type EnvFailure = 'editor_sdk' | 'office' | null

/** 依据后端错误文案判定「环境原因」失败（用于触发降级门禁）。
 *
 * ★ 唯一实现：抽屉与导出页共用。**必须同时识别 `editor_sdk` 与 `Word`/`WPS`**，
 *   漏掉任一种都会导致对应环境下的导出被永久锁死（正是 P0-4 的根因）。
 */
export function detectEnvFailure(err: unknown): EnvFailure {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('editor_sdk')) return 'editor_sdk'
  if (msg.includes('Word') || msg.includes('WPS')) return 'office'
  return null
}

/** 环境失败的人类可读原因。 */
export function envReason(t: EnvFailure): string {
  if (t === 'editor_sdk') return '未检测到 editor_sdk 服务（公式渲染 / DOCX 生成不可用）'
  if (t === 'office') return '未检测到 Microsoft Word / WPS（无法生成 PDF 预览）'
  return '环境依赖缺失'
}

/** 从预览响应/作业结果中归一化出页面列表（抽屉与导出页共用同一实现）。 */
export function extractPages(src: unknown): { pages: PreviewPage[]; key?: string } {
  if (!src || typeof src !== 'object') return { pages: [] }
  const o = src as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key : undefined
  const raw = o.pages
  if (!Array.isArray(raw)) return { pages: [], key }
  const pages: PreviewPage[] = []
  raw.forEach((p, i) => {
    if (typeof p === 'string') {
      pages.push({ n: i + 1, url: p })
      return
    }
    if (p && typeof p === 'object') {
      const po = p as { n?: number; page?: number; url?: string }
      const n = po.n ?? po.page ?? i + 1
      const url = po.url ?? (key ? `/api/preview/${key}/page_${n}.png` : '')
      if (url) pages.push({ n, url })
    }
  })
  return { pages, key }
}
