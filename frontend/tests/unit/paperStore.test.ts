/**
 * L6 `paperStore.validateTargetSection` 守卫测试。
 *
 * `targetSectionId` 是**持久化**的：目标大题被删除后仍可能指向不存在的 section id。
 * 守卫应在目标失效时置 `null`，同时**不改变**既有 `setTargetSectionId` 的语义。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePaperStore } from '../../src/store/paperStore'

describe('paperStore.validateTargetSection（L6）', () => {
  beforeEach(() => {
    // 每个用例前重置为初始态，避免持久化 / 上一条用例残留。
    usePaperStore.setState({ currentPaperId: null, targetSectionId: null })
  })

  it('目标大题仍存在 → 保留', () => {
    usePaperStore.getState().setTargetSectionId(7)
    usePaperStore.getState().validateTargetSection([7, 8, 9])
    expect(usePaperStore.getState().targetSectionId).toBe(7)
  })

  it('目标大题已被删除（不在列表）→ 置 null', () => {
    usePaperStore.getState().setTargetSectionId(7)
    usePaperStore.getState().validateTargetSection([8, 9])
    expect(usePaperStore.getState().targetSectionId).toBeNull()
  })

  it('目标为 null（卷末/未分组）→ 保持不变', () => {
    usePaperStore.getState().setTargetSectionId(null)
    usePaperStore.getState().validateTargetSection([8, 9])
    expect(usePaperStore.getState().targetSectionId).toBeNull()
  })

  it('大题列表为空 → 非 null 目标置 null', () => {
    usePaperStore.getState().setTargetSectionId(3)
    usePaperStore.getState().validateTargetSection([])
    expect(usePaperStore.getState().targetSectionId).toBeNull()
  })

  it('既有 setTargetSectionId 语义不变（可任意设置 / 清空）', () => {
    usePaperStore.getState().setTargetSectionId(11)
    expect(usePaperStore.getState().targetSectionId).toBe(11)
    usePaperStore.getState().setTargetSectionId(null)
    expect(usePaperStore.getState().targetSectionId).toBeNull()
  })
})
