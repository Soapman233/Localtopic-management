/**
 * P2 验证脚本：在真实浏览器里加载 ExportDrawer 演示页，验证「强制预览门禁 + 降级逃生」。
 *
 * 前置：后端 :8720 与 vite dev :5173 已启动。
 * 用法：node tools/verify_export_drawer.mjs
 * 依赖：puppeteer-core（spike 已有）+ 本机 Chrome。**不新增前端依赖。**
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://localhost:5173/#/export-drawer-demo'
const OUT = 'tools'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function state(page) {
  return page.evaluate(() => window.__exportDrawer || null)
}

async function waitFor(page, pred, timeout = 40000) {
  await page.waitForFunction(
    (body) => {
      const s = window.__exportDrawer
      if (!s) return false
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${body})`)(s)
    },
    { timeout, polling: 150 },
    pred,
  )
}

async function goto(page, query) {
  // 注意：仅改 hash 不会触发整页重载，组件 useState 初始化不会重跑；
  // 故显式 reload 一次，确保每次都从干净状态重挂载（参数被重新读取）。
  await page.goto(`${BASE}?${query}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await waitFor(page, 'true', 30000) // __exportDrawer 就绪
}

async function setTemplate(page, text) {
  await page.click('[data-testid="export-template"] [role="combobox"]')
  await page.waitForSelector('li[role="option"]', { timeout: 5000 })
  const opts = await page.$$('li[role="option"]')
  for (const o of opts) {
    const t = (await o.evaluate((el) => el.textContent || '')).trim()
    if (t === text) {
      await o.click()
      return true
    }
  }
  throw new Error(`未找到模板选项：${text}`)
}

async function exportBtnDisabled(page) {
  return page.$eval('[data-testid="export-button"]', (b) => b.disabled || b.getAttribute('aria-disabled') === 'true')
}

async function hasText(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text)
}

const results = {}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu', '--window-size=1500,1100'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1100, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('[http]', r.status(), r.url())
  })

  // ---- A. 未预览时导出按钮 disabled（auto=0，进抽屉不自动预览）------------
  {
    const t0 = Date.now()
    await goto(page, 'paper_id=1&auto=0')
    await sleep(1200) // 给「若误触发自动预览」留出暴露时间
    const s = await state(page)
    results.A_unpreviewed = {
      elapsedToCheckMs: Date.now() - t0,
      unlocked: s.unlocked,
      previewing: s.previewing,
      pages: s.pages,
      exportDisabled_state: s.exportDisabled,
      exportDisabled_dom: await exportBtnDisabled(page),
    }
    await page.screenshot({ path: `${OUT}/_drawer_A_locked.png` })
  }

  // ---- B. 进抽屉自动生成（命中缓存 ≈ 秒回）--------------------------------
  {
    const t0 = Date.now()
    await goto(page, 'paper_id=1')
    await waitFor(page, 's.unlocked === true', 40000)
    const s = await state(page)
    results.B_auto_preview = {
      elapsedMs: Date.now() - t0,
      unlocked: s.unlocked,
      previewCached: s.previewCached,
      pages: s.pages,
      exportDisabled_dom: await exportBtnDisabled(page),
    }
    await page.screenshot({ path: `${OUT}/_drawer_B_unlocked.png` })

    // ---- C. 预览成功后再改设置（切模板）→ 导出重新锁住 + 旧图保留 + 过期横幅 ----
    const pagesBefore = s.pages
    await setTemplate(page, '测验') // 未缓存 → 走真实渲染（数秒）
    await sleep(400)
    const sMid = await state(page)
    results.C_relock = {
      unlocked: sMid.unlocked,
      previewing: sMid.previewing,
      pagesKept: sMid.pages,
      pagesBefore,
      staleBanner: await hasText(page, '此为旧版本预览'),
      exportDisabled_dom: await exportBtnDisabled(page),
      exportBtnLabel: await page.$eval('[data-testid="export-button"]', (b) => b.textContent || ''),
    }
    await page.screenshot({ path: `${OUT}/_drawer_C_stale.png` })

    await waitFor(page, 's.unlocked === true', 40000)
    const sAfter = await state(page)
    results.C_after_regen = {
      unlocked: sAfter.unlocked,
      previewing: sAfter.previewing,
      pages: sAfter.pages,
      staleBanner: await hasText(page, '此为旧版本预览'),
      exportDisabled_dom: await exportBtnDisabled(page),
    }
    await page.screenshot({ path: `${OUT}/_drawer_C_regenerated.png` })
  }

  // ---- D. 环境降级逃生（模拟无 Word/WPS）----------------------------------
  {
    await goto(page, 'paper_id=1&sim=office')
    await waitFor(page, "s.envFail === 'office'", 30000)
    const sDeg = await state(page)
    results.D_degraded = {
      envFail: sDeg.envFail,
      unlocked_beforeConfirm: sDeg.unlocked,
      exportDisabled_dom_beforeConfirm: await exportBtnDisabled(page),
      degradedNotice: await hasText(page, '已降级为「结构预览确认」'),
      structurePreviewShown: await hasText(page, '八年级物理'),
    }
    await page.screenshot({ path: `${OUT}/_drawer_D_degraded.png` })

    // 确认结构预览 → 降级解锁
    await page.click('[data-testid="confirm-degraded"]')
    await waitFor(page, 's.unlocked === true && s.degradedOk === true', 15000)
    const sOk = await state(page)
    results.D_after_confirm = {
      unlocked: sOk.unlocked,
      degradedOk: sOk.degradedOk,
      exportDisabled_dom: await exportBtnDisabled(page),
    }

    // 降级后导出 DOCX
    await page.click('[data-testid="export-button"]')
    await waitFor(page, "s.exportStatus === 'done'", 60000)
    const sExp = await state(page)
    results.D_export = {
      exportStatus: sExp.exportStatus,
      docx: sExp.exportResult?.docx ?? null,
      docx_size_bytes: sExp.exportResult?.docx_size_bytes ?? null,
      pdf: sExp.exportResult?.pdf ?? null,
      warnings: sExp.exportResult?.warnings ?? null,
    }
    await page.screenshot({ path: `${OUT}/_drawer_D_exported.png` })
  }

  console.log('EXPORT_DRAWER_RESULT ' + JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
