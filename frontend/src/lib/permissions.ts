/** 权限模型（阶段 4：两版适配）。
 *
 * ⚠️ **这里定义的是「界面该不该给这个入口」，不是「服务端准不准」。**
 * 真正的强制在后端（`webui/routers/auth.py` 的权限中间件）。前端隐藏/禁用按钮
 * 只是**体验优化**——让老师不必点一个注定失败的操作，而不是安全边界。
 *
 * 之所以做成**声明式表**而不是散落的 if：新增端点/功能时，权限归属一目了然，
 * 也便于测试逐条断言（见 `tests/unit/Permissions.test.ts`）。
 */
import type { Role } from '../api/auth'

/** 需要权限的动作（按「业务能力」而非「按钮」划分，避免按钮改名就失效）。 */
export type Action =
  /** 编辑题目内容、标注难度。 */
  | 'question.edit'
  /** 组卷写操作：加题 / 删题 / 调序 / 设分 / 大题增删改移 / 刷新快照 / 改试卷元数据。 */
  | 'paper.edit'
  /** 删除试卷（比 paper.edit 更危险，单独列出便于将来收紧）。 */
  | 'paper.delete'
  /** 治理：知识点三态复核、待复核公式处理。 */
  | 'governance.review'
  /** 来源文件元数据回填。 */
  | 'source.edit'
  /** 系统设置（DB 路径、导出目录、模板、主题）。 */
  | 'settings.edit'
  /** 用户管理（仅管理员）。 */
  | 'user.manage'
  /** 导出试卷（**算「读」**：不写库、只产出文件，viewer 也可用）。 */
  | 'export'

/** 角色 → 允许的动作。 */
const ROLE_ACTIONS: Record<Role, readonly Action[]> = {
  // 只读：能看、能搜、能导出；不能改任何东西。
  viewer: ['export'],
  // 编辑：在只读基础上可改题库与试卷，但**不能**改系统设置、不能管理用户。
  editor: [
    'export',
    'question.edit',
    'paper.edit',
    'paper.delete',
    'governance.review',
    'source.edit',
  ],
  // 管理员：全部。
  admin: [
    'export',
    'question.edit',
    'paper.edit',
    'paper.delete',
    'governance.review',
    'source.edit',
    'settings.edit',
    'user.manage',
  ],
}

/** 判断某角色是否拥有某动作的权限。 */
export function roleCan(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role]?.includes(action) ?? false
}

/** 列出某角色拥有的全部动作（供测试与调试）。 */
export function actionsOf(role: Role): readonly Action[] {
  return ROLE_ACTIONS[role] ?? []
}

/** 角色的中文名（用于界面展示，**不要**把英文 role 直接给老师看）。 */
export const ROLE_LABELS: Record<Role, string> = {
  viewer: '只读',
  editor: '可编辑',
  admin: '管理员',
}

/** 权限不足时的统一提示（教师语言）。 */
export function describeDenied(action: Action): string {
  const what: Record<Action, string> = {
    'question.edit': '修改题目',
    'paper.edit': '编辑试卷',
    'paper.delete': '删除试卷',
    'governance.review': '处理复核项',
    'source.edit': '修改来源文件',
    'settings.edit': '修改系统设置',
    'user.manage': '管理用户',
    export: '导出试卷',
  }
  return `你的账号是只读权限，不能${what[action]}。如需权限请联系管理员。`
}
