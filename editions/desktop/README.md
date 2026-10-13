# 客户端外壳（`editions/desktop/`）—— **规划中 / 未实现**

> ⚠️ **本目录当前只有骨架，外壳尚未实现、未安装依赖、未端到端验证。**
> 不要把它当作可用产物。它存在的目的，是把「客户端化」的技术选型与
> **设计规范 §4.5 的 7 条交互契约**落成可评审的文字，并标清**哪几条已在前端落地**。

技术选型：**pywebview + 系统 WebView2**（Windows 11 自带 Edge WebView2 Runtime）。
选它的原因：复用现成的 `webui` 服务与前端产物，外壳层体量小（预计 **+3–8 MB**），
无 Electron 那样的整包 Chromium；导出仍依赖 Windows（Word/WPS COM），与现有约束一致。

---

## 一、§4.5 契约对照表（7 条）

| # | 契约（规范 §4.5） | 归属 | 状态 |
|---|---|---|---|
| 1 | 无地址栏 / 无黑窗 | 外壳 | ⏳ 待外壳实现 |
| 2 | **单实例**（重复双击聚焦已有窗口） | 外壳 | ⏳ **待外壳实现** |
| 3 | **关闭 × → 最小化到托盘**（不是退出） | 外壳 | ⏳ **待外壳实现** |
| 4 | **自动保存明示**「已自动保存 · 上次编辑 X 分钟前」 | **前端** | ✅ **已落地** |
| 5 | 恢复入口「**继续上次的卷**」 | **前端** | ✅ **已落地** |
| 6 | 首启引导（导入 → 找题 → 组卷 → 导出 四步，一次性） | **前端** | ✅ **已落地** |
| 7 | **跟随系统深色** | **前端**（外壳无需额外做） | ✅ **已落地** |
| — | 客户端 UX 状态放 `outputs/webui/client_state.db`（**绝不写 `bank.db`**） | 外壳 | ⏳ **待外壳实现** |

**小结**：7 条里 **4 条已在前端落地**（第 4/5/6/7 条，且在任何形态下都有价值）；
**3 条必须靠外壳实现**——**单实例**、**最小化到托盘**、**`client_state.db`**。

### 已在前端落地的 4 条（在哪实现）

| 契约 | 落点 |
|---|---|
| 自动保存明示 | `frontend/src/components/AutosaveNotice.tsx` + `store/uiStore.ts` 的会话态 `lastEditAt`（**不持久化**） |
| 继续上次的卷 | `frontend/src/components/ContinueLastPaper.tsx`（读 `paperStore` 持久化的 `currentPaperId`；被删则安全回退） |
| 首启四步引导 | `frontend/src/components/FirstRunFlowGuide.tsx`（`localStorage: qb_flow_guide_seen` 一次性标记） |
| 跟随系统深色 | `frontend/src/lib/themeMode.ts` + `store/themeStore.ts` + `main.tsx`（三态：跟随系统 / 浅色 / 深色） |

> 第 7 条为什么「外壳无需额外做」：前端用 `window.matchMedia('(prefers-color-scheme: dark)')`
> 并**监听变化**。WebView2 会把**操作系统**的深浅偏好透传给页面，因此外壳只要正常起窗口，
> 前端即自动跟随系统；**不要**在外壳里再写一套主题判断（会与前端打架）。

---

## 二、外壳待实现的 3 条（骨架里的 TODO）

1. **单实例**（`desktop_main.py: _acquire_single_instance`）
   - 方案（待验证）：Windows 具名互斥体 `CreateMutexW`（`ctypes`）；已存在则**聚焦已有窗口**
     （需与窗口句柄联动，pywebview 未直接暴露 → 可能要用 Win32 `FindWindow`/`SetForegroundWindow`）。
   - 退化方案：`outputs/webui/client_state.db` 里存窗口句柄 + 进程 id，启动时探测存活。

2. **最小化到托盘**（`desktop_main.py: _setup_tray`）
   - 方案（待验证）：pywebview 的窗口 `events.closing` 里 `return False` 取消关闭、改为 `window.hide()`；
     托盘用 `pystray`（**尚未引入依赖**，见下）。
   - 需要提供「退出」菜单项，否则用户无法真正退出（隐藏后只能靠任务管理器）。

3. **`client_state.db`**（`desktop_main.py: _client_state_db_path`）
   - 客户端 UX 状态（窗口位置 / 尺寸、上次打开的页面、托盘提示已读…）放
     `outputs/webui/client_state.db`，**绝不写 `outputs/bank.db`**（题库数据文件）。
   - 本轮**未建库、未建表**，仅给出路径约定。

---

## 三、依赖与体积（**本轮不安装**）

- ⚠️ **`requirements.txt` 未加入 `pywebview` / `pystray`**：本轮只做骨架，不安装、不验证。
- 计划依赖：`pywebview`（外壳）+ `pystray`（托盘，可选）+ `Pillow`（托盘图标，已在 `requirements.txt`）。
- 体积预期：外壳层 **+3–8 MB**（复用系统 WebView2，不打包 Chromium）。
- 运行前提：Windows 11 自带 WebView2 Runtime；若目标机缺失需另行分发（待评估）。

---

## 四、怎么跑（**当前会失败，属预期**）

```bash
# ⚠️ 未安装 pywebview 时，本命令会打印「缺少依赖」并退出——这是**有意**的诚实失败。
python editions/desktop/desktop_main.py
```

安装依赖并端到端验证之前，**不要**把本目录接进打包脚本或对外文档。
