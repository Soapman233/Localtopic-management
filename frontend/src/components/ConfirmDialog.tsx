/** 二次确认对话框（批量 / 文件级操作的「影响条数」确认）。
 *
 * 产品要求（PRD 3.2 / Q6）：
 * - **知识点批量否决**：先显示「将否决 N 条关联」再确认；
 * - **文件级元数据编辑**：年级/教材是文件级字段（改一题 = 改该文件全部题），
 *   必须先显示「将影响 N 道题」并二次确认。
 *
 * 本组件把「影响条数」以醒目方式居中呈现，避免用户误操作批量写入。
 */
import type { ReactNode } from 'react'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** 影响条数；为 ``null`` / ``undefined`` 时不展示条数强调块。 */
  impactCount?: number | null
  /** 条数单位文案，如「条关联」「道题」。 */
  impactLabel?: string
  /** 影响条数前的引导语，如「将否决」「将影响」。 */
  impactPrefix?: string
  /** 详细说明（可含富文本）。 */
  children?: ReactNode
  confirmText?: string
  confirmColor?: 'primary' | 'error' | 'warning' | 'success'
  loading?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** 通用二次确认对话框。 */
export function ConfirmDialog({
  open,
  title,
  impactCount,
  impactLabel = '条',
  impactPrefix = '将影响',
  children,
  confirmText = '确认',
  confirmColor = 'primary',
  loading = false,
  error = null,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const hasCount = typeof impactCount === 'number'
  return (
    <Dialog open={open} onClose={loading ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningAmberIcon color="warning" fontSize="small" />
        {title}
      </DialogTitle>
      <DialogContent>
        {hasCount && (
          <Alert severity="warning" sx={{ mb: 1.5 }} icon={false}>
            <Stack alignItems="center" spacing={0.25}>
              <Typography variant="body2" color="text.secondary">
                {impactPrefix}
              </Typography>
              <Typography variant="h4" component="div" fontWeight={500} color="warning.dark">
                {impactCount.toLocaleString('zh-CN')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {impactLabel}
              </Typography>
            </Stack>
          </Alert>
        )}
        {children && <Typography variant="body2">{children}</Typography>}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          onClick={onConfirm}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConfirmDialog
