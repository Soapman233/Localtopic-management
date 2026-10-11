/** 权限门（阶段 4：两版适配）。
 *
 * 用法：
 * ```tsx
 * <Can action="paper.delete">
 *   <Button color="error">删除</Button>
 * </Can>
 * ```
 *
 * `fallback` 可用于「无权限时显示只读提示」而不是什么都不显示——
 * **空着会让老师以为界面坏了**，给一句说明更好。
 *
 * ⚠️ 这只是**界面层**：真正的强制在后端。
 */
import type { ReactNode } from 'react'
import { usePermission } from '../hooks/usePermission'
import type { Action } from '../lib/permissions'

export interface CanProps {
  action: Action
  children: ReactNode
  /** 无权限时渲染什么；不传则不渲染任何内容。 */
  fallback?: ReactNode
}

export default function Can({ action, children, fallback = null }: CanProps) {
  const allowed = usePermission(action)
  return <>{allowed ? children : fallback}</>
}
