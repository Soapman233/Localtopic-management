/** 统一「错误态」：查询失败等**页面内**错误的标准呈现（四态规范之「错误态」）。
 *
 * 与 `ErrorBoundary` 的分工
 * -----------------------
 * - `components/ErrorBoundary.tsx`：**页面级**渲染异常兜底（挂在 `App.tsx` 的 `Outlet` 外）；
 * - 本组件：**页面内**的查询 / 请求失败（`isError`），提供「重试」而不影响其它页面。
 * 两者互补。
 *
 * 设计要点（对应 P0-1 术语外泄）
 * ----------------------------
 * - 主文案走 `api/errors.describeApiError()` → **教师可读**，不出现错误码 / 堆栈；
 * - 原始技术细节（message / stack / code）**默认折叠**在「给技术人员的信息」里，
 *   且**仅在 debug 模式**（`glossary.isDebugMode()`）下才渲染原始堆栈——
 *   老师默认看不到，维护者仍可排查（口径与 `glossary.ts` 一致）。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RefreshIcon from '@mui/icons-material/Refresh'
import { describeApiError, isApiError } from '../api/errors'
import { describeTechnicalInfo, isDebugMode } from '../lib/glossary'

/** 取出原始技术细节（含堆栈）——仅供 debug 折叠区。 */
function describeTechnicalDetail(error: unknown): string {
  if (error instanceof Error) {
    const head = isApiError(error) ? `[code ${error.code} / HTTP ${error.status}] ` : ''
    return `${head}${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

export interface ErrorStateProps {
  /** 原始错误对象（`ApiError` / `Error` / 任意抛出物）。 */
  error: unknown
  /** 标题；默认「加载失败」。 */
  title?: ReactNode
  /** 教师可读的补充说明（可选）。 */
  description?: ReactNode
  /** 提供时渲染「重试」按钮。 */
  onRetry?: () => void
  /** 重试按钮文案，默认「重试」。 */
  retryLabel?: string
  /** 紧凑模式：用于表格单元 / 折叠区内的错误，不展示技术细节折叠区。 */
  dense?: boolean
}

/** 统一错误态（教师可读 + 可重试 + 技术细节默认折叠）。 */
export function ErrorState({
  error,
  title = '加载失败',
  description,
  onRetry,
  retryLabel = '重试',
  dense = false,
}: ErrorStateProps) {
  // 调试模式在挂载时判定一次即可（URL ?debug=1 或 localStorage qb_debug=1）。
  const [debug] = useState(() => isDebugMode())
  const message = describeApiError(error)
  const detail = describeTechnicalDetail(error)

  return (
    <Box sx={{ width: '100%' }}>
      {/* MUI Alert 自带 role="alert"，满足无障碍要求 */}
      <Alert severity="error" variant="outlined" sx={{ alignItems: 'flex-start' }}>
        <AlertTitle>{title}</AlertTitle>
        <Typography variant="body2" sx={{ wordBreak: 'break-word', mb: description || onRetry ? 1 : 0 }}>
          {message}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: onRetry ? 1 : 0 }}>
            {description}
          </Typography>
        ) : null}
        {onRetry ? (
          <Button size="small" variant="contained" startIcon={<RefreshIcon />} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}

        {!dense && (
          <Accordion
            disableGutters
            elevation={0}
            sx={{ mt: 1, bgcolor: 'transparent', '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 32 }}>
              <Typography variant="caption" color="text.secondary">
                {describeTechnicalInfo()}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              {debug ? (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    fontSize: 12,
                    lineHeight: 1.5,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    overflow: 'auto',
                    maxHeight: 240,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {detail}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  原始错误信息默认隐藏。需要排查时，在网址后加 ?debug=1（或开启调试模式）即可查看。
                </Typography>
              )}
            </AccordionDetails>
          </Accordion>
        )}
      </Alert>
    </Box>
  )
}

export default ErrorState
