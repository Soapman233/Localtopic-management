/**
 * P3 验证脚本：在真实浏览器里加载**组卷工作台**（生产构建，由后端 :8720 静态托管），
 * 验证「强制预览门禁 + 排版视图编辑 + 视图记忆 + 检索 URL」。
 *
 * 前置：后端 :8720 已启动（`python -m webui`），且已 `npm run build`（webui/static）。
 * 用法：node tools/verify_builder_gate.mjs
 * 依赖：puppeteer-core（spike 已有）+ 本机 Chrome。**不新增前端依赖。**
 *
 * 验证要点（团队要求「门禁逐个动作各测一次，漏一个即漏洞」）：
 *  - 每个编辑动作前：打开导出抽屉 → 自动预览 → 门禁解锁（previewFresh=true）；
 *  - 执行动作后：断言 previewFresh=false 且 unlocked=false（**重新锁定**）。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = 'http://127.0.0.1:8720'
const BASE = `${ORIGIN}/#`
const OUT = 'tools'
const PID = 1 // 八年级物理·浮力与压强单元测验（10 题 / 2 大题）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const builderState = (page) => page.evaluate(() => window.__builder || null)

async function waitBuilder(page, expr, timeout = 30000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__builder
      if (!s) return false
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${body})`)(s)
    },
    { timeout, polling: 120 },
    expr,
  )
}
async function waitDrawer(page, expr, timeout = 90000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__exportDrawer
      if (!s) return false
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${body})`)(s)
    },
    { timeout, polling: 120 },
    expr,
  )
}

/** 启动：先加载一次页面，写入 localStorage（当前试卷 + 视图），再 reload 让 store 读到。
 *  注意：**不用** evaluateOnNewDocument——否则 reload 会再次覆盖 localStorage，破坏「视图记忆」验证。 */
async function boot(page, view, hash) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(
    ({ pid, v }) => {
      localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: pid, targetSectionId: null }, version: 0 }))
      localStorage.setItem('qb-ui-store', JSON.stringify({ state: { coverageDismissed: false, strictKp: false, expandedFilters: {}, exportFormats: { docx: true, pdf: false }, builderView: v }, version: 0 }))
    },
    { pid: PID, v: view },
  )
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
}

/** 全选（Ctrl+A）——puppeteer 需 down/up 组合。 */
async function selectAll(page) {
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
}

async function clickButton(page, text, scope = 'body') {
  const els = await page.$$(`${scope} button`)
  const want = text.replace(/\s+/g, '')
  for (const el of els) {
    const raw = await el.evaluate((e) => e.textContent || '')
    if (raw.replace(/\s+/g, '').trim() === want) {
      await el.click()
      return true
    }
  }
  return false
}
async function clickMenuItem(page, text) {
  await page.waitForSelector('li[role="menuitem"]', { timeout: 6000 })
  const items = await page.$$('li[role="menuitem"]')
  for (const it of items) {
    const raw = await it.evaluate((e) => e.textContent || '')
    if (raw.trim().includes(text)) {
      await it.click()
      return true
    }
  }
  throw new Error(`菜单项未找到：${text}`)
}

/** 打开导出抽屉 → 自动预览 → 门禁解锁 → Esc 关闭 → 等退场；返回解锁耗时。 */
async function ensureFresh(page) {
  const t0 = Date.now()
  await page.click('[data-testid="builder-export-button"]')
  await waitBuilder(page, 's.exportOpen === true', 10000)
  await waitDrawer(page, 's.unlocked === true', 90000)
  const ms = Date.now() - t0
  await page.keyboard.press('Escape')
  await waitBuilder(page, 's.exportOpen === false', 10000)
  await sleep(700) // 等 MUI 抽屉退场过渡结束（否则残留 backdrop 拦截点击）
  await waitBuilder(page, 's.previewFresh === true', 10000)
  return ms
}

async function assertRelocked(page, label, results) {
  await sleep(900)
  const s = await builderState(page)
  const ok = s && s.previewFresh === false && s.unlocked === false
  results[label] = { previewFresh: s?.previewFresh, unlocked: s?.unlocked, locked: ok }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: previewFresh=${s?.previewFresh} unlocked=${s?.unlocked}`)
  return ok
}

const results = {}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1600,1200'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('response', (r) => {
    if (r.status() >= 500) console.log('[http]', r.status(), r.url())
  })

  // ===================== 阶段 1：清单视图下逐个编辑动作 =====================
  console.log('\n=== 阶段 1：清单视图 · 逐个编辑动作 → 门禁重新锁定 ===')
  await boot(page, 'list', '/builder')
  await waitBuilder(page, 'true', 30000)
  console.log('  builderView =', (await builderState(page)).builderView)

  // A. 加题
  {
    const ms = await ensureFresh(page)
    const ok = await clickButton(page, '加入')
    const r = await assertRelocked(page, '加题（加入）', results)
    results['加题（加入）'].clicked = ok
    results['加题（加入）'].unlockMs = ms
  }
  // B. 设分
  {
    await ensureFresh(page)
    await page.click('[aria-label="条目菜单"]')
    await clickMenuItem(page, '设置分值')
    await page.waitForSelector('input[type="number"]', { timeout: 6000 })
    await page.click('input[type="number"]')
    await selectAll(page)
    await page.keyboard.press('Backspace')
    await page.type('input[type="number"]', '5')
    await clickButton(page, '确定', '.MuiDialog-root')
    await assertRelocked(page, '设分', results)
  }
  // C. 调序（下移）
  {
    await ensureFresh(page)
    await page.click('[aria-label="条目菜单"]')
    await clickMenuItem(page, '下移')
    await assertRelocked(page, '调序（下移）', results)
  }
  // D. 大题新增
  {
    await ensureFresh(page)
    await clickButton(page, '新增大题')
    await page.waitForSelector('.MuiDialog-root input', { timeout: 6000 })
    const inputs = await page.$$('.MuiDialog-root input')
    await inputs[inputs.length - 1].type('三、实验题')
    await clickButton(page, '确定', '.MuiDialog-root')
    await assertRelocked(page, '大题新增', results)
  }
  // E. 大题重命名
  {
    await ensureFresh(page)
    await page.click('[aria-label="重命名大题"]')
    await page.waitForSelector('.MuiDialog-root input', { timeout: 6000 })
    const inputs = await page.$$('.MuiDialog-root input')
    await inputs[inputs.length - 1].click()
    await selectAll(page)
    await inputs[inputs.length - 1].type('一、选择题（改）')
    await clickButton(page, '确定', '.MuiDialog-root')
    await assertRelocked(page, '大题重命名', results)
  }
  // F. 大题删除
  {
    await ensureFresh(page)
    await page.click('[aria-label="删除大题"]')
    await assertRelocked(page, '大题删除', results)
  }
  // G. 删题（清单菜单移除）
  {
    await ensureFresh(page)
    await page.click('[aria-label="条目菜单"]')
    await clickMenuItem(page, '移除')
    await assertRelocked(page, '删题', results)
  }

  // ===================== 阶段 2：排版视图内编辑 =====================
  console.log('\n=== 阶段 2：排版视图内编辑（改分 / 删除 + undo / 拖拽调序）===')
  await boot(page, 'layout', '/builder')
  await waitBuilder(page, 's.builderView === "layout"', 30000)
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.editable === true, { timeout: 60000 })
  await sleep(1200)
  const lp0 = await page.evaluate(() => window.__livePreview)
  console.log('  layout items =', lp0.itemIds?.length, 'pages =', lp0.pages, 'editable =', lp0.editable)
  await page.screenshot({ path: `${OUT}/_builder_layout_view.png` })

  // H. 改分
  {
    await ensureFresh(page)
    const before = await page.$eval('[data-testid="lp-score-chip"]', (e) => e.textContent.trim())
    await page.click('[data-testid="lp-score-chip"]')
    await page.waitForSelector('input[aria-label="分值"]', { timeout: 6000 })
    await page.click('input[aria-label="分值"]')
    await selectAll(page)
    await page.keyboard.press('Backspace')
    await page.type('input[aria-label="分值"]', '7')
    await page.keyboard.press('Enter')
    await sleep(900)
    const after = await page.$eval('[data-testid="lp-score-chip"]', (e) => e.textContent.trim())
    const ok = before !== after && after.includes('7')
    results['排版视图改分'] = { before, after, changed: ok }
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] 排版视图改分: ${before} → ${after}`)
    await assertRelocked(page, '排版视图改分(门禁)', results)
  }
  // I. 非法分值 → 红框
  {
    await page.click('[data-testid="lp-score-chip"]')
    await page.waitForSelector('input[aria-label="分值"]', { timeout: 6000 })
    await page.click('input[aria-label="分值"]')
    await selectAll(page)
    await page.keyboard.press('Backspace')
    await page.type('input[aria-label="分值"]', '99999')
    await sleep(300)
    const invalid = await page.$eval('input[aria-label="分值"]', (e) => e.classList.contains('lp-invalid'))
    results['非法分值红框'] = { invalid }
    console.log(`  [${invalid ? 'PASS' : 'FAIL'}] 非法分值红框提示: ${invalid}`)
    await page.keyboard.press('Escape')
    await sleep(200)
  }
  // J. 删除 + undo Toast
  {
    await ensureFresh(page)
    const before = (await builderState(page)).itemCount
    await page.click('[data-testid="lp-qdel"]')
    await sleep(1000)
    const afterDel = (await builderState(page)).itemCount
    const toastShown = await page.evaluate(() => document.body.innerText.includes('已移除第'))
    await page.screenshot({ path: `${OUT}/_builder_undo_toast.png` })
    await clickButton(page, '撤销')
    await sleep(1400)
    const afterUndo = (await builderState(page)).itemCount
    const ok = afterDel === before - 1 && toastShown && afterUndo === before
    results['排版视图删除+undo'] = { before, afterDel, afterUndo, toastShown, ok }
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] 删除+undo: ${before} → ${afterDel} → ${afterUndo}, toast=${toastShown}`)
    await assertRelocked(page, '排版视图删除(门禁)', results)
  }
  // K. 拖拽调序
  {
    await ensureFresh(page)
    const orderBefore = (await builderState(page)).orderedItemIds.slice()
    const handles = await page.$$('.lp-qhandle')
    console.log('  handles found =', handles.length)
    if (handles.length >= 2) {
      const b0 = await handles[0].boundingBox()
      const b1 = await handles[1].boundingBox()
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
      await page.mouse.down()
      await page.mouse.move(b0.x + b0.width / 2, b1.y + b1.height / 2 + 10, { steps: 15 })
      await sleep(200)
      await page.mouse.up()
      await sleep(1400)
    }
    const orderAfter = (await builderState(page)).orderedItemIds.slice()
    const changed = JSON.stringify(orderBefore) !== JSON.stringify(orderAfter)
    results['排版视图拖拽调序'] = { orderBefore, orderAfter, changed }
    console.log(`  [${changed ? 'PASS' : 'FAIL'}] 拖拽调序: ${JSON.stringify(orderBefore)} → ${JSON.stringify(orderAfter)}`)
    await page.screenshot({ path: `${OUT}/_builder_layout_edit.png` })
    await assertRelocked(page, '排版视图拖拽(门禁)', results)
  }

  // ===================== 阶段 3：视图切换记忆 =====================
  console.log('\n=== 阶段 3：视图切换记忆 ===')
  await boot(page, 'list', '/builder')
  await waitBuilder(page, 'true', 30000)
  const v1 = (await builderState(page)).builderView
  await page.click('[data-testid="view-layout"]')
  await sleep(700)
  const v2 = (await builderState(page)).builderView
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }) // 不重新 seed
  await waitBuilder(page, 'true', 30000)
  const v3 = (await builderState(page)).builderView
  const ok = v1 === 'list' && v2 === 'layout' && v3 === 'layout'
  results['视图记忆'] = { initial: v1, afterSwitch: v2, afterReload: v3, ok }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] 视图记忆: 初始=${v1} 切换后=${v2} 刷新后=${v3}`)

  // ===================== 阶段 4：检索页 URL 同步 =====================
  console.log('\n=== 阶段 4：检索条件写入 URL ===')
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(900)
  const kwInput = await page.$('input[placeholder*="搜索题干关键词"]')
  await kwInput.click()
  await kwInput.type('浮力')
  await sleep(1200)
  const url1 = page.url()
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(900)
  const url2 = page.url()
  const kwAfter = await page.$eval('input[placeholder*="搜索题干关键词"]', (e) => e.value)
  const kwInUrl = url1.includes('keyword') && decodeURIComponent(url1).includes('浮力')
  const urlOk = kwInUrl && kwAfter === '浮力' && url2.includes('keyword')
  results['检索URL'] = { url1, url2, kwAfter, kwInUrl, reloadKept: url2.includes('keyword'), ok: urlOk }
  console.log(`  [${urlOk ? 'PASS' : 'FAIL'}] 检索URL: 含keyword=${kwInUrl} 刷新后输入框=${kwAfter}`)

  console.log('\n=== 结果汇总 ===')
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
