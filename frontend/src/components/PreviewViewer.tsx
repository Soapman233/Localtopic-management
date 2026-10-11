/** A4 分页预览查看器（P0-11 / PRD 3.3「先预览再导出」）。
 *
 * 展示后端渲染的像素级页面位图（`page_N.png`），支持缩放/翻页。
 * 说明：预览与最终导出走**同一份 plan 与同一个 DOCX 渲染器**，故版式与导出逐像素一致。
 */
import { useEffect, useState } from 'react'
import { Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import type { PreviewPage } from '../api/types'

export interface PreviewViewerProps {
  pages: PreviewPage[]
  /** 命中缓存标识（展示「已命中缓存，无需重渲染」提示）。 */
  cached?: boolean
}

/** A4 分页预览：每页一张白色纸张卡片，图片按比例缩放。 */
export function PreviewViewer({ pages, cached }: PreviewViewerProps) {
  const [zoom, setZoom] = useState(1)

  // 页码变化时重置缩放，避免跨卷错位观感。
  useEffect(() => {
    setZoom(1)
  }, [pages])

  if (pages.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        暂无预览页。
      </Typography>
    )
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap">
        <Tooltip title="缩小">
          <IconButton size="small" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button size="small" onClick={() => setZoom(1)} startIcon={<RestartAltIcon />}>
          {Math.round(zoom * 100)}%
        </Button>
        <Tooltip title="放大">
          <IconButton size="small" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Chip size="small" label={`共 ${pages.length} 页`} variant="outlined" />
        {cached && <Chip size="small" color="success" variant="outlined" label="命中缓存" />}
      </Stack>

      <Box
        sx={{
          bgcolor: '#EDEFF2',
          borderRadius: 1,
          p: 2,
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      >
        <Stack spacing={2} alignItems="center">
          {pages.map((page) => (
            <Paper
              key={page.n}
              elevation={2}
              sx={{
                width: `${Math.round(794 * zoom)}px`,
                maxWidth: '100%',
                p: 0,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  top: 4,
                  left: 8,
                  color: 'text.secondary',
                  bgcolor: 'rgba(255,255,255,.75)',
                  px: 0.5,
                  borderRadius: '4px',
                }}
              >
                第 {page.n} 页
              </Typography>
              <Box
                component="img"
                src={page.url}
                alt={`预览第 ${page.n} 页`}
                sx={{ display: 'block', width: '100%', height: 'auto' }}
              />
            </Paper>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}

export default PreviewViewer
