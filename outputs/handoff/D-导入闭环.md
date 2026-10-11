# 交接：Phase 2 / 开发（D1+D2）— 导入闭环

> 日期：2026-10-12
> 角色：**D1 导出内核**（2.2 后端）+ **D2 前端**（2.3/2.4）
> 上游：`outputs/handoff/R-可编程导入调查报告.md`（Phase 2.1）
> 下游：Phase 3 打包便携

---

## 一、为什么这是关键路径

个人客户端是「**自己建库**」——**导入是唯一的建库途径**。
而改造前，导入只有 4+ 条命令行，**Web 界面完全没有入口**：老师根本建不了库。

---

## 二、产出物

| 文件 | 说明 |
|---|---|
| `webui/services/import_svc.py` | 导入服务：校验 / 提交 / 作业体 |
| `webui/routers/imports.py` | `GET /api/import/status`、`POST /api/import/docx` |
| `webui/errors.py` | 新增 `40010`（未提供/空文件）、`40011`（格式/大小/功能关闭） |
| `frontend/src/pages/ImportPage.tsx` | 导入页（拖拽 + 点击 + 轮询 + 结果面板） |
| `frontend/src/components/FirstRunImportGuide.tsx` | 首启引导（题库为 0 时出现） |
| `frontend/src/lib/importFile.ts` | 纯函数校验（白名单/上限**全部取自 status 接口**） |
| `frontend/src/api/imports.ts` | API 封装 |
| `tests/test_import_api.py` | 9 项后端测试 |
| `frontend/tests/unit/pages/ImportPage.test.tsx` | 11 项前端测试 |
| `spike/acceptance/verify_import_api.py` | 端到端验收脚本 |

---

## 三、🔴 实现期发现并修复的 2 个真实缺陷

### 缺陷 1 · 错误码撞码（**在写代码前查表避开了**）

架构师方案原定 `40008`/`40009` 作为导入错误码，但**实测这两个码已被占用**
（`CODE_AUTH_DISABLED` / `CODE_INVALID_ROLE`）。改用 `40010`/`40011`。

> 教训：**新错误码必须查现有码表**，不能沿用旧文档里的编号。

### 缺陷 2 · 删除上传文件打断「导入 → 组卷 → 导出」主流程 🔴

**现象**（由**端到端验收**发现，单测测不出）：导入成功 36 题后，
**加题返回 409 / 40904**：

```
kind: "source_unavailable", severity: "blocker"
"源DOCX无法核验：No such file or directory:
 '...\outputs\webui\uploads\2026年10月1日初中物理作业.docx'"
```

**根因**：我最初在导入完成后**把上传的 DOCX 删掉了**（当作临时文件清理）。
但**内容守卫**（`bank.export_content`）在**组卷/导出时会回读源 DOCX 核验题目来源**，
文件不在 → 报 `source_unavailable` blocker → **整条主流程被拦死**。

**修复**：
* 上传文件**归档**到 `outputs/sources/`（**持久保留**），命名用**内容哈希**
  （`<stem>_<sha256前12位>.docx`）——同内容同路径（幂等）、不同内容不同路径（**绝不互相覆盖**，
  否则先导入的题会失去源）；
* `_cleanup()` **只清阶段1 中间产物，不删源文件**。

> **教训**：**"临时文件"的判断不能只看名字**。上传的 DOCX 对本系统是**长期依赖**
> （来源核验的凭据），不是临时文件。这类问题**只有跑完整业务链路才会暴露**。

---

## 四、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 1) 后端单测（期望 9 tests, OK）
$PY -m unittest tests.test_import_api -v
# 2) 端到端（期望 10/10 PASS）—— 用库副本，绝不碰交付库
$PY spike/acceptance/verify_import_api.py
# 3) 前端
cd frontend && npx tsc --noEmit && npx vitest run && npm run build
```

---

## 五、实测证据

### 后端端到端（`verify_import_api.py`，10/10 PASS）
```
空文件 -> 400 40010
非 docx -> 400 40011
status: enabled=True max=100MB suffixes=['.docx']
导入前题目数: 7945
导入 2026年10月1日初中物理作业.docx -> 新增=36 跳过=0
导入后题目数: 7981（+36）
重复导入: 新增=0 跳过=36 库内题目数=7981（幂等）
交付库 sha256 前后一致: True（未被污染）
```

### 前端（独立复跑）
```
npx tsc --noEmit -> 0 错误
npx vitest run   -> 31 文件 / 236 测试 全过
npm run build    -> 成功，对比度门禁 65/65
```

---

## 六、我没做 / 做不到的

1. **侧栏导航未按功能开关动态禁用**（`enabled=false` 时仅页面内禁用）。
2. **作业进度粒度粗**：`JobManager` 只上报 0.0→0.1→1.0，没有「解析/入库」分阶段。
   前端用 indeterminate 进度条兜底。要真实阶段需后端上报（未做）。
3. **未做真实浏览器端到端**：前端拖拽在 jsdom 下验证；
   真实拖拽落盘由 `verify_portable_e2e.py`（Phase 3）在**打包客户端**上以 HTTP 覆盖。
4. **`npm ci` 在本沙箱跑不通**（esbuild postinstall 与沙箱删除保护冲突）——
   环境限制，非代码问题；`package-lock.json` 未被改动。

---

## 七、遗留风险

| 风险 | 说明 | 建议 |
|---|---|---|
| **源文件会累积** | 每导入一份 DOCX 就在 `outputs/sources/` 留一份（**这是必需的**，守卫要回读） | 界面提供「来源文件管理」页（已有 `SourcesPage`），让用户看到并理解 |
| **同名不同内容** | 已用内容哈希命名规避覆盖 | — |
| **大文件** | 上限 100MB，流式落盘并在超限时立即中断 | 若老师有超大卷可调 `MAX_UPLOAD_BYTES` |
