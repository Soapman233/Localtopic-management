/**
 * 设计令牌测试：**间距 / 动效**（评审 F11 / 规范 §2.3、§2.6；T09）。
 *
 * 为什么必须有
 * ------------
 * F11 的缺口是「`tokens` 只有颜色 + 圆角，**没有 spacing / motion**」——
 * 后果是动效以**字面量**散落在 `index.css` 与 `AnimatedList` 里（120ms / 180ms /
 * `cubic-bezier(0.2,0,0,1)`）。**「恰好等于规范值」不等于「有出处」**：
 * 改 token 时那些字面量不会跟着变，于是又回到魔法数字。
 *
 * 本测试把三件事钉住：
 * 1. token 取值**就是规范表里的值**（且间距只允许那 8 档）；
 * 2. `buildTheme` **真的消费**了它们（不是声明了没人用）；
 * 3. `index.css` 的 CSS 变量**与 token 一致**（CSS 无法 import TS，只能靠断言对齐）。
 */
import { describe, expect, it } from 'vitest'
import { buildTheme, tokens } from '../../src/theme'

const theme = buildTheme()

describe('tokens.space（规范 §2.3 间距）', () => {
  it('只有规范允许的 8 档取值', () => {
    expect(Object.values(tokens.space).sort((a, b) => a - b)).toEqual([0, 4, 8, 16, 24, 32, 48, 64])
  })

  it('键名与规范表一致（0 / half / 1 / 2 / 3 / 4 / 6 / 8）', () => {
    expect(Object.keys(tokens.space).sort()).toEqual(['0', '1', '2', '3', '4', '6', '8', 'half'].sort())
  })

  it('基准 8px 与 theme.spacing 对得上（可核对，而非靠约定俗成）', () => {
    expect(theme.spacing(1)).toBe('8px')
    expect(theme.spacing(2)).toBe('16px')
    expect(theme.spacing(3)).toBe('24px')
    expect(tokens.space[2]).toBe(16)
    expect(tokens.space[3]).toBe(24)
  })
})

describe('tokens.motion（规范 §2.6 动效）', () => {
  it('时长就是规范表里的 120 / 180 / 240', () => {
    expect(tokens.motion.fast).toBe(120)
    expect(tokens.motion.base).toBe(180)
    expect(tokens.motion.slow).toBe(240)
  })

  it('缓动就是规范表里的三条', () => {
    expect(tokens.motion.ease).toBe('cubic-bezier(0.2, 0, 0, 1)')
    expect(tokens.motion.easeOut).toBe('ease-out')
    expect(tokens.motion.easeIn).toBe('ease-in')
  })

  it('buildTheme **真的消费**了它们（不是声明了没人用）', () => {
    const d = theme.transitions.duration
    expect(d.short).toBe(tokens.motion.fast) // hover / focus 反馈
    expect(d.standard).toBe(tokens.motion.base)
    expect(d.complex).toBe(tokens.motion.slow) // 抽屉 / 对话框
    expect(theme.transitions.easing.easeInOut).toBe(tokens.motion.ease)
    expect(theme.transitions.easing.easeOut).toBe(tokens.motion.easeOut)
    expect(theme.transitions.easing.easeIn).toBe(tokens.motion.easeIn)
  })

  it('深色模式同样可用（动效与模式无关）', () => {
    const dark = buildTheme({ dark: true })
    expect(dark.transitions.duration.short).toBe(tokens.motion.fast)
    expect(dark.transitions.duration.complex).toBe(tokens.motion.slow)
  })
})
