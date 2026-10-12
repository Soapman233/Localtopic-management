# 交接：局域网访问（方案 A）+ 线上部署（方案 B）接口预留

> 日期：2026-10-12
> 角色：**D1**（实现）+ **T**（端到端验收）
> 用户决策：**「目前先 A，但是留好 B 的接口，以便后面随时能够作为线上部署」**

---

## 一、方案 A 是什么

便携客户端默认**只监听 `127.0.0.1`**，手机/平板打不开。
方案 A = **一键开启局域网访问**：开启后监听全网卡，**手机连同一 WiFi 即可使用**，
并在设置页给出**含令牌的链接 + 二维码**（扫码即登录）。

---

## 二、🔴 核心安全设计：fail-closed 不变量

**开启局域网 = 强制启用访问令牌。**

若把监听改成 `0.0.0.0` 却没设令牌，**同网段的任何人**（访客 WiFi、隔壁办公室）
都能读写整个题库——这种"静默裸奔"比不能用更糟。

因此新增一条**由实际监听地址推导**（而非用户"声称"的模式）的不变量：

```
webui/edition.py::exposure_safety()
  exposure = local（回环）  -> 安全
  exposure = lan/public 且 auth_enabled() -> 安全
  exposure = lan/public 且无鉴权        -> ok=False，启动器**拒绝启动**
```

实测（源码与打包版一致）：
```
[题库] 安全校验未通过：监听地址 '0.0.0.0' 对网络开放，但**未启用任何鉴权**
        ——同网段的任何人都能读写你的题库。
[题库]   请设置访问令牌（QB_AUTH_TOKEN）后重启；或在「设置 → 局域网访问」中开启。
（进程退出码 1，未监听端口）
```

---

## 三、产出物

| 文件 | 说明 |
|---|---|
| `webui/edition.py` | 新增 `is_loopback` / `resolve_exposure` / `exposure_safety` |
| `webui/services/network_svc.py` | 局域网开关、令牌生成/轮换、局域网地址探测、链接、二维码 |
| `webui/routers/network.py` | `status` / `link` / `enable` / `disable` / `rotate` |
| `webui/__main__.py` | 启动时应用网络配置 + **强制执行安全不变量** |
| `frontend/src/lib/lanToken.ts` | 读 `?t=` → 存令牌 → **抹掉地址栏参数** |
| `frontend/src/lib/authStorage.ts` | 令牌存储的**单一来源**（登录与扫码共用，防键名漂移） |
| `frontend/src/components/LanAccessPanel.tsx` | 设置页的局域网面板（开关 + 二维码 + 风险提示） |
| `frontend/src/api/network.ts` + `queryKeys` + `glossary` | API / 键 / 术语 |
| `tests/test_network.py`（24 项）、`frontend/tests/unit/lanToken.test.ts`（6）、`LanAccessPanel.test.tsx`（6） | 测试 |
| `spike/acceptance/verify_lan_access.py` | **端到端验收** |

---

## 四、端到端验收（打包版，**12/12 PASS**）

```
[步骤1] 默认启动 → 仅回环；局域网地址访问 → 连不上        ✅ 安全默认正确
[步骤2] 经 API 开启 → 返回链接 + 二维码（2005 字节）        ✅
[步骤3] 重启 → 自动监听全网卡并带上令牌
        /api/health（豁免）-> 200
        /api/papers 不带令牌 -> 401                        ✅
        /api/papers 带令牌   -> 200                        ✅
        /api/papers 错令牌   -> 401                        ✅
        关闭局域网（带令牌）-> 200                          ✅
[步骤4] QB_HOST=0.0.0.0 且无令牌 → **拒绝启动**（退出码 1）  ✅
```

可复现：`$PY spike/acceptance/verify_lan_access.py`

### ⚠️ 验收过程中我自己的两个测试缺陷（已修，值得记录）

1. **多步复用同一端口** → 上一步进程未死透，`_wait` 探到**旧进程**，
   把「拒绝启动」误判成「启动成功」。修：**每步独立端口 + 显式确认进程已退出**。
2. **关闭局域网时没带令牌** → 局域网开启后鉴权已生效，不带令牌的 `disable` 被 **401 拒绝**，
   配置没关掉，导致下一步的"危险配置"其实仍有令牌。修：带令牌调用 + 步骤前**断言前置条件**。

> 第 2 条本身也是**鉴权在正常工作的旁证**。

---

## 五、方案 B（线上部署）接口预留 —— **已就绪**

用户要求「留好 B 的接口」。设计上**没有引入任何仅本地可用的假设**：

| 维度 | 现状 | 切到 B 需要做什么 |
|---|---|---|
| **暴露范围** | `exposure_safety()` 已统一 local/lan/public 三态；`QB_EDITION=online` → 自动 `public` | 换 `QB_EDITION=online`（**已支持**） |
| **监听地址** | `QB_HOST` 覆盖，`_EDITION_HOSTS` 已含 online→`0.0.0.0` | 无需改代码 |
| **鉴权** | `webui/auth.py` 已支持 `off/token/session/token+session`；角色 viewer/editor/admin；`auth.db` 独立于交付库 | 建用户即可（`python -m webui.auth user add`） |
| **fail-closed** | 鉴权库不可读 → 503（50301/50302），**绝不回落为无鉴权** | 已具备 |
| **部署骨架** | `editions/online/`：Dockerfile / docker-compose.yml / nginx.conf / requirements.linux.txt | 直接用 |
| **前端** | 令牌由 `lib/authStorage.ts` 单一来源管理；`IS_ONLINE`（`VITE_DEPLOY_MODE`）已存在 | 构建时换 `VITE_DEPLOY_MODE=online` |
| **本次新增** | 局域网面板只切"暴露范围 + 凭据"，**不含任何本地专属逻辑** | 线上版同样可用（管理员可看/轮换令牌） |

### 切到 B 时仍需解决（**与本次改动无关的既有事项**）

| 事项 | 说明 |
|---|---|
| **并发写** | `JobManager` 是**单线程串行**（当初为保护 editor_sdk 单实例与 COM）。多人同时导出会排队 |
| **数据分发** | 服务器端 `bank.db` 的初始化与备份策略需定义 |
| **成本与运维** | 云服务器费用、HTTPS 证书、监控 |
| **移动端体验** | 现设计**明确降级**（"窄屏只需能用"）。手机屏上双栏组卷体验受限，需产品决策是否专项优化 |

---

## 六、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 后端单测（期望 24 项 OK）
$PY -m unittest tests.test_network -v
# 端到端（期望 12/12 PASS）
$PY spike/acceptance/verify_lan_access.py
# 前端
cd frontend && npx tsc --noEmit && npx vitest run && npm run build
```

---

## 七、遗留与风险

| 风险 | 说明 |
|---|---|
| **令牌即全权** | 扫码链接里的令牌 = 完整读写权限。手机丢失需在设置页「更换令牌」 |
| **HTTP 明文** | 局域网内是 `http://`，同网段可嗅探。家用/办公网络可接受；**公共 WiFi 不要开** |
| **需重启生效** | 监听地址在启动时绑定，开关后必须重启（界面已明确提示） |
| **`console=False` 无实时反馈** | 用户看不到进度；`outputs/webui/start.log` 是唯一窗口 |
| **新增依赖 segno** | 二维码生成（纯 Python、零依赖），包体 +0.2 MB（55.4 → **55.6 MB**） |
