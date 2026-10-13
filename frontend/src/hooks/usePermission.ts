/** 权限判定 hook（阶段 4：两版适配）。
 *
 * 用法：
 * ```tsx
 * const canEdit = usePermission('paper.edit')
 * <Button disabled={!canEdit} onClick={...}>加入</Button>
 * ```
 *
 * ⚠️ **本地版永远返回 `true`**（`AuthProvider` 在未启用鉴权时把角色视为 `admin`）——
 * 这正是"本地版零感知"的落点。线上版的只读账号才会拿到 `false`。
 *
 * ⚠️ 这只是**界面层**：真正的强制在后端。详见 `lib/permissions.ts` 的说明。
 */
import { useAuth } from '../app/auth/AuthProvider'
import { roleCan, type Action } from '../lib/permissions'

/**
 * 返回「是否拥有该动作权限」。
 *
 * @param action 业务动作（见 `lib/permissions.ts`）
 */
export function usePermission(action: Action): boolean {
  const { role } = useAuth()
  return roleCan(role, action)
}
