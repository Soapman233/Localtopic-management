/**
 * 右侧滑出面板（SlideOver，设计规范 §4 P2）。
 *
 * 参考截图里「新建 / 编辑」类操作的做法：从右侧滑入一个面板，**不打断当前页面上下文**
 * （底下的列表还在，滑出后位置不丢），比模态 Dialog 更轻。
 *
 * 何时用 SlideOver、何时仍用 Dialog
 * --------------------------------
 * - **SlideOver**：承载「填一个表单然后提交」的流程（新建试卷、编辑元数据…）。
 *   优势是保留背景上下文、可容纳较长的表单而不显得压抑。
 * - **仍用 `ConfirmDialog`**：破坏性操作的二次确认（删除试卷等）。
 *   确认框要「挡住一切、必须表态」，滑出面板会削弱这个语气。
 *
 * 无障碍：MUI `Drawer` 自身**不设 `role`**（模态根是 `role="presentation"`），
 * 与 MUI `Dialog` 不一致。这里显式把 `role="dialog"` 与可访问名放到 `Paper` 上，
 * 与 `App.tsx` 里既有抽屉的做法保持一致，读屏才会把它当对话框播报。
 */
import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { Box, Divider, Drawer, IconButton, Stack, Toolbar, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

export interface SlideOverProps {
  open: boolean
  onClose: () => void
  /** 面板标题（同时作为可访问名）。 */
  title: ReactNode
  /** 标题行右侧的操作（如「创建」按钮）。 */
  actions?: ReactNode
  children: ReactNode
  /**
   * 宽度。默认 `440`，窄屏（`xs`）**自动铺满**——手机上留一条缝只会挤压表单。
   */
  width?: number | string
  /** 标题下方的补充说明。 */
  description?: ReactNode
  /** 可访问名的 DOM id（同页有多个 SlideOver 时用于区分）。 */
  labelledById?: string
  /** 面板内容的额外样式。 */
  sx?: SxProps<Theme>
}

/** 右侧滑出面板。 */
export function SlideOver({
  open,
  onClose,
  title,
  actions,
  children,
  width = 440,
  description,
  labelledById,
  sx,
}: SlideOverProps) {
  const titleId = labelledById ?? 'slide-over-title'

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      PaperProps={{ role: 'dialog', 'aria-labelledby': titleId }}
      sx={{
        // 窄屏铺满（`100%`），宽屏用给定宽度。
        [`& .MuiDrawer-paper`]: {
          width: { xs: '100%', sm: typeof width === 'number' ? `${width}px` : width },
          maxWidth: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* 占位，避免面板内容被固定顶栏遮住。 */}
      <Toolbar variant="dense" />
      <Stack
        direction="row"
        spacing={1}
        alignItems="flex-start"
        sx={{ px: 2, pt: 1, pb: 1.25, flexShrink: 0 }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography id={titleId} variant="subtitle1" component="h2" sx={{ fontWeight: 500 }}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
          {actions}
          <IconButton size="small" aria-label="关闭" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
      <Divider />
      <Box sx={{ p: 2, overflowY: 'auto', flexGrow: 1, ...sx }}>{children}</Box>
    </Drawer>
  )
}

export default SlideOver
