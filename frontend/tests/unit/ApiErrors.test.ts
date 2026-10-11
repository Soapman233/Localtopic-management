/**
 * `api/errors` 纯函数测试（阶段 0 契约收敛）。
 *
 * 这些判断此前散落在各页面的 `if (err.code === ...)` 里，收敛后必须有测试兜住语义，
 * 否则「收敛」只是换了个地方写错。
 */
import { describe, it, expect } from 'vitest'
import { ApiError } from '../../src/api/client'
import {
  ErrorCode,
  PERMISSION_DENIED_MESSAGE,
  describeApiError,
  errorCodeOf,
  errorDataOf,
  isConfirmationRequired,
  isContentGuardCode,
  isContentGuardError,
  isNotFoundError,
  isPermissionDenied,
  isPermissionDeniedCode,
  isUnauthorized,
} from '../../src/api/errors'

describe('api/errors · 错误码识别', () => {
  it('识别 ApiError 的 code', () => {
    expect(errorCodeOf(new ApiError('boom', ErrorCode.ExportContentBlocked, 409, null)))
      .toBe(ErrorCode.ExportContentBlocked)
  })

  it('识别作业信息里的 snake_case error_code', () => {
    expect(errorCodeOf({ error_code: ErrorCode.ExportEvidenceStale }))
      .toBe(ErrorCode.ExportEvidenceStale)
  })

  it('无法识别时返回 null（不猜）', () => {
    expect(errorCodeOf(new Error('普通错误'))).toBeNull()
    expect(errorCodeOf(null)).toBeNull()
    expect(errorCodeOf('字符串')).toBeNull()
    expect(errorCodeOf({ error_code: 'not-a-number' })).toBeNull()
  })

  it('errorDataOf 取出附加数据，非 ApiError 时为 null', () => {
    const payload = { question_id: 1, number: '7' }
    expect(errorDataOf(new ApiError('冲突', ErrorCode.ContentConflict, 409, payload))).toEqual(payload)
    expect(errorDataOf(new Error('x'))).toBeNull()
  })
})

describe('api/errors · 分类判定', () => {
  it('内容守卫：仅 40904 / 40905 命中', () => {
    expect(isContentGuardError(new ApiError('', ErrorCode.ExportContentBlocked, 409, null))).toBe(true)
    expect(isContentGuardError(new ApiError('', ErrorCode.ExportEvidenceStale, 409, null))).toBe(true)
    expect(isContentGuardError(new ApiError('', ErrorCode.ContentConflict, 409, null))).toBe(false)
    expect(isContentGuardCode(ErrorCode.ExportContentBlocked)).toBe(true)
    expect(isContentGuardCode(ErrorCode.Internal)).toBe(false)
    expect(isContentGuardCode(null)).toBe(false)
  })

  it('资源不存在：404xx 段命中', () => {
    expect(isNotFoundError(new ApiError('', ErrorCode.PaperNotFound, 404, null))).toBe(true)
    expect(isNotFoundError(new ApiError('', ErrorCode.SourceNotFound, 404, null))).toBe(true)
    expect(isNotFoundError(new ApiError('', ErrorCode.InvalidScore, 400, null))).toBe(false)
  })

  it('需要二次确认：40902 / 40903 命中', () => {
    expect(isConfirmationRequired(new ApiError('', ErrorCode.NeedForce, 409, null))).toBe(true)
    expect(isConfirmationRequired(new ApiError('', ErrorCode.NeedConfirm, 409, null))).toBe(true)
    expect(isConfirmationRequired(new ApiError('', ErrorCode.ContentConflict, 409, null))).toBe(false)
  })

  it('未授权：40101 命中（线上部署版鉴权）', () => {
    expect(isUnauthorized(new ApiError('', ErrorCode.Unauthorized, 401, null))).toBe(true)
    expect(isUnauthorized(new ApiError('', ErrorCode.Internal, 500, null))).toBe(false)
  })

  it('权限不足：403xx 段命中（含 HTTP 403 兜底）', () => {
    expect(isPermissionDenied(new ApiError('', ErrorCode.PermissionDenied, 403, null))).toBe(true)
    expect(isPermissionDenied(new ApiError('', 40399, 403, null))).toBe(true)
    expect(isPermissionDenied(new ApiError('', 40300, 403, null))).toBe(true)
    expect(isPermissionDeniedCode(40301)).toBe(true)
    expect(isPermissionDeniedCode(40401)).toBe(false)
    expect(isPermissionDenied(new ApiError('', ErrorCode.QuestionNotFound, 404, null))).toBe(false)
  })
})

describe('api/errors · 文案', () => {
  it('优先使用后端 message（后端已是中文可读文案）', () => {
    expect(describeApiError(new ApiError('试卷不存在，可能已被删除。', ErrorCode.PaperNotFound, 404, null)))
      .toBe('试卷不存在，可能已被删除。')
  })

  it('权限不足一律用前端教师文案，绝不透传后端内部标识（paper.edit）', () => {
    const backendMsg = '权限不足：viewer 角色无权执行该操作（需要 paper.edit 权限）'
    const msg = describeApiError(new ApiError(backendMsg, ErrorCode.PermissionDenied, 403, null))
    expect(msg).toBe(PERMISSION_DENIED_MESSAGE)
    // 关键：不能把 `paper.edit` 这种内部权限标识甩给老师
    expect(msg).not.toContain('paper.edit')
    expect(msg).not.toMatch(/[a-z]+\.[a-z]+/)
    expect(msg).toContain('管理员')
  })

  it('403xx 段任意码都走前端文案（即便后端 message 非空）', () => {
    const msg = describeApiError(new ApiError('需要 paper.edit 权限', 40307, 403, null))
    expect(msg).toBe(PERMISSION_DENIED_MESSAGE)
    expect(msg).not.toContain('paper.edit')
  })

  it('message 为空时按码兜底', () => {
    expect(describeApiError(new ApiError('', ErrorCode.ExportEvidenceStale, 409, null)))
      .toContain('重新预览')
  })

  it('完全无法识别时给通用兜底，绝不抛错', () => {
    expect(describeApiError(null)).toBe('操作失败，请稍后重试。')
    expect(() => describeApiError(undefined)).not.toThrow()
  })

  it('普通 Error 用其 message', () => {
    expect(describeApiError(new Error('网络断了'))).toBe('网络断了')
  })
})
