/**
 * 门禁：**一屏一个主操作**（规范 §4.2 Button 层级：「`contained` primary = 页面唯一主操作，
 * 一屏 ≤ 1 个」；评审 F10）。
 *
 * 为什么需要它
 * ------------
 * 组卷工作台原先**一屏 65 个 button**，每张题卡一个蓝色 `contained`「加入」——
 * 全站最高频页面里，最强的视觉权重被 8+ 个同权按钮平分，**等于没有主操作**。
 *
 * 规范给的做法是：卡片行内动作降权，**主操作交给顶部批量条**（勾选后才出现）。
 * 本文件把这条钉住，防止以后有人「顺手」把卡片按钮改回 `contained`。
 *
 * ⚠️ 计数口径（**踩过坑**）：只数「**当前可见且可用**」的 `contained` 按钮。两条都要，理由不同：
 * 1. **可见**：`Dialog` / `Drawer` 是独立表面（有自己的主操作），但会被 `keepMounted` 挂在 DOM 里，
 *    关闭时只是不可见——直接数整页会把抽屉里的「新建」算进来。`visibility` 是**继承**属性，
 *    关闭的抽屉内元素 `getComputedStyle` 也是 `hidden`，用它过滤（jsdom 无布局，不能用 `offsetParent`）。
 * 2. **可用**：§4.2 的意图是「**不要让多个动作竞争主操作的视觉权重**」。
 *    实测组卷页在「还没有试卷」时同时有：空态的 CTA（打开试卷列表）+ **禁用**的「导出」。
 *    禁用按钮不构成竞争（点不动、也已灰化），故不计入。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import QuestionCard from '../../src/components/QuestionCard'
import PaperBuilderPage from '../../src/pages/PaperBuilderPage'
import { AuthProvider } from '../../src/app/auth/AuthProvider'
import { usePaperStore } from '../../src/store/paperStore'
import { renderPage } from './pages/pageTestUtils'
import type { SearchItem } from '../../src/api/types'

/** 最简题目夹具（只给 QuestionCard 需要的字段）。 */
const item = {
  id: 1,
  number: '1',
  plain_text: '1．下列关于密度的说法正确的是（　）A．…B．…',
  qtype: '选择题',
  difficulty: '未标注',
  chapter: '6.2 密度',
} as unknown as SearchItem

beforeEach(() => {
  usePaperStore.setState({ currentPaperId: null, targetSectionId: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: {}, message: 'ok' }),
    } as unknown as Response)),
  )
})

afterEach(() => vi.unstubAllGlobals())

/** 当前屏幕上**可见且可用**的 `contained` 按钮数量。 */
function activeContainedCount(): number {
  return [...document.querySelectorAll<HTMLButtonElement>('.MuiButton-contained')].filter((el) => {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    return !el.disabled
  }).length
}

describe('QuestionCard：卡片行内动作已降权', () => {
  it('「加入」不再是 contained（降为 outlined，主操作交给顶部批量条）', () => {
    renderPage(<QuestionCard item={item} onAdd={() => {}} onDetail={() => {}} />)
    const add = screen.getByRole('button', { name: /加入/ })
    expect(add.className).not.toContain('MuiButton-contained')
    expect(add.className).toContain('MuiButton-outlined')
  })

  it('「详情」是 text 级（规范 §4.2：行内动作只能用 text）', () => {
    renderPage(<QuestionCard item={item} onAdd={() => {}} onDetail={() => {}} />)
    const detail = screen.getByRole('button', { name: /详情/ })
    expect(detail.className).not.toContain('MuiButton-contained')
    expect(detail.className).not.toContain('MuiButton-outlined')
  })
})

describe('组卷工作台：一屏 contained ≤ 1（规范 §4.2）', () => {
  it('未选择试卷时，屏幕上只有一个主操作（导出）', async () => {
    renderPage(
      <AuthProvider>
        <PaperBuilderPage />
      </AuthProvider>,
      { route: '/builder' },
    )
    await screen.findAllByRole('heading', { level: 1 })
    const n = activeContainedCount()
    expect(n, `组卷页「可见且可用」的 contained 按钮应 ≤1，实测 ${n}`).toBeLessThanOrEqual(1)
  })
})
