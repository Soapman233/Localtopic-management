/** 单一试卷管理入口的会话态开关；不保存试卷内容、选择或导出门禁。 */
import { create } from 'zustand'
export const usePaperLibraryStore = create<{
  open: boolean
  openPaperLibrary: () => void
  closePaperLibrary: () => void
}>((set) => ({
  open: false,
  openPaperLibrary: () => set({ open: true }),
  closePaperLibrary: () => set({ open: false }),
}))
