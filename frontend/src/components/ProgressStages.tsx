/** 统一「长任务进度」：导出 / 像素预览等 3–8 秒等待的**阶段式**进度（四态规范之「进行态」）。
 *
 * 背景（前端重构方案 §2.2 P1-4）
 * ----------------------------
 * 此前长任务只有「`CircularProgress` + 已用 Ns」，**没有阶段、没有上限**，
 * 老师无法判断「还要等多久 / 是不是卡死了」。本组件把等待拆成**可见的阶段**，
 * 并明确给出「约 3–8 秒」这类**上限预期**，缓解无限等待焦虑。
 *
 * 使用约定
 * --------
 * - 仅用于**长任务**（像素预览、导出）；
 * - 普通首屏加载用 `LoadingState`，不要用本组件。
 *
 * ⚠️ 只改「呈现方式」：阶段划分由调用方给出，本组件不参与任何作业状态判定。
 */
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'

export interface ProgressStagesProps {
  /** 阶段名列表，如 `['正在渲染文档', '正在转换为 PDF', '正在生成预览图']`。 */
  stages: string[]
  /** 当前阶段索引（0 起）；小于它的为「已完成」，大于它的为「未开始」。 */
  currentStage: number
  /** 已用时长（秒）；大于 0 时展示。 */
  elapsedSec?: number
  /** 上限预期文案，默认「通常约 3–8 秒，未改动内容时会秒回」。 */
  expectedHint?: string
  /** 顶部标题（可选），如「正在生成像素预览」。 */
  title?: string
}

/** 由「已用秒数」粗估当前阶段索引（长任务通常 3–8 秒；用于无细粒度阶段上报时）。 */
export function stageFromElapsed(elapsedSec: number, stageCount: number): number {
  if (stageCount <= 1) return 0
  const idx = Math.floor((Math.max(0, elapsedSec) / 8) * stageCount)
  return Math.max(0, Math.min(stageCount - 1, idx))
}

/** 阶段式长任务进度。 */
export function ProgressStages({
  stages,
  currentStage,
  elapsedSec,
  expectedHint = '通常约 3–8 秒，未改动内容时会秒回',
  title,
}: ProgressStagesProps) {
  return (
    <Box role="status" aria-live="polite" sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
        {title ? (
          <Typography variant="body2" fontWeight={600}>
            {title}
          </Typography>
        ) : null}
        {typeof elapsedSec === 'number' && elapsedSec > 0 ? (
          <Typography variant="caption" color="text.secondary">
            已用 {elapsedSec}s
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {expectedHint}
        </Typography>
      </Stack>

      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {stages.map((stage, i) => {
          const state = i < currentStage ? 'done' : i === currentStage ? 'active' : 'pending'
          return (
            <Stack
              key={`${i}-${stage}`}
              direction="row"
              spacing={1}
              alignItems="center"
              data-testid={`progress-stage-${i}`}
              data-state={state}
            >
              {state === 'done' ? (
                <CheckCircleIcon fontSize="small" color="success" />
              ) : state === 'active' ? (
                <CircularProgress size={16} />
              ) : (
                <RadioButtonUncheckedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
              )}
              <Typography
                variant="body2"
                color={state === 'pending' ? 'text.disabled' : 'text.primary'}
                fontWeight={state === 'active' ? 600 : 400}
              >
                {stage}
              </Typography>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}

export default ProgressStages
