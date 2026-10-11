/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * 单元测试专用配置（jsdom + Testing Library）。
 *
 * 与 `vite.config.ts` 的关系：
 * - 这里**独立定义**、不 merge `vite.config.ts`，避免继承 `build.outDir: '../webui/static'`
 *   等与测试无关的生产构建配置；
 * - `vite build` 只读 `vite.config.ts`，**不会**读取本文件，故测试文件绝不会进入构建产物。
 *
 * ⚠️ `include` 被刻意限定在 `tests/unit/**`：`tests/*.test.cjs` 是 `node:test` 语法
 * （由 `npm test` 里的 `node --test` 单独跑），**绝不能**交给 vitest，否则会报错。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
})
