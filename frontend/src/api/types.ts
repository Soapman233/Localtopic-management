/** 与后端对齐的 TypeScript 类型（字段全部 snake_case，与 bank/ 一致）。
 *
 * R2 重构：按职责拆到 `types/` 下三个文件，本文件仅作 **re-export 汇总**，
 * 保持所有既有 `import ... from '../api/types'` 不变。
 *  - `types/core.ts`：题 / 公式 / 图片 / 标签 / 检索 / 版本；
 *  - `types/paper.ts`：组卷 / 导出 / 预览作业；
 *  - `types/governance.ts`：知识点复核 / 公式复核 / 来源文件 / 统计 / 设置。
 */
export * from './types/core'
export * from './types/paper'
export * from './types/governance'
