/**
 * 前端缺陷修复与重构的回归测试（R3）。
 *
 * 覆盖：
 *  - **共享导出门禁**的纯函数（`detectEnvFailure` / `extractPages` / `envReason`）——P0-4 根因；
 *  - **KaTeX 设置接线**（P0-2）：`KatexFormula` 从 `useSettingsStore` 读取 throwOnError / strict；
 *  - **设置镜像 store**（P0-2）：`syncFrom` 更新 katex 与默认模板；
 *  - **删除撤销重建**（P0-1）：`recreatePaperCopy` 按原大题/题序/分值逐条重建（mock fetch）；
 *  - **结构性回归护栏**（P0-1 / P0-3）：删除入口经确认框、来源详情按 sourceId 重挂载。
 *
 * 说明：本项目测试环境为「transpileModule + node:test + react-dom/server」，**无 DOM / 无
 * QueryClientProvider**，故含 `useQuery` 的页面无法直接挂载；对这两项采用**源码级护栏**
 * 并配合人工验收（见交接文档）。
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const saved = new Map()
global.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
}
// api/client.ts 在请求期间使用 window.setTimeout / clearTimeout；node 无 window，需桩。
global.window = { setTimeout, clearTimeout }

// ★ `.ts` 用 JsxEmit.None：否则 `.ts` 里的泛型箭头函数 `get: <T>(...) => ...`
//   会被当成 JSX 解析（`<T>` → jsx_runtime），导致 `T is not defined`。`.tsx` 才用 ReactJSX。
// ★ esModuleInterop：让 `import katex from 'katex'` 正确取到 CJS 默认导出（否则 renderToString 为 undefined）。
const jsxFor = (filename) => (filename.endsWith('.tsx') ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None)
const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
}

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { ...COMPILER_OPTIONS, jsx: jsxFor(filename) },
    })
    mod._compile(result.outputText, filename)
  }
}

function loadTs(file) {
  const filename = path.resolve(__dirname, '..', file)
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { ...COMPILER_OPTIONS, jsx: jsxFor(filename) },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(result.outputText, filename)
  return mod.exports
}

const readSource = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')

// ---------------------------------------------------------------------------
// 共享导出门禁纯函数（P0-4）
// ---------------------------------------------------------------------------
const { detectEnvFailure, extractPages, envReason } = loadTs('src/hooks/exportGateShared.ts')

test('detectEnvFailure 同时识别 editor_sdk 与 Word/WPS（P0-4 根因）', () => {
  // ★ 导出页此前只认 Word|WPS，漏了 editor_sdk → 缺 editor_sdk 时导出被永久锁死。
  assert.equal(detectEnvFailure(new Error('未检测到 editor_sdk 服务（127.0.0.1:39099）')), 'editor_sdk')
  assert.equal(detectEnvFailure(new Error('未检测到 Microsoft Word / WPS')), 'office')
  assert.equal(detectEnvFailure(new Error('WPS 未安装')), 'office')
  assert.equal(detectEnvFailure(new Error('内容被阻断')), null)
  assert.equal(detectEnvFailure('editor_sdk 缺失'), 'editor_sdk') // 非 Error 入参也识别
  assert.equal(detectEnvFailure(null), null)
})

test('envReason 覆盖三种环境失败类型', () => {
  assert.match(envReason('editor_sdk'), /editor_sdk/)
  assert.match(envReason('office'), /Word \/ WPS/)
  assert.match(envReason(null), /环境依赖缺失/)
})

test('extractPages 归一化字符串页 / 对象页 / 由 key 派生 URL / 非法入参', () => {
  assert.deepEqual(extractPages({ pages: ['/a.png', '/b.png'] }).pages, [
    { n: 1, url: '/a.png' },
    { n: 2, url: '/b.png' },
  ])
  const withKey = extractPages({ key: 'K1', pages: [{ n: 1 }, { page: 2 }] })
  assert.equal(withKey.key, 'K1')
  assert.deepEqual(withKey.pages, [
    { n: 1, url: '/api/preview/K1/page_1.png' },
    { n: 2, url: '/api/preview/K1/page_2.png' },
  ])
  assert.deepEqual(extractPages({ pages: [{ n: 3, url: '/explicit.png' }] }).pages, [{ n: 3, url: '/explicit.png' }])
  assert.deepEqual(extractPages(null).pages, [])
  assert.deepEqual(extractPages({ key: 'K', pages: 'nope' }).pages, [])
})

// ---------------------------------------------------------------------------
// KaTeX 设置接线（P0-2）
// ---------------------------------------------------------------------------
// ★ 用 require（走 require 缓存）加载 settingsStore，使 KatexFormula 内部 `require` 到**同一实例**；
//   否则 loadTs 每次 `new Module` 会造出各自独立的 store，setState 不生效。
const { useSettingsStore } = require(path.resolve(__dirname, '..', 'src/store/settingsStore.ts'))
const { KatexFormula } = loadTs('src/components/KatexFormula.tsx')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

test('syncFrom 把后端设置镜像到 store（katex + 默认模板）', () => {
  useSettingsStore.getState().syncFrom({
    db_path: 'x', export_dir: 'y', default_template: '测验',
    katex: { throw_on_error: false, strict: true }, theme: {},
  })
  const s = useSettingsStore.getState()
  assert.equal(s.katex.throwOnError, false)
  assert.equal(s.katex.strict, true)
  assert.equal(s.defaultTemplate, '测验')
  // 缺字段时回退到默认（与历史硬编码一致）。
  useSettingsStore.getState().syncFrom({ db_path: 'x', export_dir: 'y', default_template: '', katex: {}, theme: {} })
  assert.equal(useSettingsStore.getState().katex.throwOnError, true)
  assert.equal(useSettingsStore.getState().katex.strict, false)
  assert.equal(useSettingsStore.getState().defaultTemplate, '考试')
})

test('KatexFormula 从设置读取 throwOnError/strict（P0-2）', () => {
  // 默认（未改设置）→ 渲染失败降级为红色源码（qb-katex-fallback + data-katex-error）。
  useSettingsStore.setState({ katex: { throwOnError: true, strict: false } })
  const html = renderToStaticMarkup(React.createElement(KatexFormula, { latex: '\\frac{1}{' }))
  assert.match(html, /qb-katex-fallback/)
  assert.match(html, /data-katex-error=/)

  // 源码级护栏：组件改为**从 store 读取**开关（不再硬编码）。
  // 说明：zustand 在 SSR（renderToStaticMarkup）下用 `getInitialState` 作 getServerSnapshot，
  // 故 setState 不影响静态渲染结果，无法在此断言「关闭后不走降级」；该分支由 store 行为测试 +
  // 人工浏览器验收覆盖（见交接文档）。
  const src = readSource('src/components/KatexFormula.tsx')
  assert.match(src, /useSettingsStore\(\(s\) => s\.katex\.throwOnError\)/)
  assert.match(src, /useSettingsStore\(\(s\) => s\.katex\.strict\)/)
  assert.match(src, /katex\.renderToString\(display\.latex, \{\s*\n\s*throwOnError,/)
})

// ---------------------------------------------------------------------------
// 删除撤销重建（P0-1）——mock fetch
// ---------------------------------------------------------------------------
const { recreatePaperCopy } = loadTs('src/api/paperRestore.ts')

test('recreatePaperCopy 按原大题/题序/分值/归属逐条重建（撤销路径）', async () => {
  const calls = []
  const state = { id: 100, sections: [], nextSecId: 1 }
  global.fetch = async (url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    let data
    if (url === '/api/papers' && method === 'POST') {
      data = { id: state.id, ...body, sections: [], items: [] }
    } else if (method === 'POST' && /\/sections$/.test(url)) {
      state.sections.push({ id: state.nextSecId++, name: body.name, seq: body.position })
      data = { id: state.id, sections: [...state.sections], items: [] }
    } else if (method === 'POST' && /\/questions$/.test(url)) {
      data = { id: state.id, sections: [...state.sections], items: [] }
    } else {
      throw new Error(`unexpected ${method} ${url}`)
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data, message: 'ok' }) }
  }

  const full = {
    id: 9, title: '期中卷', template: '考试', answer_mode: '学生版', subject: '物理', stage: null, grade: null,
    sections: [
      { id: 71, name: '一、选择题', seq: 1, description: null },
      { id: 72, name: '二、填空题', seq: 2, description: null },
    ],
    items: [
      { id: 1, section_id: 71, question_id: 501, seq: 1, score: 3 },
      { id: 2, section_id: 72, question_id: 502, seq: 2, score: 2 },
      { id: 3, section_id: null, question_id: 503, seq: 3, score: null },
    ],
    summary: {},
  }

  const created = await recreatePaperCopy(full)

  // 1) 先建卷，携带原元数据。
  assert.deepEqual(calls[0], {
    method: 'POST', url: '/api/papers',
    body: { title: '期中卷', template: '考试', answer_mode: '学生版', subject: '物理' },
  })
  // 2) 大题按 seq 重建。
  const secCalls = calls.filter((c) => /\/sections$/.test(c.url))
  assert.deepEqual(secCalls.map((c) => c.body), [
    { name: '一、选择题', position: 1 },
    { name: '二、填空题', position: 2 },
  ])
  // 3) 题目按 seq 升序，带 position=原 seq、分值、且大题归属映射到**新**大题 id。
  const qCalls = calls.filter((c) => /\/questions$/.test(c.url))
  assert.deepEqual(qCalls.map((c) => c.body), [
    { question_ids: [501], section_id: 1, position: 1, score: 3 },
    { question_ids: [502], section_id: 2, position: 2, score: 2 },
    { question_ids: [503], position: 3 }, // 未分组：无 section_id / score（undefined 被 JSON 丢弃）
  ])
  assert.equal(created.id, 100)
})

// ---------------------------------------------------------------------------
// 结构性回归护栏（无 DOM 环境；配合人工验收）
// ---------------------------------------------------------------------------
test('护栏：删除试卷必须经确认框（显示题数），不再单击 force 删除（P0-1）', () => {
  const src = readSource('src/components/PaperLibraryDrawer.tsx')
  // 删除先读取整卷，按钮只启动读取；确认框才触发删除，题数来自整卷而非列表。
  assert.match(src, /onClick=\{\(\) => readMut\.mutate\(paper\.id\)\}/)
  assert.match(src, /onConfirm=\{\(\) => \{ if \(confirmation && !deleteMut\.isPending\) deleteMut\.mutate\(confirmation\)/)
  assert.match(src, /impactCount=\{confirmation\?\.items\.length/)
  assert.doesNotMatch(src, /onClick=\{\(\) => deleteMut\.mutate\(paper\.id\)/)

})

test('护栏：删除大题必须经确认框（P0-1）', () => {
  const src = readSource('src/components/PaperPanel.tsx')
  assert.match(src, /setConfirmSection\(\{ id: g\.section!\.id/)
  assert.match(src, /if \(confirmSection\) actions\.deleteSection\(confirmSection\.id, true\)/)
  // 图标按钮不再直接 force 删大题。
  assert.doesNotMatch(src, /onClick=\{\(\) => actions\.deleteSection\(g\.section!\.id, true\)\}/)
})

test('护栏：来源详情按 sourceId 重挂载，且回填在 effect 中（P0-3）', () => {
  const pageSrc = readSource('src/pages/SourcesPage.tsx')
  // 关键修复：以 key 强制按 sourceId 重挂载，避免跨文件串值。
  assert.match(pageSrc, /key=\{activeId \?\? 'none'\}/)
  // 回填改为 effect（不再在渲染期 `if (detail && !inited) { setGrade(...) }`）。
  assert.match(pageSrc, /useEffect\(\(\) => \{\s*\n\s*if \(detail && !inited\) \{/)
  assert.match(pageSrc, /setGrade\(detail\.source\.grade \?\? ''\)/)
})
