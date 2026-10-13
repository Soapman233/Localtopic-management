/**
 * 分区卡片（设计规范 §4 P0）。
 *
 * 统一「**标题行 + 右侧元信息 / 操作 + 内容**」的卡片头（参考截图里
 * 「我关注的任务 (3)」那种样式），用于把一页里的若干独立区块**分组**。
 *
 * 两种外观
 * --------
 * - `variant="card"`（默认）：独立卡片（1px 描边 + 16px 圆角，与全站 `Card` 同口径）。
 *   用于「区块之间互相独立、各自成块」的场景（如组卷页右栏的「试卷设置」「内容检查」）。
 * - `variant="plain"`：**不画卡片**，只有标题行 + 1px 分隔线。
 *   用于「已经在一张卡片/抽屉内部」再分小节——再套一层卡会变成「卡片里的卡片」，
 *   视觉上会碎（这是筛选栏改造时踩过的同一个坑）。
 *
 * 层级约定：`level="section"`（默认，语义 `<h2>`）/ `level="subsection"`（语义 `<h3>`）。
 * **不要**用它渲染页面主标题——那是 `PageHeader` 的职责。
 */
import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { Box, Divider, Paper, Stack, Typography } from '@mui/material'

export interface SectionCardProps {
  /** 区块标题。省略则不渲染标题行（只有内容）。 */
  title?: ReactNode
  /** **标题右侧**的元信息（计数、状态徽章等）。 */
  meta?: ReactNode
  /** 标题行最右侧的操作（按钮 / 图标按钮）。 */
  actions?: ReactNode
  children: ReactNode
  /** `card` = 独立卡片（默认）；`plain` = 仅标题行 + 分隔线。 */
  variant?: 'card' | 'plain'
  /** 标题语义层级：`section` = h2（默认），`subsection` = h3。 */
  level?: 'section' | 'subsection'
  /** 去掉内容区内边距（内容自管边距，如整块表格）。 */
  disablePadding?: boolean
  sx?: SxProps<Theme>
  /** 内容区额外样式。 */
  contentSx?: SxProps<Theme>
}

/** 分区卡片。 */
export function SectionCard({
  title,
  meta,
  actions,
  children,
  variant = 'card',
  level = 'section',
  disablePadding = false,
  sx,
  contentSx,
}: SectionCardProps) {
  const isCard = variant === 'card'
  const hasHeader = Boolean(title || meta || actions)

  const header = hasHeader ? (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="space-between"
      sx={{ px: isCard ? 2 : 0, pt: isCard ? 1.75 : 0, pb: isCard ? 1.25 : 1 }}
    >
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0, flexWrap: 'wrap' }}>
        {title ? (
          <Typography
            variant="subtitle1"
            component={level === 'section' ? 'h2' : 'h3'}
            sx={{ fontWeight: 500, lineHeight: 1.5 }}
          >
            {title}
          </Typography>
        ) : null}
        {meta ? (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {meta}
          </Typography>
        ) : null}
      </Stack>
      {actions ? (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      ) : null}
    </Stack>
  ) : null

  const body = (
    <Box
      sx={{
        // `disablePadding` 让内容自管边距（整块表格 / 已有内边距的区块）。
        // ⚠️ 这个分支必须真的生效：先前只声明未使用，调用方传了没反应，
        //    只能各自用 `contentSx={{ p: 0 }}` 绕过（本轮被 agent 实测发现）。
        px: disablePadding ? 0 : isCard ? 2 : 0,
        pb: disablePadding ? 0 : isCard ? 2 : 0,
        pt: disablePadding ? 0 : hasHeader && isCard ? 0 : isCard ? 2 : 0,
        ...contentSx,
      }}
    >
      {children}
    </Box>
  )

  if (!isCard) {
    return (
      <Box sx={sx}>
        {header}
        {hasHeader ? <Divider /> : null}
        <Box sx={{ pt: hasHeader ? 1.5 : 0 }}>{body}</Box>
      </Box>
    )
  }

  return (
    <Paper
      variant="outlined"
      // 与全站 Card 同口径（theme 的 MuiCard 用 16px）；显式写像素值，
      // 避免 sx 的数字写法被当作 `shape.borderRadius × n` 放大成 24px。
      sx={{ borderRadius: '16px', overflow: 'hidden', ...sx }}
    >
      {header}
      {header ? <Divider /> : null}
      {body}
    </Paper>
  )
}

export default SectionCard
