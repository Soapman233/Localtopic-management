/**
 * 导出「环境失败判定 / 预览页归一化」的**纯函数**（R1/R3）。
 *
 * 从 `useExportGate.ts` 抽出为独立模块，便于**无 React 依赖**地单元测试
 * （门禁安全关键路径，必须有独立测试）。
 *
 * 阶段 3 追加：
 *  - L1：`describeEnvFailure`——环境失败原因的**教师语言**（技术细节仅在 debug 下可见）；
 *  - L4：`PREVIEW_STAGES` / `EXPORT_STAGES` 与 `inferPreviewStage` / `inferExportStage`——
 *    长任务阶段（**前端推断**，后端不上报阶段名，见下方说明）。
 */
import { GLOSSARY, isDebugMode } from '../lib/glossary'
import type { PreviewPage } from '../api/types'

/** 环境失败类型：editor_sdk 不可用 / 无 Word·WPS / 其他（非环境原因）。 */
export type EnvFailure = 'editor_sdk' | 'office' | null

/** 依据后端错误文案判定「环境原因」失败（用于触发降级门禁）。
 *
 * ★ 唯一实现：抽屉与导出页共用。**必须同时识别 `editor_sdk` 与 `Word`/`WPS`**，
 *   漏掉任一种都会导致对应环境下的导出被永久锁死（正是 P0-4 的根因）。
 */
export function detectEnvFailure(err: unknown): EnvFailure {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('editor_sdk')) return 'editor_sdk'
  if (msg.includes('Word') || msg.includes('WPS')) return 'office'
  return null
}

/** 后端「PDF 生成失败」warning 前缀（见 `webui/services/preview.py::render`）。 */
const PDF_FAIL_PREFIX = 'PDF 生成失败（预览不可用）'

/**
 * 从**已完成但无页面**的预览作业结果中识别「无页环境失败」。
 *
 * 后端 PDF 失败时**不抛异常**：作业正常 `done`，`pages=[]`、`pdf=null`，并追加一条
 * ``PDF 生成失败（预览不可用）：<error>`` 的 warning（DOCX 仍已生成）。此时像素预览不可用，
 * 若不给出降级入口，DOCX 导出会被**永久锁死**（FIX-2）。
 *
 * ⚠️ 判定**从严**：只认「PDF 生成失败」这条 warning，且其错误文本明确指向
 *    Word / WPS / editor_sdk；「PDF 位图化失败」、内容 / 桥接 warning 或未知原因
 *    **一律返回 null（保持锁定）**。**不得**把全部 warning 拼起来做宽泛子串匹配，
 *    否则会把未知导出失败误判成环境失败而放行。
 */
export function detectNoPageEnvFailure(result: unknown): EnvFailure {
  if (!result || typeof result !== 'object') return null
  const warnings = (result as { warnings?: unknown }).warnings
  if (!Array.isArray(warnings)) return null
  for (const w of warnings) {
    if (typeof w !== 'string' || !w.startsWith(PDF_FAIL_PREFIX)) continue
    return detectEnvFailure(new Error(w))
  }
  return null
}

/**
 * 环境失败的**技术口径**原因（含 `editor_sdk` 等原始字段）。
 *
 * ⚠️ **仅供 debug / 日志**：老师界面请改用 {@link describeEnvFailure}，
 * 否则会把开发者视角的真相直接暴露给老师。
 */
export function envReason(t: EnvFailure): string {
  if (t === 'editor_sdk') return '未检测到 editor_sdk 服务（公式渲染 / DOCX 生成不可用）'
  if (t === 'office') return '未检测到 Microsoft Word / WPS（无法生成 PDF 预览）'
  return '环境依赖缺失'
}

/**
 * 环境失败的**教师语言**原因（L1）：走 glossary，老师看得懂。
 *
 * 默认只输出教师语言（如「公式渲染服务未启动」）；仅当 `isDebugMode()` 为真时，
 * 才在括号内追加 {@link envReason} 的技术细节——维护者仍能定位问题，老师默认看不到。
 */
export function describeEnvFailure(t: EnvFailure): string {
  const base = t === 'editor_sdk' ? GLOSSARY.envEditorSdk : t === 'office' ? GLOSSARY.envOffice : GLOSSARY.envUnknown
  return isDebugMode() ? `${base}（技术细节：${envReason(t)}）` : base
}

// --------------------------------------------------------------------------- //
// L4：长任务阶段（**前端推断**）
// --------------------------------------------------------------------------- //
//
// 背景：后端作业（`GET /api/jobs/{id}`）只上报 `status`（pending/running/done/error）
// 与**粗进度** `progress`（0.0 → 0.1 → 1.0），**不返回阶段名**（见 `webui/jobs.py`）。
// 因此下面的阶段名与当前阶段索引是**前端按已知调用步骤推断**，**不是**后端真实阶段：
//   - 预览路径：`内容检查`（export-data 诊断请求）→ `渲染文档`（POST /preview 已发出）
//     → `生成 PDF` → `生成预览图`（后端把三步合成一个作业，前端无法逐段观测，
//     仅在作业运行期间按已用时长在 渲染→PDF→预览图 之间推进）；
//   - 导出路径：`内容检查` → `渲染文档` → `写出 DOCX/PDF`。
// 如实说明：若将来后端补上阶段字段，应改为消费真实字段，替换这里的推断。

/** 预览长任务的阶段名（**前端推断**，见上方说明）。 */
export const PREVIEW_STAGES = ['内容检查', '渲染文档', '生成 PDF', '生成预览图']
/** 导出长任务的阶段名（**前端推断**，见上方说明）。 */
export const EXPORT_STAGES = ['内容检查', '渲染文档', '写出 DOCX/PDF']

/** 阶段推断入参：均来自前端**可观测**的调用状态，不含任何后端未提供的信息。 */
export interface StageInput {
  /** 内容检查（export-data 诊断）请求进行中。 */
  checking: boolean
  /** 请求已发出、尚未拿到作业 id（POST 在途）。 */
  requesting: boolean
  /** 作业运行中（pending/running）。 */
  running: boolean
  /** 已用秒数（用于在无法逐段观测的作业内部做**推断**推进）。 */
  elapsedSec: number
}

/** 推断预览当前阶段索引（0 起）。**前端推断**，非后端真实阶段。 */
export function inferPreviewStage(i: StageInput): number {
  if (i.checking) return 0
  if (i.requesting) return 1
  if (i.running) {
    // 作业内部三步（渲染→PDF→预览图）后端不逐段上报，按已用时长推断推进。
    if (i.elapsedSec < 2) return 1
    if (i.elapsedSec < 4) return 2
    return 3
  }
  return 0
}

/** 推断导出当前阶段索引（0 起）。**前端推断**，非后端真实阶段。 */
export function inferExportStage(i: StageInput): number {
  if (i.checking) return 0
  if (i.requesting) return 1
  if (i.running) return i.elapsedSec < 3 ? 1 : 2
  return 1
}

/** 从预览响应/作业结果中归一化出页面列表（抽屉与导出页共用同一实现）。 */
export function extractPages(src: unknown): { pages: PreviewPage[]; key?: string } {
  if (!src || typeof src !== 'object') return { pages: [] }
  const o = src as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key : undefined
  const raw = o.pages
  if (!Array.isArray(raw)) return { pages: [], key }
  const pages: PreviewPage[] = []
  raw.forEach((p, i) => {
    if (typeof p === 'string') {
      pages.push({ n: i + 1, url: p })
      return
    }
    if (p && typeof p === 'object') {
      const po = p as { n?: number; page?: number; url?: string }
      const n = po.n ?? po.page ?? i + 1
      const url = po.url ?? (key ? `/api/preview/${key}/page_${n}.png` : '')
      if (url) pages.push({ n, url })
    }
  })
  return { pages, key }
}
