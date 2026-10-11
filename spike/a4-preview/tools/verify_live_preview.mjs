/**
 * 验证脚本：在真实浏览器里加载 `LivePreviewPanel` 演示页，读取真实分页结果。
 *
 * 用法（先启动后端 :8720 与 vite dev :5173）：
 *   LP_MODE=学生版 node tools/verify_live_preview.mjs
 *   LP_MODE=答案解析版 node tools/verify_live_preview.mjs
 *
 * 依赖：puppeteer-core（spike 已有）+ 本机 Chrome。**不新增前端依赖。**
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const mode = process.env.LP_MODE || '学生版'
const url =
  'http://localhost:5173/#/preview-demo?paper_id=1&answer_mode=' + encodeURIComponent(mode)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1500,1100'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1100, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error') console.log('[console.error]', t)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('[http]', r.status(), r.url())
  })

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(
    () => {
      const lp = window.__livePreview
      return lp && lp.ready === true && lp.imagesReady === true && lp.fontsReady === true
    },
    { timeout: 60000, polling: 300 },
  )
  // 稳定后读一次
  const info = await page.evaluate(() => window.__livePreview)
  const render = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.lp-page img'))
    const loaded = imgs.filter((im) => im.naturalWidth > 0).length
    return {
      pageImgs: imgs.length,
      pageImgsLoaded: loaded,
      katexNodes: document.querySelectorAll('.lp-page .katex').length,
      katexErrors: document.querySelectorAll('.lp-page [data-katex-error]').length,
      missingImgPlaceholders: document.querySelectorAll('.lp-page .lp-image-missing').length,
      katexFallbacks: document.querySelectorAll('.lp-page .qb-katex-fallback').length,
      katexErrorDetails: Array.from(document.querySelectorAll('.lp-page [data-katex-error]')).map(
        (el) => ({
          source: (el.textContent || '').slice(0, 120),
          error: (el.getAttribute('title') || '').slice(0, 200),
        }),
      ),
      footerSample: document.querySelector('.lp-page .lp-footer')?.textContent ?? null,
    }
  })
  const out = {
    mode,
    pages: info.pages,
    questions: info.questions,
    overflowPages: info.overflowPages,
    template: info.template,
    answerMode: info.answerMode,
    pageHeightPx: info.pageHeightPx,
    lineHeightPx: info.lineHeightPx,
    ms: info.ms,
    render,
    pageSummary: info.pageSummary,
  }
  console.log('LIVE_PREVIEW_RESULT ' + JSON.stringify(out))

  const shot = `tools/_live_preview_${mode}.png`
  await page.screenshot({ path: shot, fullPage: true })
  console.log('screenshot ->', shot)
} finally {
  await browser.close()
}
