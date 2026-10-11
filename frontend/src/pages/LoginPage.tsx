/** 登录页（阶段 4：线上部署版专用）。
 *
 * ⚠️ **本地运行版不提供登录入口**：本地版没有用户体系，显示登录页只会让老师困惑
 * （"我该输什么密码？"）。因此本页在**本地版（`auth_enabled === false`）**访问时
 * 直接重定向到默认落地页——这也是 P1-2 的修复点：
 * `/login` 是**顶层路由**、不经过 `RequireAuth`，所以"本地版透传"必须由本页自己兜住。
 *
 * 另外两种"不该显示登录表单"的状态（线上版）：
 * - `auth_mode === 'error'`：鉴权库不可用 → 显示「鉴权服务不可用」；
 * - `needs_setup`：尚未创建管理员 → 显示建号指引。
 *
 * 文案刻意**不区分**「用户名不存在」与「密码错误」——后端统一返回同一句话，
 * 避免被用来枚举用户名。
 */
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LoginIcon from '@mui/icons-material/Login'
import { useAuth } from '../app/auth/AuthProvider'
import { describeApiError } from '../api/errors'
import { DEFAULT_LANDING_PATH } from '../router'
import LoadingState from '../components/LoadingState'
import { AuthServiceUnavailable, AuthSetupRequired } from '../components/AuthStatusNotice'

export default function LoginPage() {
  const { login, authEnabled, loading, authMode, needsSetup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 登录成功后回到「被拦下的那个页面」，而不是一律回首页。
  const from = (location.state as { from?: string } | null)?.from ?? DEFAULT_LANDING_PATH

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      // 后端对"用户不存在"与"密码错误"返回同一句话，这里原样呈现，不做二次区分。
      setError(describeApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ⚠️ 以下早返回必须放在**所有 hooks 之后**（否则违反 hooks 调用顺序规则）。
  // 线上版：鉴权状态未就绪 → 先加载，避免误判为"本地版"而闪跳。
  if (loading) {
    return <LoadingState label="正在检查登录状态…" />
  }
  if (authMode === 'error') {
    return <AuthServiceUnavailable />
  }
  if (needsSetup) {
    return <AuthSetupRequired />
  }
  // P1-2：本地版（未启用鉴权）访问登录页 → 重定向到默认落地页，不显示登录表单。
  if (!authEnabled) {
    return <Navigate to={DEFAULT_LANDING_PATH} replace />
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>
            登录题库
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            请使用管理员分配的账号登录。
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                fullWidth
                required
              />
              <TextField
                label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
                required
              />
              <Button
                type="submit"
                variant="contained"
                startIcon={<LoginIcon />}
                disabled={submitting || !username.trim() || !password}
                data-testid="login-submit"
              >
                {submitting ? '登录中…' : '登录'}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
