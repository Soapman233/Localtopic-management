/**
 * 「继续上次的卷」入口（设计规范 §4.5 第 4 条）。
 *
 * 背景
 * ----
 * `currentPaperId` 由 `store/paperStore.ts` 通过 zustand `persist` **持久化到 localStorage**
 * （已核实：`{ name: 'qb-paper-store' }`），跨会话仍在——但**除组卷页自动读它之外没有任何入口**，
 * 老师在「找题 / 导入」等页面想回到那份卷只能自己找。
 *
 * 入口位置（为什么不在顶栏）
 * ------------------------
 * 顶栏已有「试卷切换器」，再放一个按钮只会重复。这里给一个**页面级次级入口**
 * （`outlined` 小按钮，非主操作），挂在「找题 / 导入」两个日常页上。
 * **不放组卷页**：组卷页本就会自动恢复 `currentPaperId`，在那里放入口是自指（点了没反应）。
 *
 * 安全回退（**必须**）
 * ------------------
 * 上次的卷可能已被删除，而 `currentPaperId` 仍指向那个不存在的 id。
 * 本组件在**试卷列表就绪后**校验：id 不在列表里 → `setCurrentPaperId(null)`（清空脏 id）
 * 并**不渲染入口**。于是既不会崩、也不会把老师引向一份不存在的卷；
 * 组卷页另有同样的守卫（见 `PaperBuilderPage`），保证即使老师没进过本页也能自愈。
 */
import type { SxProps, Theme } from '@mui/material'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { listPapers } from '../api/papers'
import { qk } from '../api/queryKeys'
import { usePaperStore } from '../store/paperStore'
import { describeContinueLastPaper } from '../lib/glossary'

/** 「继续上次的卷」次级入口；无有效上次试卷时不渲染。 */
export function ContinueLastPaper({ sx }: { sx?: SxProps<Theme> }) {
  const navigate = useNavigate()
  const currentPaperId = usePaperStore((s) => s.currentPaperId)
  const setCurrentPaperId = usePaperStore((s) => s.setCurrentPaperId)
  const papersQ = useQuery({ queryKey: qk.papers(), queryFn: () => listPapers() })
  const list = Array.isArray(papersQ.data) ? papersQ.data : null
  const paper = currentPaperId != null && list ? list.find((p) => p.id === currentPaperId) ?? null : null

  // 安全回退：列表已就绪、但上次的卷不在其中（已被删除）→ 清空脏 id。
  useEffect(() => {
    if (currentPaperId == null || !papersQ.isSuccess || !list) return
    if (!list.some((p) => p.id === currentPaperId)) setCurrentPaperId(null)
  }, [currentPaperId, list, papersQ.isSuccess, setCurrentPaperId])

  if (!paper) return null

  return (
    <Button size="small" variant="outlined" sx={{ mb: 2, ...sx }} onClick={() => navigate('/builder')}>
      {describeContinueLastPaper(paper.title)}
    </Button>
  )
}

export default ContinueLastPaper
