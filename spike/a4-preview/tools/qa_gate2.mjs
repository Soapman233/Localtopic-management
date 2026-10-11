/**
 * QA(严过关) 独立验收 —— 补充：排版拖拽门禁 / 刷新快照门禁 / 抽屉过期处理。
 * 前置：DB 副本中 questions.id=3759 的 version 已被外部 +1（制造 stale）。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:8720/#'
const OUT = '../../.qa_edward/final_verify'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bstate = (p) => p.evaluate(() => window.__builder || null)
const dstate = (p) => p.evaluate(() => window.__exportDrawer || null)

async function waitBuilder(page, expr, timeout = 60000) {
  await page.waitForFunction((body) => {
    const s = window.__builder; if (!s) return false
    return new Function('s', `return (${body})`)(s) // eslint-disable-line
  }, { timeout, polling: 100 }, expr)
}
async function waitDrawer(page, expr, timeout = 90000) {
  await page.waitForFunction((body) => {
    const s = window.__exportDrawer; if (!s) return false
    return new Function('s', `return (${body})`)(s) // eslint-disable-line
  }, { timeout, polling: 100 }, expr)
}
async function boot(page, view) {
  await page.goto(`${BASE}/builder`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate((v) => {
    localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: 1, targetSectionId: null }, version: 0 }))
    localStorage.setItem('qb-ui-store', JSON.stringify({ state: { coverageDismissed: false, strictKp: false, expandedFilters: {}, exportFormats: { docx: true, pdf: false }, builderView: v }, version: 0 }))
  }, view)
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
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
async function ensureFresh(page) {
  await page.click('[data-testid="builder-export-button"]')
  await waitBuilder(page, 's.exportOpen === true', 10000)
  await waitDrawer(page, 's.unlocked === true', 120000)
  await page.keyboard.press('Escape')
  await waitBuilder(page, 's.exportOpen === false', 10000)
  await sleep(650)
  await waitBuilder(page, 's.previewFresh === true', 10000)
}
async function locked(page, label) {
  await sleep(900)
  const s = await bstate(page)
  const ok = Boolean(s && s.previewFresh === false && s.unlocked === false)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: previewFresh=${s?.previewFresh} unlocked=${s?.unlocked}`)
  return { previewFresh: s?.previewFresh, unlocked: s?.unlocked, locked: ok }
}
const R = {}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1700,1200'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  // ---- 刷新快照门禁（清单视图，item 已 stale）----
  console.log('\n=== 刷新快照门禁 ===')
  await boot(page, 'list')
  await waitBuilder(page, 'true', 30000)
  await sleep(1200)
  const staleAlert = await page.evaluate(() => document.body.innerText.includes('本卷仍用加入时的版本'))
  const hasRefresh = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '刷新'))
  console.log(`  stale 提示出现=${staleAlert} 「刷新」按钮存在=${hasRefresh}`)
  if (hasRefresh) {
    await ensureFresh(page)
    await clickButton(page, '刷新')
    R['刷新快照门禁'] = await locked(page, '刷新快照')
  } else {
    R['刷新快照门禁'] = { skipped: true, reason: 'no stale item / no UI entry', staleAlert }
  }

  // ---- 排版视图拖拽门禁 ----
  console.log('\n=== 排版视图拖拽门禁 ===')
  await boot(page, 'layout')
  await waitBuilder(page, 's.builderView === "layout"', 30000)
  await page.waitForFunction(() => window.__livePreview && window.__livePreview.editable === true, { timeout: 60000 })
  await sleep(1000)
  await ensureFresh(page)
  {
    const before = (await bstate(page)).orderedItemIds.slice()
    const handles = await page.$$('.lp-qhandle')
    if (handles.length >= 2) {
      const b0 = await handles[0].boundingBox(); const b1 = await handles[1].boundingBox()
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
      await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2, b1.y + b1.height / 2 + 12, { steps: 18 })
      await sleep(200); await page.mouse.up(); await sleep(1400)
    }
    const after = (await bstate(page)).orderedItemIds.slice()
    const changed = JSON.stringify(before) !== JSON.stringify(after)
    console.log(`  拖拽前=${JSON.stringify(before)} 后=${JSON.stringify(after)} 变化=${changed}`)
    const lock = await locked(page, '排版拖拽门禁')
    R['排版拖拽门禁'] = { orderChanged: changed, ...lock }
  }

  // ---- 抽屉过期处理 ----
  console.log('\n=== 抽屉过期处理（改模板）===')
  await boot(page, 'layout')
  await waitBuilder(page, 'true', 30000)
  await page.click('[data-testid="builder-export-button"]')
  await waitBuilder(page, 's.exportOpen === true', 10000)
  await waitDrawer(page, 's.unlocked === true', 120000)
  const s0 = await dstate(page)
  const pagesBefore = s0.pages
  // 读取当前模板并改为另一个
  const cur = await page.$eval('[data-testid="export-template"] [role="combobox"]', (e) => e.textContent.trim())
  const next = cur === '考试' ? '测验' : '考试'
  await page.click('[data-testid="export-template"] [role="combobox"]')
  await page.waitForSelector('li[role="option"]', { timeout: 6000 })
  const opts = await page.$$('li[role="option"]')
  for (const o of opts) { const t = (await o.evaluate((e) => e.textContent.trim())); if (t === next) { await o.click(); break } }
  await sleep(500)
  const s1 = await dstate(page)
  const banner = await page.evaluate(() => document.body.innerText.includes('此为旧版本预览'))
  const domDisabled = await page.$eval('[data-testid="export-button"]', (b) => b.disabled)
  console.log(`  改模板 ${cur}→${next}: unlocked=${s1.unlocked} 旧图=${s1.pages}/${pagesBefore} 过期横幅=${banner} 按钮disabled=${domDisabled}`)
  await waitDrawer(page, 's.unlocked === true', 120000)
  const s2 = await dstate(page)
  const bannerGone = !(await page.evaluate(() => document.body.innerText.includes('此为旧版本预览')))
  R['抽屉过期处理'] = { from: cur, to: next, lockedAfter: s1.unlocked === false, pagesKept: s1.pages, pagesBefore, staleBanner: banner, exportDisabled_dom: domDisabled, regenUnlocked: s2.unlocked, regenPages: s2.pages, bannerGone }
  console.log(`  [${s1.unlocked === false && banner && domDisabled ? 'PASS' : 'FAIL'}] 过期处理；重生成后 unlocked=${s2.unlocked} pages=${s2.pages} 横幅消失=${bannerGone}`)

  console.log('\n=== 结果汇总 ===')
  console.log(JSON.stringify(R, null, 2))
} finally {
  await browser.close()
}
