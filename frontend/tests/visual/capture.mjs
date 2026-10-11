/**
 * 视觉基线采集（**分辨率 × 主题矩阵**）。
 *
 * 背景（项目铁律）：**排版 / 样式改动必须渲染出来看** —— 单元测试测不出视觉缺陷。
 * 本脚本把关键页面在**教师主流分辨率**下截图，供 `compare.py` 做像素级回归比对。
 *
 * 阶段 4 扩展：此前只覆盖 **1366×768 单分辨率 + 浅色**，无法发现
 *   · 窄屏（<1200 右栏折叠为抽屉）的降级破版；
 *   · 宽屏（1920）的过度拉伸 / 留白；
 *   · **深色模式**下语义色 / 边框 / 背景的对比度问题。
 * 现扩展为「分辨率 × 主题」矩阵。
 *
 * ⚠️ 诚实声明：**仍是模拟视口（Playwright viewport），不是物理设备。**
 *    不覆盖真实 GPU 字体渲染差异、触屏手势、真实移动端浏览器、真实读屏软件。
 *
 * 用法（两种模式）：
 *
 *   # A. 单组合（向后兼容旧流程）——直接写入 outDir，不建子目录
 *   node tests/visual/capture.mjs <baseUrl> <outDir>
 *   node tests/visual/capture.mjs <baseUrl> <outDir> --viewport 1440x900 --theme dark
 *
 *   # B. 全矩阵（阶段 4 新增）——outRoot 下按 {W}x{H}-{theme} 建子目录
 *   node tests/visual/capture.mjs <baseUrl> <outRoot> --all
 *
 * ⚠️ 依赖 Playwright。本项目**未**把 playwright 放进 `frontend/package.json`
 * （避免为开发工具引入重量级依赖），因此需要通过环境变量指定模块位置：
 *   PLAYWRIGHT_MODULE=<file-url-to-playwright>/index.mjs node tests/visual/capture.mjs ...
 * 若不设置则尝试直接 `import('playwright')`。
 *
 * 只读：仅访问页面并截图，**不触发任何写操作**（深色模式经**拦截** `/api/settings` 返回
 * `theme.dark=true` 实现，不写任何设置文件）。
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8720'
const OUT = process.argv[3] || '.tmp_verify/baseline-1366x768'

/** 取 `--flag value` 形式的参数值。 */
const argOf = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const ALL = process.argv.includes('--all')
const SINGLE_VIEWPORT = argOf('--viewport') // 形如 "1440x900"
const SINGLE_THEME = argOf('--theme') // "light" | "dark"

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

/**
 * 采集矩阵定义。
 *
 * · 四个主流桌面视口 × 浅色/深色 = 8 组；
 * · **额外** 1024×768 浅色一组，专门验证「窄屏（<1200）右栏折叠为抽屉」的降级不破版。
 *   （1024 < 1200，触发 App 的 `breakpoints.down('lg')` 分支。）
 */
export const MATRIX = [
  { width: 1280, height: 800, theme: 'light' },
  { width: 1280, height: 800, theme: 'dark' },
  { width: 1366, height: 768, theme: 'light' },
  { width: 1366, height: 768, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
  { width: 1440, height: 900, theme: 'dark' },
  { width: 1920, height: 1080, theme: 'light' },
  { width: 1920, height: 1080, theme: 'dark' },
  // 窄屏降级验证（<1200 右栏折叠为抽屉）
  { width: 1024, height: 768, theme: 'light' },
]

/** 组合目录名，如 `1366x768-light`。 */
export const comboDirName = ({ width, height, theme }) => `${width}x${height}-${theme}`

/**
 * 解析「单组合」参数（模式 A）。
 *
 * 默认 1366×768 + light（与旧基线完全一致，保证旧流程行为不变）。
 * `--viewport 1440x900` → {width:1440,height:900}。
 */
function resolveSingle() {
  let width = 1366
  let height = 768
  if (SINGLE_VIEWPORT) {
    const m = /^(\d+)x(\d+)$/.exec(SINGLE_VIEWPORT.trim())
    if (!m) throw new Error(`--viewport 需形如 1440x900，收到：${SINGLE_VIEWPORT}`)
    width = Number(m[1])
    height = Number(m[2])
  }
  const theme = SINGLE_THEME ?? 'light'
  if (theme !== 'light' && theme !== 'dark') throw new Error(`--theme 只能是 light / dark，收到：${theme}`)
  return { width, height, theme }
}

/**
 * 采集一个组合：新建独立 context（隔离 localStorage），逐页截图到 `outDir`。
 *
 * 深色模式实现：**拦截 `/api/settings`**，把响应体的 `data.theme.dark` 改成 true。
 * 为什么不用设置文件 / 设置页开关：那会**写入** `outputs/webui/settings.json`，
 * 污染本机真实偏好；且采集脚本必须保持「只读」。
 * 主题由 `main.tsx` 的 `ApplicationTheme`（react-query 拉 `/api/settings`）驱动，
 * 因此拦截该接口即可让整棵主题树（含 CssBaseline 的 body 背景）切到深色。
 */
async function captureCombo(browser, combo, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const ctx = await browser.newContext({
    viewport: { width: combo.width, height: combo.height },
    deviceScaleFactor: 1,
  })
  if (combo.theme === 'dark') {
    await ctx.route('**/api/settings', async (route) => {
      const resp = await route.fetch()
      const body = await resp.json()
      body.data.theme = { ...body.data.theme, dark: true }
      await route.fulfill({ response: resp, json: body })
    })
  }
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
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  }
  await ctx.close()
  console.log(`  已采集 ${comboDirName(combo)}（${PAGES.length} 页）→ ${outDir}`)
}

const browser = await chromium.launch()

if (ALL) {
  // 模式 B：全矩阵，outRoot 下按组合建子目录
  console.log(`矩阵采集：${MATRIX.length} 组 × ${PAGES.length} 页 → ${OUT}`)
  for (const combo of MATRIX) {
    await captureCombo(browser, combo, path.join(OUT, comboDirName(combo)))
  }
} else {
  // 模式 A：单组合，直接写入 outDir（向后兼容）
  await captureCombo(browser, resolveSingle(), OUT)
}

await browser.close()
console.log(`\n基线已写入 ${OUT}`)
console.log('提示：采集后请运行 compare.py 与既有基线比对；若视觉变化已人工确认，再更新 baseline-manifest.json')
