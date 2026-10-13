import { main, browser, context, validUrl } from './gate-common.mjs'
await main('G-c/duplicate', async options => {
  const base = validUrl(options.url), b = await browser()
  try {
    const c = await context(b), page = await c.newPage(); await page.goto(base + '/#/manage/knowledge', { waitUntil: 'networkidle' })
    await page.locator('.MuiListItemText-secondary').filter({ hasText: /^关联 [\d,]+ 条$/ }).first().waitFor()
    if (options.probe && options.probe !== 'duplicate') throw new Error('未知probe: ' + options.probe)
    if (options.probe) await page.evaluate(() => {
      const slot = [...document.querySelectorAll('.MuiListItemText-secondary')].find(e => /^关联 [\d,]+ 条$/.test(e.textContent)); if (!slot) throw new Error('找不到真实计数槽'); slot.parentElement.append(slot.cloneNode(true))
    })
    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.MuiListItemButton-root')].filter(row => [...row.querySelectorAll('.MuiListItemText-secondary')].some(e => /^关联 [\d,]+ 条$/.test(e.textContent)))
      const items = rows.map((row, index) => {
        const slots = [...row.querySelectorAll('.MuiListItemText-secondary')].filter(e => /^关联 [\d,]+ 条$/.test(e.textContent)), total = Number(slots[0].textContent.replace(/[^\d]/g, ''))
        const duplicateChips = [...row.querySelectorAll('.MuiChip-label')].filter(e => /^\d[\d,]*$/.test(e.textContent.trim()) && Number(e.textContent.replaceAll(',', '')) === total)
        return { selector: '.MuiListItemButton-root[' + index + ']', label: row.querySelector('.MuiListItemText-primary')?.textContent, total, displayed: slots.length + duplicateChips.length, slots: [...slots, ...duplicateChips].map(e => e.textContent) }
      }); return { checked: items.length, items, failures: items.filter(i => i.displayed !== 1) }
    })
    if (!result.checked) throw new Error('真实标签列表为空，不能判断计数门禁')
    return { url: page.url(), probe: options.probe || null, threshold: '每行关联总数仅一个计数展示槽', ...result }
  } finally { await b.close() }
})
