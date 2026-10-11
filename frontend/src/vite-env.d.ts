/// <reference types="vite/client" />

/**
 * 构建期环境变量（阶段 4：两版适配）。
 *
 * `VITE_DEPLOY_MODE`：
 * - `local`（**默认**）：本地运行版——不启用登录，路由恒真透传；
 * - `online`：线上部署版——启用登录与权限（含只读态）。
 *
 * 缺省按 `local` 处理是**刻意的安全默认**：宁可"线上版忘了配 → 退回本地版语义"，
 * 也不要"本地版被误配成线上版 → 要求登录却没人能登录"。
 */
interface ImportMetaEnv {
  readonly VITE_DEPLOY_MODE?: 'local' | 'online'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
