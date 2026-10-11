/**
 * P3 附加验证：导出页（全屏预览 / 导出中心）与抽屉**共用同一份 uiStore 门禁**。
 * 前置：后端 :8720 已启动（生产构建）。
 * 用法：node tools/_verify_export_page.mjs
 */
import puppeteer from 'puppeteer-core'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = 'http://127.0.0.1:8720'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1500,1100'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1100 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${ORIGIN}/#/export?paper_id=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: 1, targetSectionId: null }, version: 0 })))
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1500)

  const read = () =>
    page.evaluate(() => {
      const btn = document.querySelector('[data-testid="export-page-export-button"]')
      const txt = document.body.innerText
      return {
        btnDisabled: btn ? btn.disabled : null,
        lockedChip: txt.includes('导出已锁定'),
        unlockedChip: txt.includes('门禁已解锁'),
        staleBanner: txt.includes('此为旧版本预览'),
      }
    })

  const before = await read()
  console.log('初始（未预览）:', JSON.stringify(before))

  // 点击「生成预览」
  const btns = await page.$$('button')
  let clicked = false
  for (const b of btns) {
    const raw = await b.evaluate((e) => (e.textContent || '').replace(/\s+/g, ''))
    if (raw === '生成预览') { await b.click(); clicked = true; break }
  }
  console.log('点击「生成预览」=', clicked)
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="export-page-export-button"]')
    return btn && btn.disabled === false
  }, { timeout: 90000, polling: 200 })
  const after = await read()
  console.log('预览后:', JSON.stringify(after))

  // 改模板 → 重新锁定
  const selects = await page.$$('.MuiSelect-select')
  await selects[1].click()
  await sleep(400)
  const opts = await page.$$('li[role="option"]')
  for (const o of opts) {
    const t = (await o.evaluate((e) => (e.textContent || '').trim()))
    if (t === '作业') { await o.click(); break }
  }
  await sleep(800)
  const afterChange = await read()
  console.log('改模板后:', JSON.stringify(afterChange))

  const ok = before.btnDisabled === true && after.btnDisabled === false && afterChange.btnDisabled === true
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] 导出页门禁：未预览 disabled=${before.btnDisabled} → 预览后 disabled=${after.btnDisabled} → 改模板后 disabled=${afterChange.btnDisabled}`)
  await page.screenshot({ path: 'tools/_export_page_gate.png' })
} finally {
  await browser.close()
}
