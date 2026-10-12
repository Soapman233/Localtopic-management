import { describe, it, expect } from 'vitest'
import { createTheme } from '@mui/material/styles'
import { buildTheme, motion, tokens } from '../../src/theme'

/**
 * M3 升级守卫。
 *
 * 覆盖三件事（缺一即回归）：
 *  1. 动效 token 存在且取值落在 M3 的 short/medium/long 档位与 standard/emphasized 缓动族上；
 *  2. 浅色与深色两种模式都能构建（`buildTheme({ dark: true })` 不抛）；
 *  3. `MuiButton` 的**键盘焦点环**仍在——它是 `disableElevation: true` 的历史缺陷补丁，
 *     任何对阴影/高度的改动都必须保留（见 theme.ts 内注释）。
 * 另附形状（M3 medium=12）与 tonal elevation（level-1 阴影减淡）两条最小断言。
 */
describe('M3 主题升级', () => {
  const theme = buildTheme()

  it('transitions.duration 暴露 M3 完整档位且取值符合 M3 刻度', () => {
    const d = theme.transitions.duration
    expect(d.short1).toBe(50)
    expect(d.short2).toBe(100)
    expect(d.short3).toBe(150)
    expect(d.short4).toBe(200)
    expect(d.medium1).toBe(250)
    expect(d.medium2).toBe(300)
    expect(d.medium3).toBe(350)
    expect(d.medium4).toBe(400)
    expect(d.long1).toBe(450)
    expect(d.long2).toBe(500)
    expect(d.long3).toBe(550)
    expect(d.long4).toBe(600)
    expect(d.extraLong1).toBe(700)
    expect(d.extraLong4).toBe(1000)
    // 档位严格单调递增（short < medium < long < extra-long）
    expect(d.short1).toBeLessThan(d.medium1)
    expect(d.medium4).toBeLessThan(d.long1)
    expect(d.long4).toBeLessThan(d.extraLong1)
    // 与导出的 token 同源，避免两处各写一份
    expect(d.medium2).toBe(motion.duration.medium2)
  })

  it('transitions.easing 暴露 M3 standard/emphasized 缓动族', () => {
    const e = theme.transitions.easing
    expect(e.standard).toBe('cubic-bezier(0.2, 0, 0, 1)')
    expect(e.standardDecelerate).toBe('cubic-bezier(0, 0, 0, 1)')
    expect(e.standardAccelerate).toBe('cubic-bezier(0.3, 0, 1, 1)')
    expect(e.emphasized).toBe('cubic-bezier(0.2, 0, 0, 1)')
    expect(e.emphasizedDecelerate).toBe('cubic-bezier(0.05, 0.7, 0.1, 1)')
    expect(e.emphasizedAccelerate).toBe('cubic-bezier(0.3, 0, 0.8, 0.15)')
    expect(e.linear).toBe('cubic-bezier(0, 0, 1, 1)')
    for (const curve of Object.values(e)) expect(curve).toMatch(/^cubic-bezier\(/)
  })

  it('MUI 旧档位键被重映射到 M3 刻度（组件实际用的就是 M3 时长）', () => {
    const d = theme.transitions.duration
    // 不再是 M2 的 150 / 250 / 375
    expect(d.shortest).toBe(motion.duration.short2)
    expect(d.shorter).toBe(motion.duration.short3)
    expect(d.short).toBe(motion.duration.short4)
    expect(d.standard).toBe(motion.duration.medium2)
    expect(d.complex).toBe(motion.duration.medium4)
    expect(d.enteringScreen).toBe(motion.duration.medium1)
    expect(d.leavingScreen).toBe(motion.duration.short4)
    // 缓动同样不再是 M2 的 cubic-bezier(0.4, 0, 0.2, 1)
    expect(theme.transitions.easing.easeInOut).toBe(motion.easing.standard)
    expect(theme.transitions.easing.easeInOut).not.toBe('cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('浅色与深色两种模式都能构建主题', () => {
    expect(() => buildTheme()).not.toThrow()
    expect(() => buildTheme({ dark: true })).not.toThrow()
    const dark = buildTheme({ dark: true })
    expect(dark.palette.mode).toBe('dark')
    // 动效 token 与模式无关，两种模式下都应可用
    expect(dark.transitions.duration.medium2).toBe(300)
    expect(dark.transitions.easing.emphasizedDecelerate).toBe('cubic-bezier(0.05, 0.7, 0.1, 1)')
  })

  it('MuiButton 的键盘焦点环样式仍在', () => {
    const overrides = theme.components!.MuiButton!.styleOverrides as Record<string, unknown>
    const root = overrides.root as (arg: { theme: typeof theme }) => Record<string, Record<string, unknown>>
    const resolved = typeof root === 'function' ? root({ theme }) : (root as unknown as Record<string, Record<string, unknown>>)
    const focusKey = Object.keys(resolved).find((k) => k.includes('Mui-focusVisible'))
    expect(focusKey).toBeTruthy()
    const rule = resolved[focusKey as string]
    expect(rule.outline).toContain(theme.palette.primary.main)
    expect(rule.outlineOffset).toBe(2)
  })

  it('M3 形状：基础圆角为 medium(12) 并派生到 MUI shape', () => {
    expect(tokens.radius).toBe(12)
    expect(theme.shape.borderRadius).toBe(12)
  })

  it('M3 tonal elevation：level-1 阴影比 MUI 默认更淡，其余档位不变', () => {
    const muiDefault = createTheme().shadows
    expect(theme.shadows).toHaveLength(25)
    expect(theme.shadows[1]).not.toBe(muiDefault[1])
    // 只改 level-1，level ≥ 2（Menu/Dialog/AppBar）保持原值
    expect(theme.shadows[2]).toBe(muiDefault[2])
    expect(theme.shadows[8]).toBe(muiDefault[8])
  })

  it('M3 状态层：ListItemButton 悬停用 8% 内容色叠加', () => {
    const overrides = theme.components!.MuiListItemButton!.styleOverrides as Record<string, unknown>
    const root = overrides.root as (arg: { theme: typeof theme }) => Record<string, Record<string, unknown>>
    const resolved = root({ theme })
    expect(resolved['&:hover'].backgroundColor).toBe('rgba(0, 0, 0, 0.08)')
    expect(resolved['&.Mui-selected'].backgroundColor).toBe('rgba(47, 99, 234, 0.12)')
  })
})
