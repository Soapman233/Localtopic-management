/** 页面级错误边界：单页渲染异常时**不再整站白屏**，而是给出可恢复的兜底界面。
 *
 * 背景（前端重构方案 §2.2 P1-2）
 * ----------------------------
 * 此前全站**没有 ErrorBoundary**：任一页面渲染抛错（例如后端返回了意外结构、
 * 某个字段为 undefined）都会让整个 SPA 白屏，且用户没有任何恢复入口。
 *
 * 设计要点
 * --------
 * - **按页包裹**（挂在路由 Outlet 外层），一个页面崩不影响导航与其它页面；
 * - `resetKeys` 传当前路由：**切换页面自动重置**边界，用户能自行脱困；
 * - 技术细节默认**折叠**，避免把堆栈直接糊到老师脸上（对应 P0-1 术语外泄问题）。
 */
import type { ReactNode } from 'react'
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RefreshIcon from '@mui/icons-material/Refresh'

/** 从 unknown 里安全取出可读信息。 */
function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null }
  }
  if (typeof error === 'string') return { message: error, stack: null }
  try {
    return { message: JSON.stringify(error), stack: null }
  } catch {
    return { message: '未知错误', stack: null }
  }
}

function PageErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { message, stack } = describe(error)
  return (
    <Box sx={{ p: 3, maxWidth: 760, mx: 'auto' }}>
      <Alert severity="error" variant="outlined">
        <AlertTitle>这个页面出错了</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>
          其它页面不受影响，可以继续使用。你可以先「重试」，若仍失败请刷新页面。
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, wordBreak: 'break-word' }}>
          {message}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => resetErrorBoundary()}
          >
            重试
          </Button>
          <Button size="small" onClick={() => window.location.reload()}>
            刷新页面
          </Button>
        </Stack>

        {(stack || message) && (
          <Accordion disableGutters elevation={0} sx={{ mt: 2, bgcolor: 'transparent' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 36 }}>
              <Typography variant="caption" color="text.secondary">
                给技术人员的信息
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0 }}>
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
                }}
              >
                {stack || message}
              </Box>
            </AccordionDetails>
          </Accordion>
        )}
      </Alert>
    </Box>
  )
}

export interface ErrorBoundaryProps {
  children: ReactNode
  /** 变化时自动重置边界（通常传当前路由 key）。 */
  resetKeys?: unknown[]
}

/** 页面级错误边界（默认兜底界面为中文教师语言）。 */
export default function ErrorBoundary({ children, resetKeys }: ErrorBoundaryProps) {
  return (
    <ReactErrorBoundary FallbackComponent={PageErrorFallback} resetKeys={resetKeys}>
      {children}
    </ReactErrorBoundary>
  )
}
