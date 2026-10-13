import fs from 'node:fs/promises'
import path from 'node:path'
import { main, files, frontend, require } from './gate-common.mjs'
const ts = require('typescript'), postcss = require('postcss')
const color = /(?:#[0-9a-f]{8}|#[0-9a-f]{6}|#[0-9a-f]{4}|#[0-9a-f]{3})(?![0-9a-z])|\brgba?\s*\([^)]*\)|\b(?:white|black)\b/i
const normalize = value => value.replace(/\s+/g, ' ').trim()
function location(node, source) {
  let key = '', scope = ''
  for (let p = node.parent; p; p = p.parent) {
    if (!key && (ts.isPropertyAssignment(p) || ts.isJsxAttribute(p))) key = p.name.getText(source).replace(/['"]/g, '')
    if (!key && ts.isCallExpression(p)) key = p.expression.getText(source)
    if (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) { scope = p.name?.getText(source) || ''; break }
  }
  return { key, scope }
}
await main('G-a/colors', async options => {
  const src = path.resolve(options['src-root'] || path.join(frontend, 'src'))
  const policy = JSON.parse(await fs.readFile(path.join(frontend, 'scripts/gate-policy.json'), 'utf8'))
  const hits = [], allowed = [], failures = [], used = new Map()
  for (const filename of await files(src)) {
    const file = path.relative(src, filename).replaceAll('\\', '/'); if (!/\.(tsx?|css)$/.test(file)) continue
    if (file === policy.tokenSource) continue
    const content = await fs.readFile(filename, 'utf8')
    if (file.endsWith('.css')) {
      const sheet = postcss.parse(content, { from: filename })
      sheet.walkDecls(d => { if (color.test(d.value)) hits.push({ file, scope: normalize(d.parent.selector || ''), key: d.prop, value: normalize(d.value), line: d.source.start.line }) })
    } else {
      const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = node => {
        // 注释不进入AST；模板各段也须检查，不能借插值隐藏边框/阴影里的字面颜色。
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && color.test(node.text)) {
          const pos = source.getLineAndCharacterOfPosition(node.getStart(source)); hits.push({ file, ...location(node, source), value: normalize(node.text), line: pos.line + 1 })
        } ts.forEachChild(node, visit)
      }; visit(source)
    }
  }
  for (const hit of hits) {
    const index = policy.declarations.findIndex(p => p.file === hit.file && (!p.scope || p.scope === hit.scope) && p.key === hit.key && normalize(p.value) === hit.value)
    if (index < 0) { failures.push({ ...hit, reason: '未获G1逐声明授权的硬编码颜色' }); continue }
    const expected = policy.declarations[index], count = (used.get(index) || 0) + 1; used.set(index, count)
    if (count > expected.count) failures.push({ ...hit, reason: '同值新声明不能继承豁免', expectedCount: expected.count, actualCount: count })
    else allowed.push({ ...hit, reason: expected.reason })
  }
  return { checked: hits.length, threshold: '零未授权声明；匹配路径/作用域/声明键/完整值/次数', allowed, failures }
})
