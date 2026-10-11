/**
 * 取证脚本（puppeteer-core + 本机 Chrome）：真实测量 + 整页截图。
 *
 * 为什么需要它：
 *  - 无头 Chrome 的 `--virtual-time-budget` 会让 `performance.now()` 在同步循环里**冻结**，
 *    导致测不出分页耗时；puppeteer 在**真实时间**下运行，能得到可信耗时。
 *  - `page.screenshot({fullPage:true})` 可稳定抓取「整卷多页」。
 *
 * 用法：
 *   1) npm run build
 *   2) node tools/evidence.mjs
 * 产物：spike/a4-preview/.evidence/*.png 与 metrics.json
 *
 * 依赖：puppeteer-core（devDependency，使用本机已安装的 Chrome，不额外下载浏览器）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.evidence')
const PORT = 8790

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(DIST, url === '/' ? 'index.html' : url)
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html')
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

const CONFIGS = [
  { name: '01_student_A4_full', q: 'panel=0&mode=student&pageSize=A4&route=B&scale=0.62&debug=1', full: true },
  { name: '02_student_Letter_full', q: 'panel=0&mode=student&pageSize=Letter&route=B&scale=0.62&debug=1', full: true },
  { name: '03_answer_A4_full', q: 'panel=0&mode=answer&pageSize=A4&route=B&scale=0.62&debug=1', full: true },
  { name: '04_answer_Letter_full', q: 'panel=0&mode=answer&pageSize=Letter&route=B&scale=0.62&debug=1', full: true },
  { name: '05_student_A4_qf5_50q', q: 'panel=0&mode=student&pageSize=A4&route=B&scale=0.32&debug=1&qf=5', full: true },
  { name: '06_detail_page1', q: 'panel=0&mode=student&pageSize=A4&route=B&scale=1&debug=0', full: false, vw: 900, vh: 1200 },
  { name: '07_routeA_css', q: 'panel=0&mode=student&pageSize=A4&route=A&scale=1&debug=1', full: false },
  { name: '09_interactive_panel', q: 'panel=1&mode=student&pageSize=A4&route=B&scale=0.5&debug=1', full: false, vw: 1500, vh: 950 },
]

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
  if (!chrome) throw new Error('未找到 Chrome/Edge')
  const server = await startServer()
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
  })

  const results = []
  try {
    const page = await browser.newPage()
    for (const cfg of CONFIGS) {
      await page.setViewport({ width: cfg.vw || 1000, height: cfg.vh || 900, deviceScaleFactor: 1 })
      await page.goto(`http://127.0.0.1:${PORT}/?${cfg.q}`, { waitUntil: 'load', timeout: 30000 })
      // 等待测量完成
      await page.waitForFunction('window.__spike && window.__spike.ready === true', { timeout: 20000 })
      await new Promise((r) => setTimeout(r, 300))
      const m = await page.evaluate(() => {
        const s = window.__spike
        return { pages: s.pages, ms: s.ms, questions: s.questions, blocks: s.blocks, overflow: s.overflow }
      })
      const bench = await page.evaluate(() => window.__spike.benchmark(30))
      const bench50 = m.questions >= 50 ? bench : null
      await page.screenshot({ path: path.join(OUT, `${cfg.name}.png`), fullPage: cfg.full })
      const row = { config: cfg.name, ...m, bench_ms: Number(bench.toFixed(4)), bench50_ms: bench50 }
      results.push(row)
      console.log(
        `${cfg.name}: 页数=${m.pages} 题=${m.questions} 首次测量=${m.ms.toFixed(3)}ms 基准=${bench.toFixed(3)}ms 溢出=${m.overflow}`,
      )
    }
  } finally {
    await browser.close()
    server.close()
  }

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2), 'utf-8')
  console.log('\n[evidence] 指标已写入 .evidence/metrics.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
