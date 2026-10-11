/** QA 六页冒烟：确认既有页面未受影响（无 JS 崩溃、有内容渲染）。 */
import puppeteer from 'puppeteer-core'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:8720/#'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1600,1100'] })
const R = {}
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const pages = [['单题详情', '/question/3759'], ['知识点复核', '/knowledge'], ['待复核公式', '/formula-review'], ['来源文件', '/sources'], ['统计', '/stats'], ['设置', '/settings']]
  for (const [name, path] of pages) {
    const before = errors.length
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(1800)
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160))
    const tables = await page.$$eval('table, .MuiPaper-root, .MuiCard-root, canvas, svg', (e) => e.length)
    R[name] = { path, newErrors: errors.slice(before), contentLen: text.length, sample: text, widgets: tables }
    console.log(`  [${errors.length === before && text.length > 10 ? 'PASS' : 'CHECK'}] ${name} ${path}: 新错误=${errors.length - before} 内容长=${text.length} 控件=${tables}`)
  }
  console.log(JSON.stringify(R, null, 2))
} finally { await browser.close() }
