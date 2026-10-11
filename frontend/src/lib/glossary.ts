/** 内部术语 → 教师语言的映射与文案生成（**唯一来源**）。
 *
 * 背景（P0-1）
 * ----------
 * 此前界面把「开发者视角的技术真相」直接暴露给**不会敲命令行的中学物理老师**：
 * `scan index`、`snapshot_digest`、`evidence_digest`、`body_paragraph_number`、
 * `instance_id`、「快照锁定」、「降级解锁」、「门禁已解锁」、「修订候选」、「提及口径」。
 * 老师看不懂，遇到问题**无法自助解决**，只能找开发。
 *
 * 本模块与 `src/api/errors.ts` 定位一致：**术语 → 文案只在这里定义**，调用处不拼字符串，
 * 一处改、处处改，避免同一句话在各组件里各写一遍而逐渐走样。
 *
 * 两条铁律
 * -------
 * 1. 面向老师的主流程**只输出教师语言**（见 `GLOSSARY` 与 `describe*` 函数）；
 * 2. 原始技术字段（scan index / 段落号 / 实例 id / 摘要 / 受影响模式）一律走
 *    `isDebugMode()` 开关，**默认不渲染**；仅在「给技术人员的信息」折叠区、且
 *    debug 开启时可见（维护者仍能定位问题，老师默认看不到）。
 */
import type { ExportIssue } from '../api/types'

/** 问题来源字段（`ExportIssue['source']`）——老师只需要其中的文件名。 */
export type IssueSource = ExportIssue['source']

/**
 * 术语词典：稳定的 key → 教师语言。
 *
 * 调用处**只引用 key**（如 `GLOSSARY.lockedSnapshot`），不要内联中文字符串，
 * 否则又会出现「同一术语多种说法」的问题。
 */
export const GLOSSARY = {
  /**
   * 「快照锁定」的教师语言。
   *
   * 理由：老师不需要理解「快照」这个版本控制概念，只需要知道
   * **题库里这道题已经改过，但本卷用的还是当初加入时的旧版本**。
   */
  lockedSnapshot: '本题在题库中已更新，本卷仍用加入时的版本',

  /** 快照锁定的动作按钮：把本卷引用的版本**更新到题库最新**（原「刷新」按钮复用）。 */
  lockedSnapshotAction: '更新到最新',

  /**
   * 「门禁已解锁（像素预览为当前内容）」的教师语言。
   *
   * 理由：「门禁」是内部比喻，老师只知道「能不能点导出」。这里直接给结论。
   */
  exportReady: '预览已确认，可以导出',

  /** 导出尚未解锁时的提示：老师需要先预览、确认当前内容。 */
  exportLocked: '导出已锁定，请先生成并确认预览',

  /**
   * 「降级解锁」/「已确认结构预览（降级解锁）」的教师语言。
   *
   * 理由：老师不关心「降级」这个词，只关心**为什么看到的不是像素预览**——
   * 因为这台电脑没装 Word/WPS，所以改用结构预览来确认。
   */
  degradedMode: '当前电脑未安装 Word/WPS，已改用结构预览确认',

  /**
   * 「修订候选」的教师语言。
   *
   * 理由：「修订候选」是内部流程名，老师需要的是**「导出前还有哪些问题要处理」**。
   */
  revisionIssues: '导出前需要处理的问题',

  /**
   * 知识点「提及口径」的解释。
   *
   * 理由：标签只是**搜索线索**（题面提到过该词），**不等于这道题考查该知识点**，
   * 必须把这个区别讲清楚，否则老师会误判题目考点。
   */
  mentionScope: '这是搜索线索，不代表本题考这个知识点',

  /**
   * 「技术详情」折叠区标题。
   *
   * 理由：这些字段只有维护者/开发看得懂，标题明确指向「给技术人员的信息」，
   * 老师一眼就知道**不需要看**。
   */
  technicalInfo: '给技术人员的信息',
} as const

/** 单题「快照锁定」提示（用于 Tooltip / 单行徽章）。 */
export function describeLockedSnapshot(): string {
  return GLOSSARY.lockedSnapshot
}

/**
 * 整卷「快照锁定」横幅文案。
 *
 * @param count 题库已更新、但本卷仍用旧版的题数。
 */
export function describeSnapshotStale(count: number): string {
  return `${count} 题在题库中已更新，本卷仍用加入时的版本。`
}

/** 导出门禁状态 → 教师语言（用于状态徽标）。 */
export function describeExportGate(state: 'ready' | 'locked' | 'degraded'): string {
  if (state === 'ready') return GLOSSARY.exportReady
  if (state === 'degraded') return GLOSSARY.degradedMode
  return GLOSSARY.exportLocked
}

/** 环境降级（未安装 Word/WPS）时的状态说明。 */
export function describeDegradedMode(): string {
  return GLOSSARY.degradedMode
}

/** 「导出前需要处理的问题」的标题文案（对应内部「修订候选」）。 */
export function describeRevisionIssues(): string {
  return GLOSSARY.revisionIssues
}

/** 知识点标签的「提及口径」解释。 */
export function describeMentionScope(): string {
  return GLOSSARY.mentionScope
}

/** 「给技术人员的信息」折叠区标题（对应内部「技术详情」）。 */
export function describeTechnicalInfo(): string {
  return GLOSSARY.technicalInfo
}

/**
 * 问题来源的**教师语言**描述：只给来源文件名（定位不到时如实说明，不伪造）。
 *
 * ⚠️ 只输出文件名；scan index / 段落号等坐标请走 {@link describeIssueTechnical}，
 * 且**仅在 debug 模式**下渲染。
 */
export function describeIssueSource(source: IssueSource | null | undefined): string {
  const name = source?.file_name?.trim()
  return name ? `来源文件：${name}` : '来源文件：无法定位'
}

/**
 * 问题的**原始技术定位**（scan index / 段落号 / 实例 id / 摘要 / 受影响模式）。
 *
 * ⚠️ **仅供 debug 折叠区**：调用方必须先用 `isDebugMode()` 判断，为真才渲染本函数结果；
 * 否则等于把开发者视角的真相又暴露给老师。
 */
export function describeIssueTechnical(issue: ExportIssue): string {
  const s = issue.source
  const lines = [
    `卷 #${issue.paper_id ?? '—'} · item ${issue.item_id ?? '—'} · 原序 ${issue.seq ?? '—'} · qid ${issue.question_id} · 锁定 v${issue.question_version} · ${issue.kind}`,
    `scan index（0起）${s.start_scan_index ?? '—'}–${s.end_scan_index ?? '—'}；答案区scan index（0起）${s.answer_region_start_scan_index ?? '—'}；body直属段号（1起）${s.body_paragraph_number ?? '—'}${issue.instance_id ? `；图实例 ${issue.instance_id}` : ''}`,
    `受影响模式：${issue.blocked_modes.join('、') || '无'}`,
  ]
  return lines.join('\n')
}

/**
 * 是否处于「给技术人员」的调试模式。
 *
 * 判定规则（任一命中即视为开启）：
 *  1. URL 查询串含 `debug=1`（例如 `?debug=1`，便于临时排查、可分享链接）；
 *  2. `localStorage['qb_debug'] === '1'`（便于长期开启，刷新后仍生效）。
 *
 * ⚠️ **默认关闭**：老师界面**绝不**出现 scan index / snapshot_digest 等原始字段。
 * 在无浏览器环境（SSR / node:test）下安全返回 `false`。
 */
export function isDebugMode(): boolean {
  try {
    // 1) URL 查询串：window 不存在时跳过。
    if (typeof window !== 'undefined' && window.location) {
      if (new URLSearchParams(window.location.search).get('debug') === '1') return true
    }
    // 2) localStorage：优先取全局（浏览器即 window.localStorage；node 测试可注入 global.localStorage）。
    const store = typeof localStorage !== 'undefined' ? localStorage : undefined
    return store?.getItem('qb_debug') === '1'
  } catch {
    // 隐私模式 / 存储被禁用等情况下读取可能抛错，一律按「非 debug」处理。
    return false
  }
}
