/**
 * `ProgressStages` 行为测试。
 *
 * 关注用户可见行为：渲染当前阶段、已完成 / 未开始阶段的区分、已用时长与上限预期的展示，
 * 以及由已用秒数粗估阶段索引的纯函数。
 */
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { ProgressStages, stageFromElapsed } from '../../src/components/ProgressStages'
import { renderWithTheme } from './testUtils'

const STAGES = ['正在渲染文档', '正在转换为 PDF', '正在生成预览图']

describe('ProgressStages', () => {
  it('渲染全部阶段文案', () => {
    renderWithTheme(<ProgressStages stages={STAGES} currentStage={1} />)
    for (const s of STAGES) expect(screen.getByText(s)).toBeInTheDocument()
  })

  it('区分已完成 / 进行中 / 未开始阶段', () => {
    const { container } = renderWithTheme(<ProgressStages stages={STAGES} currentStage={1} />)
    const state = (i: number) =>
      container.querySelector(`[data-testid="progress-stage-${i}"]`)?.getAttribute('data-state')
    expect(state(0)).toBe('done')
    expect(state(1)).toBe('active')
    expect(state(2)).toBe('pending')
  })

  it('显示已用时长与上限预期', () => {
    renderWithTheme(<ProgressStages stages={STAGES} currentStage={0} elapsedSec={4} />)
    expect(screen.getByText('已用 4s')).toBeInTheDocument()
    expect(screen.getByText(/约 3–8 秒/)).toBeInTheDocument()
  })

  it('elapsedSec 为 0 时不显示已用时长', () => {
    renderWithTheme(<ProgressStages stages={STAGES} currentStage={0} elapsedSec={0} />)
    expect(screen.queryByText(/已用/)).not.toBeInTheDocument()
  })

  it('stageFromElapsed 按 3–8 秒上限粗估阶段索引', () => {
    expect(stageFromElapsed(0, 3)).toBe(0)
    expect(stageFromElapsed(3, 3)).toBe(1)
    expect(stageFromElapsed(6, 3)).toBe(2)
    // 超过 8 秒封顶在最后一个阶段（不越界）。
    expect(stageFromElapsed(20, 3)).toBe(2)
    // 单阶段恒为 0。
    expect(stageFromElapsed(5, 1)).toBe(0)
  })
})
