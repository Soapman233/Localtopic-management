# 客户端外壳（`editions/desktop/`）—— **已实现并通过自动化验收**

> **状态（2026-10-13）**：3 条外壳契约**已实现**，`verify_desktop.py` **21/21 通过**、
> `verify_shell_e2e.py` **9/9 通过**（含真实开窗与单实例拦截）。
> ⚠️ **仍有 2 条只能人工确认**（见 §六）：① 双击**托盘图标**能否唤回窗口；
> ② 关掉再开「主题偏好与局域网令牌仍在」。**不要跳过这两条就当验收通过。**

技术选型：**pywebview + 系统 WebView2**（Windows 11 自带 Edge WebView2 Runtime）。
选它的原因：复用现成的 `webui` 服务与前端产物，外壳层体量小（预计 **+3–8 MB**），
无 Electron 那样的整包 Chromium；导出仍依赖 Windows（Word/WPS COM），与现有约束一致。

---

## 一、§4.5 契约对照表（7 条）

| # | 契约（规范 §4.5） | 归属 | 状态 |
|---|---|---|---|
| 1 | 无地址栏 / 无黑窗 | 外壳 | ✅ **已实现**（pywebview 默认无地址栏） |
| 2 | **单实例**（重复双击聚焦已有窗口） | 外壳 | ✅ **已实现**（命名互斥体 + `FindWindowW`/`SetForegroundWindow`） |
| 3 | **关闭 × → 最小化到托盘**（不是退出） | 外壳 | ✅ **已实现**（`events.closing` 返回 `False` + `hide()`；**托盘不可用时改为真正关闭**，见 §五）；⚠️ 只剩「双击托盘图标唤回」需人工 |
| 4 | **自动保存明示**「已自动保存 · 上次编辑 X 分钟前」 | **前端** | ✅ **已落地** |
| 5 | 恢复入口「**继续上次的卷**」 | **前端** | ✅ **已落地** |
| 6 | 首启引导（导入 → 找题 → 组卷 → 导出 四步，一次性） | **前端** | ✅ **已落地** |
| 7 | **跟随系统深色** | **前端**（外壳无需额外做） | ✅ **已落地** |
| — | 客户端 UX 状态放 `outputs/webui/client_state.db`（**绝不写 `bank.db`**） | 外壳 | ✅ **已实现**（独立 SQLite，与 `settings.json`/`auth.db` 同级） |

**小结**：7 条**全部已落地**——4 条在前端（第 4/5/6/7 条），3 条在外壳（第 1/2/3 条 + `client_state.db`）。

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

## 三、依赖与体积

- 依赖写在 **`editions/desktop/requirements.txt`**（`pywebview` / `pythonnet` / `pystray` / `Pillow`），
  **故意不进仓库根的 `requirements.txt`**：便携版打包只收 `editions/local/portable_main.py`，
  本目录**不参与打包**。**实测确认**：装完这些依赖后重打包，**体积仍为 65.5 MB**，
  exe 内**没有**混入 webview/pystray/pythonnet。
- 运行前提：**系统 WebView2 Runtime**（Windows 11 自带；本机实测 154.0.4258.62）。
- 体积预期：外壳层 **+3–8 MB**（复用系统 WebView2，不打包 Chromium）。

---

## 四、怎么跑

```bash
# 一次性：装外壳依赖
pip install -r editions/desktop/requirements.txt

# 起外壳（起后端服务 + 开窗口；点 × 最小化到托盘，不退出）
python editions/desktop/desktop_main.py

# 自动化验收（28 项 + 端到端 9 项）
python editions/desktop/verify_desktop.py     # 加 --no-window 可跳过真实开窗
python editions/desktop/verify_shell_e2e.py   # 会真开一次窗口并起一次服务，结束自动清理
```

---

## 五、🔴 一个真实故障与修复（**值得记住的教训**）

**症状**：点窗口 × → 窗口消失、进程仍在，**但再也找不到页面**。

**根因（第一版实现的三处缺陷叠加）**：
1. **托盘图标只在"第一次关闭时"才创建** → 用户在此之前根本不知道有托盘图标；
2. Windows 11 **默认把新出现的托盘图标收进折叠区（`^`）** → 即便创建了也不在显眼处；
3. 最致命：`tray.start()` **失败也照样 `hide()`** → 托盘不可用时用户被**彻底困住**。

**修复**：
- 托盘**在启动时就创建**（不是等关闭），并在启动日志里明确告知「点 × 会最小化到托盘」；
- **首次最小化弹一条系统通知**，告诉用户窗口去哪了、怎么唤回；
- **`can_tray=False` 时直接真正关闭**——宁可不满足"最小化到托盘"，也不能把老师困住；
- 还原窗口做三件事：`show()` + `restore()` + **`SetForegroundWindow`**（只 `show()` 可能被压住，
  用户会以为"点了没反应"）；
- `registered()`：查 pystray 的**真实 OS 句柄**（`_hwnd` / `_icon_handle` / `visible`），
  确认图标**真的进了系统托盘**——比"线程还活着"强得多（已纳入自动化验收）。

> **教训**：这条故障是**「契约写对了、实现把人困住了」**。
> 规范说「点 × 最小化到托盘」，但**它没说的那条底线更重要：不能因为满足契约而让用户找不到程序**。
> 所以现在的实现是：**能安全地最小化才最小化，否则老实退出。**

---

## 六、仍需人工确认（自动化做不到）

自动化已覆盖 **28 + 9 项**，但下面这些**依赖人眼/手**：

| # | 需确认 | 为什么不能自动化 |
|---|---|---|
| 1 | 双击**托盘图标**能唤回窗口 | 图标可能被 Win11 收进折叠区，**鼠标点它**无法脚本化 |
| 2 | 关掉再开 → **主题偏好与局域网令牌仍在** | 要验证 WebView2 的 `localStorage` 真的落盘（`storage_path` 生效） |

> 其余原本列在这里的项**已改为自动化**：
> 「点 × 是否只最小化」→ `verify_desktop.py` 断言 `closing` 返回 `False` + `hide()`；
> 「托盘图标是否出现」→ `registered()` 查真实 OS 句柄。

