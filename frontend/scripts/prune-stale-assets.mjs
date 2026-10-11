/**
 * prune-stale-assets —— 清理 webui/static/assets 下**已不被 index.html 引用**的旧构建产物。
 *
 * 背景：`vite.config.ts` 因本机沙箱对「单次删除 >50 个文件」有安全拦截，把 `emptyOutDir`
 * 设为 `false`（见该文件注释）。代价是每次构建都会留下**旧内容哈希**的入口包
 * （实测已堆积 17 个 `index-*.js`），交付目录越来越脏。
 *
 * 本脚本只删「入口包」这一小撮文件（`index-*.js` / `index-*.css`），**不碰** KaTeX 字体
 * 等被 CSS 间接引用的资源，因此单次删除量很小，不会触发沙箱拦截。
 *
 * 用法：`node scripts/prune-stale-assets.mjs`（已挂到 `npm run build` 之后）。
 */
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = resolve(here, '..', '..', 'webui', 'static')
const ASSETS_DIR = join(STATIC_DIR, 'assets')
const INDEX_HTML = join(STATIC_DIR, 'index.html')

/** 只清理入口包：`index-<hash>.js|css`。其余资源（字体等）由 CSS 引用，不动。 */
const ENTRY_RE = /^index-[A-Za-z0-9_-]+\.(js|css)$/

function referencedEntryFiles() {
  let html
  try {
    html = readFileSync(INDEX_HTML, 'utf8')
  } catch {
    console.warn('[prune] 未找到 index.html，跳过清理')
    return null
  }
  const refs = new Set()
  for (const m of html.matchAll(/["']\/assets\/([^"']+)["']/g)) refs.add(m[1])
  return refs
}

function main() {
  const refs = referencedEntryFiles()
  if (!refs) return

  let names
  try {
    names = readdirSync(ASSETS_DIR)
  } catch {
    console.warn('[prune] 未找到 assets 目录，跳过清理')
    return
  }

  const stale = names.filter((n) => ENTRY_RE.test(n) && !refs.has(n))
  if (stale.length === 0) {
    console.log('[prune] 无过期入口包，跳过')
    return
  }

  let freed = 0
  for (const n of stale) {
    const p = join(ASSETS_DIR, n)
    try {
      freed += statSync(p).size
      rmSync(p)
    } catch (err) {
      console.warn(`[prune] 删除失败 ${n}：${err.message}`)
    }
  }
  console.log(`[prune] 清理 ${stale.length} 个过期入口包，释放 ${(freed / 1024).toFixed(0)} KB`)
  for (const n of stale) console.log(`         - ${n}`)
}

main()
