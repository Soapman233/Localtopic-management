/**
 * 「继续上次的卷」入口 + **安全回退**单测（设计规范 §4.5 第 4 条）。
 *
 * 重点：上次的卷被删除后，`currentPaperId` 仍指向不存在的 id ——
 * 组件必须清空脏 id 且**不渲染**入口（不崩、不指向不存在的卷）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ContinueLastPaper } from '../../src/components/ContinueLastPaper'
import { usePaperStore } from '../../src/store/paperStore'
import { renderPage, jsonResponse } from './pages/pageTestUtils'
import type { Paper } from '../../src/api/types'

/** 最简试卷夹具（入口只消费 id 与 title）。 */
const paper = (id: number, title: string) => ({ id, title } as unknown as Paper)

beforeEach(() => {
  usePaperStore.setState({ currentPaperId: null, targetSectionId: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('ContinueLastPaper', () => {
  it('上次的卷仍在 → 渲染「继续上次的卷「标题」」入口', async () => {
    usePaperStore.setState({ currentPaperId: 5 })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([paper(5, '第 3 章单元测验')])))
    renderPage(<ContinueLastPaper />)

    expect(
      await screen.findByRole('button', { name: /继续上次的卷「第 3 章单元测验」/ }),
    ).toBeInTheDocument()
  })

  it('上次的卷已被删除 → 清空脏 id 且不渲染入口（安全回退）', async () => {
    usePaperStore.setState({ currentPaperId: 5 })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([paper(6, '另一份卷')])))
    renderPage(<ContinueLastPaper />)

    await waitFor(() => expect(usePaperStore.getState().currentPaperId).toBeNull())
    expect(screen.queryByRole('button', { name: /继续上次的卷/ })).not.toBeInTheDocument()
  })

  it('没有上次的卷（currentPaperId 为 null）→ 不渲染', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    renderPage(<ContinueLastPaper />)

    expect(screen.queryByRole('button', { name: /继续上次的卷/ })).not.toBeInTheDocument()
  })
})
