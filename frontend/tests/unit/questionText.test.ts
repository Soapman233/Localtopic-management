/**
 * `lib/questionText` 纯函数测试（设计评审 F4：题干里混入答案/解析的渲染期剥离）。
 *
 * 覆盖任务 T04 指定的 8 类场景：
 * ① 六种 `【】` 标记各自单独出现；② 多标记取最早；③ `【解析】【分析】` 相邻；
 * ④ `答案：` / `解析：` 行首被认、句中不被认；⑤ 标记在下标 0 → 返回原文；
 * ⑥ 无标记 → 原样；⑦ 空 / null；⑧ 选项必须保留（真实样本 id=118）。
 */
import { describe, expect, it } from 'vitest'
import { findEmbeddedMarker, stripEmbeddedAnswer } from '../../src/lib/questionText'

describe('stripEmbeddedAnswer —— ① 六种【】标记各自单独出现', () => {
  const markers = ['【答案】', '【详解】', '【解析】', '【解答】', '【分析】', '【点评】']

  for (const marker of markers) {
    it(`剥离 ${marker} 及其后内容`, () => {
      const text = `题干内容\n${marker}后面的答案或解析`
      expect(stripEmbeddedAnswer(text)).toBe('题干内容')
    })
  }
})

describe('stripEmbeddedAnswer —— ② 多标记取最早出现的位置', () => {
  it('即便【答案】不是第一个标记，也按最早标记切割', () => {
    // 真实库里组合多样：绝不能只认【答案】。此处【详解】先于【答案】出现。
    const text = '题干内容【详解】详解正文【答案】D'
    expect(stripEmbeddedAnswer(text)).toBe('题干内容')
    expect(findEmbeddedMarker(text)).toEqual({ index: 4, marker: '【详解】' })
  })

  it('findEmbeddedMarker 返回的正是最早标记的下标与文本', () => {
    const text = '题【答案】A【解析】因为…'
    expect(findEmbeddedMarker(text)).toEqual({ index: 1, marker: '【答案】' })
  })
})

describe('stripEmbeddedAnswer —— ③ 相邻标记【解析】【分析】', () => {
  it('切割点在第一个相邻标记处（前一字符为 】 的那批）', () => {
    const text = '题干\n【解析】【分析】正文'
    expect(stripEmbeddedAnswer(text)).toBe('题干')
    expect(findEmbeddedMarker(text)).toEqual({ index: 3, marker: '【解析】' })
  })
})

describe('stripEmbeddedAnswer —— ④ 行首型标记只在行首被认', () => {
  it('行首的 `答案：` 被认（前一字符是换行）', () => {
    expect(stripEmbeddedAnswer('第一行题干\n答案：B')).toBe('第一行题干')
  })

  it('行首的 `解析：` 被认', () => {
    expect(stripEmbeddedAnswer('题干\n解析：因为…')).toBe('题干')
  })

  it('句中的 `答案：` **不**被认（误切代价更大）', () => {
    const text = '请写出你的答案：并说明理由'
    expect(findEmbeddedMarker(text)).toBeNull()
    expect(stripEmbeddedAnswer(text)).toBe(text)
  })

  it('句中的 `解析：` **不**被认', () => {
    const text = '这里考的是解析：力的合成'
    expect(stripEmbeddedAnswer(text)).toBe(text)
  })
})

describe('stripEmbeddedAnswer —— ⑤ 标记出现在下标 0 → 返回原文', () => {
  it('不把题干弄成空串', () => {
    expect(stripEmbeddedAnswer('【答案】D')).toBe('【答案】D')
    expect(stripEmbeddedAnswer('答案：B')).toBe('答案：B')
    expect(findEmbeddedMarker('【答案】D')).toEqual({ index: 0, marker: '【答案】' })
  })
})

describe('stripEmbeddedAnswer —— ⑥ 无标记 → 原样返回', () => {
  it('普通题干原样返回（不 trim 非标记文本）', () => {
    const text = '2．下列说法正确的是（      ）\n\tA．甲\tB．乙'
    expect(stripEmbeddedAnswer(text)).toBe(text)
  })
})

describe('stripEmbeddedAnswer —— ⑦ 空 / null', () => {
  it('空串 / null / undefined 都返回空串', () => {
    expect(stripEmbeddedAnswer('')).toBe('')
    expect(stripEmbeddedAnswer(null)).toBe('')
    expect(stripEmbeddedAnswer(undefined)).toBe('')
  })

  it('findEmbeddedMarker 对空 / null 返回 null', () => {
    expect(findEmbeddedMarker('')).toBeNull()
    expect(findEmbeddedMarker(null)).toBeNull()
    expect(findEmbeddedMarker(undefined)).toBeNull()
  })
})

describe('stripEmbeddedAnswer —— ⑧ 选项必须保留（真实样本 id=118）', () => {
  const raw = [
    '2．蒸青团时，人们在很远处就能闻到香味，是由于温度升高（      ）',
    '\tA．分子才运动\tB．分子运动剧烈',
    '\tC．分子引力越小\tD．分子间空隙变大',
    '【答案】B',
    '【详解】蒸青团时，在…',
  ].join('\n')

  it('剥离后保留到 D 选项为止，且不含答案/详解标记', () => {
    const out = stripEmbeddedAnswer(raw)
    expect(out).toContain('A．分子才运动')
    expect(out).toContain('B．分子运动剧烈')
    expect(out).toContain('C．分子引力越小')
    expect(out).toContain('D．分子间空隙变大')
    expect(out).not.toContain('【答案】')
    expect(out).not.toContain('【详解】')
    expect(out.endsWith('D．分子间空隙变大')).toBe(true)
  })

  it('尾部的制表符/空白被 trim 掉', () => {
    expect(stripEmbeddedAnswer('题干\t\t \n【答案】B')).toBe('题干')
  })
})
