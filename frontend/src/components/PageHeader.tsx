/**
 * 页面标题区（设计规范 §4 P0）。
 *
 * 统一「**大标题 + 灰色元信息行 + 右侧操作区**」三段式。
 *
 * 为什么需要它
 * ------------
 * 改造前各页标题各写各的：`h5 component="h1"` / `h6 component="h1"` /
 * `h6 component="div"` 混用，字号、上下间距、操作按钮位置全不一致——
 * 老师在不同页面之间切换时，「标题在哪、操做在哪」都要重新找一遍。
 *
 * 层级约定（**不要绕过它手写 h1**）
 * -------------------------------
 * - `level="page"`（默认）→ 视觉 `h5`、语义 `<h1>`：一个页面**有且只有一个**；
 * - `level="section"` → 视觉 `h6`、语义 `<h2>`：用于 Tab 子页 / 页内一级分区。
 *
 * 维护页（`DataMaintenancePage`）是父页 h1，四个 Tab 子页必须用 `level="section"`，
 * 否则会出现「双 h1」（B4 批次修过的真实缺陷）。
 *
 * 面包屑由 `BreadcrumbBar` 承载，**默认按当前路由自动派生**：
 * 侧栏可见的顶层页会派生出空数组（不渲染），所以这里可以无条件放。
 */
import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { Box, Stack, Typography } from '@mui/material'
import BreadcrumbBar from './BreadcrumbBar'
import type { Crumb } from '../lib/routeMeta'

export interface PageHeaderProps {
  /** 主标题。 */
  title: ReactNode
  /** 灰色元信息行（如「共 7945 题 · 最后更新 10-12」）。窄屏自动换行。 */
  meta?: ReactNode
  /** 右侧操作区（主按钮 / 次要按钮）。窄屏会落到标题下方整行。 */
  actions?: ReactNode
  /**
   * 面包屑节点。**不传 = 按当前路由自动派生**（推荐）；
   * 传 `[]` 可强制不显示。
   *
   * ⚠️ `level="section"` 时**默认不派生**（父页已给过面包屑，避免重复一条）。
   */
  breadcrumbs?: Crumb[]
  /** 覆盖面包屑末级文案（详情页传「题 123」）。 */
  currentLabel?: string
  /** 标题层级。默认 `page`（h5/h1）。 */
  level?: 'page' | 'section'
  sx?: SxProps<Theme>
}

/** 页面标题区。 */
export function PageHeader({
  title,
  meta,
  actions,
  breadcrumbs,
  currentLabel,
  level = 'page',
  sx,
}: PageHeaderProps) {
  const isPage = level === 'page'

  // 面包屑：**`level="section"` 默认不渲染**。
  //
  // 理由：`section` 的语义就是「渲染在某个父页内部」，而父页（`level="page"`）已经在
  // 同一个位置给过面包屑了。实测踩过：维护页父页与 Tab 子页各自派生一次，
  // 屏幕上出现**两条一模一样**的「数据维护 › 知识点复核」，看起来像渲染 bug。
  // 需要时仍可用 `breadcrumbs` 显式传入覆盖。
  const crumbs = breadcrumbs ?? (isPage ? undefined : [])

  return (
    <Box sx={{ mb: isPage ? 2.5 : 2, ...sx }}>
      <BreadcrumbBar items={crumbs} currentLabel={currentLabel} />
      <Stack
        // 窄屏纵向堆叠（操作按钮落到下一行、整行易点按），宽屏横向并排。
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant={isPage ? 'h5' : 'h6'}
            component={isPage ? 'h1' : 'h2'}
            sx={{ wordBreak: 'break-word' }}
          >
            {title}
          </Typography>
          {meta ? (
            <Box
              sx={{
                mt: 0.5,
                color: 'text.secondary',
                fontSize: 13,
                lineHeight: 1.7,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 0.25,
              }}
            >
              {meta}
            </Box>
          ) : null}
        </Box>
        {actions ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              flexShrink: 0,
              flexWrap: 'wrap',
              gap: 1,
              // 窄屏按钮撑满整行更好点按；宽屏靠右。
              '& > *': { flexGrow: { xs: 1, sm: 0 } },
            }}
          >
            {actions}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}

export default PageHeader
