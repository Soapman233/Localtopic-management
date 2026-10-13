/**
 * `lib/questionText.ts` 行为测试（T05）。
 *
 * 契约：**展示期**剥离题干内嵌的「答案 / 详解 / 解析」区段，只保留「题干 + 选项」。
 * 关键边界：
 * 1. 只认**全角** `【】` 包裹的**固定词白名单**（公式里的半角 `[]` 不得被误伤）；
 * 2. 未命中标记的文本（长题 / 图片 / 无答案）必须**原样返回**，不得截断；
 * 3. 标记在开头（截断后为空）→ 返回空串，不伪造内容；
 * 4. `null` / `undefined` / 空串安全。
 */
import { describe, it, expect } from 'vitest'
import { stripAnswerSections } from '../../src/lib/questionText'

describe('stripAnswerSections（T05 题干内嵌答案区剥离）', () => {
  it('剥离【答案】及其后的【详解】整段', () => {
    const src = '6．下列关于浮力的说法正确的是（　　）\nA．只有浮在液体表面的物体\nB．物体只有浸入到液体中\n【答案】D\n【详解】A．浮力产生的原因是……故选D。'
    expect(stripAnswerSections(src)).toBe('6．下列关于浮力的说法正确的是（　　）\nA．只有浮在液体表面的物体\nB．物体只有浸入到液体中')
  })

  it('覆盖【解析】/【解答】/【分析】/【点评】/【参考答案】等变体', () => {
    for (const tag of ['【解析】', '【解答】', '【分析】', '【点评】', '【参考答案】']) {
      expect(stripAnswerSections(`题干内容${tag}后续解释`)).toBe('题干内容')
    }
  })

  it('【参考答案】整体识别，不会被拆成【答案】前缀误切', () => {
    // 若把 `答案` 排在 `参考答案` 之前，`【参考答案】` 会在 `参考` 处被切掉，留下错误的「参考」。
    expect(stripAnswerSections('题干【参考答案】B')).toBe('题干')
  })

  it('未命中标记 → 原样返回（长题不截断）', () => {
    const long = '题干很长……'.repeat(500)
    expect(stripAnswerSections(long)).toBe(long)
  })

  it('半角方括号 [答案] 不是标记，不得误伤公式', () => {
    const src = '已知 [答案] 只是公式里的方括号：x = [1, 2]'
    expect(stripAnswerSections(src)).toBe(src)
  })

  it('未知词（不在白名单）不截断', () => {
    const src = '题干【思考】这是普通小标题，不是答案区'
    expect(stripAnswerSections(src)).toBe(src)
  })

  it('标记位于开头 → 返回空串（不伪造内容）', () => {
    expect(stripAnswerSections('【答案】D')).toBe('')
  })

  it('去掉标记前的尾部空白与换行', () => {
    expect(stripAnswerSections('题干\n\n   【详解】解析正文')).toBe('题干')
  })

  it('null / undefined / 空串安全', () => {
    expect(stripAnswerSections(null)).toBe('')
    expect(stripAnswerSections(undefined)).toBe('')
    expect(stripAnswerSections('')).toBe('')
  })
})
