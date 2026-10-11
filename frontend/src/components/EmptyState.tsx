/** 统一「空态」：没有结果 / 还没有数据时的标准呈现（四态规范之「空态」）。
 *
 * 背景（前端重构方案 §2.2 P1-4）
 * ----------------------------
 * 此前「暂无数据 / 没有找到 / 无数据」等裸文案散落 7 处，**没有图标、没有下一步**，
 * 老师看到后不知道能做什么。本组件要求：**图标 + 一句话说明 + 可选的主行动按钮**，
 * 让空态本身成为「下一步操作」的入口。
 *
 * 使用约定
 * --------
 * - 只用于「**查询/集合为空**」的场景（无匹配结果、还没有试卷、还没有预览…）；
 * - **禁止**再写裸「暂无数据」纯文字空态；
 * - 表单校验 / 环境降级 / 覆盖率提示等**横幅类**提示仍用 `Alert`，不要用本组件。
 */
import type { ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'

export interface EmptyStateProps {
  /** 自定义图标；不传用默认的「收件箱」图标。 */
  icon?: ReactNode
  /** 一句话主说明（必填，禁止裸「暂无数据」）。 */
  title: ReactNode
  /** 补充说明 / 下一步提示。 */
  description?: ReactNode
  /** 主行动按钮文案（与 `onAction` 同时提供才渲染按钮）。 */
  actionLabel?: string
  /** 主行动按钮点击回调。 */
  onAction?: () => void
  /** 紧凑模式：用于卡片 / 表格单元 / 抽屉内的空态。 */
  dense?: boolean
}

/** 统一空态。 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  dense = false,
}: EmptyStateProps) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ textAlign: 'center', py: dense ? 2 : 5, px: 2, width: '100%' }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          color: 'text.disabled',
          mb: dense ? 0.5 : 1.5,
        }}
      >
        {icon ?? <InboxOutlinedIcon sx={{ fontSize: dense ? 28 : 44 }} />}
      </Box>
      <Typography variant={dense ? 'body2' : 'subtitle1'} fontWeight={600}>
        {title}
      </Typography>
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5, maxWidth: 460, mx: 'auto' }}
        >
          {description}
        </Typography>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="contained" size="small" sx={{ mt: 1.5 }} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Box>
  )
}

export default EmptyState
