/**
 * 门禁：`index.css` 的动效变量必须与 `tokens.motion` **逐值一致**（T09 / 规范 §2.6）。
 *
 * 为什么放在 node:test 而不是 vitest
 * --------------------------------
 * 这条断言要**读源文件**（`src/index.css`）。而本项目 tsconfig 只加载 `vite/client`
 * 类型（**没有 `@types/node`**），`node:fs` 在 `.ts` 测试里会报 TS2307；
 * Vite 的 `?raw` 在 vitest 的 jsdom 环境下返回空串（实测）。
 * 项目已有同类先例（`preview-and-theme.test.cjs` 直接读源码 + 转译 TS），沿用即可。
 *
 * 为什么需要它
 * ------------
 * CSS 无法 import TS 常量，于是「同一套刻度维护两遍」是**结构性**风险：
 * 改了 `tokens.motion.fast` 却忘了改 `--qb-motion-fast`，路由过渡就会与
 * hover 反馈用不同时长，而且**没有任何测试会发现**。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function loadTs(file) {
  const filename = path.resolve(__dirname, '..', file)
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(result.outputText, filename)
  return mod.exports
}

const { tokens } = loadTs('src/theme.ts')
const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'index.css'), 'utf8')

/** 取出 `--qb-motion-xxx: <值>;` 的值。 */
function cssVar(name) {
  const m = new RegExp(`--${name}:\s*([^;]+);`).exec(css)
  assert.ok(m, `index.css 里找不到 --${name}（动效变量必须存在，否则 CSS 无处引用）`)
  return m[1].trim()
}

test('index.css 的时长变量与 tokens.motion 逐值一致', () => {
  assert.equal(cssVar('qb-motion-fast'), `${tokens.motion.fast}ms`)
  assert.equal(cssVar('qb-motion-base'), `${tokens.motion.base}ms`)
  assert.equal(cssVar('qb-motion-slow'), `${tokens.motion.slow}ms`)
})

test('index.css 的缓动变量与 tokens.motion 逐值一致', () => {
  assert.equal(cssVar('qb-motion-ease'), tokens.motion.ease)
  assert.equal(cssVar('qb-motion-ease-out'), tokens.motion.easeOut)
  assert.equal(cssVar('qb-motion-ease-in'), tokens.motion.easeIn)
})

test('路由过渡块**引用变量**，不再写字面量（否则 token 改了它不会变）', () => {
  assert.match(css, /animation:\s*qb-route-in\s+var\(--qb-motion-fast\)/)
  assert.match(css, /animation:\s*qb-route-out\s+var\(--qb-motion-fast\)/)
  // 反证：确保上面两条不是「永远通过」——把变量全换成字面量后必须检不出。
  // ⚠️ 必须用 `replaceAll`：`String.replace(str, ...)` **只替换第一处**，
  //    两处只换一处会让这条反证假失败（本用例第一版就踩了这个）。
  const mutated = css.replaceAll('var(--qb-motion-fast)', '120ms')
  assert.ok(
    !/animation:\s*qb-route-in\s+var\(--qb-motion-fast\)/.test(mutated),
    '反证：替换字面量后应不再匹配',
  )
})
