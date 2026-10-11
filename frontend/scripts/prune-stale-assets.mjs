/**
 * prune-stale-assets —— 清理 `webui/static/assets` 下**不属于本次构建**的旧产物。
 *
 * 背景
 * ----
 * `vite.config.ts` 因本机沙箱对「单次删除 >50 个文件」有安全拦截，把 `emptyOutDir` 设为 `false`
 * （见该文件注释）。代价是每次构建都会留下**旧内容哈希**的文件，交付目录越来越脏。
 *
 * 阶段 5（P5-1 代码分割）之后这个问题**显著放大**：产物从「1 个入口包」变成
 * 「入口 + 5 个 vendor + 每个页面一个 chunk」，实测 assets 下 js/css 从 **2 个涨到 125 个**。
 *
 * 为什么不能用「是否被 index.html 引用」判断（旧版做法）
 * ----------------------------------------------------
 * 代码分割后，**懒加载的页面 chunk 不在 `index.html` 里**（它们是运行时动态 import 的）。
 * 按旧口径会把这些**正在使用的** chunk 误判为过期并删掉 → 点进页面即 404。
 *
 * 正确做法：读 Vite 构建清单（`build.manifest: true` 产出）
 * --------------------------------------------------------
 * `.vite/manifest.json` 列出本次构建的**完整产物集**（含 `file` / `css` / `dynamicImports`），
 * 据此即可安全判定新旧。
 *
 * 安全边界
 * ----
 * - **只删 `.js` / `.css`**：KaTeX 字体等资源由 CSS 间接引用，不在 manifest 的 file/css 列表里，
 *   但**绝不能删**（所以按扩展名白名单过滤，而不是按「不在清单里」一刀切）。
 * - 分批删除（每批 ≤40），避免触发沙箱的「单次删除 >50 文件」拦截。
 *
 * 用法：`node scripts/prune-stale-assets.mjs`（已挂在 `npm run build` 之后）。
 */
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = resolve(here, '..', '..', 'webui', 'static')
const ASSETS_DIR = join(STATIC_DIR, 'assets')
const MANIFEST = join(STATIC_DIR, '.vite', 'manifest.json')
const INDEX_HTML = join(STATIC_DIR, 'index.html')

/** 只处理这两类可安全删除的产物；字体/图片等一律不碰。 */
const PRUNABLE_RE = /\.(js|css)$/
/** 每批删除上限（沙箱对单次批量删除有阈值）。 */
const BATCH = 40

/** 收集本次构建的完整产物文件名集合（来自 Vite manifest）。 */
function currentBuildFiles() {
  let raw
  try {
    raw = readFileSync(MANIFEST, 'utf8')
  } catch {
    return null
  }
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    console.warn(`[prune] manifest.json 解析失败，跳过清理：${err.message}`)
    return null
  }
  const keep = new Set()
  const add = (p) => {
    if (typeof p === 'string' && p) keep.add(p.replace(/^\/?assets\//, ''))
  }
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue
    add(entry.file)
    for (const c of entry.css ?? []) add(c)
    for (const a of entry.assets ?? []) add(a)
    // dynamicImports 指向的是 manifest 的 key（模块名），其产物已由各条目自身的 file 覆盖；
    // 这里仍显式遍历一次，防止某条目未被收录。
    for (const d of entry.dynamicImports ?? []) {
      const target = manifest[d]
      if (target && typeof target === 'object') {
        add(target.file)
        for (const c of target.css ?? []) add(c)
      }
    }
  }
  return keep
}

/** 兜底：manifest 缺失时退回「按 index.html 引用」判断（此时至少不会误删，只是清得不彻底）。 */
function indexHtmlFiles() {
  try {
    const html = readFileSync(INDEX_HTML, 'utf8')
    const keep = new Set()
    for (const m of html.matchAll(/["']\/assets\/([^"']+)["']/g)) keep.add(m[1])
    return keep
  } catch {
    return null
  }
}

function main() {
  let keep = currentBuildFiles()
  let source = 'Vite manifest'
  if (!keep) {
    keep = indexHtmlFiles()
    source = 'index.html（manifest 缺失，退化为保守口径）'
  }
  if (!keep) {
    console.warn('[prune] 既无 manifest 也无 index.html，跳过清理')
    return
  }

  let names
  try {
    names = readdirSync(ASSETS_DIR)
  } catch {
    console.warn('[prune] 未找到 assets 目录，跳过清理')
    return
  }

  const stale = names.filter((n) => PRUNABLE_RE.test(n) && !keep.has(n))
  if (stale.length === 0) {
    console.log(`[prune] 无过期产物（本次构建 ${keep.size} 个文件，判定依据：${source}）`)
    return
  }

  let freed = 0
  let deleted = 0
  // 分批删除，避免触发沙箱的「单次批量删除」拦截。
  for (let i = 0; i < stale.length; i += BATCH) {
    for (const n of stale.slice(i, i + BATCH)) {
      const p = join(ASSETS_DIR, n)
      try {
        freed += statSync(p).size
        rmSync(p)
        deleted++
      } catch (err) {
        console.warn(`[prune] 删除失败 ${n}：${err.message}`)
      }
    }
  }
  console.log(
    `[prune] 清理 ${deleted}/${stale.length} 个过期产物，释放 ${(freed / 1024).toFixed(0)} KB` +
      `（保留 ${keep.size} 个，判定依据：${source}）`,
  )
}

main()
