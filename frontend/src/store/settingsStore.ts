/**
 * 前端可消费的**设置镜像**（P0-2）。
 *
 * 背景：设置页保存的 `katex.throw_on_error` / `katex.strict` / `default_template`
 * 原先**没有任何消费方**——老师看到「保存成功」但行为不变（假成功）。
 * 这里把后端设置镜像到 zustand store，供叶子组件（如 `KatexFormula`）与
 * 建卷逻辑读取；由 `main.tsx` 在设置查询返回后同步。
 *
 * 为什么用 zustand 而非直接 `useQuery`：`KatexFormula` 被 `renderToStaticMarkup`
 * 等**无 QueryClientProvider** 的场景使用（如单元测试），直接调 `useQuery` 会抛错。
 * zustand 无 Provider 依赖，且默认值与历史硬编码行为一致（throwOnError=true, strict=false）。
 */
import { create } from 'zustand'
import type { SettingsData } from '../api/types'

export interface KatexSettings {
  /** 渲染失败时是否抛错（关闭则 KaTeX 以红色内联错误降级显示源码）。 */
  throwOnError: boolean
  /** 是否严格模式（对非标准 LaTeX 语法告警）。 */
  strict: boolean
}

interface SettingsState {
  katex: KatexSettings
  /** 新建试卷时的默认模板（`default_template`）。 */
  defaultTemplate: string
  /** 用后端设置整体覆盖镜像。 */
  syncFrom: (s: SettingsData) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // 默认值与历史硬编码一致，保证「未加载设置」时行为不变。
  katex: { throwOnError: true, strict: false },
  defaultTemplate: '考试',
  syncFrom: (s) =>
    set({
      katex: {
        throwOnError: s.katex?.throw_on_error ?? true,
        strict: s.katex?.strict ?? false,
      },
      defaultTemplate: s.default_template || '考试',
    }),
}))
