/** 直接运行生产 TypeScript 模块，验证异步门禁与主题，无需浏览器或新增依赖。 */
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

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } })
  mod._compile(result.outputText, filename)
}
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

const { useUiStore, previewSettingsKey } = loadTs('src/store/uiStore.ts')
const { buildTheme, tokens } = loadTs('src/theme.ts')
const { formulaDisplay } = loadTs('src/components/formulaDisplay.ts')
const katex = require('katex')
const { GradeGapNotice } = loadTs('src/components/GradeGapNotice.tsx')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

test('结果区提示只展示当前条件计数，明确未确认年级', () => {
  const props = { gap: { selected_grade: '八年级下册', count: 1200 }, filters: { grade: '八年级下册' }, pending: false, onChange() {} }
  const html = renderToStaticMarkup(React.createElement(GradeGapNotice, props))
  assert.match(html, /1,200/)
  assert.match(html, /不代表属于/)
  assert.match(html, /查看未标注年级的题/)
})

test('无年级、待补充、零计数及迟到结果均不展示漏题提示', () => {
  const base = { gap: { selected_grade: '八年级下册', count: 4 }, filters: { grade: '八年级下册' }, pending: false, onChange() {} }
  for (const patch of [{ filters: {} }, { filters: { grade_missing: true } }, { gap: { ...base.gap, count: 0 } }, { pending: true }, { filters: { grade: '九年级' } }]) {
    assert.equal(GradeGapNotice({ ...base, ...patch }), null)
  }
})

test('点击查看只切换年级条件，关键词和其他筛选保留', () => {
  const filters = { grade: '八年级下册', keyword: '浮力', subject: '物理', has_answer: true, textbook_missing: true }
  let next
  const element = GradeGapNotice({ gap: { selected_grade: filters.grade, count: 4 }, filters, pending: false, onChange: patch => { next = { ...filters, ...patch } } })
  element.props.action.props.onClick()
  assert.deepEqual(next, { ...filters, grade: undefined, grade_missing: true })
})

test('EF01 空标记在真实旧公式中可显示，未知私有字形须提示', () => {
  const raw = String.raw`p\prime_{\text{甲}}{\text{` + '\uEF01' + String.raw`}}>p\prime_{\text{乙}}`
  assert.throws(() => katex.renderToString(raw, { throwOnError: true, strict: 'error' }))
  const display = formulaDisplay(raw)
  assert.equal(display.unknown.length, 0)
  assert.ok(!display.latex.includes('\uEF01'))
  assert.doesNotThrow(() => katex.renderToString(display.latex, { throwOnError: true, strict: false }))
  assert.deepEqual(formulaDisplay(String.raw`\text{[U+EF0A]}h`).unknown, ['U+EF0A'])
  assert.deepEqual(formulaDisplay(display.latex), display)
})

beforeEach(() => useUiStore.setState({
  previewFresh: {}, previewDegradedOk: {}, previewRevision: {}, previewSettings: {}, previewContent: {}, previewAllowed: {},
}))

test('内容编辑后，延迟返回的旧预览不能解锁', async () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  const ticket = state.beginPreview(1, '学生版', '考试', 'digest-one')
  const delayedResult = Promise.resolve().then(() => state.markPreviewFresh(ticket, ticket.contentDigest))
  state.invalidatePreview(1)
  assert.equal(await delayedResult, false)
  assert.equal(state.isExportUnlocked(1), false)
})

test('两次预览乱序完成，只接受最新请求', () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  const old = state.beginPreview(1, '学生版', '考试', 'digest-one')
  const current = state.beginPreview(1, '答案解析版', '测验', 'digest-one')
  assert.equal(state.markPreviewFresh(current, current.contentDigest), true)
  assert.equal(state.markPreviewFresh(old, old.contentDigest), false)
  assert.equal(state.isExportUnlocked(1, current.settingsKey), true)
})

test('抽屉与导出中心使用不同设置时不能互相解锁', () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  const ticket = state.beginPreview(1, '学生版', '考试', 'digest-one')
  state.markPreviewFresh(ticket, ticket.contentDigest)
  assert.equal(state.isExportUnlocked(1, previewSettingsKey('学生版', '考试')), true)
  assert.equal(state.isExportUnlocked(1, previewSettingsKey('答案解析版', '考试')), false)
  assert.equal(state.isExportUnlocked(1, previewSettingsKey('学生版', '作业')), false)
})

test('不同试卷隔离，编辑一卷不影响另一卷', () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  const one = state.beginPreview(1, '学生版', '考试', 'digest-one')
  const two = state.beginPreview(2, '学生版', '考试', 'digest-two')
  state.markPreviewFresh(one, one.contentDigest)
  state.markPreviewFresh(two, two.contentDigest)
  state.invalidatePreview(1)
  assert.equal(state.isExportUnlocked(1), false)
  assert.equal(state.isExportUnlocked(2), true)
})

test('降级确认绑定设置，编辑后重新锁定', () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  const key = previewSettingsKey('学生版', '考试')
  state.markPreviewDegraded(1, key, 'digest-one')
  assert.equal(state.isExportUnlocked(1, key), true)
  assert.equal(state.isExportUnlocked(1, previewSettingsKey('仅答案', '考试')), false)
  state.invalidatePreview(1)
  assert.equal(state.isExportUnlocked(1, key), false)
})

test('门禁和请求版本不持久化，刷新后必须重新预览', () => {
  const state = useUiStore.getState()
  state.observeContent(1, 'digest-one', true)
  state.observeContent(2, 'digest-two', true)
  state.markPreviewFresh(state.beginPreview(1, '学生版', '考试', 'digest-one'), 'digest-one')
  const persisted = JSON.parse(saved.get('qb-ui-store')).state
  for (const key of ['previewFresh', 'previewDegradedOk', 'previewRevision', 'previewSettings', 'previewContent', 'previewAllowed']) {
    assert.equal(key in persisted, false)
  }
})

test('主题按保存值构建深色/主色，历史非法颜色安全回退', () => {
  const dark = buildTheme({ dark: true, primary: '#123abc' })
  assert.equal(dark.palette.mode, 'dark')
  assert.equal(dark.palette.background.paper, '#1E1E1E')
  // P0/T02：主色不再「原样采用」——按模式收敛到与承载底对比度 ≥4.5 的派生值
  // （深色模式提亮、浅色模式加深）。此处断言「已收敛」而非相等，避免把修复后的行为锁回旧契约；
  // 收敛后的达标性由 vitest `ThemeContrast.test.ts` 复算 WCAG 对比度来锁。
  assert.notEqual(dark.palette.primary.main, '#123abc')
  // 回退主色 = `tokens.primary`（P5-2 起为 WCAG AA 文字安全值；断言引用 token，避免改色时硬编码字面量漂移）。
  // 浅色模式下它本身达标，收敛为恒等变换，故仍是原值。
  assert.equal(buildTheme({ primary: 'invalid' }).palette.primary.main, tokens.primary)
  assert.equal(buildTheme().palette.mode, 'light')
})


test('返回digest不匹配、未获取审计或blocked均不能解锁', () => {
  const s = useUiStore.getState()
  s.observeContent(1, 'new-content', true)
  const ticket = s.beginPreview(1, '学生版', '考试', 'new-content')
  assert.equal(s.markPreviewFresh(ticket, 'old-content'), false)
  assert.equal(s.markPreviewFresh(ticket, undefined), false)
  s.observeContent(1, 'new-content', false)
  assert.equal(s.markPreviewFresh(ticket, 'new-content'), false)
  assert.equal(s.markPreviewDegraded(1, ticket.settingsKey, 'new-content'), false)
  assert.equal(s.markPreviewDegraded(2, ticket.settingsKey, 'unfetched'), false)
})

test('源证据变化，即使设置和题号未变，旧响应与降级确认均失效', () => {
  const s = useUiStore.getState()
  s.observeContent(1, 'source-before', true)
  const ticket = s.beginPreview(1, '学生版', '考试', 'source-before')
  assert.equal(s.markPreviewFresh(ticket, 'source-before'), true)
  s.observeContent(1, 'source-after', true)
  assert.equal(s.isExportUnlocked(1), false)
  assert.equal(s.markPreviewFresh(ticket, 'source-before'), false)
  assert.equal(s.markPreviewDegraded(1, ticket.settingsKey, 'source-before'), false)
  assert.equal(s.markPreviewDegraded(1, ticket.settingsKey, 'source-after'), true)
})

const { buildBlocks, BlockView, toLines } = loadTs('src/components/livePreview/blocks.tsx')
const { computeLayout, imageDisplayPx } = loadTs('src/components/livePreview/spec.ts')
test('结构预览仅消费有序块，保留同资源跨分支的独立实例及TAB', () => {
  const content = [
    { kind: 'paragraph', branch: 'stem', text: '1．甲\t乙' },
    { kind: 'image', branch: 'stem', instance_id: 'same:p1:i0', url: '/stem.png', media_path: 'same.png', width: 20, height: 20 },
    { kind: 'paragraph', branch: 'answer', text: '锁定答案' },
    { kind: 'image', branch: 'answer', instance_id: 'same:p2:i0', url: '/answer.png', media_path: 'same.png', width: 20, height: 20 },
    { kind: 'paragraph', branch: 'analysis', text: '锁定解析' },
  ]
  const data = { paper: { title: '有序实例' }, sections: [{ section_id: 1, name: '一', questions: [{ item_id: 9, question_id: 20, seq: 1, score: 2, number: '1', content_status: 'ready', content_blocks: content, text: '不应猜读的正文【答案】错误答案', answer: '错误答案', images: [{ url: '/hidden.png' }], formulas: [] }] }] }
  const model = computeLayout('考试', 'A4')
  const q = buildBlocks(data, model, new Map()).find(b => b.kind === 'question')
  const html = renderToStaticMarkup(React.createElement(BlockView, { block: q, model }))
  assert.ok(html.indexOf('/stem.png') < html.indexOf('锁定答案'))
  assert.ok(html.indexOf('锁定答案') < html.indexOf('/answer.png'))
  assert.ok(html.indexOf('/answer.png') < html.indexOf('锁定解析'))
  assert.match(html, /same:p1:i0/)
  assert.match(html, /same:p2:i0/)
  assert.doesNotMatch(html, /hidden.png|错误答案|不应猜读/)
  assert.equal(toLines('甲\t乙')[0], '甲\t乙')
})

// P0-1：blocked 卡默认只给老师看「第几题 + 内容待核对 + 来源文件」，
// item / qid / scan index 等原始坐标藏到 debug 开关后；两种模式都不得泄漏原正文或图片。
test('blocked问题卡默认不泄漏技术坐标，debug下仍可定位item和来源坐标', () => {
  const model = computeLayout('作业', 'A4')
  const issue = { kind: 'answer_region_item', severity: 'warning', paper_id: 1, item_id: 113, seq: 5, question_id: 5542, question_version: 3, summary: '答案片段', message: '来源答案区', blocked_modes: [], source: { file_name: '来源.docx', start_scan_index: 5, end_scan_index: 6, body_paragraph_number: 8 }, suggested_action: '移除候选' }
  const q = buildBlocks({ paper: {}, sections: [{ name: '一', questions: [{ item_id: 113, question_id: 5542, seq: 5, score: null, content_status: 'blocked', content_blocks: [], text: '绝不展示', images: [{ url: '/secret.png' }], issues: [issue] }] }] }, model, new Map()).find(b => b.kind === 'question')
  // 默认（非 debug）：老师界面不得出现原始技术字段，也不泄漏原正文/图片。
  const html = renderToStaticMarkup(React.createElement(BlockView, { block: q, model }))
  assert.doesNotMatch(html, /item 113|qid 5542|scan index（0起）|body直属段号（1起）|instance_id/)
  assert.match(html, /来源\.docx/)
  assert.match(html, /内容待核对/)
  assert.doesNotMatch(html, /绝不展示|secret.png/)
  // debug（localStorage qb_debug=1）：维护者仍能定位 item 与来源坐标。
  global.localStorage.setItem('qb_debug', '1')
  const dbg = renderToStaticMarkup(React.createElement(BlockView, { block: q, model }))
  global.localStorage.removeItem('qb_debug')
  assert.match(dbg, /item 113/)
  assert.match(dbg, /qid 5542/)
  assert.match(dbg, /scan index（0起）/)
  assert.match(dbg, /body直属段号（1起）/)
  assert.doesNotMatch(dbg, /绝不展示|secret.png/)
})

test('可信源extent的小图不被最小图宽放大，比例保持', () => {
  const size = imageDisplayPx({ naturalW: 20, naturalH: 10, sourceWidthEmu: 180000, sourceHeightEmu: 90000 }, computeLayout('考试', 'A4'))
  assert.ok(size.widthPx <= 19)
  assert.equal(size.widthPx / size.heightPx, 2)
})


const { PageView } = loadTs('src/components/livePreview/PageView.tsx')
test('超长结构页自然增高，最后一段完整保留且不设置固定高度', () => {
  const model = computeLayout('考试', 'A4')
  const text = '长段落\n'.repeat(100) + '最后一段不可裁切'
  const q = buildBlocks({ paper: {}, sections: [{ name: '一', questions: [{ item_id: 1, question_id: 1, score: null, content_status: 'ready', content_blocks: [{ kind: 'paragraph', branch: 'stem', text }] }] }] }, model, new Map()).find(b => b.kind === 'question')
  const html = renderToStaticMarkup(React.createElement(PageView, { page: { blockIndices: [0], usedPx: 9999, overflow: true }, blocks: [q], model, pageNumber: 1, totalPages: 1, debug: false }))
  const pageStart = html.slice(0, html.indexOf('><div'))
  assert.match(pageStart, /min-height:/)
  assert.doesNotMatch(pageStart.replace(/min-height:[^;]+;/, ''), /height:/)
  assert.match(html, /最后一段不可裁切/)
})
