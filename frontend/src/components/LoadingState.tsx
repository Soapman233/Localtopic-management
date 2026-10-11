/** 统一「加载态」：列表 / 面板**首屏加载**时的标准呈现（四态规范之「加载态」）。
 *
 * 背景（前端重构方案 §2.2 P1-4 / P1-1）
 * --------------------------------
 * 此前 `CircularProgress` 散落在 13 个文件，尺寸（14/16/18/20/24）与位置各不相同，
 * 同一「首屏加载」场景在不同页面长得不一样。本组件把「加载中」收敛为**唯一呈现**：
 * 居中的 `CircularProgress`（默认 20px）+ 可选文案，`role="status"` 供读屏播报。
 *
 * 使用约定
 * --------
 * - **首屏加载**（`isLoading` 且尚无数据）→ 用本组件；
 * - **后台刷新**（已有数据、`isFetching`）→ 用行内小号 spinner，不要用本组件（会闪空）。
 *
 * ⚠️ 只改「呈现方式」：什么时候显示加载态仍由各页原有的 `isLoading` 判定控制。
 */
import type { ReactNode } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'

export interface LoadingStateProps {
  /** 加载文案；传 `null` 只显示转圈。 */
  label?: ReactNode
  /** 转圈尺寸（px），默认 20——**全站首屏加载统一尺寸**。 */
  size?: number
  /** 紧凑模式：左对齐、少量留白，用于表格单元 / 抽屉 / 折叠区内。 */
  dense?: boolean
}

/** 统一加载态。 */
export function LoadingState({ label = '加载中…', size = 20, dense = false }: LoadingStateProps) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        justifyContent: dense ? 'flex-start' : 'center',
        alignItems: 'center',
        py: dense ? 0.5 : 4,
        width: '100%',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={size} />
        {label ? (
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}

export default LoadingState
