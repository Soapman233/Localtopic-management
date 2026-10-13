import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AppBar,
  Alert,
  AlertTitle,
  Box,
  Collapse,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import EditNoteIcon from '@mui/icons-material/EditNote'
import ChecklistIcon from '@mui/icons-material/Checklist'
import SettingsIcon from '@mui/icons-material/Settings'
import { Outlet, useLocation } from 'react-router-dom'
import { isSafeMotionPath, useAppNavigate } from './hooks/useAppNavigate'
import { useReducedMotion } from './hooks/useReducedMotion'
import api from './api/client'
import { qk } from './api/queryKeys'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingState from './components/LoadingState'
import { PaperSwitcher } from './components/PaperSwitcher'
import { SessionControls, SessionNotice } from './components/SessionControls'
import { listPapers } from './api/papers'
import { usePaperStore } from './store/paperStore'
import type { HealthData, Paper } from './api/types'

import { usePaperLibraryStore } from './store/paperLibraryStore'
import { documentTitleForPath, selectedNavPath } from './app/routeMetadata'
export { BASE_TITLE, documentTitleForPath } from './app/routeMetadata'

const PaperLibraryDrawer = lazy(() => import('./components/PaperLibraryDrawer'))
const DRAWER_WIDTH = 232

export interface NavItem {
  path: string
  label: string
  description: string
  icon: ReactNode
}

/** 导航分组：一个分组标题（渲染为 `ListSubheader`）+ 若干导航项。 */
export interface NavGroup {
  label: string
  items: NavItem[]
}

/** 日常入口与低频维护分组；业务路由集合独立保存在 router.tsx。 */
export const NAV_GROUPS: NavGroup[] = [
  { label: '日常', items: [
    { path: 'builder', label: '组卷工作台', description: '边找题边组卷', icon: <EditNoteIcon /> },
    { path: 'search', label: '找题', description: '检索题库', icon: <SearchIcon /> },
  ] },
  { label: '数据维护', items: [
    { path: 'manage', label: '数据维护', description: '复核、来源与统计', icon: <ChecklistIcon /> },
  ] },
]
/** 设置固定在底部；说明保留为帮助信息，不占据导航第二行。 */
export const SETTINGS_ITEM: NavItem = {
  path: 'settings', label: '设置', description: '数据库路径、导出目录与偏好', icon: <SettingsIcon />,
}
export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap(g => g.items), SETTINGS_ITEM]

/**
 * 单个侧栏导航按钮。
 *
 * 抽成独立组件是因为它内部要用 `useLocation` 判断选中态（`selected`），
 * 不能在 `App` 的 `render` 里以普通函数形式调用 Hooks。
 */
function NavListButton({ item, onNavigate }: { item: NavItem; onNavigate: (path: string) => void }) {
  const location = useLocation()
  // 用前缀匹配：治理页位于 /manage/* 子路径下，访问子路由时父项也应保持高亮。
  const selected = selectedNavPath(location.pathname) === item.path
  return (
    // P5-3：`aria-current="page"` 明确告诉读屏用户「当前就在这一页」，
    // 仅靠视觉高亮（selected）对读屏用户不可见。
    <ListItemButton selected={selected} aria-current={selected ? 'page' : undefined} onClick={() => onNavigate(item.path)}>
      <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
      <ListItemText primary={item.label} />
    </ListItemButton>
  )
}

function HealthBanner() {
  const { data, isError } = useQuery({
    queryKey: qk.health(),
    queryFn: () => api.get<HealthData>('/api/health'),
    retry: 1,
  })

  if (isError) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        <AlertTitle>无法连接后端</AlertTitle>
        请确认服务已启动（双击「启动题库.bat」或运行 python -m webui）。
      </Alert>
    )
  }
  if (data && data.degraded) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>运行环境降级</AlertTitle>
        {data.messages.map((m, i) => (
          <div key={i}>· {m}</div>
        ))}
      </Alert>
    )
  }
  return null
}

export default function App() {
  const location = useLocation()
  const navigate = useAppNavigate()
  const reducedMotion = useReducedMotion()
  const theme = useTheme()
  // P1-1 响应式：窄屏（<md，即 <900px）时侧栏改为临时抽屉（汉堡菜单开合），
  // 避免 232px 固定侧栏挤占内容区。桌面（≥md）保持常驻侧栏。
  const isNarrowNav = useMediaQuery(theme.breakpoints.down('md'))
  const [navOpen, setNavOpen] = useState(false)
  const onMaintenancePath = selectedNavPath(location.pathname) === 'manage'
  const [maintenanceOpen, setMaintenanceOpen] = useState(onMaintenancePath)
  useEffect(() => { if (onMaintenancePath) setMaintenanceOpen(true) }, [onMaintenancePath])

  // P5-3：路由变化时同步 document.title，让浏览器标签页 / 读屏播报当前页名。
  useEffect(() => {
    document.title = documentTitleForPath(location.pathname)
  }, [location.pathname])

  // ---- P1-6：「我的试卷」提升为全站可达 ----
  // 试卷切换器从组卷页顶部提升到全局 AppBar，任意页面都能切换 / 新建试卷。
  // 数据来源仍是 react-query（`qk.papers()`，与组卷页共用同一份缓存）；**唯一状态来源是 paperStore**。
  const currentPaperId = usePaperStore((s) => s.currentPaperId)
  const setCurrentPaperId = usePaperStore((s) => s.setCurrentPaperId)
  const setTargetSectionId = usePaperStore((s) => s.setTargetSectionId)
  const { open: paperListOpen, openPaperLibrary, closePaperLibrary } = usePaperLibraryStore()
  // 初次打开才请求抽屉模块；之后保留实例以让关闭后的重建提示继续可用。
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  useEffect(() => { if (paperListOpen) setLibraryLoaded(true) }, [paperListOpen])
  const papersQ = useQuery({ queryKey: qk.papers(), queryFn: () => listPapers() })
  // 防御性兜底：接口异常/契约变化时避免把非数组当列表（如后端错误体）。
  const papers: Paper[] = Array.isArray(papersQ.data) ? papersQ.data : []

  /** 统一切换试卷：写入唯一来源 `paperStore`，并跳到组卷页让切换效果立即可见（P1-6）。 */
  const switchPaper = (id: number) => {
    setCurrentPaperId(id)
    setTargetSectionId(null)
    closePaperLibrary()
    navigate('/builder')
  }

  /** 统一导航动作：跳转 +（窄屏时）收起临时抽屉。 */
  const handleNavigate = (path: string) => {
    navigate(`/${path}`)
    if (isNarrowNav) setNavOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* 跳到主内容（skip-link）——P5-3 无障碍语义。
          键盘用户首次 Tab 即可直达主内容，不必逐次 Tab 过侧栏 8 个导航项。
          ⚠️ 本项目用 HashRouter：若 `href="#main-content"` 走原生锚点会改写 location.hash，
          被路由当成路径 `/main-content`（进而重定向）。故拦截默认行为，改为「聚焦 + 滚动」主内容区。
          默认用 transform 移出视口（仍可被 Tab 聚焦），`:focus` 时滑入并显示焦点环（与 theme 的
          Button 焦点环口径一致：2px 实线 + 外扩 2px）。 */}
      <Box
        component="a"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          const el = document.getElementById('main-content')
          if (el) {
            el.focus()
            el.scrollIntoView()
          }
        }}
        sx={{
          position: 'fixed',
          top: 8,
          left: 8,
          zIndex: (t) => t.zIndex.tooltip + 1,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderRadius: 1,
          boxShadow: 3,
          textDecoration: 'none',
          fontSize: 14,
          transform: 'translateY(-200%)',
          transition: 'transform 120ms ease',
          '&:focus': {
            transform: 'translateY(0)',
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2,
          },
        }}
      >
        跳到主内容
      </Box>
      {/* P0/T02：顶栏底色改用派生**填充安全值** `primary.dark`——它恒按浅色底收敛，
          保证「白字压主色」≥4.5:1（任意合法主色，含历史 #3370FF）。浅色模式下它与
          `primary.main` 恒等，视觉零变化；深色模式下仍为深底白字，保持品牌观感。 */}
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'primary.dark' }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          {isNarrowNav && (
            <IconButton
              color="inherit"
              edge="start"
              size="small"
              aria-label="打开导航"
              onClick={() => setNavOpen(true)}
              sx={{ mr: 0 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          {/* 标题在超窄屏（<sm）让位给试卷切换器；桌面常显，不破版。 */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap component="div" sx={{ display: { xs: 'none', sm: 'block' } }}>
              初中物理 · 题库与组卷
            </Typography>
          </Box>
          {/* P1-6：试卷切换器提升到全局顶栏，任意页面可切换 / 新建试卷（窄屏自动收窄）。 */}
          <PaperSwitcher
            papers={papers}
            currentPaperId={currentPaperId}
            onSwitch={switchPaper}
            onOpenList={openPaperLibrary}
            compact={isNarrowNav}
          />
          {/* 阶段 4：当前用户 + 登出（**本地版渲染为空**）。 */}
          <SessionControls />
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isNarrowNav ? 'temporary' : 'permanent'}
        open={isNarrowNav ? navOpen : true}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        // P5-3：MUI 的 `Dialog` 会在 Paper 上设 `role="dialog"`（`Dialog.js:254`），
        // 而 **`Drawer` 完全不设 role**（`Drawer.js` 里搜不到 role），模态根默认 `role="presentation"`
        // → 读屏不会把它当对话框。故显式把 role 与可访问名放到 **Paper** 上（与 MUI Dialog 一致）。
        // 注：`permanent` 变体不是模态，不加 role。
        PaperProps={{
          'aria-label': '侧边导航',
          ...(isNarrowNav ? { role: 'dialog' } : {}),
        }}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar variant="dense" />
        {/* 分组导航：分组名用 ListSubheader 呈现（非交互元素，不进 Tab 序列）；
            系统设置用 mt:auto 顶到底部，与日常/治理两组视觉分离。
            P5-3：整块侧栏用 `<nav aria-label="主导航">` 承载，读屏用户可按地标快速跳转。 */}
        <Box component="nav" aria-label="主导航" sx={{ overflow: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <List subheader={<ListSubheader component="div" disableSticky>日常</ListSubheader>}>
            {NAV_GROUPS[0].items.map(item => <NavListButton key={item.path} item={item} onNavigate={handleNavigate} />)}
          </List>
          <List>
            <ListItemButton aria-label="展开数据维护" aria-expanded={maintenanceOpen}
              aria-controls="maintenance-nav" onClick={() => setMaintenanceOpen(value => !value)}>
              <ListItemText primary="数据维护" />
            </ListItemButton>
            <Collapse in={maintenanceOpen} id="maintenance-nav" unmountOnExit>
              {NAV_GROUPS[1].items.map(item => <NavListButton key={item.path} item={item} onNavigate={handleNavigate} />)}
            </Collapse>
          </List>
          <List sx={{ mt: 'auto' }}>
            <NavListButton item={SETTINGS_ITEM} onNavigate={handleNavigate} />
          </List>
        </Box>
      </Drawer>

      {/* 唯一管理宿主：首次打开才加载，与工作台及空态复用相同开关。 */}
      {(paperListOpen || libraryLoaded) && (
        <ErrorBoundary resetKeys={[paperListOpen]}>
          <Suspense fallback={<LoadingState label="试卷管理加载中…" />}>
            <PaperLibraryDrawer open={paperListOpen} onClose={closePaperLibrary} onSelectPaper={switchPaper} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* 主内容区：`id` + `role="main"` 作为 skip-link 的目标与读屏地标；
          `tabIndex={-1}` 使其可被脚本聚焦（不进 Tab 序列），聚焦时去掉整页外框。
          （`component="main"` 本身已有隐式 role=main，此处显式声明以便阅读与断言。） */}
      <Box
        component="main"
        id="main-content"
        role="main"
        tabIndex={-1}
        sx={{ flexGrow: 1, minWidth: 0, p: { xs: 1.5, md: 3 }, '&:focus': { outline: 'none' } }}
      >
        <Toolbar variant="dense" />
        <HealthBanner />
        {/* 阶段 4：只读账号提示（**仅线上版只读角色可见**，本地版为空）。 */}
        <SessionNotice />
        {/* 页面级错误边界：单页异常不再整站白屏；切换路由自动重置。 */}
        <ErrorBoundary resetKeys={[location.pathname]}>
          {/* P5-1 路由级代码分割的加载态边界。
              Suspense 放在 App 外壳**内部**、仅包住 <Outlet/>，而不是包住整个 <App/>：
              这样懒加载页面 chunk 下载期间，顶栏 / 侧栏 / 试卷切换器**保持挂载不闪动**，
              只有内容区显示统一的加载态（`LoadingState`），既无白屏也不会整页重排。
              外层保留 ErrorBoundary：懒加载 chunk 拉取失败（动态 import reject）会作为
              渲染错误冒泡到它，走项目既有的错误 UI，而不是卡在加载态。 */}
          <Suspense fallback={<LoadingState label="页面加载中…" />}>
            {/* 测量页与reduce明确none；稳定容器不改key，不加transform或DOM进出动画。 */}
            <div style={{ viewTransitionName: !reducedMotion && isSafeMotionPath(location.pathname) ? 'route-content' : 'none' }}>
              <Outlet />
            </div>
          </Suspense>
        </ErrorBoundary>
      </Box>
    </Box>
  )
}
