/** KaTeX 公式渲染组件（架构设计 §1.4 / PRD 3.4）。
 *
 * 为什么自写而不引入 `react-katex`：该库已停止维护，且本项目需要「按 fid 精确映射」
 * 与「渲染失败降级为红色源码」两个定制行为。
 *
 * 关键点：
 * - 展示态：题干中的 `⟦Fn⟧` 占位符**按 fid 精确映射**（不是按出现顺序）到 `formulas[fid].latex`；
 * - 失败降级：`throwOnError:true` 探针失败时，渲染为红色源码（**不静默吞掉**）；
 * - `validateLatex`：供公式编辑浮层在保存前校验（失败则阻止保存）。
 */
import { useMemo, type ReactNode } from 'react'
import katex from 'katex'
import { Box } from '@mui/material'
import type { Formula } from '../api/types'
import { formulaDisplay } from './formulaDisplay'
import { useSettingsStore } from '../store/settingsStore'

/** 题干占位符正则（与 `bank.textutil.PLACEHOLDER_RE` 对齐：`⟦Fn⟧`）。 */
export const PLACEHOLDER_RE = /⟦(F\d+)⟧/g

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface LatexValidation {
  ok: boolean
  error?: string
}

/** 校验 LaTeX 是否可被 KaTeX 渲染（编辑保存前调用）。 */
export function validateLatex(latex: string): LatexValidation {
  if (!latex || !latex.trim()) {
    return { ok: false, error: 'LaTeX 源码不能为空' }
  }
  try {
    const display = formulaDisplay(latex)
    if (display.unknown.length) return { ok: false, error: `含未识别字形 ${display.unknown.join('、')}，请对照原图修正` }
    katex.renderToString(display.latex, { throwOnError: true, displayMode: false, strict: false })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface KatexFormulaProps {
  latex: string | null | undefined
  displayMode?: boolean
  className?: string
}

/** 渲染单条公式；失败时降级为红色源码（含 tooltip 错误信息）。
 *
 * P0-2：`throwOnError` / `strict` 从**设置**读取（`useSettingsStore`），
 * 让设置页的「渲染失败抛错 / 严格模式」开关真正生效（此前硬编码、开关是假成功）。
 * 未加载设置时取默认值 `throwOnError:true, strict:false`，与历史行为一致。
 */
export function KatexFormula({ latex, displayMode = false, className }: KatexFormulaProps) {
  const throwOnError = useSettingsStore((s) => s.katex.throwOnError)
  const strict = useSettingsStore((s) => s.katex.strict)
  const { html, error } = useMemo(() => {
    const src = latex ?? ''
    try {
      const display = formulaDisplay(src)
      if (display.unknown.length) throw new Error(`含未识别字形 ${display.unknown.join('、')}，请对照原图核对`)
      return {
        html: katex.renderToString(display.latex, {
          throwOnError,
          displayMode,
          strict,
          output: 'html',
        }),
        error: null as string | null,
      }
    } catch (err) {
      return {
        html: `<span class="qb-katex-fallback">${escapeHtml(src.replace(/[\uE000-\uF8FF]/g, c => `[未知字形 U+${c.charCodeAt(0).toString(16).toUpperCase()}]`) || '（空公式）')}</span>`,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [latex, displayMode, throwOnError, strict])

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
  /** 含 `⟦Fn⟧` 占位符的题干文本。 */
  text: string | null | undefined
  /** 该题的公式列表（按 fid 精确映射）。 */
  formulas?: Formula[] | null
  displayMode?: boolean
  className?: string
}

/** 渲染「文本 + 就地公式」：把 `⟦Fn⟧` 替换为对应 fid 的 KaTeX 公式。
 *
 * - 命中 fid → 渲染公式；
 * - 未命中 fid → 渲染红色 `[Fn]` 占位提示（提示公式缺失，而非静默丢弃）。
 */
export function FormulaText({
  text,
  formulas,
  displayMode = false,
  className,
}: FormulaTextProps) {
  const nodes = useMemo<ReactNode[]>(() => {
    const src = text ?? ''
    const map = new Map<string, string>()
    for (const f of formulas ?? []) {
      map.set(f.fid, f.latex ?? '')
    }
    const out: ReactNode[] = []
    let last = 0
    let key = 0
    PLACEHOLDER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PLACEHOLDER_RE.exec(src)) !== null) {
      if (m.index > last) {
        out.push(<span key={`t${key++}`}>{src.slice(last, m.index)}</span>)
      }
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
          <Box
            key={`m${key++}`}
            component="span"
            sx={{
              color: 'error.main',
              border: '1px dashed',
              borderColor: 'error.main',
              borderRadius: '4px',
              px: 0.5,
              fontSize: '0.85em',
            }}
            title={`题干占位符 ⟦${fid}⟧ 没有对应公式`}
          >
            ⟦{fid}⟧
          </Box>,
        )
      }
      last = m.index + m[0].length
    }
    if (last < src.length) {
      // 末段：这是最后一次使用 key，自增结果此后不再被读取，故不自增（no-useless-assignment）。
      out.push(<span key={`t${key}`}>{src.slice(last)}</span>)
    }
    return out
  }, [text, formulas, displayMode])

  return (
    <Box component="span" className={className} sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>
      {nodes}
    </Box>
  )
}

export default KatexFormula
