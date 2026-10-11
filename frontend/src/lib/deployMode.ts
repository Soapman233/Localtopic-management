/** 部署形态（阶段 4：两版适配）——构建期由 `VITE_DEPLOY_MODE` 注入。
 *
 * 与后端的 `QB_EDITION` 是**两个独立的开关**，但语义上应保持一致：
 *
 * | 前端 `VITE_DEPLOY_MODE` | 后端 `QB_EDITION` | 效果 |
 * |---|---|---|
 * | `local`（默认） | `local` | 单机、无登录、路由透传 |
 * | `online` | `online` | 登录 + 权限（含只读态） |
 *
 * ⚠️ **前端开关只决定"界面表现"**（要不要显示登录页、要不要禁用写按钮），
 * **真正的权限强制在后端**。前端隐藏按钮 ≠ 安全；它只是让老师不必点一个注定失败的按钮。
 *
 * 缺省为 `local` 是刻意的安全默认：不会因为漏配而让纯本地部署变成"要求登录却没人能登录"。
 */
export type DeployMode = 'local' | 'online'

/** 当前部署形态。 */
export const DEPLOY_MODE: DeployMode =
  import.meta.env.VITE_DEPLOY_MODE === 'online' ? 'online' : 'local'

/** 是否为线上部署版（构建期常量，便于被 Vite 做死代码消除）。 */
export const IS_ONLINE: boolean = DEPLOY_MODE === 'online'

/**
 * 是否允许访问登录页。
 *
 * 本地版**不提供**登录入口——它没有用户体系，显示登录页只会让人困惑
 * （"我该输什么密码？"）。即便有人手动访问 `#/login`，`RequireAuth` 也会透传。
 */
export const LOGIN_ROUTE_ENABLED: boolean = IS_ONLINE
