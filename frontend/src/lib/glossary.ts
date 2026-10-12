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

  // ------------------------------------------------------------------------- //
  // 阶段 3（T3-2）新增：门禁「可执行下一步」与「刷新即锁」解释
  // ------------------------------------------------------------------------- //

  /**
   * 锁定态下的**可执行动作**（按钮文案）：直接给「生成预览」。
   *
   * 理由：老师看到灰掉的导出按钮会问「为什么不能导」，旧文案只说「已锁定」，
   * 不给下一步；这里把动作直接写进按钮，省去老师自己去找预览入口。
   */
  generatePreview: '生成预览',

  /** 已有旧预览、需要重做时的按钮文案（与 {@link generatePreview} 同源）。 */
  regeneratePreview: '重新生成预览',

  /**
   * 「刷新即锁」的原因解释。
   *
   * 理由：门禁是**会话态**（`uiStore` 刻意不持久化 `previewFresh`），刷新页面后
   * 会重新锁定。这是**设计取舍**（导出的一定是老师本次看过、确认过的内容），
   * 但老师不知道，会以为「刚才明明能导，怎么又锁了」。此处**只解释、不改行为**。
   */
  previewNotPersisted: '预览结果不跨页面刷新保留，请重新生成',

  /**
   * 「命中缓存」的教师语言（L2）。
   *
   * 理由：「缓存」是技术词，老师不关心它；只要知道**这次预览很快、无需等待**即可。
   */
  previewReused: '已复用上次预览，秒开',

  // ------------------------------------------------------------------------- //
  // 阶段 3（L1）新增：环境失败的教师语言（技术细节仅在 debug 下可见）
  // ------------------------------------------------------------------------- //

  /** 公式渲染 / DOCX 生成服务未启动（内部对应 `editor_sdk` 缺失）。 */
  envEditorSdk: '公式渲染服务未启动',

  /** 本机未安装 Word / WPS（无法生成 PDF 预览）。 */
  envOffice: '本机未安装 Word/WPS',

  /** 其余环境依赖缺失（兜底）。 */
  envUnknown: '运行环境缺少必要组件',

  /**
   * 作业超时的教师语言（L5 接线）。
   *
   * 理由：作业线程若消失，作业会永远停在「进行中」，前端此前只能永久转圈。
   * 超时后必须给老师**可执行出路**：明确告知超时并提示重试。
   */
  jobTimeout: '任务超时，请重试',
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

/**
 * 由「是否解锁 + 是否降级」派生门禁三态 key（**唯一派生口径**）。
 *
 * 抽屉与导出中心都调用它，保证**同一状态下两个入口的徽标文案完全一致**
 * （避免各自判断 `unlocked/degradedOk` 时写出不同分支）。
 */
export function exportGateState(unlocked: boolean, degradedOk: boolean): 'ready' | 'locked' | 'degraded' {
  if (!unlocked) return 'locked'
  return degradedOk ? 'degraded' : 'ready'
}

/**
 * 门禁三态下的**可执行下一步**（按钮文案）。
 *
 * 锁定态必须给出可执行动作（T3-2）：直接返回「生成预览」，供界面就地渲染按钮；
 * 已解锁 / 降级已确认时无需额外动作，返回空串（调用方据此隐藏按钮）。
 */
export function describeExportGateAction(state: 'ready' | 'locked' | 'degraded'): string {
  return state === 'locked' ? GLOSSARY.generatePreview : ''
}

/**
 * 锁定态下解释「为什么刷新后又要重新预览」（T3-2）。
 *
 * ⚠️ **只解释、不改行为**：门禁的会话态语义（刷新即锁）由 `uiStore` 决定，
 * 本函数仅把原因讲给老师听。
 */
export function describePreviewRetention(): string {
  return GLOSSARY.previewNotPersisted
}

/** 「命中缓存」的教师语言（L2）：告诉老师本次预览很快、无需等待。 */
export function describePreviewReused(): string {
  return GLOSSARY.previewReused
}

/**
 * 作业（预览 / 导出）超时的教师语言（L5 接线）。
 *
 * 由 `useJob` 的 `timedOut` 标记触发：后端作业线程消失时，作业永远停在 running，
 * 前端不再无限轮询，而是给出**可执行出路**（提示超时、可重试）。
 */
export function describeJobTimeout(): string {
  return GLOSSARY.jobTimeout
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
 *  1. 普通或 HashRouter 查询串含 `debug=1`（例如 `?debug=1` / `#/builder?debug=1`）；
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
      // HashRouter 把路由查询放在 hash 内；只解析问号后的查询，不能把路径当参数。
      const hash = window.location.hash
      const queryStart = hash.indexOf('?')
      if (queryStart >= 0 && new URLSearchParams(hash.slice(queryStart + 1)).get('debug') === '1') return true
    }
    // 2) localStorage：优先取全局（浏览器即 window.localStorage；node 测试可注入 global.localStorage）。
    const store = typeof localStorage !== 'undefined' ? localStorage : undefined
    return store?.getItem('qb_debug') === '1'
  } catch {
    // 隐私模式 / 存储被禁用等情况下读取可能抛错，一律按「非 debug」处理。
    return false
  }
}

/** 公式转换状态的展示文案；转换完成只表示转换结果，不代替内容核对。
 * 空值与新出现的未知码必须如实提示，不能退回「正常」或透出内部原码。 */
export function describeFormulaStatus(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    OK: '转换完成',
    UNSUPPORTED: '不支持',
    EMPTY: '未提取到内容',
    FAIL: '转换失败',
    UNVERIFIED: '待核对',
  }
  return status && Object.prototype.hasOwnProperty.call(labels, status)
    ? labels[status]
    : '状态信息不可用，待核对'
}
