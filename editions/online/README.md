# 线上部署版（online）

> **一句话**：把题库服务放到一台**常开的 Windows 机器**上，让办公室几位老师通过浏览器共用。
> 服务监听 `0.0.0.0:8720`，前面加一层 nginx 做访问控制。

---

## 一、适用场景

- 同办公室 2～十几位老师共用一份题库。
- 希望「题库集中在一处、谁都能访问」，而不是每人拷一份。
- 能接受「共享口令」级别的访问控制（不是严格的用户/角色体系）。

## 二、部署架构

```
       老师浏览器
           │  http(s)://内网IP
           ▼
   ┌───────────────┐
   │  nginx 反向代理 │  ← Basic Auth（访问控制）+ 可选 HTTPS
   └───────┬───────┘
           │  proxy_pass 127.0.0.1:8720
           ▼
   ┌───────────────┐
   │  webui (FastAPI)│  ← QB_EDITION=online
   └───────┬───────┘
           │
     ┌─────┴──────┬─────────────┐
     ▼            ▼             ▼
  bank.db     editor_sdk     Word/WPS
 (数据卷)     (39099 端口)   (COM 自动化)
```

**关键点**：`editor_sdk` 与 Word/WPS 都是 **Windows 专有**，所以整条链路必须跑在 Windows 宿主上。

## 三、⚠️ 三条硬约束（部署前必读）

### 1. 必须部署在 Windows 宿主

`requirements.txt` 含 `pywin32`（仅 Windows），且 `bank/export.py` 通过 `editor_sdk` + Word/WPS
渲染公式、生成 DOCX/PDF。**在 Linux 上部署，导出功能不可用**（检索、组卷、预览仍可用）。

### 2. 导出必须串行（并发限制）

`editor_sdk` 桥接为单实例，**并发调用会报 `WinError 10048`（端口占用）**。
两人同时点「导出」会互相阻塞或失败。当前**没有**服务端导出队列——
这是已知限制，多人同时导出时请错开。

### 3. 鉴权分三层（可组合），推荐「用户体系 + HTTPS」

从阶段4 起，线上版具备**用户与角色体系**（详见第五节）。当前可用的三层保护：

| 层 | 机制 | 保护对象 | 是否推荐 |
|---|---|---|---|
| 应用·用户会话 | 用户名+密码 → 会话 token，按角色鉴权 | `/api/*` 与业务操作 | ✅ **推荐（细粒度、可审计）** |
| 应用·共享令牌 | `QB_AUTH_TOKEN`（Bearer） | `/api/*`（自动化脚本 / 服务账号） | ⚙️ 可选 |
| nginx·Basic Auth | 共享口令（浏览器弹框） | 整个站点（含前端页面） | ⚠️ **启用用户体系后建议关闭**（避免两层口令） |

**建议组合**：`用户会话`（应用内登录）**＋ HTTPS**。此时可**关闭 nginx Basic Auth**，
只保留 nginx 反向代理与 HTTPS。理由见第五节「与 nginx Basic Auth 的关系」。

> ⚠️ **HTTPS 不能省**：会话 token 明文过网即等于泄露。若只用 HTTP，任何能抓包的人都能
> 直接拿到 token。内网也应上 HTTPS（自签证书即可）。

> 若**不**启用用户体系（鉴权库中无用户），线上版行为与历史一致：由 nginx Basic Auth
> 与可选 `QB_AUTH_TOKEN` 保护，**没有**「谁是谁 / 谁能改 / 谁能删」的区分。

---

## 四、部署步骤

### 方式 A：Windows 宿主 + nginx（**推荐**，保留完整导出能力）

1. **准备机器**：一台常开的 Windows 机器（有 Word 或 WPS）。
2. **准备代码与数据**：把仓库拷到该机，准备好 `outputs/bank.db`。
3. **装依赖**：
   ```bat
   python -m pip install -r requirements.txt
   cd frontend && npm install && npm run build && cd ..
   ```
4. **配置环境**：复制 `.env.example` 为 `.env`，按需修改。
5. **启动服务**：双击 `start-server.bat`（会加载 `.env`，以 online 版启动）。
6. **配置 nginx**：
   - 安装 nginx（Windows 版）；
   - 用 `htpasswd` 生成口令文件，把 `nginx.conf` 里的 `auth_basic_user_file` 指过去；
   - 把 `nginx.conf` 放进 `conf.d/`，`server_name` 改成内网 IP；
   - 启动/重载 nginx。
7. **验证**：浏览器打开 `http://<内网IP>/`，应弹出登录框；登录后进入题库界面。

> 建议把 `start-server.bat` 注册为**开机自启服务**（任务计划程序 → 触发器「计算机启动时」），
> 这样服务器重启后题库自动可用。

### 方式 B：Docker Compose（**可选**，仅非导出场景）

适用于 Linux 服务器上只想提供「浏览 / 检索 / 组卷」能力的情况：

```bash
cd editions/online
cp .env.example .env
docker compose up -d
```

> ⚠️ **此方式导出功能不可用**（容器内没有 `editor_sdk` 与 Office）。
> 若你需要导出，请用方式 A。

---

## 五、用户与权限体系（阶段4）

> **一句话**：账号存在**独立的** `auth.db`（**不是** `bank.db`），按角色（viewer/editor/admin）
> 在**服务端**强制鉴权；首个管理员用 CLI 创建。

### 5.1 鉴权模式（由环境自动判定）

| 条件 | 模式 | 行为 |
|---|---|---|
| `QB_EDITION=local`（本地版） | `off` | 单机全权，无需任何凭据（**本地版永不变**） |
| 线上版 + 鉴权库**无用户** | `off` | 单机全权（迁移期 / 未建号，行为同历史） |
| 线上版 + 有用户 + 未设 `QB_AUTH_TOKEN` | `session` | 按**用户会话**鉴权 |
| 线上版 + 有用户 + 设了 `QB_AUTH_TOKEN` | `token+session` | **用户体系优先**；共享令牌退化为「服务账号」 |

> **优先级规则（重要）**：`token+session` 模式下，携带**正确** `QB_AUTH_TOKEN` 的请求
> 一律放行并**视为管理员**（供自动化脚本 / 服务账号）；其余请求必须带有效会话。
> 也就是说：**用户体系优先，共享令牌只作 API 专用旁路**。

### 5.2 创建首个管理员

密码**不要写在命令行**（会进 shell 历史）。二选一：

```bat
:: 方式一：交互式输入（推荐）
python -m webui.auth user add zhangsan --role admin --display-name 张三

:: 方式二：从环境变量读取（适合脚本）
set QB_AUTH_PASSWORD=强密码
python -m webui.auth user add zhangsan --role admin
```

同名用户**默认报错、不覆盖**（避免误改既有账号）。其余命令：

```bat
python -m webui.auth user list                       :: 查看用户与角色
python -m webui.auth user set-password zhangsan       :: 重设密码（吊销其既有会话）
python -m webui.auth user set-role lisi --role editor :: 改角色
python -m webui.auth user disable lisi                :: 禁用（吊销会话）
python -m webui.auth user enable  lisi                :: 启用
```

> ⚠️ **防锁死**：不允许降级/禁用**最后一个启用的管理员**。请先另建一名管理员再调整。

### 5.3 角色与权限

| 角色 | 读（检索/预览/统计/导出） | 写（增删改题/组卷/标注/设置） | 用户管理 |
|---|---|---|---|
| `viewer` | ✅ | ❌ | ❌ |
| `editor` | ✅ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ |

- **「导出」算「读」**：导出只产出文件、不修改题库，故 `viewer` 也可用。
- 权限在**服务端**强制（不依赖前端隐藏按钮）。未授权写操作返回
  `403` + `{"code": 40301, ...}`；未登录/会话过期返回 `401` + `{"code": 40102, ...}`。

### 5.4 会话如何传递

- 登录：`POST /api/auth/login`（`{username, password}`）→ 返回 `data.token`。
- 后续请求：`Authorization: Bearer <token>`（**默认**方式，前端存 localStorage）。
- 后端**同时接受** Cookie `qb_session`（设 `QB_AUTH_COOKIE=1` 时登录会额外下发
  `HttpOnly` Cookie；`QB_COOKIE_SECURE=1` 追加 `Secure`，HTTPS 下建议开启）。
- 登出：`POST /api/auth/logout`（删除服务端会话，token 立即失效）。
- 会话默认 12 小时过期，可用 `QB_SESSION_TTL`（秒）调整。

### 5.5 与 nginx Basic Auth 的关系（建议怎么组合）

**推荐：只用应用层用户会话，关闭 nginx Basic Auth。**

- 两层口令对老师是纯负担，且容易出现「只改了其中一层、以为全改了」的隐患。
- 应用层登录**更细粒度**（区分只读/可编辑/管理员），且为将来**审计**留出接口。
- nginx 仅保留**反向代理 + HTTPS**。

配置要点：把 `nginx.conf` 里的 `auth_basic*` 两行注释掉即可。

> **若你坚持两层并存**，务必向老师**明确说明**：「浏览器弹框的口令」与「题库登录的口令」
> 是**两套独立口令**，改密码要分别改——否则必然有人困惑。

### 5.6 数据与备份（auth.db 属运维数据）

- 账号与会话存于 **`outputs/webui/auth.db`**（线上版可挂载到数据卷），与题库交付数据
  **`bank.db` 分开存放**；`auth.db` 属**运维数据**，请与 `bank.db` **分开备份**。
- **升级**：替换代码 → 重启服务（`webui/__main__.py` 会自动对 `bank.db` 执行幂等迁移；
  鉴权表在首次建号/建连时**幂等**创建）。
- 环境变量：`QB_AUTH_DB`（鉴权库路径）、`QB_SESSION_TTL`（会话秒数）、
  `QB_AUTH_COOKIE` / `QB_COOKIE_SECURE`（Cookie 开关）。

## 六、数据与备份

- 题库文件 `bank.db`（约 62 MB）建议放在**独立数据卷/目录**，不要和代码混在一起。
- **备份**：定期复制 `bank.db`。项目自带校验工具：
  ```bat
  python -c "from bank.enrich import verify_backup; print(verify_backup('outputs/bank.db','备份路径.db'))"
  ```
  > ⚠️ `verify_backup(原库, 备份)` 参数顺序为**原库在前**，传反会得到错误结论。
- **升级**：替换代码 → 重启服务（`webui/__main__.py` 会自动执行幂等迁移）。

## 七、已知限制与未完成项（如实声明）

| 项 | 状态 | 说明 |
|---|---|---|
| 用户与角色体系 | ✅ 已实现（阶段4） | viewer/editor/admin 三级；账号存独立 `auth.db`；见**第五节** |
| 导出队列串行化 | ❌ 未实现 | 并发导出会失败，需人工错开 |
| 异地（公网）访问 | ⚠️ 可配但未加固 | 需自行配 HTTPS、限流、防火墙；**默认不建议直接暴露公网** |
| 前端登录界面 | ⚠️ 后端已就绪 | 后端 `/api/auth/*`（登录/登出/me/用户管理）已完成；前端适配中 |
| 操作审计日志 | ❌ 未实现 | 无「谁在何时改了什么」的记录（用户体系为其预留了身份基础） |
| 多人并发编辑同一试卷 | ⚠️ 部分 | 有 `content_digest` 兜底，但未做实时协同 |

> 以上属**后续阶段**工作；当前版本适用于「互相信任、使用频率不高」的小团队。

## 八、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 局域网访问不了 | 防火墙拦截 | 放行 nginx 端口（80/443）；确认服务监听 `0.0.0.0` |
| 打开是空白页 | 前端未构建 | `cd frontend && npm run build` |
| 导出报 `WinError 10048` | 并发导出 | 错开导出；这是已知限制 |
| 导出无反应 | `editor_sdk`/Office 未就绪 | 启动 `editor_sdk`；确认装了 Word/WPS |
| 401 `40101` 未授权 | 开了 `QB_AUTH_TOKEN` 但未带令牌 | 调用方加 `Authorization: Bearer <token>` |
| 401 `40102` 会话失效 | 未登录 / 会话过期 | 重新登录 `POST /api/auth/login` |
| 401 `40103` 登录失败 | 密码错误 / 账号不存在 / 账号被禁用（**三者同一码同一文案**） | 核对密码；若确为账号被禁用，管理员执行 `user enable` |
| 403 `40301` 权限不足 | 当前角色无权 | 用更高权限账号，或管理员 `user set-role` 提权 |
| 503 `50301` 鉴权未初始化 | 线上版但**尚未创建任何用户** | `python -m webui.auth user add <名> --role admin` |
| 503 `50302` 鉴权库不可用 | `auth.db` 损坏 / 权限不足 / 路径失效 | 检查该文件；**这是故障，不会自动放行**（fail-closed） |
| 无法登录、提示未启用用户体系 | 鉴权库无用户 | `python -m webui.auth user add <名> --role admin` |
| 所有人被锁在外面 | 误禁用了所有管理员 | CLI `python -m webui.auth user enable <名>` 恢复 |
| 改了口令仍用旧密码能进 | 会话未过期（改密应吊销会话） | 本实现改密即吊销会话；若仍异常请重启服务 |

> ⚠️ **契约陷阱（写接口/写脚本时必读）**：`GET /api/auth/me` 是**豁免路径**且**恒返回 200**——
> 令牌过期或无效时同样返回 200，只是 `user` 为 `null`。
> 所以**它只能回答「后端有没有启用鉴权、当前是谁」，不能用来判断会话是否有效**。
> **判断会话有效性一律以受保护端点的 401 为准**（例如 `GET /api/papers`）。
> （此坑已在 QA 复验中被实际踩到：用 `me` 判断的第一版探针误报"会话仍有效"。）

