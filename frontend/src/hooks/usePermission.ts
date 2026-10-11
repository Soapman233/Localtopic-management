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
import { useCallback } from 'react'
import { useAuth } from '../app/auth/AuthProvider'
import { describeDenied, roleCan, type Action } from '../lib/permissions'
import { useNotify } from '../lib/feedback'

/**
 * 返回「是否拥有该动作权限」。
 *
 * @param action 业务动作（见 `lib/permissions.ts`）
 */
export function usePermission(action: Action): boolean {
  const { role } = useAuth()
  return roleCan(role, action)
}

/**
 * 返回一个「守卫函数」：有权限则执行，否则弹教师语言的提示。
 *
 * 适合用在「按钮还在、但点了会被拒」的场景（例如拖拽这类无法简单禁用的交互）。
 */
export function usePermissionGuard(action: Action): (run: () => void) => void {
  const allowed = usePermission(action)
  const notify = useNotify()
  return useCallback(
    (run: () => void) => {
      if (!allowed) {
        notify.warning(describeDenied(action))
        return
      }
      run()
    },
    [allowed, action, notify],
  )
}
