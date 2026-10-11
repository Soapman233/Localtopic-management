/** 部署形态（阶段 4：两版适配）——构建期由 `VITE_DEPLOY_MODE` 注入。
 *
 * 与后端的 `QB_EDITION` 是**两个独立的开关**，但语义上应保持一致：
 *
 * | 前端 `VITE_DEPLOY_MODE` | 后端 `QB_EDITION` | 效果 |
 * |---|---|---|
 * | `local`（默认） | `local` | 单机、无登录、路由透传、**不请求 `/api/auth/me`** |
 * | `online` | `online` | 登录 + 权限（含只读态） |
 *
 * ⚠️ **前端开关只决定"界面表现"**（要不要显示登录页、要不要禁用写按钮），
 * **真正的权限强制在后端**。前端隐藏按钮 ≠ 安全；它只是让老师不必点一个注定失败的按钮。
 *
 * 缺省为 `local` 是刻意的安全默认：不会因为漏配而让纯本地部署变成"要求登录却没人能登录"。
 *
 * 实际消费点（P1-3 修复后，本开关不再是无操作）：
 * - `AuthProvider` 用 `IS_ONLINE` 决定**是否请求** `/api/auth/me`：本地版完全跳过，
 *   既省一次启动请求，也让本地版从根本上不可能卷入 401 请求风暴；
 * - 线上版仍以**运行时** `auth_enabled` 为唯一权威（后端可能未配用户 → 退回本地语义）。
 */
export type DeployMode = 'local' | 'online'

/** 当前部署形态。 */
export const DEPLOY_MODE: DeployMode =
  import.meta.env.VITE_DEPLOY_MODE === 'online' ? 'online' : 'local'

/** 是否为线上部署版（构建期常量，便于被 Vite 做死代码消除）。 */
export const IS_ONLINE: boolean = DEPLOY_MODE === 'online'
