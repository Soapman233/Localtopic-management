/** 首启引导（Phase 2.4）：题库为空时，在**落地页**引导老师导入第一份旧卷。
 *
 * 为什么需要它
 * ------------
 * 个人客户端是「**自己建库**」——没有管理员帮忙建库，导入是唯一的建库途径。
 * 首次使用时题库是空的，老师会看到「共 0 题」却不知道从哪开始。
 * 这里在落地页（组卷工作台）给一个**醒目但可关闭**的引导，直达导入页。
 *
 * 两条产品约束
 * ------------
 * 1. **不挡有数据的用户**：仅当题目总数为 0（``/api/stats`` 的 ``questions``）时才出现；
 *    取不到数据（加载中 / 失败）一律不显示，绝不误伤。
 * 2. **可关闭 / 可跳过**：右上角关闭后写入 localStorage，之后不再打扰。
 *    若本机已关闭导入功能，则不给出跳转按钮，只说明原因（避免把老师引向死路）。
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { useNavigate } from 'react-router-dom'
import { getStats } from '../api/stats'
import { getImportStatus } from '../api/imports'
import { qk } from '../api/queryKeys'
import { describeImportDisabled, describeImportGuide } from '../lib/glossary'

/** 关闭引导的本地标记键（与其它偏好一致，仅存前端）。 */
export const IMPORT_GUIDE_DISMISS_KEY = 'qb_import_guide_dismissed'

/** 读取「已关闭引导」标记；存储不可用（隐私模式等）时安全回退为「未关闭」。 */
export function isImportGuideDismissed(): boolean {
  try {
    return localStorage.getItem(IMPORT_GUIDE_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** 首启导入引导（题库为空时显示；可关闭）。 */
export function FirstRunImportGuide() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(isImportGuideDismissed)

  const statsQ = useQuery({ queryKey: qk.stats(), queryFn: () => getStats() })
  const statusQ = useQuery({ queryKey: qk.importStatus(), queryFn: () => getImportStatus() })

  // 已关闭 / 数据未就绪 / 题库非空 → 不显示（有数据的用户绝不被打扰）。
  const total = statsQ.data?.questions
  if (dismissed || typeof total !== 'number' || total > 0) return null

  const guide = describeImportGuide()
  const enabled = statusQ.data?.enabled ?? false

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(IMPORT_GUIDE_DISMISS_KEY, '1')
    } catch {
      /* 存储不可用时仅当次会话隐藏 */
    }
  }

  return (
    /**
     * 布局说明（移动端实测修正）：
     * 原先用 `Alert` 的 `action` 槽放按钮——该槽是**固定窄列**，
     * 手机上「导入我的第一份旧卷」会被挤成**三行**，横幅因此变得很高很丑。
     * 改为自绘布局：文字区 `flex:1` + 按钮 `flexShrink:0`，
     * 窄屏**纵向堆叠**（按钮占满一行，易点按），宽屏**横向并排**。
     */
    <Alert
      severity="info"
      icon={<UploadFileIcon />}
      sx={{ mb: 2, alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}
      onClose={dismiss}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1.5, sm: 2 }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <AlertTitle sx={{ mb: 0.25 }}>{guide.title}</AlertTitle>
          {guide.body}
          {!enabled && <div>{describeImportDisabled()}</div>}
        </Box>
        {enabled && (
          <Button
            variant="contained"
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => navigate('/import')}
            sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' } }}
          >
            {guide.action}
          </Button>
        )}
      </Stack>
    </Alert>
  )
}

export default FirstRunImportGuide
