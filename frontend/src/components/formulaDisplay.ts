/** 与 bank.latexnorm 的显示规则对齐；保留编辑源值，不向库写回占位符。 */
export function formulaDisplay(latex: string): { latex: string; unknown: string[] } {
  const restored = latex.replace(/\[U\+([0-9a-fA-F]{4})\]/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  const unknown = [...new Set([...restored].filter(c => c >= '\uE000' && c <= '\uF8FF' && c !== '\uEF01').map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`))].sort()
  return { latex: restored.replace(/\uEF01/g, '').replace(/\\text\{\s*\}/g, ''), unknown }
}
