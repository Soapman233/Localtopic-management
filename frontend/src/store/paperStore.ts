/** 组卷本地状态（zustand + localStorage 持久化）。
 *
 * 设计（架构设计 §10）：**以后端整卷为准，前端不做乐观累加**。因此本 store
 * **只保存「当前试卷 id」「加入目标大题」等 UI 选择**，不缓存整卷内容——
 * 整卷数据一律由 react-query 从后端获取，避免前后端不一致。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PaperState {
  /** 当前正在编辑/查看的试卷 id（跨页面共享：检索页「加入」、组卷页、导出页）。 */
  currentPaperId: number | null
  /** 「加入」时的目标大题 id（null=落到末尾/未分组）。 */
  targetSectionId: number | null
  setCurrentPaperId: (id: number | null) => void
  setTargetSectionId: (id: number | null) => void
  /**
   * 守卫（L6）：用**当前试卷真实存在的大题 id 列表**校验 `targetSectionId`。
   *
   * `targetSectionId` 是持久化的：目标大题被删除后，它仍可能指向一个不存在的 section id，
   * 老师点「加入」时题目会落到不存在的大题、被后端拒绝。调用方（能拿到试卷大题列表的地方，
   * 如 `PaperPanel`）在每次拿到最新 sections 后调用本方法，若目标已失效则置为 `null`
   * （回到「卷末/未分组」），避免脏 id 继续生效。
   *
   * 注意：本方法**只新增**，不改变 `setTargetSectionId` 等既有方法的语义。
   */
  validateTargetSection: (sectionIds: number[]) => void
}

export const usePaperStore = create<PaperState>()(
  persist(
    (set) => ({
      currentPaperId: null,
      targetSectionId: null,
      setCurrentPaperId: (id) => set({ currentPaperId: id }),
      setTargetSectionId: (id) => set({ targetSectionId: id }),
      validateTargetSection: (sectionIds) =>
        set((state) =>
          state.targetSectionId !== null && !sectionIds.includes(state.targetSectionId)
            ? { targetSectionId: null }
            : // 无需变更时返回原 state（Object.is 相等 → zustand 不通知订阅者，避免多余重渲染）。
              state,
        ),
    }),
    { name: 'qb-paper-store' },
  ),
)
