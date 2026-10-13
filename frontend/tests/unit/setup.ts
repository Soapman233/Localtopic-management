/**
 * vitest 全局 setup（jsdom 环境）。
 *
 * 职责：
 * 1. 注册 `@testing-library/jest-dom` 的断言扩展（`toBeInTheDocument` / `toBeDisabled` 等）；
 * 2. 每个用例后 `cleanup()`，卸载 DOM，避免用例之间互相污染；
 * 3. 补齐 jsdom **实测缺失**的浏览器 API —— 否则 MUI 组件挂载即崩。
 *
 * 缺失项（本机 jsdom@30.1.2 实测）：`matchMedia` / `ResizeObserver` /
 * `IntersectionObserver` / `document.fonts` / `Element.scrollIntoView`。
 * `requestAnimationFrame`、`scrollTo`、`getComputedStyle` 原生即有，无需补。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// 1) matchMedia：MUI `useMediaQuery`（ThemeProvider 断点、响应式布局）强依赖；jsdom 无。
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const mql = {
        matches: false,
        media: query,
        onchange: null,
        // 旧 API（Safari < 14 兼容写法），MUI 内部仍可能调用。
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }
      return mql as unknown as MediaQueryList
    },
  })
}

// 2) ResizeObserver：MUI 部分自适应组件（Autocomplete/Modal 等）依赖；jsdom 无。
if (typeof globalThis.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// 3) IntersectionObserver：懒加载/可见性组件依赖；jsdom 无。
if (typeof globalThis.IntersectionObserver !== 'function') {
  class IntersectionObserverStub {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: ReadonlyArray<number> = []
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
}

// 4) document.fonts（FontFaceSet）：KaTeX / 字体就绪检测可能读取；jsdom 无。
if (typeof document !== 'undefined' && !document.fonts) {
  Object.defineProperty(document, 'fonts', {
    writable: true,
    configurable: true,
    value: {
      ready: Promise.resolve(),
      status: 'loaded',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      check: vi.fn(() => true),
      load: vi.fn(() => Promise.resolve([])),
      forEach: vi.fn(),
      clear: vi.fn(),
    },
  })
}

// 5) Element.scrollIntoView：jsdom 未实现（调用即 `TypeError: not a function`）。
//    凡是「让当前高亮项滚进可视区」的组件（如 ⌘K 快速跳转面板）都会踩到，
//    在真实浏览器里是正常 API，故这里补空实现而非改产品代码。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

afterEach(() => {
  cleanup()
})
