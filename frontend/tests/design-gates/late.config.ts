import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

// 仅测试加载器读取临时生产模块副本，保持原模块 id/相对导入。
export default defineConfig({
  plugins: [{ name: 'late-production-copy', enforce: 'pre', load(id) {
    const mapping = process.env.QB_LATE_COPY_MAP
    if (!mapping) return null
    const copies = JSON.parse(mapping) as Record<string, string>
    const copy = copies[id.replaceAll('\\', '/')]
    return copy ? fs.readFileSync(copy, 'utf8') : null
  } }, react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/design-gates/late.test.tsx'], reporters: ['default'], testTimeout: 10000,
    pool: 'forks', poolOptions: { forks: { singleFork: true } } },
})
