# 视觉回归（visual regression）与交互走查

> 项目铁律：**排版 / 样式改动必须渲染出来看** —— 单元测试测不出视觉缺陷。
> 本目录提供两件事：
> 1. **静态基线**：关键页面在「分辨率 × 主题」矩阵下的截图比对（`capture.mjs` + `compare.py`）；
> 2. **交互走查**：真实浏览器走一遍关键交互路径并**断言用户可见结果**（`interactions.mjs`）。

---

## 为什么基线图**不入库**

| 项 | 是否入库 | 理由 |
|---|---|---|
| `capture.mjs` / `compare.py` / `interactions.mjs` / 本 README | ✅ | 小文本，是机制本身 |
| `baseline-manifest.json` | ✅ | 记录基线**何时、以何参数**被替换 —— 让「接受一次视觉变化」在 git 里可见可审计 |
| 基线 PNG | ❌ | 每阶段都会变、属派生产物；入库会让「接受一次视觉变化」提交约 2 MB 二进制 |

基线图存放位置（已被 `.gitignore` 排除）：
- 单分辨率旧基线：`.tmp_verify/baseline-1366x768/`
- **阶段 4 矩阵基线**：`.tmp_verify/baseline-matrix/{W}x{H}-{theme}/`

> **代价（如实说明）**：换机器 / 清空临时目录后，基线需要**重新采集**。
> 由于 manifest 记录了每张图的 sha256，**基线是否被换过、换成什么**仍可追溯。

---

## 一、静态基线：分辨率 × 主题矩阵

### 覆盖矩阵（阶段 4 扩展）

| 维度 | 取值 |
|---|---|
| 视口 | 1280×800、1366×768、1440×900、1920×1080 |
| 主题 | 浅色（light）、**深色（dark）** |
| 窄屏降级 | **额外** 1024×768（浅色）—— 验证 `<1200` 右栏折叠为抽屉**不破版** |
| 页面 | 现有 8 个（见下方「页面清单」） |

合计 **9 组 × 8 页 = 72 张**截图。此前只覆盖「1366×768 + 浅色」8 张。

### 用法

```bash
# 0) 先启动后端（本机 127.0.0.1:8720）并**确保前端已构建**（否则验的是旧产物）：
#    cd frontend && npm run build

# A. 全矩阵（输出到 outRoot/{W}x{H}-{theme}/）
PLAYWRIGHT_MODULE="<file-url-to-playwright>/index.mjs" \
  node frontend/tests/visual/capture.mjs http://127.0.0.1:8720 .tmp_verify/baseline-matrix --all

# B. 单组合（向后兼容旧流程，直接写入 outDir、不建子目录）
PLAYWRIGHT_MODULE="<file-url-to-playwright>/index.mjs" \
  node frontend/tests/visual/capture.mjs http://127.0.0.1:8720 .tmp_verify/baseline-1366x768
#    可加 --viewport 1440x900 --theme dark 指定单个组合
```

> 本项目**未**把 `playwright` 放进 `frontend/package.json` —— 它是个重量级开发依赖，
> 仅为视觉回归引入不划算。用 `PLAYWRIGHT_MODULE` 指向已有的 playwright 模块即可。
> ⚠️ Windows 下 ESM 动态 import 需要 **file:// URL**（形如
> `file:///C:/Users/<user>/.../node_modules/playwright/index.mjs`），直接给盘符路径会报
> `ERR_UNSUPPORTED_ESM_URL_SCHEME`；用 `index.mjs`（而非 `index.js`）才能拿到具名导出 `chromium`。

### 深色模式怎么开（**只读**实现）

主题由 `main.tsx` 的 `ApplicationTheme` 通过 react-query 拉取 `GET /api/settings` 驱动
（`buildTheme(data.theme)`）。因此 `capture.mjs` 在深色组合下**拦截 `/api/settings`**，
把响应体的 `data.theme.dark` 改成 `true`：

```js
await ctx.route('**/api/settings', async (route) => {
  const resp = await route.fetch()
  const body = await resp.json()
  body.data.theme = { ...body.data.theme, dark: true }
  await route.fulfill({ response: resp, json: body })
})
```

> 为什么不用设置页开关 / 改 `settings.json`：那会**写入** `outputs/webui/settings.json`，
> 污染本机真实偏好，且违背采集脚本「只读」的约定。

### 比对

```bash
# 逐组合比对（矩阵模式需对每个 {W}x{H}-{theme} 各跑一次）
python frontend/tests/visual/compare.py \
  .tmp_verify/baseline-matrix/1366x768-light \
  .tmp_verify/phase4-verify/1366x768-light \
  --out .tmp_verify/visual-diff/1366x768-light
```

输出每页的 `mean_diff` / `>32 像素占比`，并写出**差异热力图**（`*-diff.png`）。
退出码 `1` 表示有页面超出阈值，**需要人工看图判定**。

### 判定口径

| 指标 | 阈值 | 含义 |
|---|---|---|
| `mean_diff` | < 1.0 | 无可见变化 |
| `pct_gt32` | < 0.5% | 无结构性变化 |
| 自校验 | 自比 == 0 | 确认度量本身没写错 |

---

## 二、交互走查（`interactions.mjs`）

静态截图**看不出交互缺陷**（按钮点了没反应、切换后视图没变、抽屉读屏读不到、删除没二次确认）。
本脚本用真实浏览器走一遍关键路径并**断言用户可见结果**（DOM 文本 / 属性 / 元素尺寸 / 可访问名），
**不断言内部 state**。

### 覆盖路径

| 路径 | 断言（用户可见结果） |
|---|---|
| 检索 → 加入题目 | 点「加入」后试卷题数 **+1**，且出现成功提示 |
| 组卷页 排版/清单 切换 | 切换后**视图真的变了**（排版视图的 A4 文档 `.lp-doc` 出现/消失） |
| 打开/关闭抽屉 | 抽屉打开后**可见且可访问名正确**（「试卷」/「切换试卷」），可关闭 |
| 筛选栏开合（<1440） | 收起后**题目列表真的变宽**（元素实测宽度） |
| 分页 | 翻页后**内容变化**（首张题卡文本不同） |
| 设置页改主题 | 改深色后 `body` 背景色**真的变了** |
| 删除确认 | 点删除**先出确认框**（含题数），取消后**没删** |

### 用法

```bash
# 只读路径打真实服务；写路径须另起「副本后端」
PLAYWRIGHT_MODULE="<file-url-to-playwright>/index.mjs" \
  node frontend/tests/visual/interactions.mjs http://127.0.0.1:8720 \
    --write-base http://127.0.0.1:8731
```

启动**副本后端**（写路径专用，**绝不碰 `outputs/bank.db`**）：

```bash
cp outputs/bank.db .tmp_verify/bank_copy_interactions.db
QB_DB_PATH="<项目>/.tmp_verify/bank_copy_interactions.db" \
  <kb-env-python> -c "import uvicorn; from webui.app import app; \
    uvicorn.run(app, host='127.0.0.1', port=8731, log_level='warning')"
```

### 写数据安全（硬约束）

- 脚本先查 `--write-base` 的 `GET /api/health` 拿**实际 db 路径**；
  若指向真实 `outputs/bank.db`（或不可达），则**拒绝执行写路径**并记为 `SKIP`，绝不污染真实题库；
- 主题路径通过**拦截 `/api/settings`**（GET/PUT 均返回内存态）验证，**不写** `outputs/webui/settings.json`；
- 「删除确认」只走到「取消」，不真正删除 —— 对真实服务也只读。

退出码：`0` = 全部通过；`1` = 存在失败。（`SKIP` 与 `NOTE` 不计入失败。）

---

## ⚠️ 更新基线的唯一合法流程

> **只有当视觉变化被人工渲染看图确认之后，才允许覆盖基线。**

1. 跑 `compare.py`，拿到超阈值的页面清单；
2. **打开差异热力图与实际截图**，逐页判断是「预期变化」还是「回归」；
3. 若是**回归** → 改代码，**不要**更新基线；
4. 若是**预期变化** → 用 `capture.mjs` 覆盖基线，并更新 `baseline-manifest.json`
   （重算 sha256、更新 `accepted_at` 与 `accepted_reason`）。

**禁止「为了让比对变绿而更新基线」** —— 那等于把回归洗成通过。

---

## 页面清单

| 名称 | 路由 |
|---|---|
| `builder` | `/#/builder`（默认落地页） |
| `search` | `/#/search?keyword=浮力` |
| `export` | `/#/export` |
| `manage-knowledge` | `/#/manage/knowledge` |
| `manage-formula-review` | `/#/manage/formula-review` |
| `manage-sources` | `/#/manage/sources` |
| `manage-stats` | `/#/manage/stats` |
| `settings` | `/#/settings` |

采集前会预置 `localStorage['qb-paper-store'] = { currentPaperId: 1 }`，
让组卷页落到「有试卷」的稳定状态，避免基线截到空态而不可比。

---

## 局限（如实声明）

- **仍是「模拟视口」，不是物理设备**：Playwright 的 viewport 只是设定浏览器窗口逻辑尺寸，
  **不等价于真机**。
- **不覆盖真实 GPU / 字体渲染差异**：截图在同一台机器的同一渲染管线产生；换机器、换显卡驱动、
  换系统字体（如 macOS / 安卓 / iOS）后像素会不同，基线**不可跨机直接复用**。
- **不覆盖触屏手势**：拖拽排序、双指缩放、长按等触摸交互**未验证**（本脚本用鼠标/键盘）。
- **不覆盖真实移动端浏览器**：仅桌面 Chromium；未跑 Safari / 移动版 Chrome / 微信内置浏览器。
- **不覆盖真实读屏软件**：`interactions.mjs` 只断言「可访问名 / role」等**语义属性**，
  不等于真实读屏（NVDA / VoiceOver）能正确朗读与操作 —— 那需要真机 + 真实读屏，属另一独立任务。
- **不覆盖交互态全量**：加载中 / 空态 / 错误态 / 各对话框等**瞬时界面**只覆盖了上表列出的少数路径，
  其余仍由组件单测 + 其它浏览器验收脚本覆盖。
- **采集等待为固定 3.5 秒**：若某页数据更慢，可能截到 loading 态 → 该页基线不可靠
  （表现为「同一代码两次采集差异很大」，此时应调大等待时间）。
- **深色模式为「拦截接口」模拟**：验证的是「设置 → 主题 → 样式」链路，未覆盖真实保存到
  `settings.json` 后再冷启动的持久化路径。

---

## ⚠️ 不要依赖基线清单里的 `sha256`（实测发现）

阶段 4 的矩阵采集中发现：**同一份代码、同一视口，两次采集的截图字节并不完全一致** ——
`builder` 页约 **40px** 差异（`mean ≤ 0.0017`），另有 2 页 `max = 1` 的亚感知噪声。
（推测来源：字体光栅化时机、KaTeX 字体异步加载等亚像素因素。）

**因此**：

- ✅ **判定新旧一律用 `compare.py` 的像素阈值**（`mean_diff` / `pct_gt32`）——实测**稳定**；
- ❌ **不要**用「`sha256` 是否一致」判断基线有没有被换过——**会误报**；
- 清单里的 `sha256` 只用于**粗粒度留痕**，配合 `accepted_at` / `accepted_reason`
  说明「何时接受过视觉变化、为什么」。

> 这正是本项目一贯的口径：**判定要看稳定的度量，不要看偶然相等的哈希**。
