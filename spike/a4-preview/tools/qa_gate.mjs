/**
 * QA(严过关) 独立验收 —— 强制预览门禁（逐个编辑动作）。
 *
 * 与工程师脚本无关，独立编写。驱动**生产构建**（后端 :8720 托管，DB 为副本）。
 * 判定：编辑动作执行后 `window.__builder.previewFresh===false && unlocked===false`
 *   ⟺ 导出按钮 disabled（exportDisabled 由 unlocked 派生，见 ExportDrawer 源码）。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = 'http://127.0.0.1:8720'
const BASE = `${ORIGIN}/#`
const OUT = '../../.qa_edward/final_verify'
const PID = 1

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bstate = (p) => p.evaluate(() => window.__builder || null)
const dstate = (p) => p.evaluate(() => window.__exportDrawer || null)

async function waitBuilder(page, expr, timeout = 30000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__builder
      if (!s) return false
      return new Function('s', `return (${body})`)(s) // eslint-disable-line
    },
    { timeout, polling: 100 },
    expr,
  )
}
async function waitDrawer(page, expr, timeout = 90000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__exportDrawer
      if (!s) return false
      return new Function('s', `return (${body})`)(s) // eslint-disable-line
    },
    { timeout, polling: 100 },
    expr,
  )
}

async function boot(page, view, hash) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(
    ({ pid, v }) => {
      localStorage.setItem(
        'qb-paper-store',
        JSON.stringify({ state: { currentPaperId: pid, targetSectionId: null }, version: 0 }),
      )
      localStorage.setItem(
        'qb-ui-store',
        JSON.stringify({
          state: {
            coverageDismissed: false, strictKp: false, expandedFilters: {},
            exportFormats: { docx: true, pdf: false }, builderView: v,
          }, version: 0,
        }),
      )
    },
    { pid: PID, v: view },
  )
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
}

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

/** 通过当前显示文本定位 MUI Select 并选择目标项。 */
async function selectCombo(page, fromText, toText) {
  const combos = await page.$$('[role="combobox"]')
  for (const c of combos) {
    const t = (await c.evaluate((e) => (e.textContent || '').trim()))
    if (t === fromText) {
      await c.click()
      await page.waitForSelector('li[role="option"]', { timeout: 6000 })
      const opts = await page.$$('li[role="option"]')
      for (const o of opts) {
        const ot = (await o.evaluate((e) => (e.textContent || '').trim()))
        if (ot === toText) { await o.click(); return true }
      }
      throw new Error(`选项未找到：${toText}`)
    }
  }
  throw new Error(`combobox 未找到（当前文本）：${fromText}`)
}

async function ensureFresh(page) {
  const t0 = Date.now()
  await page.click('[data-testid="builder-export-button"]')
  await waitBuilder(page, 's.exportOpen === true', 10000)
  await waitDrawer(page, 's.unlocked === true', 90000)
  const ms = Date.now() - t0
  await page.keyboard.press('Escape')
  await waitBuilder(page, 's.exportOpen === false', 10000)
  await sleep(650)
  await waitBuilder(page, 's.previewFresh === true', 10000)
  return ms
}

const results = {}
async function locked(page, label) {
  await sleep(800)
  const s = await bstate(page)
  const ok = Boolean(s && s.previewFresh === false && s.unlocked === false)
  results[label] = { previewFresh: s?.previewFresh, unlocked: s?.unlocked, locked: ok }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: previewFresh=${s?.previewFresh} unlocked=${s?.unlocked}`)
  return ok
}
async function runAction(page, label, fn) {
  try {
    await ensureFresh(page)
    await fn()
    await locked(page, label)
  } catch (e) {
    results[label] = { error: String(e.message || e) }
    console.log(`  [ERROR] ${label}: ${e.message || e}`)
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1700,1200'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  // ============ 阶段 1：清单视图 · 10 个内容变更动作 ============
  console.log('\n=== 阶段 1：清单视图 · 编辑动作 → 门禁重新锁定 ===')
  await boot(page, 'list', '/builder')
  await waitBuilder(page, 'true', 30000)
  console.log('  builderView =', (await bstate(page)).builderView, 'items =', (await bstate(page)).itemCount)

  await runAction(page, '加题', async () => { await clickButton(page, '加入') })
  await runAction(page, '设分', async () => {
    await page.click('[aria-label="条目菜单"]')
    await clickMenuItem(page, '设置分值')
    await page.waitForSelector('input[type="number"]', { timeout: 6000 })
    await page.click('input[type="number"]')
    await selectAll(page); await page.keyboard.press('Backspace')
    await page.type('input[type="number"]', '5')
    await clickButton(page, '确定', '.MuiDialog-root')
  })
  await runAction(page, '调序-下移', async () => {
    await page.click('[aria-label="条目菜单"]'); await clickMenuItem(page, '下移')
  })
  await runAction(page, '调序-上移', async () => {
    const menus = await page.$$('[aria-label="条目菜单"]')
    await menus[1].click(); await clickMenuItem(page, '上移')
  })
  await runAction(page, '大题新增', async () => {
    await clickButton(page, '新增大题')
    await page.waitForSelector('.MuiDialog-root input', { timeout: 6000 })
    const inputs = await page.$$('.MuiDialog-root input')
    await inputs[inputs.length - 1].type('三、QA实验题')
    await clickButton(page, '确定', '.MuiDialog-root')
  })
  await runAction(page, '大题重命名', async () => {
    await page.click('[aria-label="重命名大题"]')
    await page.waitForSelector('.MuiDialog-root input', { timeout: 6000 })
    const inputs = await page.$$('.MuiDialog-root input')
    await inputs[inputs.length - 1].click(); await selectAll(page)
    await inputs[inputs.length - 1].type('一、QA改名')
    await clickButton(page, '确定', '.MuiDialog-root')
  })
  await runAction(page, '大题删除', async () => { await page.click('[aria-label="删除大题"]') })
  await runAction(page, '删题', async () => {
    await page.click('[aria-label="条目菜单"]'); await clickMenuItem(page, '移除')
  })
  await runAction(page, '改试卷模板(考试→测验)', async () => { await selectCombo(page, '考试', '测验') })
  await runAction(page, '改答案模式(学生版→答案解析版)', async () => { await selectCombo(page, '学生版', '答案解析版') })

  // ============ 阶段 2：排版视图 · 3 个编辑动作 ============
  console.log('\n=== 阶段 2：排版视图 · 编辑动作 → 门禁重新锁定 ===')
  await boot(page, 'layout', '/builder')
  await waitBuilder(page, 's.builderView === "layout"', 30000)
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.editable === true, { timeout: 60000 })
  await sleep(1000)
  const lp = await page.evaluate(() => window.__livePreview)
  console.log('  排版视图 items =', lp.itemIds?.length, 'pages =', lp.pages, 'editable =', lp.editable)

  await runAction(page, '排版-改分', async () => {
    await page.click('[data-testid="lp-score-chip"]')
    await page.waitForSelector('input[aria-label="分值"]', { timeout: 6000 })
    await page.click('input[aria-label="分值"]')
    await selectAll(page); await page.keyboard.press('Backspace')
    await page.type('input[aria-label="分值"]', '9')
    await page.keyboard.press('Enter')
  })
  await runAction(page, '排版-删除', async () => { await page.click('[data-testid="lp-qdel"]') })
  await runAction(page, '排版-拖拽调序', async () => {
    const before = (await bstate(page)).orderedItemIds.slice()
    const handles = await page.$$('.lp-qhandle')
    if (handles.length >= 2) {
      const b0 = await handles[0].boundingBox()
      const b1 = await handles[1].boundingBox()
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
      await page.mouse.down()
      await page.mouse.move(b0.x + b0.width / 2, b1.y + b1.height / 2 + 12, { steps: 18 })
      await sleep(200); await page.mouse.up(); await sleep(1200)
    }
    const after = (await bstate(page)).orderedItemIds.slice()
    results['排版-拖拽调序'].orderChanged = JSON.stringify(before) !== JSON.stringify(after)
    console.log('    拖拽前后 =', JSON.stringify(before), '→', JSON.stringify(after))
  })

  // ============ 阶段 3：抽屉行为（未预览 disabled / 缓存命中 / 过期）============
  console.log('\n=== 阶段 3：抽屉门禁其余行为 ===')
  // 3.1 未预览时导出按钮 disabled（拦截 preview 延迟 4s，制造稳定未完成窗口）
  {
    await page.setRequestInterception(true)
    let delay = true
    page.on('request', async (req) => {
      if (delay && req.method() === 'POST' && /\/preview$/.test(req.url())) {
        await sleep(4000)
      }
      try { await req.continue() } catch { /* already handled */ }
    })
    await boot(page, 'layout', '/builder')
    await waitBuilder(page, 'true', 30000)
    await page.click('[data-testid="builder-export-button"]')
    await waitBuilder(page, 's.exportOpen === true', 10000)
    await waitDrawer(page, 's.previewing === true', 15000)
    const mid = await dstate(page)
    const domDisabled = await page.$eval('[data-testid="export-button"]', (b) => b.disabled)
    results['未预览-导出按钮disabled'] = { unlocked: mid.unlocked, previewing: mid.previewing, exportDisabled_state: mid.exportDisabled, exportDisabled_dom: domDisabled }
    console.log(`  [${domDisabled && mid.unlocked === false ? 'PASS' : 'FAIL'}] 未预览: unlocked=${mid.unlocked} previewing=${mid.previewing} domDisabled=${domDisabled}`)
    await waitDrawer(page, 's.unlocked === true', 90000)
    await page.keyboard.press('Escape')
    await waitBuilder(page, 's.exportOpen === false', 10000)
    await sleep(650)
    delay = false
    await page.setRequestInterception(false)
  }
  // 3.2 缓存命中耗时（同内容再开抽屉）
  {
    const t0 = Date.now()
    await page.click('[data-testid="builder-export-button"]')
    await waitBuilder(page, 's.exportOpen === true', 10000)
    await waitDrawer(page, 's.unlocked === true', 90000)
    const ms = Date.now() - t0
    const s = await dstate(page)
    results['缓存命中-解锁耗时ms'] = { ms, previewCached: s.previewCached, pages: s.pages }
    console.log(`  缓存命中解锁耗时 = ${ms}ms（cached=${s.previewCached}, pages=${s.pages}）`)
    // 3.3 过期处理：抽屉内改模板 → 旧图保留 + 过期横幅 + 锁定
    const pagesBefore = s.pages
    await selectCombo(page, '考试', '测验')
    await sleep(500)
    const stale = await dstate(page)
    const staleBanner = await page.evaluate(() => document.body.innerText.includes('此为旧版本预览'))
    const domDisabled = await page.$eval('[data-testid="export-button"]', (b) => b.disabled)
    results['过期处理'] = { unlocked: stale.unlocked, pagesKept: stale.pages, pagesBefore, staleBanner, exportDisabled_dom: domDisabled, previewing: stale.previewing }
    console.log(`  [${stale.unlocked === false && staleBanner ? 'PASS' : 'FAIL'}] 过期: unlocked=${stale.unlocked} 旧图保留=${stale.pages}/${pagesBefore} 横幅=${staleBanner} 按钮disabled=${domDisabled}`)
    await waitDrawer(page, 's.unlocked === true', 90000)
    const regen = await dstate(page)
    results['过期后自动重生成'] = { unlocked: regen.unlocked, pages: regen.pages, staleBannerGone: !(await page.evaluate(() => document.body.innerText.includes('此为旧版本预览'))) }
    console.log(`  自动重生成后: unlocked=${regen.unlocked} pages=${regen.pages}`)
    await page.keyboard.press('Escape')
    await waitBuilder(page, 's.exportOpen === false', 10000)
  }

  console.log('\n=== 结果汇总 ===')
  console.log(JSON.stringify(results, null, 2))
  await page.screenshot({ path: `${OUT}/qa_gate_final.png` })
} finally {
  await browser.close()
}
