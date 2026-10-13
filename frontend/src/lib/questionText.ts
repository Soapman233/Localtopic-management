/** 题干文本的「渲染期」清洗：剥离被塞进 `text` 里的答案 / 解析片段。
 *
 * 背景（设计评审 F4）
 * ------------------
 * 真实交付库里部分题目的 `text` 字段把**答案与详解一起**塞了进来，例如实测
 * `GET /api/questions/3521`：
 *   text     = 「…故选 D。【答案】D 【详解】A．…故选D。」（296 字）
 *   answer   = 「D」
 *   analysis = 「A．…故选D。」（与题干内 `【详解】` 是同一段）
 * 于是详情页会把同一份内容渲染三遍（题干 + 答案 + 解析）；`/search` 的结果卡更糟——
 * 整段「【答案】D【详解】…」直接铺在列表里，**老师还没做就先看到答案**。
 *
 * ⚠️ 本模块只做**渲染期剥离**，**不改数据**：
 * DB 里 `text` 原样保留（题库文件 / 导出 / 在线编辑均以原始 `text` 为准），
 * 剥离只发生在「把 text 显示给老师看」这一步。
 *
 * 规则依据（对真实交付库 7945 题统计，见任务 T04）
 * ------------------------------------------------
 * - 【】型标记高置信：`【答案】2419 / 【详解】2146 / 【解析】506 / 【解答】487 /
 *   【分析】271 / 【点评】64`；且组合多样（`【答案】+【详解】` 1657、纯 `【详解】` 441、
 *   `【答案】+【解析】` 241、`【答案】` 190、`【答案】+【解析】+【分析】+【解答】` 175、
 *   `【解答】` 131 …）→ **绝不能只认 `【答案】`**，必须取**所有标记中最早出现的位置**。
 * - `答案：` / `解析：`（全角冒号）各出现 4 / 54 次，但它们**也可能合法地出现在题干里**，
 *   误切的代价比不切大 → 只在**行首**（前一字符是 `\n` 或字符串开头）才认。
 * - 切割点前一字符分布：`\n` 5235、`．` 310、`】` 203、`.` 83、空格 42、`\t` 8
 *   （`】` 那批是 `【解析】【分析】` 这种相邻标记；`\n` 占绝对多数）。
 * - 选项位于标记之前（真实样本 id=118 的 A/B/C/D 选项在 `【答案】` 之前），
 *   故按最早标记切割**天然保留选项**。
 */

/** 【】型高置信标记：出现即认为是答案 / 解析区块的开始。 */
const BRACKET_MARKERS = ['【答案】', '【详解】', '【解析】', '【解答】', '【分析】', '【点评】'] as const

/** 行首型标记（全角冒号）：仅在行首才认，避免误切题干里合法的「答案：」。 */
const LINE_START_MARKERS = ['答案：', '解析：'] as const

export interface EmbeddedMarker {
  /** 标记在原文中的起始下标。 */
  index: number
  /** 命中的标记文本。 */
  marker: string
}

/**
 * 找出题干里**最早出现**的答案 / 解析标记位置（供测试与调试）。
 *
 * @param text 原始题干（可为空 / null）。
 * @returns 命中的 `{ index, marker }`；无标记返回 `null`。
 */
export function findEmbeddedMarker(text: string | null | undefined): EmbeddedMarker | null {
  if (!text) return null

  let best: EmbeddedMarker | null = null
  const consider = (index: number, marker: string) => {
    if (index < 0) return
    if (best === null || index < best.index) best = { index, marker }
  }

  // 【】型：直接找最早出现的位置。
  for (const marker of BRACKET_MARKERS) {
    consider(text.indexOf(marker), marker)
  }

  // 行首型：只认字符串开头或前一字符为 `\n` 的出现；取最早的合法位置。
  for (const marker of LINE_START_MARKERS) {
    let from = 0
    for (;;) {
      const at = text.indexOf(marker, from)
      if (at < 0) break
      if (at === 0 || text[at - 1] === '\n') {
        consider(at, marker)
        break
      }
      from = at + marker.length
    }
  }

  return best
}

/**
 * 剥离题干里被塞入的答案 / 解析片段，返回**只含题干（含选项）**的文本。
 *
 * 边界：
 * - 标记出现在下标 0（即题干为空）→ **返回原文**，绝不把题干弄成空串；
 * - 无标记 → 原样返回；
 * - `text` 为空 / null → 返回空串。
 */
export function stripEmbeddedAnswer(text: string | null | undefined): string {
  if (!text) return ''
  const hit = findEmbeddedMarker(text)
  if (!hit) return text
  if (hit.index === 0) return text
  return text.slice(0, hit.index).trim()
}
