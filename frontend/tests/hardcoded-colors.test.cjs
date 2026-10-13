/**
 * 门禁自测：`scripts/check-hardcoded-colors.mjs`（设计规范 §2.1 铁律 1 / §5.3 第 1 条）。
 *
 * 为什么门禁自身要有测试
 * ----------------------
 * 项目铁律：**门禁必须能被反证触发**——一个永远返回 0 的检查等于没有检查。
 * 这里用**夹具目录**（`--root`）跑四种情形，把「注入缺陷 → 报错」固化下来：
 *
 *  1. 只用语义槽                 → 通过
 *  2. 硬编码 `#fff` / `rgba(`    → **报错**
 *  3. 硬编码 + 豁免标记（有理由） → 通过（且计入豁免数）
 *  4. 硬编码 + 豁免标记（空理由） → **报错**（无理由的豁免不允许）
 *
 * 另外还要挡住一类**假阳性**：注释里引用反例（如「曾是 `bgcolor: '#fff'`」）不得判违规。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const SCRIPT = join(__dirname, '..', 'scripts', 'check-hardcoded-colors.mjs')

/** 在临时目录里建一个夹具，返回 `{ dir, run }`；`run()` 跑门禁并返回 `{ code, out }`。 */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'qb-colors-'))
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  const run = () => {
    try {
      const out = execFileSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('① 只用语义槽 → 通过', () => {
  const f = fixture({
    'Clean.tsx': `export const A = () => <Box sx={{ bgcolor: 'background.paper', color: 'text.primary' }} />\n`,
  })
  try {
    const { code, out } = f.run()
    assert.equal(code, 0, out)
    assert.match(out, /0 处违规/)
  } finally {
    f.cleanup()
  }
})

test('② 硬编码颜色（#hex 与 rgba 两种）→ 必须报错', () => {
  const f = fixture({
    'Bad.tsx': [
      `export const A = () => <Box sx={{ bgcolor: '#fff' }} />`,
      `export const B = () => <Box sx={{ bgcolor: 'rgba(255,255,255,.75)' }} />`,
      `export const C = () => <Box sx={{ borderColor: '#D0D3D9' }} />`,
      `export const D = () => <Box sx={{ color: 'white' }} />`,
      '',
    ].join('\n'),
  })
  try {
    const { code, out } = f.run()
    assert.equal(code, 1, `期望失败但通过了：${out}`)
    // 四行都要被抓到（含容易被漏掉的 rgba 与具名色）
    assert.match(out, /4 处违规/)
  } finally {
    f.cleanup()
  }
})

test('③ 硬编码 + 豁免标记（有理由）→ 通过，且计入豁免数', () => {
  const f = fixture({
    'Exempt.tsx': [
      'export const A = () => (',
      '  <Box',
      '    sx={{',
      '      // color-token-exempt: 二维码必须浅底深码，跟随主题会扫不出来',
      "      bgcolor: '#fff',",
      '    }}',
      '  />',
      ')',
      '',
    ].join('\n'),
  })
  try {
    const { code, out } = f.run()
    assert.equal(code, 0, out)
    assert.match(out, /已豁免 1 处/)
  } finally {
    f.cleanup()
  }
})

test('④ 豁免标记但理由为空 → 必须报错（不允许无理由豁免）', () => {
  const f = fixture({
    'Bad.tsx': ['export const A = () => (', '  <Box', '    // color-token-exempt:', "    sx={{ bgcolor: '#fff' }}", '  />', ')', ''].join('\n'),
  })
  try {
    const { code, out } = f.run()
    assert.equal(code, 1, `期望失败但通过了：${out}`)
    assert.match(out, /豁免标记缺少理由/)
  } finally {
    f.cleanup()
  }
})

test('⑤ 假阳性防线：注释里引用反例不算违规', () => {
  const f = fixture({
    'Doc.tsx': `// 这里曾是硬编码 bgcolor: '#fff'，深色下白底白字（已改为 background.paper）\nexport const A = 1\n`,
  })
  try {
    const { code, out } = f.run()
    assert.equal(code, 0, out)
  } finally {
    f.cleanup()
  }
})
