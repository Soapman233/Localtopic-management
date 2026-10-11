/**
 * 断页位置比对：探针（route B）每页起始题号 vs 真实 A4 PDF 每页起始题号。
 *
 * 用法：node tools/compare_breaks.mjs
 * 依赖：puppeteer-core（复用本机 Chrome）；真实页数据由
 *       tools/extract_real_pages.py 生成到 .evidence/real_pages.json。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const EV = path.join(ROOT, '.evidence')
const PORT = 8791

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

function serve() {
  const s = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let f = path.join(DIST, url === '/' ? 'index.html' : url)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream')
    fs.createReadStream(f).pipe(res)
  })
  return new Promise((r) => s.listen(PORT, '127.0.0.1', () => r(s)))
}

const CASES = [
  { name: '学生版', q: 'panel=0&mode=student&pageSize=A4&route=B&scale=1&debug=0' },
  { name: '答案解析版', q: 'panel=0&mode=answer&pageSize=A4&route=B&scale=1&debug=0' },
]

const real = JSON.parse(fs.readFileSync(path.join(EV, 'real_pages.json'), 'utf-8'))

const server = await serve()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 900 })

const summary = []
for (const c of CASES) {
  await page.goto(`http://127.0.0.1:${PORT}/?${c.q}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction('window.__spike && window.__spike.ready === true', { timeout: 20000 })
  await new Promise((r) => setTimeout(r, 200))
  const spike = await page.evaluate(() => window.__spike.pageSummary)
  const realKey = Object.keys(real).find((k) => k.includes(c.name === '学生版' ? 'student' : 'ans') || k.includes(c.name))
  const realPdf = realKey ? real[realKey] : null

  console.log(`\n===== ${c.name} =====`)
  console.log(`探针页数=${spike.length}  真实页数=${realPdf ? realPdf.page_count : '?'}  (真实文件 ${realKey})`)
  const n = Math.max(spike.length, realPdf ? realPdf.pages.length : 0)
  for (let i = 0; i < n; i++) {
    const s = spike[i]
    const r = realPdf ? realPdf.pages[i] : null
    const sStr = s ? `起题 ${s.firstQuestion ?? '-'}（题 ${s.questions.join(',')}）${s.startsWithSection ? ' [大题标题]' : ''}` : '（无）'
    const rStr = r ? `起题 ${r.q_starts[0] ?? '-'}（本页出现 ${r.q_starts.join(',') || '无'}）` : '（无）'
    const mark = s && r && (s.firstQuestion === (r.q_starts[0] ?? null)) ? '✅' : '❌'
    console.log(`  P${i + 1}: 探针 ${sStr}`)
    console.log(`        真实 ${rStr}  ${mark}`)
  }
  summary.push({ case: c.name, spikePages: spike.length, realPages: realPdf ? realPdf.page_count : null, spike, real: realPdf })
}

fs.writeFileSync(path.join(EV, 'break_compare.json'), JSON.stringify(summary, null, 2), 'utf-8')
await browser.close()
server.close()
console.log('\n[compare] 已写入 .evidence/break_compare.json')
