/**
 * 数据维护（B1 信息架构重构，方案 §2.2）。
 *
 * 把四个**低频**维护页（知识点复核 / 公式复核 / 来源文件 / 题库统计）收进一个页面，
 * 侧栏只保留一个「数据维护」入口——老师日常不再被维护页淹没，但功能一个不少。
 *
 * 设计要点：
 * - **Tab 状态由 pathname 派生**（`/manage/<tab>`）：不维护第二份本地 state，
 *   刷新 / 深链 / 前进后退都与 URL 一致（`maintenanceTabFromPath` 是纯函数，便于单测）。
 * - 每个 Tab 有 `id` + `aria-controls`；当前 panel 有 `id` + `aria-labelledby`。
 * - **非活动 Tab 不挂载**：`Outlet` 只渲染当前子路由，四套查询 / 表单不会同时运行。
 * - 子页面在 `Suspense` 内懒加载（router 层已 `lazy`），加载态复用全站统一 `LoadingState`。
 *
 * ⚠️ 边界：本页只做「容器 + Tab 导航」。四个子页组件**本轮不改内部**，
 * 其标题层级（h1→h2 下沉）由后续批次负责；当前子页仍各自渲染自己的标题。
 */
import { Suspense } from 'react'
import { Box, Tab, Tabs, Typography } from '@mui/material'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import LoadingState from '../components/LoadingState'

/** 一个维护 Tab：`value` 同时用作 URL 段（`/manage/<value>`）与 Tab 标识。 */
export interface MaintenanceTab {
  value: string
  label: string
}

/** 四个维护 Tab（顺序即侧栏顺序：知识点 → 公式 → 来源 → 统计）。 */
export const MAINTENANCE_TABS: MaintenanceTab[] = [
  { value: 'knowledge', label: '知识点复核' },
  { value: 'formula-review', label: '公式复核' },
  { value: 'sources', label: '来源文件' },
  { value: 'stats', label: '题库统计' },
]

/** 未指定或未知子路径时落到「知识点复核」。 */
export const DEFAULT_MAINTENANCE_TAB = 'knowledge'

/**
 * 由 pathname 派生当前 Tab（纯函数）。
 *
 * 只认 `/manage/<tab>`：`/manage`、`/manage/未知` 一律回落到默认 Tab，
 * 保证 Tabs 的 `value` 永远命中某个 Tab（MUI 在 value 无匹配时不选中任何项）。
 */
export function maintenanceTabFromPath(pathname: string): string {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  const seg = clean.startsWith('manage/') ? clean.slice('manage/'.length).split('/')[0] : ''
  return MAINTENANCE_TABS.some((t) => t.value === seg) ? seg : DEFAULT_MAINTENANCE_TAB
}

export default function DataMaintenancePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = maintenanceTabFromPath(location.pathname)

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        数据维护
      </Typography>
      <Tabs
        value={active}
        onChange={(_, value: string) => navigate(`/manage/${value}`)}
        aria-label="数据维护分区"
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {MAINTENANCE_TABS.map((tab) => (
          <Tab
            key={tab.value}
            value={tab.value}
            label={tab.label}
            id={`manage-tab-${tab.value}`}
            aria-controls={`manage-panel-${tab.value}`}
          />
        ))}
      </Tabs>
      {/* 仅当前 Tab 的面板被挂载（其余 Tab 的子路由不渲染）——见顶部「非活动 Tab 不挂载」。
          id / aria-labelledby 与当前 Tab 一一对应，读屏可正确关联。 */}
      <Box
        role="tabpanel"
        id={`manage-panel-${active}`}
        aria-labelledby={`manage-tab-${active}`}
        tabIndex={0}
        sx={{ pt: 2 }}
      >
        <Suspense fallback={<LoadingState label="页面加载中…" />}>
          <Outlet />
        </Suspense>
      </Box>
    </Box>
  )
}
