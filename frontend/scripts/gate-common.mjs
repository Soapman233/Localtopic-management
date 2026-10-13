import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
export const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const require = createRequire(path.join(frontend, 'package.json'))
export function args(flags = []) {
  const out = {}; for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    // 只有调用方声明的开关可省略参数；其它门禁保留既有键值参数约定。
    if (key.startsWith('--') && flags.includes(key.slice(2)) && (!process.argv[i + 1] || process.argv[i + 1].startsWith('--'))) { out[key.slice(2)] = true; continue }
    if (!key.startsWith('--') || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('无效参数: ' + key)
    out[key.slice(2)] = process.argv[++i]
  } return out
}
export async function main(id, run) {
  try { const options = args(id === 'G-b/runtime' ? ['probe'] : []); const allowed = { 'G-a/colors': ['src-root'], 'G-b/runtime': ['settings', 'theme-source', 'probe'], 'G-c/duplicate': ['url', 'probe'], 'G-d/dark': ['url', 'probe', 'report'] }[id] || []; for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error('未知参数: --' + key); const result = await run(options); console.log(JSON.stringify({ gate: id, ...result }, null, 2)); process.exitCode = result.failures?.length ? 1 : 0 }
  catch (error) { console.error(JSON.stringify({ gate: id, status: '无法判定', reason: error.stack || String(error) })); process.exitCode = 2 }
}
export async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }); const out = []
  for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await files(p)); else out.push(p) } return out
}
export async function browser() {
  // 优先使用标准安装；本机工具环境通过显式模块路径提供已有Playwright，不新增依赖。
  const module = process.env.PLAYWRIGHT_MODULE || 'C:/Users/SOAP/.workbuddy-ai/binaries/node/workspace/node_modules/playwright'
  const { chromium } = require(module); return chromium.launch({ headless: true })
}
// 显式URL优先；环境变量供gate:all统一选择独立验证端口，未指定时保留原默认。
export function validUrl(value = process.env.GATE_URL || 'http://127.0.0.1:8911') { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('仅接受HTTP服务URL'); return u.origin }
export async function context(browser, dark = false) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  await c.route('**/api/settings', async route => { const response = await route.fetch(); if (!response.ok()) throw new Error('settings接口失败'); const json = await response.json(); if (!json.data?.theme) throw new Error('settings缺theme'); json.data.theme.dark = dark; await route.fulfill({ response, json }) })
  await c.addInitScript(() => localStorage.setItem('qb-paper-store', JSON.stringify({ state: { currentPaperId: 1, targetSectionId: null }, version: 0 })))
  return c
}
