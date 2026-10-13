import fs from 'node:fs/promises'
import path from 'node:path'
import { main, browser, context, validUrl, frontend } from './gate-common.mjs'
/** 浏览器computed style求合成像素；文本与无字背景各自经每层opacity和alpha合成。 */
export function inspectText() {
  const failures = [], unsupported = [], items = [], excluded = { hidden: 0, disabled: 0, clipped: 0, empty: 0 }
  const parse = value => {
    const m = value.match(/^rgba?\(([^)]+)\)$/); if (!m) throw new Error('无法解析计算颜色: ' + value)
    const a = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); if (a.length < 3 || a.some(v => !Number.isFinite(v))) throw new Error('无效计算颜色: ' + value)
    return [a[0], a[1], a[2], a[3] ?? 1]
  }
  const over = (a, b) => { const alpha = a[3] + b[3] * (1 - a[3]); return alpha ? [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha).concat(alpha) : [0, 0, 0, 0] }
  const opacity = (a, value) => [a[0], a[1], a[2], a[3] * value]
  const luminance = a => a.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0)
  const selector = el => { const parts = []; for (let p = el; p && parts.length < 4; p = p.parentElement) parts.unshift(p.tagName.toLowerCase() + (p.id ? '#' + p.id : [...p.classList].filter(c => !c.startsWith('css-')).map(c => '.' + c).join(''))); return parts.join(' > ') }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode, text = node.textContent.trim(), el = node.parentElement
    if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) { excluded.empty++; continue }
    const chain = []; for (let p = el; p; p = p.parentElement) chain.push({ element: p, style: getComputedStyle(p) })
    if (chain.some(({ element: p }) => p.matches(':disabled,[aria-disabled="true"]'))) { excluded.disabled++; continue }
    if (chain.some(({ element: p, style: s }) => p.getAttribute('aria-hidden') === 'true' || p.closest('.lp-measure') || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0)) { excluded.hidden++; continue }
    const range = document.createRange(); range.selectNodeContents(node); const rects = [...range.getClientRects()]
    const visible = rects.some(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && chain.every(({ element: p, style: s }) => { if (!/(hidden|clip|scroll|auto)/.test(s.overflow + s.overflowX + s.overflowY)) return true; const b = p.getBoundingClientRect(); return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom }))
    if (!visible) { excluded.clipped++; continue }
    const target = { text: text.slice(0, 160), selector: selector(el) }
    const bad = chain.find(({ style: s }) => s.backgroundImage !== 'none' || s.mixBlendMode !== 'normal' || s.filter !== 'none' || s.backdropFilter && s.backdropFilter !== 'none')
    if (bad) { unsupported.push({ ...target, reason: '背景图/渐变/混合/滤镜无法由纯色模型判定', backgroundImage: bad.style.backgroundImage, filter: bad.style.filter, mixBlendMode: bad.style.mixBlendMode }); continue }
    try {
      let background = [0, 0, 0, 0], foreground = parse(chain[0].style.color)
      for (const { element: ancestor, style: s } of chain) {
        let bg = parse(s.backgroundColor)
        // 绝对页码浮层压在同级位图上，CSS祖先底不是它的实际底。仅可解算门禁返回的已知纯白A4；其它覆盖位图明确unsupported。
        if (ancestor !== el) for (const image of [...ancestor.children].filter(e => e.tagName === 'IMG')) {
          const r = image.getBoundingClientRect(), hit = rects.some(t => t.left >= r.left && t.right <= r.right && t.top >= r.top && t.bottom <= r.bottom)
          if (!hit) continue
          const known = image.src.startsWith('data:image/svg+xml;base64,') && atob(image.src.split(',')[1]) === '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/></svg>'
          if (!known || Number(getComputedStyle(image).opacity) !== 1) throw new Error('文本覆盖无法解算的位图背景')
          bg = [255, 255, 255, 1]
        }
        foreground = opacity(over(foreground, bg), Number(s.opacity)); background = opacity(over(background, bg), Number(s.opacity)) }
      // 浏览器画布根的既定初始色；body不透明时不会影响合成。
      foreground = over(foreground, [255, 255, 255, 1]); background = over(background, [255, 255, 255, 1])
      const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      const item = { ...target, foreground: foreground.map(v => +v.toFixed(3)), background: background.map(v => +v.toFixed(3)), ratio: +ratio.toFixed(4), threshold: 4.5 }; items.push(item); if (ratio < 4.5) failures.push(item)
    } catch (e) { unsupported.push({ ...target, reason: String(e) }) }
  }
  return { checked: items.length, excluded, items, failures, unsupported }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(frontend, 'scripts/gate-dark.mjs')) await main('G-d/dark', async options => {
  if (options.probe && options.probe !== 'dark') throw new Error('未知probe: ' + options.probe)
  const base = validUrl(options.url), b = await browser(), states = [], failures = [], unsupported = [], errors = []
  try {
    const c = await context(b, true), page = await c.newPage(); page.on('pageerror', e => errors.push(String(e)))
    // 所有写操作由浏览器截获；像素预览返回已知白色A4图像，确保实际PreviewViewer非空。
    const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/></svg>').toString('base64')
    await c.route('**/api/**', async route => {
      const req = route.request(); if (req.method() === 'GET') return route.fallback()
      if (/\/papers\/\d+\/preview$/.test(new URL(req.url()).pathname)) {
        const id = new URL(req.url()).pathname.match(/papers\/(\d+)/)[1], body = req.postDataJSON(), response = await c.request.get(base + '/api/papers/' + id + '/export-data?answer_mode=' + encodeURIComponent(body.answer_mode || '学生版') + '&template=' + encodeURIComponent(body.template || '考试')), json = await response.json()
        if (!response.ok() || !json.data?.content_digest) throw new Error('缺少真实export-data内容指纹')
        return route.fulfill({ json: { code: 0, message: '门禁仅浏览器返回预览', data: { cached: true, content_digest: json.data.content_digest, pages: [{ n: 1, url: image }], page_count: 1 } } })
      }
      await route.fulfill({ status: 409, json: { code: 40903, data: null, message: '门禁禁止实际写入' } })
    })
    const capture = async name => {
      // 等实际有限CSS过渡结束再验收稳定状态；并行CPU负载不能用固定毫秒猜测完成。
      await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (options.report && ['paper-hover', 'paper-invalid-score', 'primary-button-hover', 'PreviewViewer-nonempty'].includes(name)) await page.screenshot({ path: path.resolve(options.report).replace(/\.json$/, '') + '-' + name + '.png' })
      const result = await page.evaluate(inspectText); if (!result.checked) throw new Error('无可见正文: ' + name)
      states.push({ name, url: page.url(), ...result }); failures.push(...result.failures.map(v => ({ state: name, ...v }))); unsupported.push(...result.unsupported.map(v => ({ state: name, ...v })))
    }
    const routes = ['/search?keyword=浮力', '/question/1', '/builder', '/export?paper_id=1', '/manage/knowledge', '/manage/formula-review', '/manage/sources', '/manage/stats', '/settings']
    for (const route of routes) {
      await page.goto(base + '/#' + route, { waitUntil: 'networkidle' }); await page.locator('h1').waitFor(); await page.mouse.move(0, 0); await capture(route)
      if (route.startsWith('/builder')) {
        const paper = page.locator('.lp-page').first(); await paper.waitFor(); await paper.hover(); await capture('paper-hover')
        const chip = page.locator('.lp-score-chip').first(); if (await chip.count()) { await chip.click(); const input = page.locator('.lp-score-input'); await input.waitFor(); await input.fill('-1'); await capture('paper-invalid-score'); await input.press('Escape') } else throw new Error('纸面分值编辑状态为空')
      }
      if (route.startsWith('/export')) {
        await page.getByRole('button', { name: /生成像素预览|生成预览/ }).click(); await page.getByText('第 1 页', { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成预览' }).hover(); await capture('primary-button-hover'); await page.getByText('第 1 页', { exact: true }).scrollIntoViewIfNeeded(); await page.mouse.move(0, 0); await capture('PreviewViewer-nonempty')
      }
      if (route === '/settings' && options.probe) {
        await page.locator('main h1').evaluate(el => { el.style.backgroundColor = 'white'; el.style.color = 'white' }); await capture('probe-white-on-white')
      }
    }
    // 实际窄屏Drawer对话框由用户入口打开，纸面与导航不能仅检查静态DOM。
    await page.setViewportSize({ width: 800, height: 768 }); await page.goto(base + '/#/builder', { waitUntil: 'networkidle' }); await page.getByRole('button', { name: '打开导航' }).click(); await page.getByRole('dialog', { name: '侧边导航' }).waitFor(); await capture('navigation-Drawer')
    if (errors.length) throw new Error('pageerror: ' + errors.join('; '))
    const report = { gate: 'G-d/dark', url: base, probe: options.probe || null, checked: states.reduce((n, s) => n + s.checked, 0), threshold: 4.5, exclusions: '隐藏/测量层/裁切不属于可见正文；disabled按SC1.4.3', states, failures, unsupported }
    if (options.report) await fs.writeFile(path.resolve(options.report), JSON.stringify(report, null, 2))
    if (unsupported.length) { console.error(JSON.stringify({ gate: 'G-d/dark', unsupported, failures })); throw new Error('有无法解算的真实背景，详见unsupported；不能静默放行') }
    return { ...report, states: states.map(({ items, ...state }) => state) }
  } finally { await b.close() }
})
