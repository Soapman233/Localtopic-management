/** 公式编辑浮层（PRD 3.4 方案 A「源码 + 实时预览」）。
 *
 * 左侧 = LaTeX 源码输入框（预填当前 `formulas.latex`）；右侧 = KaTeX 实时预览。
 * **渲染失败时阻止保存并高亮错误**（不静默写入）。
 * 题干结构（占位符与 fid）不变——只改公式内容。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { KatexFormula, validateLatex } from './KatexFormula'

export interface FormulaEditorProps {
  open: boolean
  /** 公式 fid（仅编辑现有公式）。 */
  fid: string | null
  /** 当前 LaTeX（打开时预填）。 */
  initialLatex: string
  onClose: () => void
  /** 确认写回（仅在 LaTeX 可渲染时调用）。 */
  onConfirm: (latex: string) => void
}

/** 公式编辑对话框：源码 + 实时预览 + 保存前校验。 */
export function FormulaEditor({ open, fid, initialLatex, onClose, onConfirm }: FormulaEditorProps) {
  const [latex, setLatex] = useState(initialLatex)

  useEffect(() => {
    if (open) setLatex(initialLatex)
  }, [open, initialLatex, fid])

  const validation = useMemo(() => validateLatex(latex), [latex])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        编辑公式 {fid ? <Typography component="span" color="text.secondary">（{fid}）</Typography> : null}
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="LaTeX 源码"
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            multiline
            minRows={6}
            fullWidth
            error={!validation.ok}
            helperText={validation.ok ? '输入即渲染；保存前会校验可渲染性' : validation.error}
            InputProps={{ sx: { fontFamily: 'Consolas, Menlo, monospace', fontSize: 14 } }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" gutterBottom>
              实时预览
            </Typography>
            <Box
              sx={{
                minHeight: 120,
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 1,
                border: '1px dashed',
                borderColor: validation.ok ? 'divider' : 'error.main',
                overflowX: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {latex.trim() ? (
                <KatexFormula latex={latex} displayMode />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  请输入 LaTeX 源码
                </Typography>
              )}
            </Box>
            {!validation.ok && (
              <Alert severity="error" sx={{ mt: 1 }}>
                渲染失败，无法保存：{validation.error}
              </Alert>
            )}
            <Alert severity="info" sx={{ mt: 1 }}>
              保存整道题后，该公式会标记为已处理；请先对照源图确认内容正确。
            </Alert>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!validation.ok}
          onClick={() => onConfirm(latex)}
        >
          确定
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default FormulaEditor
