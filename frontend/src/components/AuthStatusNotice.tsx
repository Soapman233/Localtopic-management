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
import { ErrorState } from './ErrorState'

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

/** 鉴权服务不可用（`auth_mode === 'error'`）。
 *
 * 语义确为「错误」→ **复用统一 `<ErrorState/>`**（§4.2 四态强制复用），
 * 而非再手写一套 `Alert severity="error"`：统一「标题 + 可读说明 + 重试 + 技术细节默认折叠」。
 *
 * ⚠️ 这里没有真实抛出的 Error 对象（是后端状态而非请求异常），故用 `new Error(文案)`
 * 承载主说明——`ErrorState` 对普通 `Error` 会经 `describeApiError` 原样返回 message
 * （与 `PaperPanel` 的 `error={new Error(error)}` 同法）。
 * ⚠️ 首段的 `<strong>` 强调在纯文本 message 中丢失（文字本身完整保留）；次段的
 * `outputs/webui/auth.db` 走 `description`（ReactNode）保留 `<code>`。 */
export function AuthServiceUnavailable() {
  return (
    <CenteredCard>
      <ErrorState
        title="鉴权服务不可用"
        error={
          new Error(
            '后端已启用用户体系，但鉴权数据库无法读取（可能损坏、权限不足或缺表）。为保证安全，系统已拒绝所有需要登录的操作。',
          )
        }
        description={
          <>
            请管理员检查鉴权库文件（默认位于 <code>outputs/webui/auth.db</code>）是否完好、可读，修复后刷新本页重试。
          </>
        }
        onRetry={() => window.location.reload()}
        retryLabel="刷新页面"
      />
    </CenteredCard>
  )
}

/** 尚未初始化管理员（`needs_setup`）。
 *
 * ⚠️ **刻意不复用 `<ErrorState/>`**：本态语义是**中性/警告**（系统正常，只是「还没有账号」），
 * 不是错误；且需承载**自定义 CLI 建号指引 + 命令代码块**（`ErrorState` 的 message 为纯文本，
 * 无此能力）。强行套 `severity="error"` 会扭曲语义、误导运维「系统坏了」——故如实保留。
 */
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
