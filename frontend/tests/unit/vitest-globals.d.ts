/**
 * 让 `tsc --noEmit` 认识 vitest 的全局 API（`describe` / `it` / `expect` / `vi` 等）。
 *
 * 对应 `vitest.config.ts` 的 `globals: true`。若某用例改为显式 `import { ... } from 'vitest'`，
 * 亦可正常工作（显式导入优先于全局）。
 */
/// <reference types="vitest/globals" />
