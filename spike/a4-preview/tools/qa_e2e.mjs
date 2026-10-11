/**
 * QA(严过关) 独立验收 —— 端到端流程 + 结构预览准确性 + 降级门禁。
 * 生产构建（后端 :8720 托管，DB 为**全新副本**）。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = 'http://127.0.0.1:8720'
const BASE = `${ORIGIN}/#`
const OUT = '../../.qa_edward/final_verify'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bstate = (p) => p.evaluate(() => window.__builder || null)
const dstate = (p) => p.evaluate(() => window.__exportDrawer || null)
const lstate = (p) => p.evaluate(() => window.__livePreview || null)

async function waitFn(page, expr, timeout = 60000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__builder || window.__exportDrawer || window.__livePreview
      if (!s) return false
      return new Function('s', `return (${body})`)(s) // eslint-disable-line
    },
    { timeout, polling: 100 }, expr,
  )
}
async function seed(page, view) {
  await page.evaluate(
    ({ pid, v }) => {
      localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: pid, targetSectionId: null }, version: 0 }))
      localStorage.setItem('qb-ui-store', JSON.stringify({ state: { coverageDismissed: false, strictKp: false, expandedFilters: {}, exportFormats: { docx: true, pdf: false }, builderView: v }, version: 0 }))
    }, { pid: 1, v: view },
  )
}
async function clickButton(page, text, scope = 'body') {
  const els = await page.$$(`${scope} button`)
  const want = text.replace(/\s+/g, '')
  for (const el of els) {
    const raw = await el.evaluate((e) => e.textContent || '')
    if (raw.replace(/\s+/g, '').trim() === want) { await el.click(); return true }
  }
  return false
}
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
      throw new Error('option not found ' + toText)
    }
  }
  throw new Error('combobox not found ' + fromText)
}

const R = {}
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1700,1200'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  // ===================== 4. 结构预览准确性（paper 1 原始内容）=====================
  console.log('\n=== 4. 结构预览准确性（学生版 / 答案解析版）===')
  await page.goto(`${BASE}/builder`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await seed(page, 'layout')
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.ready === true, { timeout: 60000 })
  await sleep(1200)
  let lp = await lstate(page)
  R['结构预览-学生版'] = { pages: lp.pages, overflowPages: lp.overflowPages, questions: lp.questions, answerMode: lp.answerMode, katex: await page.$$eval('.katex', (e) => e.length), imgs: await page.$$eval('img', (e) => e.length), fontsReady: lp.fontsReady, imagesReady: lp.imagesReady }
  console.log(`  学生版: pages=${lp.pages} overflow=${lp.overflowPages} 题=${lp.questions} KaTeX=${R['结构预览-学生版'].katex} img=${R['结构预览-学生版'].imgs} fonts=${lp.fontsReady} imgsReady=${lp.imagesReady}`)
  R['结构预览-学生版-断页'] = lp.pageSummary.map((p) => ({ page: p.page, first: p.firstQuestion, used: p.usedPx }))

  // 切清单视图 → 改答案模式为 答案解析版 → 回排版视图
  await page.click('[data-testid="view-list"]')
  await sleep(600)
  await selectCombo(page, '学生版', '答案解析版')
  await sleep(600)
  await page.click('[data-testid="view-layout"]')
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.ready === true, { timeout: 60000 })
  await sleep(1200)
  lp = await lstate(page)
  R['结构预览-答案解析版'] = { pages: lp.pages, overflowPages: lp.overflowPages, answerMode: lp.answerMode }
  console.log(`  答案解析版: pages=${lp.pages} overflow=${lp.overflowPages} answerMode=${lp.answerMode}`)
  // 复位为学生版
  await page.click('[data-testid="view-list"]')
  await sleep(500)
  await selectCombo(page, '答案解析版', '学生版')
  await sleep(400)

  // ===================== 1-2. 检索页：加入入口 + URL =====================
  console.log('\n=== 1-2. 检索页：加入入口 + 检索条件写入 URL ===')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(800)
  const kw = await page.$('input[placeholder*="搜索题干关键词"]')
  await kw.click(); await kw.type('浮力')
  await sleep(1200)
  const url1 = page.url()
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1000)
  const url2 = page.url()
  const kwAfter = await page.$eval('input[placeholder*="搜索题干关键词"]', (e) => e.value)
  R['检索URL'] = { url1, url2, kwAfter, urlHasKeyword: decodeURIComponent(url1).includes('浮力'), reloadKept: url2.includes('keyword'), ok: decodeURIComponent(url1).includes('浮力') && kwAfter === '浮力' }
  console.log(`  [${R['检索URL'].ok ? 'PASS' : 'FAIL'}] URL含keyword=${R['检索URL'].urlHasKeyword} 刷新后输入框="${kwAfter}"`)

  // 点第一张卡的「加入」
  await clickButton(page, '加入')
  await sleep(1000)
  // 无当前试卷 → 弹选择对话框，选现有试卷 #1
  const picked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.MuiDialog-root button')]
    const b = btns.find((x) => x.textContent.includes('八年级物理'))
    if (b) { b.click(); return true }
    return false
  })
  if (!picked) { console.log('  [warn] 未找到试卷选择项，尝试新建'); await page.evaluate(() => { const i = document.querySelector('.MuiDialog-root input'); if (i) i.value = 'QA临时卷' }) }
  await sleep(1500)
  const joined = await page.evaluate(() => document.body.innerText.includes('已加入'))
  const goEntry = await page.$('[data-testid="go-to-paper"]')
  R['加入入口'] = { dialogPicked: picked, joined, entryShown: Boolean(goEntry), entryText: goEntry ? (await goEntry.evaluate((e) => e.textContent.trim())) : null }
  console.log(`  [${goEntry ? 'PASS' : 'FAIL'}] 加入后入口: joined=${joined} 入口="${R['加入入口'].entryText}"`)

  // ===================== 3. 进组卷页：默认排版视图 + 结构预览内容 =====================
  console.log('\n=== 3. 组卷页：默认视图 + 结构预览 ===')
  if (goEntry) await goEntry.click()
  else await page.goto(`${BASE}/builder`, { waitUntil: 'networkidle2', timeout: 60000 })
  await waitFn(page, 'true', 30000)
  await sleep(1500)
  const b0 = await bstate(page)
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.ready === true, { timeout: 60000 })
  await sleep(800)
  const lpB = await lstate(page)
  R['组卷页'] = { defaultView: b0.builderView, itemCount: b0.itemCount, lpQuestions: lpB.questions, lpPages: lpB.pages, katex: await page.$$eval('.katex', (e) => e.length), imgs: await page.$$eval('img', (e) => e.length) }
  console.log(`  默认视图=${b0.builderView} 题数=${b0.itemCount} 结构预览题=${lpB.questions} KaTeX=${R['组卷页'].katex} img=${R['组卷页'].imgs}`)

  // ===================== 4'. 排版视图内编辑可用 =====================
  console.log('\n=== 4\'. 排版视图内 拖拽/改分/删除 可用 ===')
  {
    const orderBefore = (await bstate(page)).orderedItemIds.slice()
    const handles = await page.$$('.lp-qhandle')
    if (handles.length >= 2) {
      const b0x = await handles[0].boundingBox(); const b1x = await handles[1].boundingBox()
      await page.mouse.move(b0x.x + b0x.width / 2, b0x.y + b0x.height / 2)
      await page.mouse.down(); await page.mouse.move(b0x.x + b0x.width / 2, b1x.y + b1x.height / 2 + 12, { steps: 18 })
      await sleep(200); await page.mouse.up(); await sleep(1400)
    }
    const orderAfter = (await bstate(page)).orderedItemIds.slice()
    const chip = await page.$eval('[data-testid="lp-score-chip"]', (e) => e.textContent.trim())
    await page.click('[data-testid="lp-score-chip"]')
    await page.waitForSelector('input[aria-label="分值"]', { timeout: 6000 })
    await page.click('input[aria-label="分值"]')
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
    await page.keyboard.press('Backspace'); await page.type('input[aria-label="分值"]', '4'); await page.keyboard.press('Enter')
    await sleep(1200)
    const chip2 = await page.$eval('[data-testid="lp-score-chip"]', (e) => e.textContent.trim())
    const n0 = (await bstate(page)).itemCount
    await page.click('[data-testid="lp-qdel"]'); await sleep(1200)
    const n1 = (await bstate(page)).itemCount
    R['排版编辑'] = { dragChanged: JSON.stringify(orderBefore) !== JSON.stringify(orderAfter), scoreBefore: chip, scoreAfter: chip2, delBefore: n0, delAfter: n1 }
    console.log(`  拖拽改序=${R['排版编辑'].dragChanged} 改分=${chip}→${chip2} 删除=${n0}→${n1}`)
  }

  // ===================== 5. 视图记忆 =====================
  console.log('\n=== 5. 视图切换记忆 ===')
  await page.click('[data-testid="view-list"]'); await sleep(700)
  const v1 = (await bstate(page)).builderView
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await waitFn(page, 'true', 30000); await sleep(800)
  const v2 = (await bstate(page)).builderView
  R['视图记忆'] = { afterSwitch: v1, afterReload: v2, ok: v1 === 'list' && v2 === 'list' }
  console.log(`  [${R['视图记忆'].ok ? 'PASS' : 'FAIL'}] 切换后=${v1} 刷新后=${v2}`)

  // ===================== 6-7. 导出：自动预览 → 解锁 → 导出产物 =====================
  console.log('\n=== 6-7. 导出抽屉：自动预览解锁 → 导出产物 ===')
  {
    // 先制造内容变更（加题），使预览为**未命中缓存** → 测量真实未命中耗时
    await page.click('[data-testid="view-layout"]'); await sleep(800)
    const t0 = Date.now()
    await page.click('[data-testid="builder-export-button"]')
    await waitFn(page, 'window.__builder && window.__builder.exportOpen === true', 10000)
    // 捕获抽屉刚打开、预览未完成时的按钮状态
    let sawLocked = false
    try {
      await page.waitForFunction(() => window.__exportDrawer && window.__exportDrawer.unlocked === false, { timeout: 4000, polling: 50 })
      sawLocked = true
    } catch { /* 可能瞬间解锁 */ }
    const lockedDom = sawLocked ? await page.$eval('[data-testid="export-button"]', (b) => b.disabled) : null
    await waitFn(page, 'window.__exportDrawer && window.__exportDrawer.unlocked === true', 120000)
    const unlockMs = Date.now() - t0
    const d = await dstate(page)
    R['导出抽屉'] = { sawLockedBeforeUnlock: sawLocked, lockedDomDisabled: lockedDom, unlockMs, previewCached: d.previewCached, pages: d.pages, exportDisabled_state: d.exportDisabled }
    console.log(`  [${d.unlocked ? 'PASS' : 'FAIL'}] 预览解锁: 未完成时locked=${sawLocked} 解锁耗时=${unlockMs}ms cached=${d.previewCached} pages=${d.pages}`)
    // 点导出（DOCX）
    await page.click('[data-testid="export-button"]')
    await page.waitForFunction(() => window.__exportDrawer && window.__exportDrawer.exportStatus === 'done', { timeout: 120000 })
    const de = await dstate(page)
    R['导出产物'] = { status: de.exportStatus, docx: de.exportResult?.docx ?? null, docx_bytes: de.exportResult?.docx_size_bytes ?? null, pdf: de.exportResult?.pdf ?? null, pageCount: de.exportResult?.page_count ?? null, warnings: de.exportResult?.warnings ?? null }
    console.log(`  导出: status=${de.exportStatus} docx=${de.exportResult?.docx} (${de.exportResult?.docx_size_bytes} B) page_count=${de.exportResult?.page_count}`)
    await page.keyboard.press('Escape'); await sleep(700)
  }

  // ===================== C. 降级门禁（拦截 preview 制造环境失败）=====================
  console.log('\n=== C. 降级门禁（模拟无 Word/WPS）===')
  {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/preview$/.test(req.url())) {
        req.respond({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: 50001, message: '未检测到 Microsoft Word / WPS：无法生成 PDF，像素级预览不可用。可改用「导出 DOCX」，或安装 Word/WPS 后重试。', data: null }),
        })
      } else { req.continue() }
    })
    await page.goto(`${BASE}/builder`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await seed(page, 'layout')
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
    await waitFn(page, 'true', 30000)
    await page.click('[data-testid="builder-export-button"]')
    await waitFn(page, 'window.__exportDrawer && window.__exportDrawer.envFail === "office"', 30000)
    const dg = await dstate(page)
    const notice = await page.evaluate(() => document.body.innerText.includes('已降级为「结构预览确认」'))
    const structShown = await page.evaluate(() => document.body.innerText.includes('八年级物理'))
    const disabledBefore = await page.$eval('[data-testid="export-button"]', (b) => b.disabled)
    R['降级-识别'] = { envFail: dg.envFail, unlockedBeforeConfirm: dg.unlocked, notice, structShown, exportDisabled_before: disabledBefore }
    console.log(`  [${dg.envFail === 'office' && notice ? 'PASS' : 'FAIL'}] 识别环境失败: envFail=${dg.envFail} 提示=${notice} 结构预览=${structShown} 按钮disabled=${disabledBefore}`)
    await page.click('[data-testid="confirm-degraded"]')
    await page.waitForFunction(() => window.__exportDrawer && window.__exportDrawer.degradedOk === true, { timeout: 15000 })
    const dg2 = await dstate(page)
    const enabledAfter = !(await page.$eval('[data-testid="export-button"]', (b) => b.disabled))
    R['降级-解锁'] = { unlocked: dg2.unlocked, degradedOk: dg2.degradedOk, exportEnabled_after: enabledAfter }
    console.log(`  [${dg2.unlocked && enabledAfter ? 'PASS' : 'FAIL'}] 确认后解锁: unlocked=${dg2.unlocked} 导出按钮可点=${enabledAfter}`)
    await page.click('[data-testid="export-button"]')
    await page.waitForFunction(() => window.__exportDrawer && window.__exportDrawer.exportStatus === 'done', { timeout: 120000 })
    const dg3 = await dstate(page)
    R['降级-导出DOCX'] = { status: dg3.exportStatus, docx: dg3.exportResult?.docx ?? null, bytes: dg3.exportResult?.docx_size_bytes ?? null, warnings: dg3.exportResult?.warnings ?? null }
    console.log(`  [${dg3.exportResult?.docx ? 'PASS' : 'FAIL'}] 降级后导出: docx=${dg3.exportResult?.docx} (${dg3.exportResult?.docx_size_bytes} B)`)
    await page.setRequestInterception(false)
  }

  console.log('\n=== 结果汇总 ===')
  console.log(JSON.stringify(R, null, 2))
} finally {
  await browser.close()
}
