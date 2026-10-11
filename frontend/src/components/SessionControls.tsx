/** 会话相关界面（阶段 4：两版适配）。
 *
 * 导出两个组件：
 * - `SessionControls`：顶栏右侧的「当前用户 + 登出」；
 * - `SessionNotice`：主内容区顶部的**只读提示**（仅只读账号可见）。
 *
 * ⚠️ **两者在本地版都渲染为空**（`authEnabled === false`）。
 * 本地版没有账号概念，显示"当前用户：admin"只会让人困惑。
 */
import { Alert, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { useAuth } from '../app/auth/AuthProvider'
import { ROLE_LABELS } from '../lib/permissions'

/** 顶栏「当前用户 + 登出」。本地版返回 `null`。 */
export function SessionControls() {
  const { authEnabled, user, logout } = useAuth()
  if (!authEnabled || !user) return null

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
      <Tooltip title={`${user.display_name}（${ROLE_LABELS[user.role]}）`}>
        <Chip
          size="small"
          label={`${user.display_name} · ${ROLE_LABELS[user.role]}`}
          sx={{
            // 顶栏是主色底，用半透明白保证可读（对比度按顶栏底色计算）
            color: '#fff',
            bgcolor: 'rgba(255,255,255,0.18)',
            maxWidth: 200,
          }}
        />
      </Tooltip>
      <Button
        size="small"
        color="inherit"
        startIcon={<LogoutIcon fontSize="small" />}
        onClick={() => void logout()}
        data-testid="logout-button"
        sx={{ flexShrink: 0 }}
      >
        退出
      </Button>
    </Stack>
  )
}

/** 主内容区顶部的只读提示。仅「已启用鉴权且角色为 viewer」时显示。 */
export function SessionNotice() {
  const { authEnabled, role, user } = useAuth()
  if (!authEnabled || role !== 'viewer') return null

  return (
    <Alert severity="info" icon={<VisibilityIcon />} sx={{ mb: 2 }} data-testid="readonly-notice">
      <Typography variant="body2">
        {user?.display_name ?? '你'}当前是<strong>只读</strong>账号：可以检索、组卷预览与导出，
        但不能修改题目、试卷或设置。需要编辑权限请联系管理员。
      </Typography>
    </Alert>
  )
}

/** 兼容默认导出（仅 `SessionControls`），便于按需引入。 */
export default SessionControls
