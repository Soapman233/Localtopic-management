import fs from 'node:fs/promises'
import path from 'node:path'
import Module from 'node:module'
import { main, frontend, require } from './gate-common.mjs'
const ts = require('typescript'), { getContrastRatio } = require('@mui/material/styles')
function loadTheme(filename, source) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = new Module(filename); module.filename = filename; module.paths = Module._nodeModulePaths(path.join(frontend, 'src')); module._compile(output.outputText, filename)
  if (typeof module.exports.buildTheme !== 'function') throw new Error('theme源码未导出buildTheme'); return module.exports.buildTheme
}
function styles(theme, component, slot, ownerState = {}) {
  const value = theme.components?.[component]?.styleOverrides?.[slot]
  if (Array.isArray(value)) throw new Error('暂不支持数组styleOverrides: ' + component + '.' + slot)
  return typeof value === 'function' ? value({ theme, ownerState }) : value || {}
}
await main('G-b/runtime', async options => {
  const settings = path.resolve(options.settings || path.join(frontend, '../outputs/webui/settings.json'))
  const saved = JSON.parse(await fs.readFile(settings, 'utf8')), raw = saved.theme?.primary
  if (!/^#[0-9a-f]{6}$/i.test(raw || '')) throw new Error('settings.theme.primary必须是合法hex6；不得静默回退')
  const sourcePath = path.resolve(options['theme-source'] || path.join(frontend, 'src/theme.ts'))
  const buildTheme = loadTheme(sourcePath, await fs.readFile(sourcePath, 'utf8')), pairs = [], failures = []
  for (const dark of [false, true]) {
    const t = buildTheme({ primary: raw, dark }), p = t.palette.primary, paper = t.palette.background.paper, page = t.palette.background.default
    const button = styles(t, 'MuiButton', 'containedPrimary'), outlined = styles(t, 'MuiButton', 'outlinedPrimary'), chip = styles(t, 'MuiChip', 'root', { variant: 'filled', color: 'primary' }), outlinedChip = styles(t, 'MuiChip', 'outlinedPrimary', { variant: 'outlined', color: 'primary' }), pagination = styles(t, 'MuiPaginationItem', 'textPrimary'), alert = styles(t, 'MuiAlert', 'standardInfo')
    // 按实际组件覆写优先取值；App.tsx顶栏使用primary.dark；未覆写槽沿MUI实际默认值。
    const roles = [
      ['正文主色', p.main, paper], ['页面主色正文', p.main, page], ['链接', styles(t, 'MuiLink', 'root').color || p.main, paper],
      ['outlined按钮', outlined.color || p.main, paper], ['outlined Chip', outlinedChip.color || p.main, paper],
      ['选中Chip', chip.color || p.contrastText, chip.backgroundColor || p.main],
      ['主按钮', button.color || p.contrastText, button.backgroundColor || p.main],
      ['AppBar', styles(t, 'MuiAppBar', 'colorPrimary').color || p.contrastText, styles(t, 'MuiAppBar', 'colorPrimary').backgroundColor || p.dark],
      ['分页选中', pagination['&.Mui-selected']?.color || p.contrastText, pagination['&.Mui-selected']?.backgroundColor || p.main],
      ['焦点关联文字', styles(t, 'MuiButton', 'textPrimary').color || p.main, paper], ['主色提示', alert.color || p.main, paper],
    ]
    for (const [role, fg, bg] of roles) { const ratio = getContrastRatio(fg, bg), item = { mode: dark ? 'dark' : 'light', role, raw, main: p.main, fill: p.dark, foreground: fg, background: bg, ratio, threshold: 4.5 }; if (!Number.isFinite(ratio)) throw new Error('无法计算配对: ' + JSON.stringify(item)); pairs.push(item); if (ratio < 4.5) failures.push(item) }
  }
  return { checked: pairs.length, settings, sourcePath, pairs, failures }
})
