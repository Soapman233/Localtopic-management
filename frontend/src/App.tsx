import type { ReactNode } from 'react'
import { Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppBar,
  Alert,
  AlertTitle,
  Box,
  Button,
  Collapse,
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
import UploadFileIcon from '@mui/icons-material/UploadFile'
import EditNoteIcon from '@mui/icons-material/EditNote'
import StorageIcon from '@mui/icons-material/Storage'
import SettingsIcon from '@mui/icons-material/Settings'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Outlet, useLocation } from 'react-router-dom'
import { useAppNavigate } from './lib/navigation'
import api from './api/client'
import { qk } from './api/queryKeys'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingState from './components/LoadingState'
import { PaperSwitcher } from './components/PaperSwitcher'
import { SessionControls, SessionNotice } from './components/SessionControls'
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

/**
 * 导航分组：一个分组标题 + 若干导航项。
 *
 * `collapsible` 为真时表示**低频分组**，侧栏默认折叠（方案 §2.1），
 * 用 MUI `Collapse` 承载，触发器带 `aria-expanded` / `aria-controls`。
 */
export interface NavGroup {
  label: string
  items: NavItem[]
  collapsible?: boolean
}

/**
 * 侧栏导航分组（B1 信息架构重构，方案 §2.1）。
 *
 * 老师反馈侧栏「太杂、找不到重点」：原来日常与治理 8 项平权罗列，
 * 高频动作被低频维护页淹没。现按**使用频率**收敛为两组：
 * - 「日常」：高频页（导入 / 组卷 / 找题）；
 * - 「数据维护」：低频维护页，**默认折叠**，点击才展开（见 `CollapsibleNavGroup`）。
 *
 * ⚠️ **偏离方案的一处（有意为之）**：方案 §2.1 的目标导航只有 4 项
 * （builder / search / manage / settings），**漏掉了「导入试卷」页**。
 * 但导入是老师**唯一的建库途径**——没有导入就没有题库，绝不能从侧栏消失。
 * 故这里把 `import` 保留在「日常」分组（沿用原顺序：导入 → 组卷 → 找题），
 * 最终侧栏为 **5 项**。这是本项目对方案的唯一实质偏离。
 *
 * 「设置」不属任何分组，固定在侧栏底部单独呈现（见 `SETTINGS_ITEM`）。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '日常',
    items: [
      // 个人客户端「自己建库」：导入是唯一建库途径，放在日常首位（题库为空时最该做的事）。
      { path: 'import', label: '导入试卷', description: '导入旧试卷 DOCX 建库', icon: <UploadFileIcon /> },
      // 组卷工作台是老师最高频的动作，也是默认落地页（router.tsx 的 index/* 都指向 /builder）。
      { path: 'builder', label: '组卷工作台', description: '边找题边组卷，左题库右试卷', icon: <EditNoteIcon /> },
      { path: 'search', label: '找题', description: '关键词 + 筛选，批量找题', icon: <SearchIcon /> },
    ],
  },
  {
    // 低频分组：四个维护页收进维护页 Tab，侧栏只留一个入口，默认折叠。
    label: '数据维护',
    collapsible: true,
    items: [
      { path: 'manage', label: '数据维护', description: '知识点 / 公式 / 来源 / 统计', icon: <StorageIcon /> },
    ],
  },
]

/** 设置：不归入任何分组，固定显示在侧栏底部。 */
export const SETTINGS_ITEM: NavItem = {
  path: 'settings',
  label: '设置',
  description: '数据库路径、导出目录与偏好',
  icon: <SettingsIcon />,
}

/**
 * 扁平导航项（**向后兼容导出**）。
 *
 * 顺序 = 各分组项顺序 + 末尾的设置项，共 5 项。
 * ⚠️ 路由集合**不再**由它派生（见 `router.tsx` 的 `ROUTES`）：侧栏项与路由必须解耦，
 * 否则删掉一个导航项会连带删掉路由（B1 硬性要求 1）。
 */
export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM]

/** 站点基础标题（与 `index.html` 的 `<title>` 一致）。 */
export const BASE_TITLE = '初中物理 · 题库与组卷'

/**
 * **独立的路由标题表**（B1 硬性要求 6）。
 *
 * 为什么不复用导航项：导航项只覆盖侧栏 5 项，但文档标题还要覆盖**不在侧栏**的页面
 * （题目详情、导出中心）与**维护子页**（/manage/* 四个具体页）。
 * 前缀按**由长到短**排列，`find` 首个命中即为最具体匹配（`manage/stats` 不会退化成 `manage`）。
 */
export const ROUTE_TITLES: ReadonlyArray<{ prefix: string; title: string }> = [
  { prefix: 'manage/knowledge', title: '知识点复核' },
  { prefix: 'manage/formula-review', title: '公式复核' },
  { prefix: 'manage/sources', title: '来源文件' },
  { prefix: 'manage/stats', title: '题库统计' },
  { prefix: 'manage', title: '数据维护' },
  { prefix: 'question', title: '题目详情' },
  { prefix: 'import', title: '导入试卷' },
  { prefix: 'builder', title: '组卷工作台' },
  { prefix: 'search', title: '找题' },
  { prefix: 'export', title: '导出中心' },
  { prefix: 'settings', title: '系统设置' },
]

/** 归一化路径：去掉首尾斜杠，便于「完整路径 / 分段前缀」比较。 */
function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 由路由路径推导**文档标题**（P5-3：路由变化时同步 `document.title`）。
 *
 * 本函数是**纯函数、无副作用**，导出以便单测（不变量：已知路由 → 「页面名 · 初中物理题库」；
 * 维护子页显示具体标题，如「公式复核 · 初中物理题库」；未知 → 基础标题）。
 * 标题来源是**独立的路由标题表** `ROUTE_TITLES`，不依赖导航项。
 */
export function documentTitleForPath(pathname: string): string {
  const clean = normalizePath(pathname)
  const hit = ROUTE_TITLES.find((r) => clean === r.prefix || clean.startsWith(`${r.prefix}/`))
  return hit ? `${hit.title} · 初中物理题库` : BASE_TITLE
}

/**
 * 由 pathname 派生**当前应高亮的导航项 path**（B1 硬性要求 5）。
 *
 * 规则：
 * - `/builder` → 组卷工作台；`/export` → 组卷工作台（导出是全屏预览辅助页）；
 * - `/search`、`/question/:id` → 找题；
 * - `/manage`、`/manage/*` → 数据维护；
 * - `/settings` → 设置。
 *
 * 匹配用**完整路径或分段前缀**（`clean === path || clean.startsWith(path + '/')`），
 * 避免 `/search-other` 被 `/search` 误选中（必须命中 `/search/` 才算分段前缀）。
 */
export function selectedNavPathFor(pathname: string): string | null {
  const clean = normalizePath(pathname)
  if (clean === 'question' || clean.startsWith('question/')) return 'search'
  if (clean === 'export' || clean.startsWith('export/')) return 'builder'
  // 取最长匹配（如 manage/* 归到 manage），保证层级路径归到最近的导航项。
  const hit = NAV_ITEMS.map((i) => i.path)
    .filter((p) => clean === p || clean.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0]
  return hit ?? null
}

/**
 * 单个侧栏导航按钮。
 *
 * 抽成独立组件是因为它内部要用 `useLocation` 判断选中态（`selected`），
 * 不能在 `App` 的 `render` 里以普通函数形式调用 Hooks。
 */
function NavListButton({ item, onNavigate }: { item: NavItem; onNavigate: (path: string) => void }) {
  const location = useLocation()
  // 选中态由 pathname 派生（`selectedNavPathFor` 处理 /question/:id→找题、/export→组卷、
  // /manage/*→数据维护，并用「完整路径 / 分段前缀」避免 /search-other 误选）。
  const selected = selectedNavPathFor(location.pathname) === item.path
  return (
    // P5-3：`aria-current="page"` 明确告诉读屏用户「当前就在这一页」，
    // 仅靠视觉高亮（selected）对读屏用户不可见。
    <ListItemButton selected={selected} aria-current={selected ? 'page' : undefined} onClick={() => onNavigate(item.path)}>
      <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
      <ListItemText
        primary={item.label}
        secondary={item.description}
        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
      />
    </ListItemButton>
  )
}

/** 分组标题的统一样式（非交互元素，不进 Tab 序列）。 */
const GROUP_SUBHEADER_SX = {
  bgcolor: 'transparent',
  color: 'text.secondary',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 2,
  mt: 1,
} as const

/**
 * 低频可折叠分组（方案 §2.1）。
 *
 * - 默认关闭：折叠态下不挂载子项（`Collapse` 的 `unmountOnExit`），减少侧栏噪音；
 * - 触发器是真实的 `ListItemButton`，带 `aria-expanded`（开合状态）与
 *   `aria-controls`（指向折叠区 id），读屏可感知；
 * - 直接访问 `/manage/*` 时由父组件自动展开（见 `App` 里的 `useEffect`）并高亮子项。
 *
 * 触发器的可访问名用 `aria-label` 与子项区分（两者可见文字同为「数据维护」），
 * 避免读屏/测试把「展开分组」和「进入数据维护」当成同一个控件。
 */
function CollapsibleNavGroup({
  group,
  open,
  regionId,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  open: boolean
  regionId: string
  onToggle: () => void
  onNavigate: (path: string) => void
}) {
  return (
    <List>
      <ListItemButton
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`${open ? '收起' : '展开'}${group.label}分组`}
        onClick={onToggle}
      >
        <ListItemIcon sx={{ minWidth: 40 }}>{open ? <ExpandLessIcon /> : <ExpandMoreIcon />}</ListItemIcon>
        <ListItemText
          primary={group.label}
          secondary={open ? '收起维护页入口' : '展开维护页入口'}
          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
        />
      </ListItemButton>
      <Collapse in={open} id={regionId} timeout="auto" unmountOnExit>
        <List disablePadding>
          {group.items.map((item) => (
            <NavListButton key={item.path} item={item} onNavigate={onNavigate} />
          ))}
        </List>
      </Collapse>
    </List>
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
  // 统一导航入口：自动在「支持 View Transition 且未开启减少动效」时加页面过渡。
  const navigate = useAppNavigate()
  const qc = useQueryClient()
  const theme = useTheme()
  // P1-1 响应式：窄屏（<md，即 <900px）时侧栏改为临时抽屉（汉堡菜单开合），
  // 避免 232px 固定侧栏挤占内容区。桌面（≥md）保持常驻侧栏。
  const isNarrowNav = useMediaQuery(theme.breakpoints.down('md'))
  const [navOpen, setNavOpen] = useState(false)

  // B1：低频「数据维护」分组默认折叠；当路由落在 /manage/* 时自动展开，
  // 让深链 / 刷新 / 前进后退都能看到并高亮「数据维护」子项。
  const [manageGroupOpen, setManageGroupOpen] = useState(false)
  const onManageRoute = selectedNavPathFor(location.pathname) === 'manage'
  useEffect(() => {
    if (onManageRoute) setManageGroupOpen(true)
  }, [onManageRoute])

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
        {/* 分组导航（B1）：高频「日常」直接列出；低频「数据维护」默认折叠，点击展开。
            设置项用 mt:auto 顶到底部，与两组视觉分离。
            P5-3：整块侧栏用 `<nav aria-label="主导航">` 承载，读屏用户可按地标快速跳转。 */}
        <Box component="nav" aria-label="主导航" sx={{ overflow: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {NAV_GROUPS.map((group) =>
            group.collapsible ? (
              <CollapsibleNavGroup
                key={group.label}
                group={group}
                open={manageGroupOpen}
                regionId="nav-manage-region"
                onToggle={() => setManageGroupOpen((o) => !o)}
                onNavigate={handleNavigate}
              />
            ) : (
              <List
                key={group.label}
                subheader={
                  <ListSubheader component="div" disableSticky sx={GROUP_SUBHEADER_SX}>
                    {group.label}
                  </ListSubheader>
                }
              >
                {group.items.map((item) => (
                  <NavListButton key={item.path} item={item} onNavigate={handleNavigate} />
                ))}
              </List>
            ),
          )}
          <List sx={{ mt: 'auto' }}>
            <NavListButton item={SETTINGS_ITEM} onNavigate={handleNavigate} />
          </List>
        </Box>
      </Drawer>

      {/* 全局「切换试卷」抽屉（P1-6）：任意页面都能切换 / 新建。
          命名刻意与组卷页的「试卷管理」（含删除 + 撤销）区分——两者能力不同，
          都叫「试卷列表」会让老师困惑「为什么这里的删不掉」。 */}
      <Drawer anchor="left" open={paperListOpen} onClose={() => setPaperListOpen(false)}
        PaperProps={{ role: 'dialog', 'aria-labelledby': 'paper-switch-drawer-title' }}>
        <Box sx={{ width: 320, p: 2 }}>
          {/* 同上：避免被固定顶栏遮住标题与新建表单。 */}
          <Toolbar variant="dense" />
          <Typography id="paper-switch-drawer-title" variant="subtitle1" component="h2" gutterBottom>
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

      {/* 主内容区：`id` + `role="main"` 作为 skip-link 的目标与读屏地标；
          `tabIndex={-1}` 使其可被脚本聚焦（不进 Tab 序列），聚焦时去掉整页外框。
          （`component="main"` 本身已有隐式 role=main，此处显式声明以便阅读与断言。） */}
      <Box
        component="main"
        id="main-content"
        role="main"
        tabIndex={-1}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          // 留白：桌面 32px、移动 16px。移动端宁窄勿宽——内容列太窄反而难读。
          p: { xs: 2, sm: 3, md: 4 },
          '&:focus': { outline: 'none' },
        }}
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
            {/* 页面切换过渡的锚点（实施方案 §5）：只给**页面内容**做淡入淡出，
                顶栏 / 侧栏 / 全局 Drawer 保持静止（root 过渡已关闭）。
                用稳定 class 而非随机 key，避免动效导致页面重挂载。 */}
            <div className="qb-route-content">
              <Outlet />
            </div>
          </Suspense>
        </ErrorBoundary>
      </Box>
    </Box>
  )
}
