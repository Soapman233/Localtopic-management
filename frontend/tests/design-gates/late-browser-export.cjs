/** 真实导出抽屉：答案模式迟到响应与最终export目标，全截获POST。 */
const { chromium } = require('C:/Users/SOAP/.workbuddy-ai/binaries/node/workspace/node_modules/playwright')
const assert = require('node:assert/strict')
;(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8911'
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  try {
    await context.addInitScript(() => localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: 1, targetSectionId: null }, version: 0 })))
    const writes = [], held = [], payloads = new Map()
    const fulfill = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data, message: 'ok' }) })
    await context.route('**/api/**', async route => {
      const req = route.request(), requestUrl = req.url()
      if (req.method() === 'GET') {
        if (requestUrl.includes('/export-data')) {
          const response = await route.fetch(), envelope = await response.json()
          payloads.set(requestUrl, envelope.data)
          return route.fulfill({ response })
        }
        if (requestUrl.includes('/api/jobs/intercepted-export')) return fulfill(route, { job_id: 'intercepted-export', status: 'done', kind: 'export', result: { files: [] } })
        return route.continue()
      }
      const body = req.postDataJSON()
      writes.push({ method: req.method(), url: requestUrl, body })
      if (/\/papers\/[0-9]+\/preview$/.test(requestUrl)) { held.push({ route, url: requestUrl, body }); return }
      if (/\/papers\/[0-9]+\/export$/.test(requestUrl)) return fulfill(route, { job_id: 'intercepted-export' })
      return fulfill(route, null)
    })
    const page = await context.newPage()
    const until = async fn => { for (let n=0;n<400;n++) { if (await fn()) return; await page.waitForTimeout(25) } throw new Error('G-e环境: 等待真实状态超时') }
    await page.goto(url + '/#/builder')
    await page.getByRole('button', { name: '导出', exact: true }).first().click()
    const dialog = page.getByRole('dialog').filter({ has: page.locator('#export-drawer-title') })
    await dialog.waitFor()
    await until(() => held.length === 1)
    const old = held[0], newMode = old.body.answer_mode === '学生版' ? '答案解析版' : '学生版'
    await page.getByTestId('export-answer-mode').getByRole('combobox').click()
    await page.getByRole('option', { name: newMode, exact: true }).click()
    await until(() => held.length === 2)
    const finish = async h => {
      const expected = new URL(h.url); expected.pathname = expected.pathname.replace('/preview', '/export-data'); expected.searchParams.set('answer_mode', h.body.answer_mode); expected.searchParams.set('template', h.body.template)
      const payload = payloads.get(expected.href)
      assert.ok(payload?.content_digest, '真实export-data内容摘要必须存在')
      assert.equal(payload.diagnostics.export_allowed, true, '副本试卷存在内容阻断，不能判定正例')
      return fulfill(h.route, { cached: true, content_digest: payload.content_digest, pages: [{ n: 1, url: '/api/preview/gate-' + encodeURIComponent(h.body.answer_mode) + '/page_1.png', width: 800, height: 1100 }] })
    }
    await finish(old)
    await page.waitForTimeout(100)
    const staleState = { exportDisabled: await page.getByTestId('export-button').isDisabled(), images: await dialog.locator('img').count(), currentMode: await page.getByTestId('export-answer-mode').getByRole('combobox').innerText() }
    assert.equal(staleState.exportDisabled, true)
    assert.equal(staleState.images, 0)
    await finish(held[1])
    await until(() => page.getByTestId('export-button').isEnabled())
    await page.getByTestId('export-button').click()
    await until(() => writes.some(w => /\/export$/.test(w.url)))
    const exportWrites = writes.filter(w => /\/export$/.test(w.url))
    console.log(JSON.stringify({ gate: 'G-e', url, oldMode: old.body.answer_mode, staleState, expected: { paper_id: 1, answer_mode: newMode }, actualWrites: exportWrites, interceptedRequests: writes.length }, null, 2))
    assert.equal(exportWrites.length, 1)
    assert.ok(exportWrites[0].url.endsWith('/api/papers/1/export'))
    assert.equal(exportWrites[0].body.answer_mode, newMode)
    console.log('G-e export browser PASS exit=0')
  } finally { await context.close(); await browser.close() }
})().catch(err => { console.error(err); process.exitCode = 1 })
