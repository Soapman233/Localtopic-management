import type { ReactNode } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppBar,
  Alert,
  AlertTitle,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
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
import { PaperSwitcher } from './components/PaperSwitcher'
import { createPaper, listPapers } from './api/papers'
import { usePaperStore } from './store/paperStore'
import { useSettingsStore } from './store/settingsStore'
import type { HealthData, Paper } from './api/types'

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

/**
 * 侧栏导航分组（P0-4 / P1-6 信息架构重构）。
 *
 * 原来是一个 8 项扁平等权的 `NAV_ITEMS`，老师分不清"日常要用的"和"偶尔维护的"。
 * 现按**使用频率**拆成两组：
 * - 「日常备课」：老师每天都要用的高频页（组卷 / 找题 / 导出）；
 * - 「数据治理」：偶尔维护的低频页（知识点复核 / 公式复核 / 来源文件 / 统计）。
 *
 * 「系统设置」不属任何分组，固定在侧栏底部单独呈现（见 `SETTINGS_ITEM`）。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '日常备课',
    items: [
      // 组卷工作台是老师最高频的动作，也是默认落地页（router.tsx 的 index/* 都指向 /builder）。
      { path: 'builder', label: '组卷工作台', description: '边找题边组卷，左题库右试卷', icon: <EditNoteIcon /> },
      { path: 'search', label: '找题', description: '关键词 + 筛选，批量找题', icon: <SearchIcon /> },
      { path: 'export', label: '导出中心', description: '先预览，再导出 DOCX / PDF', icon: <FileDownloadIcon /> },
    ],
  },
  {
    label: '数据治理',
    items: [
      { path: 'manage/knowledge', label: '知识点复核', description: '按标签确认或否决知识点', icon: <ChecklistIcon /> },
      { path: 'manage/formula-review', label: '公式复核', description: '处理待复核的公式', icon: <FunctionsIcon /> },
      { path: 'manage/sources', label: '来源文件', description: '管理题目来源文件', icon: <FolderIcon /> },
      { path: 'manage/stats', label: '题库统计', description: '查看题库总量与分布', icon: <BarChartIcon /> },
    ],
  },
]

/** 系统设置：不归入任何分组，固定显示在侧栏底部。 */
export const SETTINGS_ITEM: NavItem = {
  path: 'settings',
  label: '系统设置',
  description: '数据库路径、导出目录与偏好',
  icon: <SettingsIcon />,
}

/**
 * 扁平导航项（**向后兼容导出**）。
 *
 * `router.tsx` 依赖它构建路由子表，测试也用它做"路径唯一 / 无漏项"等不变量校验。
 * 顺序 = 各分组项顺序 + 末尾的系统设置。
 */
export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM]

/**
 * 单个侧栏导航按钮。
 *
 * 抽成独立组件是因为它内部要用 `useLocation` 判断选中态（`selected`），
 * 不能在 `App` 的 `render` 里以普通函数形式调用 Hooks。
 */
function NavListButton({ item, onNavigate }: { item: NavItem; onNavigate: (path: string) => void }) {
  const location = useLocation()
  // 用前缀匹配：治理页位于 /manage/* 子路径下，访问子路由时父项也应保持高亮。
  const selected = location.pathname.startsWith(`/${item.path}`)
  return (
    <ListItemButton selected={selected} onClick={() => onNavigate(item.path)}>
      <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
      <ListItemText
        primary={item.label}
        secondary={item.description}
        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
      />
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const theme = useTheme()
  // P1-1 响应式：窄屏（<md，即 <900px）时侧栏改为临时抽屉（汉堡菜单开合），
  // 避免 232px 固定侧栏挤占内容区。桌面（≥md）保持常驻侧栏。
  const isNarrowNav = useMediaQuery(theme.breakpoints.down('md'))
  const [navOpen, setNavOpen] = useState(false)

  // ---- P1-6：「我的试卷」提升为全站可达 ----
  // 试卷切换器从组卷页顶部提升到全局 AppBar，任意页面都能切换 / 新建试卷。
  // 数据来源仍是 react-query（`qk.papers()`，与组卷页共用同一份缓存）；**唯一状态来源是 paperStore**。
  const currentPaperId = usePaperStore((s) => s.currentPaperId)
  const setCurrentPaperId = usePaperStore((s) => s.setCurrentPaperId)
  const setTargetSectionId = usePaperStore((s) => s.setTargetSectionId)
  const [paperListOpen, setPaperListOpen] = useState(false)
  const [newPaperTitle, setNewPaperTitle] = useState('')
  const papersQ = useQuery({ queryKey: qk.papers(), queryFn: () => listPapers() })
  // 防御性兜底：接口异常/契约变化时避免把非数组当列表（如后端错误体）。
  const papers: Paper[] = Array.isArray(papersQ.data) ? papersQ.data : []

  /** 统一切换试卷：写入唯一来源 `paperStore`，并跳到组卷页让切换效果立即可见（P1-6）。 */
  const switchPaper = (id: number) => {
    setCurrentPaperId(id)
    setTargetSectionId(null)
    setPaperListOpen(false)
    navigate('/builder')
  }

  const createPaperMut = useMutation({
    // 与组卷页一致：新建试卷套用设置页的「默认模板」。
    mutationFn: (title: string) => createPaper({ title, template: useSettingsStore.getState().defaultTemplate }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.papers() })
      switchPaper(p.id)
      setNewPaperTitle('')
    },
  })

  /** 统一导航动作：跳转 +（窄屏时）收起临时抽屉。 */
  const handleNavigate = (path: string) => {
    navigate(`/${path}`)
    if (isNarrowNav) setNavOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'primary.main' }}
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
            onOpenList={() => setPaperListOpen(true)}
            compact={isNarrowNav}
          />
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
        {/* 分组导航：分组名用 ListSubheader 呈现（非交互元素，不进 Tab 序列）；
            系统设置用 mt:auto 顶到底部，与日常/治理两组视觉分离。 */}
        <Box sx={{ overflow: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {NAV_GROUPS.map((group) => (
            <List
              key={group.label}
              subheader={
                <ListSubheader
                  component="div"
                  disableSticky
                  sx={{
                    bgcolor: 'transparent',
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 2,
                    mt: 1,
                  }}
                >
                  {group.label}
                </ListSubheader>
              }
            >
              {group.items.map((item) => (
                <NavListButton key={item.path} item={item} onNavigate={handleNavigate} />
              ))}
            </List>
          ))}
          <List sx={{ mt: 'auto' }}>
            <NavListButton item={SETTINGS_ITEM} onNavigate={handleNavigate} />
          </List>
        </Box>
      </Drawer>

      {/* 全局「切换试卷」抽屉（P1-6）：任意页面都能切换 / 新建。
          命名刻意与组卷页的「试卷管理」（含删除 + 撤销）区分——两者能力不同，
          都叫「试卷列表」会让老师困惑「为什么这里的删不掉」。 */}
      <Drawer anchor="left" open={paperListOpen} onClose={() => setPaperListOpen(false)}>
        <Box sx={{ width: 320, p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            切换试卷
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField
              size="small"
              label="新建试卷标题"
              value={newPaperTitle}
              onChange={(e) => setNewPaperTitle(e.target.value)}
              fullWidth
            />
            <Button
              variant="contained"
              disabled={createPaperMut.isPending}
              onClick={() => createPaperMut.mutate(newPaperTitle.trim() || '未命名试卷')}
            >
              新建
            </Button>
          </Stack>
          <Divider sx={{ my: 1 }} />
          {papersQ.isLoading && (
            <Typography variant="body2" color="text.secondary">
              加载中…
            </Typography>
          )}
          {papersQ.isError && (
            <Typography variant="body2" color="error">
              加载失败，请确认后端服务已启动。
            </Typography>
          )}
          <List dense>
            {papers.map((p) => (
              <ListItemButton key={p.id} selected={p.id === currentPaperId} onClick={() => switchPaper(p.id)}>
                <ListItemText
                  primary={p.title}
                  secondary={`${p.item_count ?? 0} 题 · ${p.total_score ?? 0} 分${(p.unscored_count ?? 0) > 0 ? ` · 未设分 ${p.unscored_count}` : ''}`}
                />
              </ListItemButton>
            ))}
          </List>
          {papers.length === 0 && !papersQ.isLoading && !papersQ.isError && (
            <Typography variant="body2" color="text.secondary">
              还没有试卷，在上方输入标题新建一份。
            </Typography>
          )}
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
