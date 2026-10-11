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
}

export const usePaperStore = create<PaperState>()(
  persist(
    (set) => ({
      currentPaperId: null,
      targetSectionId: null,
      setCurrentPaperId: (id) => set({ currentPaperId: id }),
      setTargetSectionId: (id) => set({ targetSectionId: id }),
    }),
    { name: 'qb-paper-store' },
  ),
)
