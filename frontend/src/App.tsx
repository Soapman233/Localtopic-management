import type { ReactNode } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AppBar,
  Alert,
  AlertTitle,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import EditNoteIcon from '@mui/icons-material/EditNote'
import DescriptionIcon from '@mui/icons-material/Description'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import ChecklistIcon from '@mui/icons-material/Checklist'
import FunctionsIcon from '@mui/icons-material/Functions'
import FolderIcon from '@mui/icons-material/Folder'
import BarChartIcon from '@mui/icons-material/BarChart'
import SettingsIcon from '@mui/icons-material/Settings'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import api from './api/client'
import { qk } from './api/queryKeys'
import ErrorBoundary from './components/ErrorBoundary'
import type { HealthData } from './api/types'

const DRAWER_WIDTH = 232

export interface NavItem {
  path: string
  label: string
  description: string
  icon: ReactNode
}

/** 9 个页面的导航定义（全部已接入真实实现，见 router.tsx）。 */
export const NAV_ITEMS: NavItem[] = [
  { path: 'search', label: '检索题库', description: '关键词 + 筛选栏找题（P1）', icon: <SearchIcon /> },
  { path: 'builder', label: '组卷', description: '左题库右试卷双栏组卷（P3）', icon: <EditNoteIcon /> },
  { path: 'export', label: '导出', description: '先预览再导出 DOCX/PDF（P4）', icon: <FileDownloadIcon /> },
  { path: 'knowledge', label: '知识点复核', description: '按标签确认/否决（P5）', icon: <ChecklistIcon /> },
  { path: 'formula-review', label: '待复核公式', description: '非 OK 公式队列（P6）', icon: <FunctionsIcon /> },
  { path: 'sources', label: '来源文件', description: '来源文件管理（P7）', icon: <FolderIcon /> },
  { path: 'stats', label: '题库统计', description: '总览与分布（P8）', icon: <BarChartIcon /> },
  { path: 'settings', label: '系统设置', description: 'DB 路径 / 导出目录 / 偏好（P9）', icon: <SettingsIcon /> },
]

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
  const navigate = useNavigate()
  const theme = useTheme()
  // P1-1 响应式：窄屏（<md，即 <900px）时侧栏改为临时抽屉（汉堡菜单开合），
  // 避免 232px 固定侧栏挤占内容区。桌面（≥md）保持常驻侧栏。
  const isNarrowNav = useMediaQuery(theme.breakpoints.down('md'))
  const [navOpen, setNavOpen] = useState(false)

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'primary.main' }}
      >
        <Toolbar variant="dense">
          {isNarrowNav && (
            <IconButton
              color="inherit"
              edge="start"
              size="small"
              aria-label="打开导航"
              onClick={() => setNavOpen(true)}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap component="div">
            题库 Web 界面 · 初中物理
          </Typography>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isNarrowNav ? 'temporary' : 'permanent'}
        open={isNarrowNav ? navOpen : true}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar variant="dense" />
        <Box sx={{ overflow: 'auto' }}>
          <List>
            {NAV_ITEMS.map((item) => {
              const selected = location.pathname.startsWith(`/${item.path}`)
              return (
                <ListItemButton
                  key={item.path}
                  selected={selected}
                  onClick={() => {
                    navigate(`/${item.path}`)
                    if (isNarrowNav) setNavOpen(false)
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                  {/* P1-6：渲染 NAV_ITEMS.description（此前定义却未使用），作为导航副标题。 */}
                  <ListItemText
                    primary={item.label}
                    secondary={item.description}
                    secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                  />
                </ListItemButton>
              )
            })}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 1.5, md: 3 } }}>
        <Toolbar variant="dense" />
        <HealthBanner />
        {/* 页面级错误边界：单页异常不再整站白屏；切换路由自动重置。 */}
        <ErrorBoundary resetKeys={[location.pathname]}>
          <Outlet />
        </ErrorBoundary>
      </Box>
    </Box>
  )
}
