/** 数据维护父页：只挂载当前路由，低频业务延迟加载时保留分类与标题。 */
import { Suspense } from 'react'
import { Box, Tab, Tabs, Typography } from '@mui/material'
import { Outlet, useLocation } from 'react-router-dom'
import { useAppNavigate } from '../hooks/useAppNavigate'
import ErrorBoundary from '../components/ErrorBoundary'
import LoadingState from '../components/LoadingState'

const categories = [
  { path: 'knowledge', title: '知识点复核' },
  { path: 'formula-review', title: '公式复核' },
  { path: 'sources', title: '来源文件' },
  { path: 'stats', title: '题库统计' },
]
export default function DataMaintenancePage() {
  const location = useLocation()
  const navigate = useAppNavigate()
  const current = categories.find(category => location.pathname === '/manage/' + category.path) ?? categories[0]
  return <Box>
    <Typography variant="h6" component="h1" gutterBottom>数据维护</Typography>
    <Tabs aria-label="数据维护分类" value={current.path}
      onChange={(_event, path: string) => navigate('/manage/' + path + location.search, { state: location.state })}>
      {categories.map(category => <Tab key={category.path} value={category.path} label={category.title}
        id={'maintenance-tab-' + category.path} aria-controls={'maintenance-panel-' + category.path} />)}
    </Tabs>
    <Box role="tabpanel" id={'maintenance-panel-' + current.path}
      aria-labelledby={'maintenance-tab-' + current.path} sx={{ mt: 2 }}>
      <ErrorBoundary resetKeys={[location.pathname]}>
        <Suspense fallback={<Box><Typography component="h2" variant="h6">{current.title}</Typography><LoadingState label="页面加载中…" /></Box>}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </Box>
  </Box>
}
