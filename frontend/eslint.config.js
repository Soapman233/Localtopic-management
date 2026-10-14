// =============================================================================
// ESLint 扁平配置（flat config）—— 前端 TypeScript / React
// =============================================================================
// 定位：**渐进启用的静态检查**，**不接入 `npm run build`**（避免门禁变红阻塞构建）。
//   * 只检查 `src/**` 与 `tests/unit/**`（本次不覆盖历史 .cjs 测试与构建脚本）；
//   * 现有代码**未做全量整改**——首次运行可能报出若干告警/错误，属预期；
//     按需逐条处理，**不要**为"清零"而做无关重构。
//   * 与 Prettier 的分工：ESLint 管**正确性**，格式交给 Prettier
//     （末位 `eslint-config-prettier` 关闭所有冲突的格式类规则）。
//
// 用法：
//   npm run lint          # 检查
//   npm run lint:fix      # 自动修复可修复项
//   npm run format:check  # 只检查格式（不改文件）
// =============================================================================

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    // 生成物 / 依赖 / 第三方：不检查
    ignores: [
      'dist/**',
      'node_modules/**',
      '../webui/static/**',
      'coverage/**',
      'tests/**/*.cjs', // node:test 语法，非 TS
      'scripts/**/*.mjs', // 自建门禁脚本，独立维护
      'vite.config.ts.timestamp-*.mjs',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/unit/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // ⚠️ 渐进启用：react-hooks 只先开**两条经典规则**。
      //    v7 的 `configs.flat.recommended` 会额外启用一批编译期规则
      //    （`set-state-in-effect` / `refs` / `immutability` 等），
      //    在既有代码上一次命中约 24 处——待后续评估后再逐步开启，
      //    避免"配置一落地就全红"。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 允许只导出常量（MUI 主题 / token 文件常见），否则会误报
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 未使用变量降为告警；`_` 前缀参数/变量视为有意忽略
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // 测试文件：注入 vitest 全局（globals: true）
    files: ['tests/unit/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
  // 必须放最后：关闭与 Prettier 冲突的格式规则
  prettier,
)
