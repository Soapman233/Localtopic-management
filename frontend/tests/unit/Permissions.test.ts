/**
 * 权限模型测试（阶段 4：两版适配）。
 *
 * 为什么值得逐格断言：权限是**安全边界**，而前端这份表只是"界面该不该给入口"。
 * 一旦某格写错（例如 viewer 意外拿到 `paper.delete`），老师会看到能点但必失败的按钮；
 * 更糟的是它会让后端权限矩阵的意图在前端被"提前泄露"成误导性的 UI。
 *
 * ⚠️ 再次强调：**真正的强制在后端**。本文件只保证前端表现与后端意图一致。
 */
import { describe, it, expect } from 'vitest'
import {
  ROLE_LABELS,
  actionsOf,
  describeDenied,
  roleCan,
  type Action,
} from '../../src/lib/permissions'
import type { Role } from '../../src/api/auth'

const ALL_ACTIONS: Action[] = [
  'export',
  'question.edit',
  'paper.edit',
  'paper.delete',
  'governance.review',
  'source.edit',
  'settings.edit',
  'user.manage',
]

/** 期望矩阵：`true` = 该角色拥有该动作。 */
const EXPECTED: Record<Role, Partial<Record<Action, boolean>>> = {
  viewer: { export: true },
  editor: {
    export: true,
    'question.edit': true,
    'paper.edit': true,
    'paper.delete': true,
    'governance.review': true,
    'source.edit': true,
  },
  admin: Object.fromEntries(ALL_ACTIONS.map((a) => [a, true])) as Record<Action, boolean>,
}

describe('权限矩阵 · 逐格断言', () => {
  for (const role of ['viewer', 'editor', 'admin'] as Role[]) {
    for (const action of ALL_ACTIONS) {
      const want = EXPECTED[role][action] === true
      it(`${role} ${want ? '拥有' : '不拥有'} ${action}`, () => {
        expect(roleCan(role, action)).toBe(want)
      })
    }
  }

  it('viewer 是只读：除 export 外一律无权限', () => {
    const owned = ALL_ACTIONS.filter((a) => roleCan('viewer', a))
    expect(owned).toEqual(['export'])
  })

  it('editor 不得管理用户、不得改系统设置', () => {
    expect(roleCan('editor', 'user.manage')).toBe(false)
    expect(roleCan('editor', 'settings.edit')).toBe(false)
  })

  it('admin 拥有全部动作', () => {
    expect(ALL_ACTIONS.filter((a) => roleCan('admin', a))).toEqual(ALL_ACTIONS)
  })

  it('editor 的动作是 viewer 的超集（层级单调）', () => {
    for (const a of actionsOf('viewer')) expect(roleCan('editor', a)).toBe(true)
  })

  it('admin 的动作是 editor 的超集（层级单调）', () => {
    for (const a of actionsOf('editor')) expect(roleCan('admin', a)).toBe(true)
  })

  it('未知角色一律无权限（不 fail-open）', () => {
    expect(roleCan('nobody' as Role, 'export')).toBe(false)
  })
})

describe('权限文案', () => {
  it('每个动作都有教师语言的拒绝说明，且不出现内部英文标识', () => {
    for (const a of ALL_ACTIONS) {
      const msg = describeDenied(a)
      expect(msg.length).toBeGreaterThan(0)
      // 不能把 'paper.delete' 这种内部标识直接甩给老师
      expect(msg).not.toContain(a)
      expect(msg).not.toMatch(/[a-z]+\.[a-z]+/)
    }
  })

  it('拒绝说明明确提到「只读」与「联系管理员」', () => {
    const msg = describeDenied('paper.delete')
    expect(msg).toContain('只读')
    expect(msg).toContain('管理员')
  })

  it('三种角色都有中文名（不把英文 role 给老师看）', () => {
    expect(ROLE_LABELS.viewer).toBe('只读')
    expect(ROLE_LABELS.editor).toBe('可编辑')
    expect(ROLE_LABELS.admin).toBe('管理员')
  })
})

describe('部署形态', () => {
  it('未设置 VITE_DEPLOY_MODE 时默认为 local（安全默认）', async () => {
    const mod = await import('../../src/lib/deployMode')
    // 测试环境未注入该变量 → 必须是 local。
    // 这条很重要：若默认成 online，纯本地部署会被要求登录却没人能登录。
    expect(mod.DEPLOY_MODE).toBe('local')
    expect(mod.IS_ONLINE).toBe(false)
  })
})
