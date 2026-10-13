import { describe, expect, it } from 'vitest'
// @ts-expect-error 项目未安装Node类型；仅测试环境读取实际CSS/TS文件，不进入生产构建。
import fs from 'node:fs'
import { buildTheme, tokens } from '../../src/theme'

describe('T12 令牌真实消费契约', () => {
  it('间距完整且保持MUI多参数、负数和字符串语义', () => {
    expect(tokens.space).toEqual({ 0: 0, half: 4, 1: 8, 2: 16, 3: 24, 4: 32, 6: 48, 8: 64 })
    const t = buildTheme(); expect(t.spacing(.5, 1, 2)).toBe('4px 8px 16px'); expect(t.spacing(-1, 'auto')).toBe('-8px auto')
  })
  it('完整映射MUI时长与曲线，路由旧ease保持', () => {
    expect(tokens.motion).toEqual({ fast:120, base:180, slow:240, ease:'cubic-bezier(0.2, 0, 0, 1)', easeOut:'ease-out', easeIn:'ease-in', legacyRouteEase:'ease' })
    const t = buildTheme(); expect(t.transitions.duration).toEqual({ shortest:120, short:120, standard:180, shorter:180, complex:240, enteringScreen:240, leavingScreen:240 })
    expect(t.transitions.easing).toEqual({ easeInOut:tokens.motion.ease, easeOut:'ease-out', easeIn:'ease-in', sharp:tokens.motion.ease })
  })
  it('主题注入CSS桥且路由/list消费同一令牌，reduce完全关闭', () => {
    const t = buildTheme(), css = t.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>
    expect(css[':root']).toMatchObject({ '--qb-motion-fast':'120ms', '--qb-route-ease':'ease', '--qb-paper-handle':tokens.neutral })
    const route = fs.readFileSync('src/app/routeTransitions.css', 'utf8'), list = fs.readFileSync('src/components/AnimatedList.tsx', 'utf8')
    expect(route).toContain('var(--qb-motion-fast) var(--qb-route-ease)'); expect(route).not.toMatch(/120ms|animation:.*\b120\b/)
    expect(route).toContain('animation: none !important; transition: none !important;'); expect(list).toContain('tokens.motion.fast'); expect(list).toContain('tokens.motion.easeOut')
    expect(list).toContain("import('@formkit/auto-animate')"); expect(list).toContain('destroy?.()')
  })
})
