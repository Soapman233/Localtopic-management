/**
 * `lib/feedback` 测试（阶段 0 统一反馈底座）。
 *
 * 关键约束：**未绑定全局通知器时必须是安全空操作**——否则组件外调用会直接崩。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { bindNotifier, notify } from '../../src/lib/feedback'
import { ApiError } from '../../src/api/client'
import { ErrorCode } from '../../src/api/errors'

describe('lib/feedback · 全局 notify', () => {
  afterEach(() => bindNotifier(null))

  it('未绑定时不抛错（安全空操作）', () => {
    bindNotifier(null)
    expect(() => notify.success('已加入试卷')).not.toThrow()
    expect(() => notify.errorFrom(new Error('x'))).not.toThrow()
  })

  it('绑定后按 variant 转发给 notistack', () => {
    const spy = vi.fn()
    bindNotifier(spy)

    notify.success('已加入试卷')
    expect(spy).toHaveBeenCalledWith('已加入试卷', expect.objectContaining({ variant: 'success' }))

    notify.warning('数据未标注')
    expect(spy).toHaveBeenLastCalledWith('数据未标注', expect.objectContaining({ variant: 'warning' }))
  })

  it('errorFrom 把异常转成教师可读文案（走 describeApiError）', () => {
    const spy = vi.fn()
    bindNotifier(spy)

    notify.errorFrom(new ApiError('导出前还有内容问题需要处理。', ErrorCode.ExportContentBlocked, 409, null))
    expect(spy).toHaveBeenCalledWith(
      '导出前还有内容问题需要处理。',
      expect.objectContaining({ variant: 'error' }),
    )
  })

  it('错误默认停留更久（6s），普通提示 3s', () => {
    const spy = vi.fn()
    bindNotifier(spy)

    notify.error('失败了')
    expect(spy.mock.calls[0][1]).toMatchObject({ autoHideDuration: 6000 })

    notify.info('普通提示')
    expect(spy.mock.calls[1][1]).toMatchObject({ autoHideDuration: 3000 })
  })

  it('persist 时不给 autoHideDuration（需用户手动关闭）', () => {
    const spy = vi.fn()
    bindNotifier(spy)

    notify.error('必须阅读', { persist: true })
    expect(spy.mock.calls[0][1]).toMatchObject({ autoHideDuration: undefined })
  })
})
