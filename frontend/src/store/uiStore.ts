/** UI 偏好状态（zustand 持久化）+ 导出门禁状态（P2）。
 *
 * 分两类：
 *  - **持久化偏好**：覆盖率提示关闭态、严格模式默认、筛选分组展开态、导出格式偏好、
 *    组卷页右栏视图（`builderView`）；
 *  - **会话内门禁脏标记（不持久化）**：`previewFresh` / `previewDegradedOk`——
 *    刷新后默认锁定（符合《流程重构设计》§5-Q3）。
 *
 * 门禁语义（§5-Q3）：
 *  - `previewFresh[paperId] === true` ⟺ 当前内容已成功生成过像素预览且其后未再变化；
 *  - 任何影响内容的操作（组卷编辑 / `answer_mode` / `template` 变化）→ `invalidatePreview` → 锁定；
 *  - 仅像素预览作业 `done` 且成功返回后 → `markPreviewFresh` → 解锁；
 *  - **环境降级逃生**：像素预览因环境原因失败时，用户确认结构预览 → `markPreviewDegraded` → 解锁。
 *  - 解锁条件：`previewFresh[paperId] || previewDegradedOk[paperId]`。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ExportFormats {
  docx: boolean
  pdf: boolean
}

/** 组卷页右栏视图：`layout`（排版，**默认**）| `list`（清单）。 */
export type BuilderView = 'list' | 'layout'

export interface PreviewTicket {
  paperId: number
  revision: number
  answerMode: string
  template: string
  settingsKey: string
  contentDigest: string
}

export const previewSettingsKey = (answerMode: string, template: string) => JSON.stringify([answerMode, template])

interface UiState {
  /** 覆盖率提示条是否已被用户关闭（P0-13：非阻塞、可关闭）。 */
  coverageDismissed: boolean
  setCoverageDismissed: (v: boolean) => void
  /** 「仅看已确认知识点」严格模式（PRD 5.3：**默认关闭**）。 */
  strictKp: boolean
  setStrictKp: (v: boolean) => void
  /** 筛选栏各分组展开态（key=维度名）。 */
  expandedFilters: Record<string, boolean>
  toggleFilter: (key: string) => void
  /** 组卷页右栏视图（§5-Q8②：「首次排版，之后跟随上次」；**持久化**）。 */
  builderView: BuilderView
  setBuilderView: (v: BuilderView) => void

  // ----------------------------------------------------------------------- //
  // 导出门禁（P2，§5-Q3）
  // ----------------------------------------------------------------------- //
  /** 导出格式偏好（纯前端偏好，持久化；§Q6）。 */
  exportFormats: ExportFormats
  setExportFormats: (f: Partial<ExportFormats>) => void
  /** 像素预览门禁：paperId → 当前内容已成功生成像素预览且其后未变化。**不持久化**。 */
  previewFresh: Record<number, boolean>
  /** 降级门禁：paperId → 环境不支持像素预览时用户已确认结构预览。**不持久化**。 */
  previewDegradedOk: Record<number, boolean>
  /** 每次编辑和重新请求均递增，旧请求完成不能解锁当前内容。 */
  previewRevision: Record<number, number>
  previewSettings: Record<number, string>
  previewContent: Record<number, string>
  previewAllowed: Record<number, boolean>
  observeContent: (paperId: number, digest: string, allowed: boolean) => void
  beginPreview: (paperId: number, answerMode: string, template: string, contentDigest: string) => PreviewTicket
  /** 仅在像素预览作业 `done` 且成功返回后调用：解锁导出。 */
  markPreviewFresh: (ticket: PreviewTicket, returnedDigest: string | undefined) => boolean
  /** 仅在环境降级且用户确认结构预览后调用：以结构预览替代像素预览解锁导出。 */
  markPreviewDegraded: (paperId: number, settingsKey: string, contentDigest: string) => boolean
  /** 任何影响内容的操作后调用：置 false，**重新锁定**导出。 */
  invalidatePreview: (paperId: number) => void
  /** 门禁是否解锁（fresh 或 降级已确认）。非响应式便捷方法；组件请直接订阅上表。 */
  isExportUnlocked: (paperId: number, settingsKey?: string) => boolean
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      coverageDismissed: false,
      setCoverageDismissed: (v) => set({ coverageDismissed: v }),
      strictKp: false,
      setStrictKp: (v) => set({ strictKp: v }),
      expandedFilters: {},
      toggleFilter: (key) =>
        set((s) => ({
          expandedFilters: { ...s.expandedFilters, [key]: !(s.expandedFilters[key] ?? true) },
        })),

      // 首次默认「排版视图」（用户决策 Q8）；之后跟随上次选择（持久化）。
      builderView: 'layout',
      setBuilderView: (v) => set({ builderView: v }),

      exportFormats: { docx: true, pdf: false },
      setExportFormats: (f) => set((s) => ({ exportFormats: { ...s.exportFormats, ...f } })),

      previewFresh: {},
      previewDegradedOk: {},
      previewRevision: {},
      previewSettings: {},
      previewContent: {},
      previewAllowed: {},
      observeContent: (paperId, digest, allowed) => {
        if (get().previewContent[paperId] !== digest || get().previewAllowed[paperId] !== allowed) {
          get().invalidatePreview(paperId)
          set((s) => ({ previewContent: { ...s.previewContent, [paperId]: digest }, previewAllowed: { ...s.previewAllowed, [paperId]: allowed } }))
        }
      },
      beginPreview: (paperId, answerMode, template, contentDigest) => {
        get().invalidatePreview(paperId)
        return { paperId, answerMode, template, contentDigest, revision: get().previewRevision[paperId],
          settingsKey: previewSettingsKey(answerMode, template) }
      },
      markPreviewFresh: (ticket, returnedDigest) => {
        const { paperId, revision, settingsKey } = ticket
        if (get().previewRevision[paperId] !== revision || !ticket.contentDigest || returnedDigest !== ticket.contentDigest || get().previewContent[paperId] !== ticket.contentDigest || !get().previewAllowed[paperId]) return false
        set((s) => ({
          previewSettings: { ...s.previewSettings, [paperId]: settingsKey },
          previewFresh: { ...s.previewFresh, [paperId]: true },
          // 像素预览成功即视为「非降级」路径，清掉降级确认，避免混淆。
          previewDegradedOk: { ...s.previewDegradedOk, [paperId]: false },
        }))
        return true
      },
      markPreviewDegraded: (paperId, settingsKey, contentDigest) => {
        if (!contentDigest || get().previewContent[paperId] !== contentDigest || !get().previewAllowed[paperId]) return false
        set((s) => ({ previewDegradedOk: { ...s.previewDegradedOk, [paperId]: true }, previewSettings: { ...s.previewSettings, [paperId]: settingsKey } }))
        return true
      },
      invalidatePreview: (paperId) =>
        set((s) => ({
          previewRevision: { ...s.previewRevision, [paperId]: (s.previewRevision[paperId] ?? 0) + 1 },
          previewFresh: { ...s.previewFresh, [paperId]: false },
          previewDegradedOk: { ...s.previewDegradedOk, [paperId]: false },
        })),
      isExportUnlocked: (paperId, settingsKey) =>
        Boolean(get().previewAllowed[paperId] && (get().previewFresh[paperId] || get().previewDegradedOk[paperId]) &&
          (settingsKey === undefined || get().previewSettings[paperId] === settingsKey)),
    }),
    {
      name: 'qb-ui-store',
      // 门禁为**会话内脏标记**，不持久化（刷新后默认锁定，符合 §5-Q3）。
      partialize: (s) => ({
        coverageDismissed: s.coverageDismissed,
        strictKp: s.strictKp,
        expandedFilters: s.expandedFilters,
        exportFormats: s.exportFormats,
        builderView: s.builderView,
      }),
    },
  ),
)
