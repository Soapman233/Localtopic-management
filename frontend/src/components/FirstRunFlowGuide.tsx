/**
 * 首启四步流程引导（设计规范 §4.5 第 5 条）。
 *
 * 与 `FirstRunImportGuide` 的分工（**两者互斥，不重复造第二个空态引导**）
 * -------------------------------------------------------------------
 * - `FirstRunImportGuide`：**题库为空**时，引导导入第一份旧卷（唯一的建库途径）；
 * - 本组件：**题库非空、但老师从未走过完整流程**时，一次性给出
 *   「导入 → 找题 → 组卷 → 导出」四步，且**每一步都可点击直达对应页面**——
 *   不是一段只能读的说明文字。
 *
 * 「一次性」标记放哪、为什么
 * -------------------------
 * 放 **`localStorage`**（键 `qb_flow_guide_seen`）。
 * - 理由 1：这是**跨会话的偏好**（「这份引导我见过了」），不是会话态。项目既有约定
 *   「UI 会话态不持久化」针对的是**本次会话内的临时状态**（如 `uiStore` 的导出门禁脏标记、
 *   组卷页的窄屏提示），它们刷新即应重来；而「已看过首启引导」若也刷新即重来，
 *   老师每次开都会被打扰一次——那正是这条规范要避免的。
 * - 理由 2：**绝不写后端 / `bank.db`**。它纯属本机界面偏好，没有跨端同步的价值，
 *   也没有理由污染题库数据文件（§4.5 状态库约定）。
 *
 * 触发条件（三条同时满足）：① 题库非空（`/api/stats` 的 `questions > 0`）；
 * ② 未看过（localStorage 无标记）；③ 统计已就绪（加载中 / 失败一律不显示，绝不误伤）。
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { getStats } from '../api/stats'
import { qk } from '../api/queryKeys'
import { GLOSSARY, describeFlowGuide } from '../lib/glossary'

/** 「已看过四步引导」的本地标记键（跨会话偏好，仅存前端）。 */
export const FLOW_GUIDE_SEEN_KEY = 'qb_flow_guide_seen'

/** 读取「已看过」标记；存储不可用（隐私模式等）时安全回退为「未看过」。 */
export function isFlowGuideSeen(): boolean {
  try {
    return localStorage.getItem(FLOW_GUIDE_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** 写入「已看过」标记（存储不可用时静默，仅当次会话隐藏）。 */
export function markFlowGuideSeen(): void {
  try {
    localStorage.setItem(FLOW_GUIDE_SEEN_KEY, '1')
  } catch {
    /* 存储不可用时仅当次会话隐藏 */
  }
}

/** 首启四步引导（题库非空、未看过时显示；可关闭；每一步都可点击直达）。 */
export function FirstRunFlowGuide() {
  const navigate = useNavigate()
  const [seen, setSeen] = useState(isFlowGuideSeen)

  const statsQ = useQuery({ queryKey: qk.stats(), queryFn: () => getStats() })
  const total = statsQ.data?.questions

  // 已看过 / 统计未就绪 / 题库为空 → 不显示（空库交给 FirstRunImportGuide）。
  if (seen || typeof total !== 'number' || total <= 0) return null

  const guide = describeFlowGuide()

  /** 关闭引导（写入一次性标记）。 */
  const dismiss = () => {
    setSeen(true)
    markFlowGuideSeen()
  }

  /** 点某一步：先标记「已看过」（老师已经上手了），再跳转对应页面。 */
  const go = (to: string) => {
    setSeen(true)
    markFlowGuideSeen()
    navigate(to)
  }

  return (
    <Alert
      severity="info"
      sx={{ mb: 2, alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}
    >
      <AlertTitle sx={{ mb: 0.25 }}>{guide.title}</AlertTitle>
      <Box sx={{ mb: 1 }}>{guide.body}</Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {guide.steps.map((s) => (
          <Button key={s.to} size="small" variant="outlined" onClick={() => go(s.to)}>
            {s.label}
          </Button>
        ))}
        <Button size="small" onClick={dismiss}>
          {GLOSSARY.flowGuideDismiss}
        </Button>
      </Stack>
    </Alert>
  )
}

export default FirstRunFlowGuide
