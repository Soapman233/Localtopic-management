/**
 * 面包屑条（设计规范 §4 P0）。
 *
 * 参考截图里的标志性元素：内容区左上角一行「上级 › 当前页」，让老师随时知道自己在哪、
 * 一键回到上级。
 *
 * 三条设计决定
 * ------------
 * 1. **由路由派生，不新增状态**：节点来自 `lib/routeMeta.deriveCrumbs`（纯函数）。
 *    页面组件无需手写节点数组，也就不会出现「某页忘了加面包屑」。
 * 2. **返回 `[]` 时不渲染**：侧栏可见的顶层页（组卷/找题/导入/设置）只有一级，
 *    渲染单节点面包屑是纯噪音。因此调用方（`PageHeader`）可以**无条件**放它。
 * 3. **是真链接（`<a>`）而非按钮**：面包屑是导航，语义必须是链接——
 *    右键「新标签打开」、读屏「链接」播报都依赖这一点。
 *    同时用 `href="#/path"`（HashRouter 口径）保证链接本身可复制、可分享；
 *    点击则交给 `useAppNavigate`（带 View Transition 与「减少动效」降级），
 *    且**只在无修饰键的普通左键点击时拦截**，Ctrl/⌘/中键等仍走浏览器默认行为。
 */
import type { SxProps, Theme } from '@mui/material'
import { Breadcrumbs, Link as MuiLink, Typography } from '@mui/material'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import { useLocation } from 'react-router-dom'
import { useAppNavigate } from '../lib/navigation'
import { deriveCrumbs, type Crumb } from '../lib/routeMeta'

export interface BreadcrumbBarProps {
  /**
   * 显式指定节点；**不传则按当前路由自动派生**。
   * 传 `[]` 表示明确不要面包屑（自动派生结果非空时用于抑制）。
   */
  items?: Crumb[]
  /** 覆盖末级文案（详情页用「题 123」——题号来自数据，路由推不出来）。 */
  currentLabel?: string
  sx?: SxProps<Theme>
}

/** 面包屑条。自动派生为空时不渲染任何内容。 */
export function BreadcrumbBar({ items, currentLabel, sx }: BreadcrumbBarProps) {
  const location = useLocation()
  const navigate = useAppNavigate()
  const crumbs = items ?? deriveCrumbs(location.pathname, { currentLabel })

  if (crumbs.length === 0) return null

  return (
    <Breadcrumbs
      aria-label="面包屑导航"
      separator={<NavigateNextIcon fontSize="inherit" sx={{ fontSize: 16, opacity: 0.6 }} />}
      sx={{ mb: 0.75, fontSize: 13, lineHeight: 1.6, ...sx }}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        // 末级（当前页）恒为纯文本——当前页不该链接到自身。
        if (!crumb.to || isLast) {
          return (
            <Typography
              key={`${crumb.label}-${i}`}
              component="span"
              color="text.primary"
              sx={{ fontSize: 'inherit', fontWeight: 500 }}
              aria-current={isLast ? 'page' : undefined}
            >
              {crumb.label}
            </Typography>
          )
        }
        return (
          <MuiLink
            key={`${crumb.label}-${i}`}
            // HashRouter 口径：链接本身指向 `#/path`，可复制可分享。
            href={`#${crumb.to}`}
            onClick={(e) => {
              // 只在「无修饰键的普通左键点击」时接管，其余（新标签打开、下载等）交给浏览器。
              if (e.defaultPrevented || e.button !== 0) return
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              navigate(crumb.to as string)
            }}
            underline="hover"
            color="text.secondary"
            sx={{
              fontSize: 'inherit',
              cursor: 'pointer',
              // 与全站焦点环口径一致（2px 实线 + 外扩 2px）。
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
                borderRadius: '4px',
              },
            }}
          >
            {crumb.label}
          </MuiLink>
        )
      })}
    </Breadcrumbs>
  )
}

export default BreadcrumbBar
