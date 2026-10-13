import { describe, it, expect } from 'vitest'
import { buildTheme, tokens } from '../../src/theme'

/**
 * 对比度漂移守卫（P5-2）。
 *
 * `npm run contrast` 校验的是一份**静态** `tests/visual/contrast-pairs.json`；
 * 若有人改了 `theme.ts` 的取值却没同步 JSON，门禁仍会「绿」但应用已不达标。
 * 本测试直接**构建真实主题**、对 `palette` 里的实际取值复算 WCAG 对比度，
 * 从根上锁死「主题取值 ⇄ 达标」这一不变量。
 *
 * 覆盖范围：主色填充（按钮/顶栏）、语义色 main（outlined 文字/图标）与其 contrastText（filled 徽章）、
 * 以及**两种模式下**主色作文字。P0/T02 起主色不再「原样采用」，而是由 `buildTheme` 按模式收敛
 * （浅色加深 / 深色提亮）到承载底上达标，故这里同时锁死「深色主色作文字」与「任意合法主色都达标」。
 * Alert 的 light/dark 派生色、CSS 里硬编码的排版预览 chrome 色由 JSON 门禁覆盖。
 */

/** WCAG 2.x 相对亮度（sRGB）。 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 把 `rgba(r,g,b,a)` 合成到不透明底色上，得到等效 hex（MUI 的 contrastText 常是半透明黑）。 */
function composite(fg: string, bg: string): string {
  const m = fg.match(/rgba?\(([^)]+)\)/)
  if (!m) return fg
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => parseFloat(x))
  const alpha = parseFloat(a as unknown as string)
  const [br, bgc, bb] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  const mix = (f: number, bck: number) => Math.round(alpha * f + (1 - alpha) * bck)
  return '#' + [mix(r, br), mix(g, bgc), mix(b, bb)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** 对比度（两色互换结果相同）。 */
function contrast(a: string, b: string): number {
  const fg = composite(a, b)
  const [hi, lo] = [luminance(fg), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SEMANTIC = ['success', 'warning', 'error'] as const

describe('主题对比度（WCAG AA 4.5:1）', () => {
  for (const dark of [false, true]) {
    const name = dark ? '深色' : '浅色'
    const theme = buildTheme({ dark })
    const paper = theme.palette.background.paper
    const pageBg = theme.palette.background.default

    it(`${name}·主色底上的文字（顶栏/实心按钮/分页选中）达标`, () => {
      // P0/T02：白字压主色的表面改用派生**填充安全值** `primary.dark`（恒按浅色底收敛），
      // 而不是 `primary.main`（深色模式下它被提亮，白字不达标）。
      expect(contrast(theme.palette.primary.contrastText, theme.palette.primary.dark)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${name}·主色作文字在白卡片/页面底色上达标`, () => {
      // P0/T02：浅色模式取深色卡片 `#FFFFFF`/页面底 `#F5F6F8`；深色模式取 `#1E1E1E`/`#121212`。
      expect(contrast(theme.palette.primary.main, paper)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.palette.primary.main, pageBg)).toBeGreaterThanOrEqual(4.5)
    })

    for (const key of SEMANTIC) {
      it(`${name}·${key}：outlined 文字（main）在白卡片/页面底色上达标`, () => {
        const main = theme.palette[key].main
        expect(contrast(main, paper)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(main, pageBg)).toBeGreaterThanOrEqual(4.5)
      })

      it(`${name}·${key}：filled 徽章 contrastText 压 main 达标`, () => {
        const { main, contrastText } = theme.palette[key]
        expect(contrast(contrastText, main)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('语义色 main 必须取「文字安全值」而非鲜艳填充值', () => {
    const light = buildTheme()
    expect(light.palette.success.main).toBe(tokens.successText)
    expect(light.palette.warning.main).toBe(tokens.warningText)
    expect(light.palette.error.main).toBe(tokens.errorText)
    const dark = buildTheme({ dark: true })
    expect(dark.palette.success.main).toBe(tokens.successTextDark)
    expect(dark.palette.warning.main).toBe(tokens.warningTextDark)
    expect(dark.palette.error.main).toBe(tokens.errorTextDark)
    // 鲜艳填充值被保留（供 filled 徽章底色 / 非文字填充），且**不等于** main
    expect(tokens.success).toBe('#22C55E')
    expect(light.palette.success.main).not.toBe(tokens.success)
  })

  it('中性灰在两种底色上均达标；禁用态为规范豁免的浅灰', () => {
    expect(contrast(tokens.neutral, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokens.neutral, tokens.bg)).toBeGreaterThanOrEqual(4.5)
    // 禁用态豁免（SC 1.4.3），仅作记录：应保持浅于文字值
    expect(luminance(tokens.neutralDisabled)).toBeGreaterThan(luminance(tokens.neutral))
  })

  it('任意合法主色（含历史 #3370FF）在两种模式下都被收敛到达标', () => {
    // P0/T02 验收：`settings.json` 可能存着任意用户主色。这里对「达标色 / 历史 #3370FF /
    // 预设色 / 极端色」逐一构建真实主题，断言三处关键组合全部 ≥4.5:1。
    const candidates = ['#3370FF', '#2F63EA', '#0E7490', '#15803D', '#7C3AED', '#9A3412', '#FFFF00', '#FFFFFF', '#000000', '#808080']
    for (const primary of candidates) {
      for (const dark of [false, true]) {
        const t = buildTheme({ primary, dark })
        const { main, dark: fill, contrastText } = t.palette.primary
        const label = `${primary}/${dark ? 'dark' : 'light'}`
        // 作文字：承载底（卡片 + 页面底）上均达标
        expect(contrast(main, t.palette.background.paper), label).toBeGreaterThanOrEqual(4.5)
        expect(contrast(main, t.palette.background.default), label).toBeGreaterThanOrEqual(4.5)
        // 压主色底的字（顶栏/实心按钮/分页选中）达标
        expect(contrast(contrastText, fill), label).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
