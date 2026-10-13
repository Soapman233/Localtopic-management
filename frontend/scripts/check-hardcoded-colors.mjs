/**
 * 门禁：**硬编码颜色扫描**（设计规范 §2.1 铁律 1 / §5.3 第 1 条）。
 *
 * 为什么要有它
 * ------------
 * 已经发生过一次真实缺陷：`FormulaReviewPage` 里硬编码 `bgcolor: '#fff'`，
 * 深色模式下容器不跟着变 → **白底白字、内容完全不可见**。
 * 同类问题还出过 3 处「按旧顶栏配色写死的白色系」（顶栏从主色底改成纸面白后，
 * 白描边压白底 → 描边与焦点环隐形）。
 *
 * 规则
 * ----
 * 颜色**只能**来自 `theme.ts` 的 token 或 `useTheme()` 的语义槽。
 * 命中下列模式即失败（`frontend/src` 下 `.ts` / `.tsx`）：
 *   - 颜色属性值以 `#` 开头：`bgcolor: '#fff'`、`color: '#D0D3D9'`
 *   - 颜色属性值以 `rgb(` / `rgba(` 开头
 *   - 颜色属性值为 `'white'` / `'black'`
 *
 * 豁免机制（**必须写明理由，且理由不得为空**）
 * ------------------------------------------
 * 在**同一行**或**紧邻上一行**写 `color-token-exempt: <理由>`。
 * 为什么要求理由：无理由的豁免表会随着时间变成「什么都豁免」——
 * 而**有理由的例外**才是可审计的（例如「二维码必须是白底才能被扫到」）。
 *
 * 用法::
 *
 *     node scripts/check-hardcoded-colors.mjs        # 命中即 exit 1
 *     node scripts/check-hardcoded-colors.mjs --root <dir>   # 指定扫描根（供测试用夹具）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// `--root <dir>` 让测试能把门禁指向**夹具目录**（含故意注入的缺陷），
// 从而把「门禁能被反证触发」变成可重复执行的测试，而不是一次性的手工验证。
const rootArgIdx = process.argv.indexOf('--root')
const SCAN_ROOT = rootArgIdx >= 0 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : join(ROOT, 'src')

/** 整文件豁免（路径**相对扫描根**）：token 定义处与全局样式 —— 它们本来就是「颜色的唯一来源」。 */
const FILE_ALLOWLIST = new Set([
  'theme.ts', // token 的唯一来源
  'index.css', // 全局样式（含 KaTeX 降级块，已在文件内注明对比度）
])

/** 颜色属性名（只查这些，避免把 `backgroundImage: 'url(#grad)'` 之类误判）。 */
const COLOR_PROPS = [
  'color',
  'bgcolor',
  'background',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'outlineColor',
  'fill',
  'stroke',
]

/** 值形如 '#fff' / '#FFFFFF' / 'rgb(...)' / 'rgba(...)' / 'white' / 'black'。 */
const HEX_OR_FUNC = /(#[0-9a-fA-F]{3,8}|rgba?\()/
const NAMED = /^(white|black)$/i

const EXEMPT_MARK = 'color-token-exempt'

/** 递归收集 `.ts` / `.tsx`（跳过测试与声明文件）。 */
function collect(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...collect(p))
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) {
      out.push(p)
    }
  }
  return out
}

const violations = []
let exempted = 0

for (const file of collect(SCAN_ROOT)) {
  const rel = relative(SCAN_ROOT, file)
  if (FILE_ALLOWLIST.has(rel)) continue

  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // 跳过纯注释行（文档里会引用反例，例如「曾是 `bgcolor: '#fff'`」）。
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const hit = COLOR_PROPS.some((prop) => {
      // 匹配 `prop: '值'` 或 `prop: "值"`（允许 prop 前后有空格）。
      const m = new RegExp(`\\b${prop}\\s*:\\s*(['"])([^'"]*)\\1`).exec(code)
      if (!m) return false
      const value = m[2].trim()
      return HEX_OR_FUNC.test(value) || NAMED.test(value)
    })
    if (!hit) return

    // 豁免：**同一行或上方 3 行内**有标记，且理由非空。
    // 为什么是 3 行而不是 1 行：理由往往需要写成多行注释（先说结论、再说原因），
    // 窗口太窄会逼着把理由压成一行，反而写不清楚。窗口固定为 3 行，仍然是「紧邻」语义。
    const window = lines.slice(Math.max(0, i - 3), i + 1)
    const markLine = window.find((l) => l.includes(EXEMPT_MARK))
    if (markLine) {
      const reason = markLine.split(EXEMPT_MARK)[1]?.replace(/^[:：\s*]*/, '').replace(/\*\/\s*$/, '').trim()
      if (reason) {
        exempted += 1
        return
      }
      violations.push({ file: rel, line: i + 1, text: line.trim(), why: '豁免标记缺少理由' })
      return
    }
    violations.push({ file: rel, line: i + 1, text: line.trim(), why: '硬编码颜色' })
  })
}

if (violations.length === 0) {
  console.log(`✅ 硬编码颜色扫描通过：0 处违规（已豁免 ${exempted} 处，均有理由）`)
  process.exit(0)
}

console.error(`❌ 硬编码颜色扫描失败：${violations.length} 处违规\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.why}]`)
  console.error(`      ${v.text}`)
}
console.error(`
修法：改用语义槽（background.paper / text.primary / divider / action.hover / primary.main…）。
确需例外的，在**同一行或上一行**写 \`${EXEMPT_MARK}: <理由>\`（理由为空同样算违规）。
`)
process.exit(1)
