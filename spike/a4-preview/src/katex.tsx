/**
 * KaTeX 公式渲染（**镜像** `frontend/src/components/KatexFormula.tsx` 的 `FormulaText`）。
 *
 * 探针复刻该组件是为了让「公式渲染时机 / 高度」的验证与生产一致：
 * - `katex.renderToString` 是**同步**的（返回 HTML 字符串），插入 DOM 后同帧即定高；
 * - 唯一异步因素是 **KaTeX 自带字体**的加载（未加载完会有 FOUT → 度量变化），
 *   故测量前需 `await document.fonts.ready`（见 usePagination）。
 */
import { useMemo, type ReactNode } from 'react'
import katex from 'katex'
import type { Formula } from './types'

/** 题干占位符正则（与 `bank.textutil.PLACEHOLDER_RE` 对齐）。 */
export const PLACEHOLDER_RE = /⟦(F\d+)⟧/g

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface KatexFormulaProps {
  latex: string | null | undefined
  displayMode?: boolean
  className?: string
}

/** 渲染单条公式；失败时降级为红色源码。 */
export function KatexFormula({ latex, displayMode = false, className }: KatexFormulaProps) {
  const { html, error } = useMemo(() => {
    const src = latex ?? ''
    try {
      return {
        html: katex.renderToString(src, {
          throwOnError: true,
          displayMode,
          strict: false,
          output: 'html',
        }),
        error: null as string | null,
      }
    } catch (err) {
      return {
        html: `<span class="qb-katex-fallback">${escapeHtml(src || '（空公式）')}</span>`,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [latex, displayMode])

  return (
    <span
      className={className}
      data-katex-error={error ?? undefined}
      title={error ? `公式渲染失败：${error}` : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export interface FormulaTextProps {
  text: string | null | undefined
  formulas?: Formula[] | null
  displayMode?: boolean
  className?: string
}

/** 渲染「文本 + 就地公式」：把 `⟦Fn⟧` 替换为对应 fid 的 KaTeX 公式。 */
export function FormulaText({ text, formulas, displayMode = false, className }: FormulaTextProps) {
  const nodes = useMemo<ReactNode[]>(() => {
    const src = text ?? ''
    const map = new Map<string, string>()
    for (const f of formulas ?? []) map.set(f.fid, f.latex ?? '')
    const out: ReactNode[] = []
    let last = 0
    let key = 0
    PLACEHOLDER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PLACEHOLDER_RE.exec(src)) !== null) {
      if (m.index > last) out.push(<span key={`t${key++}`}>{src.slice(last, m.index)}</span>)
      const fid = m[1]
      if (map.has(fid)) {
        out.push(
          <KatexFormula
            key={`f${key++}`}
            latex={map.get(fid)}
            displayMode={displayMode}
            className="katex-inline"
          />,
        )
      } else {
        out.push(
          <span key={`m${key++}`} className="qb-placeholder-missing" title={`占位符 ⟦${fid}⟧ 无对应公式`}>
            ⟦{fid}⟧
          </span>,
        )
      }
      last = m.index + m[0].length
    }
    if (last < src.length) out.push(<span key={`t${key++}`}>{src.slice(last)}</span>)
    return out
  }, [text, formulas, displayMode])

  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {nodes}
    </span>
  )
}

export default KatexFormula
