/** 8911副本真实页面正例；所有非GET请求均被浏览器route截获。 */
const { chromium } = require('C:/Users/SOAP/.workbuddy-ai/binaries/node/workspace/node_modules/playwright')
const fs = require('node:fs')
const assert = require('node:assert/strict')
;(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8911'
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const writes = [], pending = []
  try {
    const summaryResponse = await context.request.get(url + '/api/labels/review-summary')
    assert.equal(summaryResponse.status(), 200)
    const summary = (await summaryResponse.json()).data.summary.filter(l => l.pending > 0)
    assert.ok(summary.length >= 2, 'G-e 环境: 至少两条非空标签')
    const [a,b] = summary.slice(0,2)
    const envelope = data => JSON.stringify({ code: 0, data, message: 'ok' })
    const fulfill = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: envelope(data) })
    await context.route('**/api/**', async route => {
      const request = route.request()
      if (request.method() === 'GET') return route.continue()
      const body = request.postDataJSON(), requestUrl = request.url()
      writes.push({ method: request.method(), url: requestUrl, body })
      if (requestUrl.endsWith('/labels/decision/preview')) {
        pending.push({ route, body }); return
      }
      if (requestUrl.endsWith('/labels/decision')) return fulfill(route, { updated: b.pending })
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 40001, data: null, message: 'G-e未授权写路径已截获' }) })
    })
    const page = await context.newPage()
    await page.goto(url + '/#/manage/knowledge')
    const choose = async name => page.locator('.MuiListItemButton-root').filter({ hasText: name }).first().click()
    const until = async fn => { for (let n=0;n<200;n++) { if (fn()) return; await page.waitForTimeout(25) } throw new Error('G-e环境: 请求未到达') }
    await choose(a.label_name)
    await page.getByRole('button', { name: '批量确认待复核', exact: true }).click()
    await until(() => pending.length === 1)
    await choose(b.label_name)
    await page.getByRole('button', { name: '批量确认待复核', exact: true }).click()
    await until(() => pending.length === 2)
    const preview = l => ({ found: true, label_id: l.label_id, label_name: l.label_name, decision: '确认', matched: l.total, pending: l.pending, will_update: l.pending, question_id: null })
    await fulfill(pending[1].route, preview(b))
    await page.getByRole('dialog').waitFor()
    await fulfill(pending[0].route, preview(a))
    await page.waitForTimeout(100)
    const dialog = page.getByRole('dialog'), text = await dialog.innerText()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await until(() => writes.some(w => w.url.endsWith('/labels/decision')))
    const decision = writes.filter(w => w.url.endsWith('/labels/decision'))
    const evidence = { gate: 'G-e', url, actual: { text, writes: decision }, expected: { label_name: b.label_name, pending: b.pending, matched: b.total }, interceptedRequests: writes.length }
    console.log(JSON.stringify(evidence, null, 2))
    assert.ok(text.includes('标签「' + b.label_name + '」'))
    assert.ok(text.replace(/[\s,]/g, '').includes('将确认' + b.pending + '条关联'))
    assert.equal(decision.length, 1)
    assert.deepEqual(decision[0].body, { label_name: b.label_name, decision: '确认', confirm: true })
    console.log('G-e browser PASS exit=0')
  } finally { await context.close(); await browser.close() }
})().catch(err => { console.error(err); process.exitCode = 1 })
