/** 鉴权异常状态提示（阶段 4：线上部署版专用）。
 *
 * 两个"不是登录表单"的状态：
 * - `AuthServiceUnavailable`：后端 `auth_mode === 'error'`（鉴权库损坏 / 权限不足 / 缺表）；
 * - `AuthSetupRequired`：后端 `needs_setup`（在线但**尚未创建首个管理员**）。
 *
 * 为什么单独抽出来：这两种情况下显示登录表单是**有害**的——运维会反复输错密码，
 * 却不知道"根本没有账号"或"库坏了"。给出**可操作的下一步指引**才有意义。
 *
 * ⚠️ 文案面向**部署运维**（谁装谁知道），因此允许出现 CLI 命令；这与面向老师的
 * 教师语言不同，属于刻意的例外。
 */
import type { ReactNode } from 'react'
import { Alert, AlertTitle, Box, Card, CardContent, Typography } from '@mui/material'

/** 与登录页一致的外层居中容器，避免两个提示各写一份样式。 */
function CenteredCard({ children }: { children: ReactNode }) {
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
      <Card sx={{ width: '100%', maxWidth: 520 }}>
        <CardContent>{children}</CardContent>
      </Card>
    </Box>
  )
}

/** 鉴权服务不可用（`auth_mode === 'error'`）。 */
export function AuthServiceUnavailable() {
  return (
    <CenteredCard>
      <Alert severity="error" role="alert">
        <AlertTitle>鉴权服务不可用</AlertTitle>
        <Typography variant="body2" component="p">
          后端已启用用户体系，但<strong>鉴权数据库无法读取</strong>（可能损坏、权限不足或缺表）。
          为保证安全，系统已拒绝所有需要登录的操作。
        </Typography>
        <Typography variant="body2" component="p" sx={{ mt: 1 }}>
          请管理员检查鉴权库文件（默认位于 <code>outputs/webui/auth.db</code>）是否完好、可读，
          修复后刷新本页重试。
        </Typography>
      </Alert>
    </CenteredCard>
  )
}

/** 尚未初始化管理员（`needs_setup`）。 */
export function AuthSetupRequired() {
  return (
    <CenteredCard>
      <Alert severity="warning" role="alert">
        <AlertTitle>尚未初始化管理员</AlertTitle>
        <Typography variant="body2" component="p">
          后端已启用用户体系，但<strong>还没有任何账号</strong>，因此暂时无法登录。
        </Typography>
        <Typography variant="body2" component="p" sx={{ mt: 1 }}>
          请在服务器上执行下面的命令创建首个管理员，然后刷新本页登录：
        </Typography>
        <Box
          component="pre"
          sx={{
            mt: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontSize: 13,
            overflowX: 'auto',
          }}
        >
          python -m webui.auth user add &lt;用户名&gt; --role admin
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          密码请通过环境变量 <code>QB_ADMIN_PASSWORD</code> 提供，或按提示交互输入；详见部署文档。
        </Typography>
      </Alert>
    </CenteredCard>
  )
}

export default AuthServiceUnavailable
