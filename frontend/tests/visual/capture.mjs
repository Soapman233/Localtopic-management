/**
 * 视觉基线采集（1366×768）。
 *
 * 背景（项目铁律）：**排版 / 样式改动必须渲染出来看** —— 单元测试测不出视觉缺陷。
 * 本脚本把关键页面在**教师主流分辨率 1366×768** 下截图，供 `compare.py` 做像素级回归比对。
 *
 * 用法：
 *   node tests/visual/capture.mjs <baseUrl> <outDir>
 *   例：node tests/visual/capture.mjs http://127.0.0.1:8720 .tmp_verify/baseline-1366x768
 *
 * ⚠️ 依赖 Playwright。本项目**未**把 playwright 放进 `frontend/package.json`
 * （避免为开发工具引入重量级依赖），因此需要通过环境变量指定模块位置：
 *   PLAYWRIGHT_MODULE=<path-to-playwright>/index.js node tests/visual/capture.mjs ...
 * 若不设置则尝试直接 `import('playwright')`。
 *
 * 只读：仅访问页面并截图，**不触发任何写操作**。
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8720'
const OUT = process.argv[3] || '.tmp_verify/baseline-1366x768'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

/** 关键页面清单（与 `compare.py` 的页面名一一对应）。 */
export const PAGES = [
  ['builder', '/#/builder'],
  ['search', '/#/search?keyword=浮力'],
  ['export', '/#/export'],
  ['manage-knowledge', '/#/manage/knowledge'],
  ['manage-formula-review', '/#/manage/formula-review'],
  ['manage-sources', '/#/manage/sources'],
  ['manage-stats', '/#/manage/stats'],
  ['settings', '/#/settings'],
]

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
// 预置一份存在的试卷，避免组卷页落到空态（保证基线可比）
await ctx.addInitScript(() => {
  localStorage.setItem('qb-paper-store', JSON.stringify({
    state: { currentPaperId: 1, targetSectionId: null }, version: 0,
  }))
})
const page = await ctx.newPage()

for (const [name, hash] of PAGES) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'domcontentloaded' })
  // 等首屏数据落定（含 300ms 防抖 + 请求）；过短会截到 loading 态，基线就不可比了
  await page.waitForTimeout(3500)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
  console.log(`  已采集 ${name}`)
}

await browser.close()
console.log(`\n基线已写入 ${OUT}`)
console.log('提示：采集后请运行 compare.py 与既有基线比对；若视觉变化已人工确认，再更新 baseline-manifest.json')
