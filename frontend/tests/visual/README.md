# 视觉回归（visual regression）

> 项目铁律：**排版 / 样式改动必须渲染出来看** —— 单元测试测不出视觉缺陷。
> 本目录提供 1366×768（教师笔记本主流分辨率）的截图比对机制。

---

## 为什么基线图**不入库**

| 项 | 是否入库 | 理由 |
|---|---|---|
| `capture.mjs` / `compare.py` / 本 README | ✅ | 小文本，是机制本身 |
| `baseline-manifest.json` | ✅ | 记录基线**何时、以何参数**被替换 —— 让「接受一次视觉变化」在 git 里可见可审计 |
| 基线 PNG | ❌ | 每阶段都会变、属派生产物；入库会让「接受一次视觉变化」提交约 2 MB 二进制 |

基线图存放位置：`.tmp_verify/baseline-1366x768/`（已被 `.gitignore` 排除）。

> **代价（如实说明）**：换机器 / 清空临时目录后，基线需要**重新采集**。
> 由于 manifest 记录了每张图的 sha256，**基线是否被换过、换成什么**仍可追溯。

---

## 用法

### 1. 采集

```bash
# 先启动后端（本机 127.0.0.1:8720），再执行：
PLAYWRIGHT_MODULE="<path-to-playwright>" \
  node frontend/tests/visual/capture.mjs http://127.0.0.1:8720 .tmp_verify/baseline-1366x768
```

> 本项目**未**把 `playwright` 放进 `frontend/package.json` —— 它是个重量级开发依赖，
> 仅为视觉回归引入不划算。用 `PLAYWRIGHT_MODULE` 指向已有的 playwright 模块即可。
> 不设该变量时会尝试直接 `import('playwright')`。

### 2. 比对

```bash
python frontend/tests/visual/compare.py \
  .tmp_verify/baseline-1366x768 \
  .tmp_verify/phase3-1366x768 \
  --out .tmp_verify/visual-diff
```

输出每页的 `mean_diff` / `>32 像素占比`，并写出**差异热力图**（`*-diff.png`）。
退出码 `1` 表示有页面超出阈值，**需要人工看图判定**。

### 3. 判定口径

| 指标 | 阈值 | 含义 |
|---|---|---|
| `mean_diff` | < 1.0 | 无可见变化 |
| `pct_gt32` | < 0.5% | 无结构性变化 |
| 自校验 | 自比 == 0 | 确认度量本身没写错 |

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

- **只覆盖 1366×768 一个分辨率**：窄屏（<1200）与超宽（1920+）的布局差异**未纳入**基线。
- **不覆盖交互态**：加载中 / 空态 / 错误态 / 抽屉打开 / 对话框等**瞬时或需操作**的界面不在基线内
  （这些由组件单测 + 浏览器验收脚本覆盖）。
- **不覆盖深色模式**。
- 页面加载后固定等 3.5 秒再截图；若某页数据更慢，可能截到 loading 态 → 该页基线不可靠
  （表现为「同一代码两次采集差异很大」，此时应调大等待时间）。
