/**
 * 导出结果展示（R2 抽取）：产物路径 / 大小 / 题数页数 / 缓存命中 / 警告。
 *
 * 导出抽屉（`components/ExportDrawer.tsx`）与导出页（`pages/ExportPage.tsx`）
 * 共用同一份展示，避免两处各写一遍导致字段不一致。
 */
import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import type { ExportJobResult } from '../api/types'

export interface ExportResultPanelProps {
  result: ExportJobResult
}

export function ExportResultPanel({ result }: ExportResultPanelProps) {
  return (
    <Box>
      {result.docx && (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          DOCX：{result.docx}
          {typeof result.docx_size_bytes === 'number' ? `（${(result.docx_size_bytes / 1024).toFixed(0)} KB）` : ''}
        </Typography>
      )}
      {result.pdf && (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          PDF：{result.pdf}
          {typeof result.pdf_size_bytes === 'number' ? `（${(result.pdf_size_bytes / 1024).toFixed(0)} KB）` : ''}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
        {typeof result.question_count === 'number' && (
          <Chip size="small" variant="outlined" label={`题数 ${result.question_count}`} />
        )}
        {typeof result.page_count === 'number' && (
          <Chip size="small" variant="outlined" label={`页数 ${result.page_count}`} />
        )}
        {typeof result.formulas_written === 'number' && (
          <Chip size="small" variant="outlined" label={`写入公式 ${result.formulas_written}`} />
        )}
        {typeof result.images_written === 'number' && (
          <Chip size="small" variant="outlined" label={`写入图片 ${result.images_written}`} />
        )}
        {result.cached && <Chip size="small" color="success" variant="outlined" label="命中缓存" />}
      </Stack>
      {(result.warnings ?? []).length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {result.warnings!.map((w, i) => (
            <div key={i}>· {w}</div>
          ))}
        </Alert>
      )}
      {!(result.docx || result.pdf) && (
        <Typography variant="body2" color="text.secondary">
          作业已完成（后端未返回产物路径字段）。
        </Typography>
      )}
    </Box>
  )
}

export default ExportResultPanel
