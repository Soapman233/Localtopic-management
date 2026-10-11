# 前端单元测试基座（vitest + Testing Library）

本目录是**真实组件行为测试**的基座（jsdom + `@testing-library/react`），用于在重构中提供
「改坏即红」的护栏。与仓库里既有的 `tests/*.test.cjs`（`node:test` + 源码字符串断言，无 DOM）
**并存、互不干扰**。

## 怎么跑

```bash
cd frontend

npm test            # 全量：旧 node:test 测试 + 新 vitest 测试（CI 用这一条）
npm run test:unit   # 只跑 vitest 单元测试
npx vitest run tests/unit/ConfirmDialog.test.tsx   # 跑单个文件
npx vitest          # watch 模式
```

## 目录约定

| 路径 | 运行器 | 说明 |
|---|---|---|
| `tests/*.test.cjs` | `node --test` | **旧测试**，源码字符串/护栏断言，无 DOM。**请勿改动**。 |
| `tests/unit/**/*.test.{ts,tsx}` | `vitest` | **新测试**，真实渲染 + 行为断言。新增测试放这里。 |
| `tests/unit/setup.ts` | vitest setup | 全局 setup（jest-dom、cleanup、jsdom API 兜底）。 |
| `tests/unit/testUtils.tsx` | — | 公共渲染工具（非测试文件）。 |
| `tests/unit/vitest-globals.d.ts` | — | 让 `tsc` 认识 vitest 全局 API。 |

> ⚠️ `vitest.config.ts` 的 `include` **只收集 `tests/unit/**`**。这是刻意的：
> `tests/*.test.cjs` 是 `node:test` 语法，交给 vitest 会直接报错。

## 写新测试的模板

```tsx
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { YourComponent } from '../../src/components/YourComponent'
import { renderWithTheme } from './testUtils'

describe('YourComponent', () => {
  it('描述用户可见的行为', () => {
    const onSomething = vi.fn()
    renderWithTheme(<YourComponent onSomething={onSomething} />)

    // 断言「用户看得到 / 用户操作的结果」，不要断言 className、内部 state 名
    expect(screen.getByText('可见文案')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onSomething).toHaveBeenCalledTimes(1)
  })
})
```

约定：
- **只测行为，不测实现**：用 `screen.getByRole('button', { name })` / `getByText` 等面向可访问性的查询；
  不要断言 `className`、内部 `useState` 变量名、组件内部结构。
- 事件用 `fireEvent`（**未安装** `@testing-library/user-event`，不要为它引入新依赖）。
- 需要 MUI 主题时用 `renderWithTheme`；若组件依赖 react-query，请在 `testUtils.tsx` 里按需补
  `QueryClientProvider` 包裹（当前 4 个被测组件都不需要）。
- 依赖 zustand 的组件（如 `KatexFormula`）**无需 Provider**，但要在用例间 `useSettingsStore.setState(...)`
  重置状态，避免互相污染。
- 新增依赖前请先与团队确认（本项目约定：不擅自 `npm install`）。

## jsdom 兜底了哪些 API

本机 `jsdom@30.1.2` **实测缺失**、已在 `setup.ts` 补齐：

| API | 为什么需要 |
|---|---|
| `window.matchMedia` | MUI `useMediaQuery` / 断点，缺失会直接崩 |
| `ResizeObserver` | MUI 自适应组件（Modal/Autocomplete 等） |
| `IntersectionObserver` | 懒加载 / 可见性组件 |
| `document.fonts`（FontFaceSet） | 字体就绪检测（KaTeX 等） |

`requestAnimationFrame`、`scrollTo`、`getComputedStyle` 原生即有，**未**补。

## 本轮覆盖范围

- `ConfirmDialog`：标题/内容、影响条数（前缀+条数+单位）、确认/取消回调、`loading` 禁用、错误提示。
- `StatusBadges`：有/无答案、有/无解析、难度（空/「未标注」/已标注 + 标注按钮回调）、
  待复核公式、知识点三态、待补充（千分位）。
- `KatexFormula` / `FormulaText`：正常渲染 KaTeX DOM、块级模式、未识别字形降级、
  `throwOnError=false` 不崩、占位符按 fid 映射 / 未命中提示。
- `CoverageBanner`：覆盖率渲染（千分位/百分比）、`dismissed`/无数据返回 null、关闭回调。

## 本轮**未**覆盖（遗留）

- 页面级组件（依赖 `react-query` + 路由 + 全局 store 的 `*Page.tsx`）——需补齐
  `QueryClientProvider` / `MemoryRouter` / mock fetch 后才能测。
- 依赖 DnD（`@dnd-kit`）的 `PaperPanel` / `PaperPanelItemRow` 等交互组件。
- 视觉/样式回归（无截图对比方案）。
- 后端交互与端到端（属于后端测试 / 手工验收范围）。
