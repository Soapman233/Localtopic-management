/**
 * `lib/routeMeta` 纯函数测试（设计规范 §4 P0 的派生逻辑）。
 *
 * 这三件事**只由 pathname 决定**，因此必须用纯函数测，而不是靠渲染页面去间接覆盖：
 * 1. `deriveCrumbs` —— 面包屑只在「侧栏说不清位置」的页面出现，顶层页必须为空；
 * 2. `contentMaxWidthFor` —— 正文类限宽 / 工具类全宽的分档；
 * 3. `documentTitleForPath` —— 既有能力，随模块搬迁一并回归（防搬迁改坏）。
 */
import { describe, expect, it } from 'vitest'
import {
  BASE_TITLE,
  contentMaxWidthFor,
  deriveCrumbs,
  documentTitleForPath,
  normalizePath,
} from '../../src/lib/routeMeta'

describe('normalizePath', () => {
  it('去掉首尾斜杠', () => {
    expect(normalizePath('/builder/')).toBe('builder')
    expect(normalizePath('builder')).toBe('builder')
    expect(normalizePath('/')).toBe('')
  })
})

describe('deriveCrumbs（面包屑派生）', () => {
  it('侧栏可见的顶层页返回空（单节点面包屑是噪音）', () => {
    for (const p of ['/builder', '/search', '/import', '/settings', '/manage']) {
      expect(deriveCrumbs(p)).toEqual([])
    }
  })

  it('单题详情：来路是「找题」，末级是「题目详情」', () => {
    expect(deriveCrumbs('/question/123')).toEqual([
      { label: '找题', to: '/search' },
      { label: '题目详情' },
    ])
  })

  it('单题详情可用 currentLabel 覆盖末级（题号来自数据）', () => {
    const crumbs = deriveCrumbs('/question/123', { currentLabel: '题 123' })
    expect(crumbs[crumbs.length - 1]).toEqual({ label: '题 123' })
    // 首级不受影响
    expect(crumbs[0]).toEqual({ label: '找题', to: '/search' })
  })

  it('导出中心：来路指向「组卷工作台」（与选中态口径一致）', () => {
    expect(deriveCrumbs('/export')).toEqual([
      { label: '组卷工作台', to: '/builder' },
      { label: '导出中心' },
    ])
  })

  it('维护子页：两级「数据维护 › 具体页」', () => {
    expect(deriveCrumbs('/manage/formula-review')).toEqual([
      { label: '数据维护', to: '/manage/knowledge' },
      { label: '公式复核' },
    ])
    expect(deriveCrumbs('/manage/stats')[1]).toEqual({ label: '题库统计' })
  })

  it('末级永远没有 to（当前页不该链接到自身）', () => {
    for (const p of ['/question/1', '/export', '/manage/sources']) {
      const crumbs = deriveCrumbs(p)
      expect(crumbs[crumbs.length - 1].to).toBeUndefined()
    }
  })

  it('未知路径返回空（不伪造层级）', () => {
    expect(deriveCrumbs('/nope')).toEqual([])
    expect(deriveCrumbs('')).toEqual([])
  })
})

describe('contentMaxWidthFor（内容限宽分档）', () => {
  it('正文类页面限宽', () => {
    expect(contentMaxWidthFor('/settings')).toBe(1100)
    expect(contentMaxWidthFor('/import')).toBe(1100)
    // 详情页要容纳「正文 + 右侧上下文面板」两列，故更宽
    expect(contentMaxWidthFor('/question/123')).toBe(1200)
  })

  it('工具类页面全宽（限宽会挤压双栏与宽表格）', () => {
    for (const p of ['/builder', '/search', '/export', '/manage/stats', '/manage/sources']) {
      expect(contentMaxWidthFor(p)).toBeNull()
    }
  })
})

describe('documentTitleForPath（搬迁回归）', () => {
  it('已知路由 → 页面名 · 初中物理题库', () => {
    expect(documentTitleForPath('/builder')).toBe('组卷工作台 · 初中物理题库')
    // 维护子页取更具体的前缀，不退化
    expect(documentTitleForPath('/manage/stats')).toBe('题库统计 · 初中物理题库')
    expect(documentTitleForPath('/manage')).toBe('数据维护 · 初中物理题库')
    expect(documentTitleForPath('/settings')).toBe('系统设置 · 初中物理题库')
  })

  it('未知路由 → 基础标题', () => {
    expect(documentTitleForPath('/nope')).toBe(BASE_TITLE)
  })
})
