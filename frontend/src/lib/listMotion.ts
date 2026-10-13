/** 纯展示资格判断：完整query身份、稳定结果、共同ID顺序与数量双门槛。 */
export interface ListSnapshot { scope: string; stable: boolean; ids: readonly (number | string)[] }
export function canAnimateList(previous: ListSnapshot | undefined, current: ListSnapshot, toolbar = false) {
  if (!previous?.stable || !current.stable || previous.scope !== current.scope) return false
  const oldIds = previous.ids, newIds = current.ids
  const oldSet = new Set(oldIds), newSet = new Set(newIds)
  const added = newIds.filter(id => !oldSet.has(id)).length
  const removed = oldIds.filter(id => !newSet.has(id)).length
  if (!added && !removed) return false
  if (toolbar) return added + removed === 1
  const common = oldIds.filter(id => newSet.has(id))
  if (!common.length || common.some((id, index) => newIds.filter(id => oldSet.has(id))[index] !== id)) return false
  return added + removed <= 4 && added + removed <= Math.max(oldIds.length, newIds.length) * 0.25
}
