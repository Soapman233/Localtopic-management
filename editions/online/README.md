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

### 3. 鉴权是「访问控制」级，不是「权限体系」级

当前实现：
- **浏览器访问**：由 nginx Basic Auth 保护（一个共享口令）；
- **API 访问**：可选 `QB_AUTH_TOKEN`（Bearer 令牌）。

**没有**「谁是谁 / 谁能改 / 谁能删 / 谁只能看」的区分。
适用于**互相信任的小团队**；若需要角色与审计，属后续阶段（见第七节）。

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

## 五、鉴权配置

| 层 | 机制 | 保护对象 | 配置位置 |
|---|---|---|---|
| nginx | HTTP Basic Auth | **整个站点**（含前端页面与 API） | `nginx.conf` 的 `auth_basic*` |
| 应用 | Bearer 令牌（可选） | `/api/*`（`/api/health` 豁免） | `.env` 的 `QB_AUTH_TOKEN` |

- 普通老师日常使用**只需 nginx 的 Basic Auth**（浏览器会自动弹框、记住口令）。
- `QB_AUTH_TOKEN` 主要用于**自动化脚本**或后续改造过的前端；
  **浏览器直接访问时不会自动携带该令牌**，故不能只靠它保护页面。

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
| 用户与角色体系 | ❌ 未实现 | 只有共享口令；无法区分「只读/可编辑/管理员」 |
| 导出队列串行化 | ❌ 未实现 | 并发导出会失败，需人工错开 |
| 异地（公网）访问 | ⚠️ 可配但未加固 | 需自行配 HTTPS、限流、防火墙；**默认不建议直接暴露公网** |
| 前端登录界面 | ❌ 未实现 | 浏览器侧靠 nginx Basic Auth；应用内无登录页 |
| 操作审计日志 | ❌ 未实现 | 无「谁在何时改了什么」的记录 |
| 多人并发编辑同一试卷 | ⚠️ 部分 | 有 `content_digest` 兜底，但未做实时协同 |

> 以上属**后续阶段**工作；当前版本适用于「互相信任、使用频率不高」的小团队。

## 八、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 局域网访问不了 | 防火墙拦截 | 放行 nginx 端口（80/443）；确认服务监听 `0.0.0.0` |
| 打开是空白页 | 前端未构建 | `cd frontend && npm run build` |
| 导出报 `WinError 10048` | 并发导出 | 错开导出；这是已知限制 |
| 导出无反应 | `editor_sdk`/Office 未就绪 | 启动 `editor_sdk`；确认装了 Word/WPS |
| 401 未授权 | 开了 `QB_AUTH_TOKEN` 但未带令牌 | 调用方加 `Authorization: Bearer <token>` |
