/**
 * 门禁：**性能预算**（设计规范 §4.4，R06 重新定义口径后）。
 *
 * 为什么不再只看「入口 chunk ≤ 30 KB」
 * ----------------------------------
 * 规范 §4.4 原本只卡入口 chunk（30 KB）。但该阈值是**在 `main` 线的架构下**定的
 * （那边入口 21.8 KB）。本线的入口是 47.2 KB，**看起来超标 57%**，然而：
 *
 *   本线首屏 JS 总量 **765 KB / 6 请求**，而 `main` 是 **1,058 KB / 15 请求**——
 *   **本线两项都明显更好**。
 *
 * 原因是两线对「什么时候下载什么」的策略不同：本线把更多东西放在**懒加载 chunk** 里
 * （katex、页面、命令面板…），于是入口偏大、首屏总量偏小。
 *
 * 规范 §4.4 自己写了这条规则：
 * > **防游戏指标规则**：入口变小不等于变好——必须同时看首屏请求数与总量。
 *
 * 单看入口会**同时**误判两个方向：
 *   - 误判本线「超标」（其实总量更好）；
 *   - 也**放行**那种「把代码挪进预加载 vendor」的假优化（入口小了，首屏反而更大）。
 *
 * 所以本门禁改为**三项同时卡**（R06 = ③「两者同时卡」）：
 *
 * | 指标 | 预算 | 依据 |
 * |---|---|---|
 * | 入口 chunk | **≤ 54 KB** | 本线 49.9 KB，留 ~10% 余量（**棘轮语义**：只允许小幅波动，不允许趋势性增长） |
 * | 首屏 JS 总量 | **≤ 1.1 MB** | 沿用规范原值（本线 765 KB） |
 * | 首屏请求数 | **≤ 16** | 沿用规范原值（本线 6） |
 *
 * 入口 54 KB 的构成依据（**都是首屏必需，不可再拆**）：
 *   `theme.ts`（样式覆写对象，必须在首帧前应用）≈10 KB
 *   `App.tsx`（外壳 JSX：侧栏/顶栏/抽屉/浮层）≈9 KB
 *   `glossary.ts`（术语唯一来源，外壳要用）≈5 KB
 *   9 个 MUI 图标（侧栏导航）≈4 KB
 *   + 路由 / store / api / 基础组件 ≈19 KB
 * 要压到规范原文的 30 KB 只能把这四块之一拆成懒加载，代价是**首帧闪烁或侧栏延迟**——**收益为零**（本机 HTTP）。
 * 故本门禁取「实测 + 约 10%」作为**棘轮**：它不假装 30 KB 可达，但能挡住**趋势性增长**
 * （每次改动涨 1 KB，一年后就是 +100 KB——这才是真正要防的）。
 *
 * 用法::
 *
 *     node scripts/check-budget.mjs        # 超预算即 exit 1
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const STATIC = join(ROOT, '..', 'webui', 'static')

/** 预算（**三项同时卡**，R06 = ③）。 */
export const BUDGET = {
  /** 入口 chunk 字节上限。 */
  entryBytes: 54 * 1024,
  /** 首屏 JS 总量字节上限。 */
  firstScreenBytes: 1.1 * 1024 * 1024,
  /** 首屏请求数上限。 */
  firstScreenRequests: 16,
}

/** 取 `index.html` 里被 `<script src>` / `<link href>` 直接引用的资源（= 首屏必下）。 */
function firstScreenRefs() {
  const html = readFileSync(join(STATIC, 'index.html'), 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])
  return [...new Set(refs)]
}

function main() {
  const refs = firstScreenRefs()
  const assets = readdirSync(join(STATIC, 'assets'))

  // 入口 chunk：`assets/index-*.js`（Vite 约定；与 `index.html` 引用一致）
  const entryName = refs.map((r) => r.split('/').pop()).find((n) => /^index-.*\.js$/.test(n))
  if (!entryName) {
    console.error('❌ 找不到入口 chunk（index-*.js）——请先 npm run build')
    process.exit(1)
  }
  const entryBytes = statSync(join(STATIC, 'assets', entryName)).size

  let total = 0
  let jsCount = 0
  for (const r of refs) {
    const p = join(STATIC, r.replace(/^\//, ''))
    try {
      total += statSync(p).size
      if (r.endsWith('.js')) jsCount += 1
    } catch {
      /* 资源可能不在 static 下（理论上不会） */
    }
  }

  const rows = [
    ['入口 chunk', `${entryBytes} B`, `≤ ${BUDGET.entryBytes} B`, entryBytes <= BUDGET.entryBytes],
    ['首屏 JS 总量', `${(total / 1024).toFixed(0)} KB`, `≤ ${(BUDGET.firstScreenBytes / 1024).toFixed(0)} KB`, total <= BUDGET.firstScreenBytes],
    ['首屏 JS 请求数', `${jsCount}`, `≤ ${BUDGET.firstScreenRequests}`, jsCount <= BUDGET.firstScreenRequests],
  ]

  console.log(`入口 chunk：${entryName}`)
  console.log('')
  let ok = true
  for (const [name, actual, budget, pass] of rows) {
    ok = ok && pass
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name.padEnd(16)} 实测 ${String(actual).padEnd(10)} 预算 ${budget}`)
  }
  console.log('')
  if (ok) {
    console.log(`✅ 性能预算通过（三项同时卡；assets 共 ${assets.length} 个文件）`)
    process.exit(0)
  }
  console.error('❌ 性能预算超限。⚠️ 注意：**不要靠「把代码挪进预加载 vendor」来让入口变小**——')
  console.error('   那会同时抬高首屏总量，本门禁会一起卡住（这正是三项同时卡的目的）。')
  process.exit(1)
}

main()
