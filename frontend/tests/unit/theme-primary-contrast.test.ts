/**
 * 主色对比度收敛测试（评审 F2 / 规范 §5.2；**R02 = ③ 都做** 的 ② 那一半）。
 *
 * 为什么必须是测试而不是「跑一次探针」
 * ----------------------------------
 * 对比度门禁 `check-contrast.mjs` 校验的是 **token 配对表**，
 * 而真正生效的主色来自**运行期存值**（`outputs/webui/settings.json`）——门禁测不到它。
 * 实测后果：本机存着旧默认值 `#3370FF`，白字仅 **4.28:1**，全站 11 类元素不达 AA，
 * 而门禁一路报通过。
 *
 * 所以这里把「任意合法主色都能收敛到达标」变成**可重复执行的断言**：
 * 用一组**对抗性取值**（纯白、纯黄、纯绿等极端值）逼出收敛逻辑的边界。
 */
import { describe, expect, it } from 'vitest'
import {
  PRIMARY_MIN_CONTRAST,
  buildTheme,
  contrastRatio,
  resolvePrimary,
  tokens,
} from '../../src/theme'

/** 浅色模式下主色必须同时满足的两条（对称，但取更紧的页面底）。 */
function assertLightOk(main: string) {
  expect(contrastRatio(main, tokens.bg)).toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST)
  expect(contrastRatio('#FFFFFF', main)).toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST)
}

/** 深色模式下主色作文字必须压过两种深色表面。 */
function assertDarkOk(main: string) {
  expect(contrastRatio(main, '#1E1E1E')).toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST)
  expect(contrastRatio(main, '#121212')).toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST)
}

describe('resolvePrimary（主色对比度收敛）', () => {
  it('token 的「文字安全值」不被动：不调整，原样使用', () => {
    const r = resolvePrimary(tokens.primary, false)
    expect(r.main).toBe(tokens.primary)
    expect(r.adjusted).toBe(false)
    expect(r.contrastText).toBe('#FFFFFF')
  })

  it('🔴 旧默认值 #3370FF（F2 的元凶）：浅色下必须被收敛到达标', () => {
    const r = resolvePrimary('#3370FF', false)
    // 先证明「改前确实不达标」——这是反证，不是形式断言
    expect(contrastRatio('#3370FF', tokens.bg)).toBeLessThan(PRIMARY_MIN_CONTRAST)
    // 再断言收敛后达标
    expect(r.adjusted).toBe(true)
    assertLightOk(r.main)
    // 收敛结果应落在 token 值附近（说明规则与既有取值一致，而非另起一套）
    expect(r.main.toLowerCase()).not.toBe('#3370ff')
  })

  it('#3370FF 在深色下也必须收敛，且填充文字转为深色', () => {
    const r = resolvePrimary('#3370FF', true)
    expect(contrastRatio('#3370FF', '#1E1E1E')).toBeLessThan(PRIMARY_MIN_CONTRAST)
    expect(r.adjusted).toBe(true)
    assertDarkOk(r.main)
    // 主色被调亮后，白字压上去不再达标 → 必须改用深色文字
    expect(contrastRatio('#FFFFFF', r.main)).toBeLessThan(PRIMARY_MIN_CONTRAST)
    expect(r.contrastText).not.toBe('#FFFFFF')
  })

  it('非法值安全回退到 tokens.primary（不抛、不产生脏色）', () => {
    for (const bad of ['', 'red', '#12345', 'rgb(1,2,3)', '#GGGGGG']) {
      const r = resolvePrimary(bad, false)
      expect(r.main).toBe(tokens.primary)
    }
    expect(resolvePrimary(undefined, false).main).toBe(tokens.primary)
  })

  it('对抗性取值（极端亮色）也必须收敛达标', () => {
    const adversarial = ['#FFFFFF', '#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#F0F0F0', '#3370FF', '#8AB4F8']
    for (const c of adversarial) {
      const light = resolvePrimary(c, false)
      assertLightOk(light.main)
      const dark = resolvePrimary(c, true)
      assertDarkOk(dark.main)
    }
  })

  it('buildTheme 真的用了收敛后的值（不是只在工具函数里算了一遍）', () => {
    const theme = buildTheme({ primary: '#3370FF', dark: false })
    expect(contrastRatio(theme.palette.primary.main, tokens.bg)).toBeGreaterThanOrEqual(
      PRIMARY_MIN_CONTRAST,
    )
    const darkTheme = buildTheme({ primary: '#3370FF', dark: true })
    expect(contrastRatio(darkTheme.palette.primary.main, '#1E1E1E')).toBeGreaterThanOrEqual(
      PRIMARY_MIN_CONTRAST,
    )
  })
})

describe('contrastRatio（口径唯一）', () => {
  it('与 WCAG 已知值一致：黑白 21:1、同色 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#2F63EA', '#2F63EA')).toBeCloseTo(1, 5)
  })

  it('对称：交换前景背景结果不变', () => {
    expect(contrastRatio('#3370FF', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#3370FF'), 10)
  })
})
