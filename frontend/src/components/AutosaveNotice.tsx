/**
 * 自动保存明示（设计规范 §4.5 第 3 条）。
 *
 * 为什么需要它
 * ------------
 * 组卷 / 单题编辑**保存成功后从不显式告知**老师——老师误以为「没点保存就是没存」，
 * 于是反复点、或干脆不敢关页面。规范要求常驻一行：
 * **「已自动保存 · 上次编辑 X 分钟前」**，用一句安静的状态 caption 消除这个疑虑
 * （P3「安静的状态」：不用彩色横幅，只用一行灰字）。
 *
 * 时间来源
 * --------
 * 统一读 `useUiStore.lastEditAt`（**会话态**时间戳，不持久化，理由见 `store/uiStore.ts`）：
 * - `QuestionDetailPage` 保存成功后 `markEdited()`；
 * - `PaperBuilderPage` 任意写操作成功后 `markEdited()`（收敛在 `usePaperMutations` 的 `invalidate`）。
 *
 * ⚠️ **不新建后端字段、不动 `bank.db`**——保存成功这个事实本就发生在前端 mutation 回调里，
 * 只是原先没有一个统一的可观测点。
 */
import type { SxProps, Theme } from '@mui/material'
import { useEffect, useState } from 'react'
import { Typography } from '@mui/material'
import { useUiStore } from '../store/uiStore'
import { describeAutosave } from '../lib/glossary'

/**
 * 相对时间的刷新间隔（毫秒）。
 *
 * ⚠️ 这是**文案刷新节拍**，不是动效时长（动效一律走 `tokens.motion`）：
 * 每 30 秒重算一次「X 分钟前」，保证长时间停留在同一页时文案不会停在旧值。
 */
const REFRESH_INTERVAL_MS = 30_000

/** 常驻一行「已自动保存 · 上次编辑 X 分钟前」；本次会话尚未编辑时**不渲染**（无可告知之事）。 */
export function AutosaveNotice({ sx }: { sx?: SxProps<Theme> }) {
  const lastEditAt = useUiStore((s) => s.lastEditAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (lastEditAt == null) return
    // 挂载 / 时间戳变化时先同步一次，再按节拍刷新（避免首帧显示过期文案）。
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [lastEditAt])

  if (lastEditAt == null) return null

  return (
    <Typography
      variant="caption"
      color="text.secondary"
      role="status"
      data-testid="autosave-notice"
      sx={{ display: 'block', mb: 1, ...sx }}
    >
      {describeAutosave(now - lastEditAt)}
    </Typography>
  )
}

export default AutosaveNotice
