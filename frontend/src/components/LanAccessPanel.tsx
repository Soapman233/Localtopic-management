/**
 * 局域网访问面板（方案 A）——设置页内的一节。
 *
 * 老师在这里一键开启「手机访问」：开启后题库监听全网卡，
 * 手机连同一 WiFi 就能通过**链接或二维码**使用（令牌随链接下发，扫码即登录）。
 *
 * 安全设计
 * --------
 * * 开启 = **强制启用访问令牌**（后端 `webui/edition.py::exposure_safety` 兜底：
 *   监听非回环却无鉴权 → **拒绝启动**）；
 * * 令牌只在本面板主动索取时经 `/api/network/link` 返回，常规轮询不含令牌；
 * * 界面**显著提示风险**（同网络设备均可访问，勿在公共 WiFi 开启）。
 *
 * 与「方案 B 线上部署」的关系
 * ---------------------------
 * 本面板只切换**暴露范围**与**访问凭据**，不引入仅本地可用的假设；
 * 升级到线上部署时把 `QB_EDITION` 换成 `online` 并启用用户体系即可，界面无需重做。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Link,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RefreshIcon from '@mui/icons-material/Refresh'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import {
  disableLan,
  enableLan,
  getNetworkLink,
  getNetworkStatus,
  rotateLanToken,
} from '../api/network'
import { qk } from '../api/queryKeys'
import { notify } from '../lib/feedback'
import { GLOSSARY } from '../lib/glossary'

export default function LanAccessPanel() {
  const qc = useQueryClient()
  const [showLink, setShowLink] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const statusQ = useQuery({ queryKey: qk.networkStatus(), queryFn: getNetworkStatus })
  // 仅在用户主动「查看手机访问方式」时拉取含令牌的链接与二维码。
  const linkQ = useQuery({
    queryKey: [...qk.networkStatus(), 'link'] as const,
    queryFn: getNetworkLink,
    enabled: showLink,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.networkStatus() })
    void qc.invalidateQueries({ queryKey: [...qk.networkStatus(), 'link'] })
  }

  const enableM = useMutation({
    mutationFn: enableLan,
    onSuccess: (res) => {
      notify.info(res.message)
      invalidate()
    },
    onError: (e) => notify.errorFrom(e),
  })
  const disableM = useMutation({
    mutationFn: disableLan,
    onSuccess: (res) => {
      notify.info(res.message)
      invalidate()
    },
    onError: (e) => notify.errorFrom(e),
  })
  const rotateM = useMutation({
    mutationFn: rotateLanToken,
    onSuccess: (res) => {
      notify.warning(res.message)
      setConfirmRotate(false)
      invalidate()
    },
    onError: (e) => notify.errorFrom(e),
  })

  const data = statusQ.data
  const busy = enableM.isPending || disableM.isPending || rotateM.isPending
  const link = linkQ.data

  const copyLink = async () => {
    const url = link?.lan_url
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      notify.success(GLOSSARY.lanCopied)
    } catch {
      notify.warning(url) // 剪贴板不可用时退化为直接展示
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <QrCode2Icon fontSize="small" />
        <Typography variant="subtitle1" component="h2">
          {GLOSSARY.lanTitle}
        </Typography>
        {statusQ.isFetching && <CircularProgress size={14} />}
      </Stack>

      {statusQ.isError ? (
        <Alert severity="error">{GLOSSARY.lanNoIp}</Alert>
      ) : (
        <>
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(data?.lan_enabled)}
                disabled={busy || statusQ.isLoading}
                onChange={(_e, next) => (next ? enableM.mutate() : disableM.mutate())}
                inputProps={{ 'aria-label': GLOSSARY.lanTitle }}
              />
            }
            label={data?.lan_enabled ? GLOSSARY.lanOn : GLOSSARY.lanOff}
          />

          {/* 风险提示：开启即对同网络开放，必须显著 */}
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {GLOSSARY.lanRisk}
          </Alert>

          {data?.restart_required && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {GLOSSARY.lanNeedRestart}
            </Alert>
          )}

          {data?.lan_enabled && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<QrCode2Icon />}
                  onClick={() => setShowLink((v) => !v)}
                >
                  {showLink ? '收起' : '查看手机访问方式'}
                </Button>
                <Button
                  size="small"
                  color="warning"
                  startIcon={<RefreshIcon />}
                  disabled={busy}
                  onClick={() => setConfirmRotate(true)}
                >
                  {GLOSSARY.lanRotate}
                </Button>
              </Stack>

              {showLink && (
                <Box sx={{ mt: 1 }}>
                  {linkQ.isLoading && <CircularProgress size={20} />}
                  {linkQ.data && !linkQ.data.lan_url && (
                    <Alert severity="warning">{GLOSSARY.lanNoIp}</Alert>
                  )}
                  {linkQ.data?.lan_url && (
                    <Stack spacing={1.5} alignItems="flex-start">
                      <Typography variant="body2" color="text.secondary">
                        {GLOSSARY.lanScanHint}
                      </Typography>
                      {linkQ.data.qr_svg && (
                        // 二维码由后端生成的内联 SVG（无外链、无脚本）
                        <Box
                          aria-label="手机访问二维码"
                          sx={{
                            bgcolor: '#fff',
                            p: 1,
                            borderRadius: 1,
                            lineHeight: 0,
                            '& svg': { display: 'block', width: 168, height: 168 },
                          }}
                          dangerouslySetInnerHTML={{ __html: linkQ.data.qr_svg }}
                        />
                      )}
                      <Link href={linkQ.data.lan_url} variant="body2" sx={{ wordBreak: 'break-all' }}>
                        {linkQ.data.lan_url}
                      </Link>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => void copyLink()}
                      >
                        {GLOSSARY.lanCopyLink}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        {GLOSSARY.lanRotateHint}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      <Dialog open={confirmRotate} onClose={() => setConfirmRotate(false)}>
        <DialogTitle>{GLOSSARY.lanRotate}</DialogTitle>
        <DialogContent>
          <DialogContentText>{GLOSSARY.lanRotateHint}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRotate(false)}>取消</Button>
          <Button color="warning" onClick={() => rotateM.mutate()} disabled={busy}>
            确认更换
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
