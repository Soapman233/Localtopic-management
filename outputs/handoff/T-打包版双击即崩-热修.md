# 交接：热修 / 打包版「双击即崩」+ 验证盲区

> 日期：2026-10-12
> 角色：**D1**（修复）+ **T**（验证方法纠正）
> 上游：`outputs/handoff/D-打包与便携.md`（Phase 3）
> 用户反馈：**打包版双击后无反应**，附崩溃栈

---

## 一、用户报的问题（**产品完全不可用**）

```
AttributeError: 'NoneType' object has no attribute 'isatty'
  File "uvicorn\logging.py", line 42, in __init__
  ...
ValueError: Unable to configure formatter 'default'
  File "webui\__main__.py", line 141, in main
```

## 二、根因

打包用 `console=False`（双击不弹黑窗），exe 的 **PE 子系统是 `WINDOWS_GUI`**：

```
PE Subsystem = 2 -> WINDOWS_GUI（无控制台）
```

**GUI 子系统在任何启动方式下都不分配控制台** → `sys.stdout` / `sys.stderr` 为 `None`
→ uvicorn 配置日志时执行 `sys.stdout.isatty()` → **崩溃**。

## 三、🔴 我的验证为什么没发现（**方法论问题，比 bug 本身更值得记**）

**我确实「验证过」打包版**：启动 exe、探接口、跑完整 13 项端到端 —— **全绿**。

**但每一次启动都经由 shell / 后台任务，进程继承了有效的输出句柄**，
`sys.stdout` 不为 `None`，于是**双击路径根本没被覆盖**。

> **验证的失败模式**：不是"没验证"，而是**验证条件与真实使用条件不一致**。
> 「能启动」不等于「用户那样启动也能启动」。

### 反证过程（也踩了一次坑）

我第一版复现脚本传了 `stdout=subprocess.DEVNULL` ——
**那等于给了它有效句柄**，旧 exe 照样能跑，反证失败。

去掉后（`DETACHED_PROCESS` + `close_fds=True`，**不传任何 std 参数**）：

```
=== 旧 exe + 真正无句柄启动 ===
[步骤2] ✗ 未能在 40s 内就绪
[步骤4] ✗ 无 start.log
FAIL  无控制台可启动          ← 反证成立，复现了用户的崩溃
```

**教训**：构造反例时，**"模拟条件"本身也要被验证**——否则会得出"没问题"的错误结论。

---

## 四、修复（`editions/local/portable_main.py`）

### 1. 把 stdout/stderr 接到日志文件（核心修复）

```python
def _ensure_streams() -> Path | None:
    """保证 sys.stdout/sys.stderr 非 None，否则接到日志文件。"""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    target = log_path()                      # <数据根>/outputs/webui/start.log
    target.parent.mkdir(parents=True, exist_ok=True)
    fh = open(target, "a", encoding="utf-8", buffering=1)
    if sys.stdout is None: sys.stdout = fh
    if sys.stderr is None: sys.stderr = fh
    return target
```

**调用时机**：`main()` 里**最先**执行，**早于 `import webui` / uvicorn**
（uvicorn 在导入/配置日志时就会读 stdout）。

顺带解决了我在 Phase 3 交接里标记为风险的一项：**「首启无日志、出错看不到原因」**。

### 2. 致命错误弹窗（无控制台时否则用户什么都看不到）

```python
def _fatal(title, message):
    """写日志 + MessageBoxW 弹窗告知用户 + 日志路径。"""
```

`main()` 用 `try/except BaseException` 包住整个启动流程，
异常时打印栈、弹窗、返回 1（而不是静默退出）。

---

## 五、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 1) 启动单元测试（含反证：无 stdout 时 uvicorn 确实会崩）—— 期望 7 tests, OK
$PY -m unittest tests.test_portable_startup -v
# 2) 🔴 **双击场景**验收（DETACHED_PROCESS + 不给任何 std 句柄）—— 期望 7/7 PASS
$PY spike/acceptance/verify_portable_detached.py
# 3) 回归：完整全流程 —— 期望 13/13 PASS
$PY spike/acceptance/verify_portable_e2e.py
```

> ⚠️ 第 2 条是**新增的必要验证**。此前所有验证（含第 3 条）都在"有 stdout"条件下跑，
> **测不到双击路径**。今后打包类改动**必须**跑这一条。

---

## 六、实测证据

### 单元测试（7/7 OK）
```
test_uvicorn_logging_crashes_without_stdout ... ok   ← 反证：bug 确实可复现
test_takes_over_and_uvicorn_logging_ok     ... ok   ← 正证：修复后不再崩
test_noop_when_streams_ok / test_only_stdout_none / test_log_file_actually_written
test_log_path_under_data_root / test_fatal_does_not_raise ... ok
```

### 双击场景（7/7 PASS）
```
PASS  无控制台可启动
PASS  health 正常
PASS  /api/import/status 可用 / /api/backup/info 可用 / /api/stats 可用
PASS  数据落在 exe 旁
PASS  生成启动日志
✅ 通过：打包版双击可用（无控制台）
```

启动日志实际内容（**这正是用户排障需要的**）：
```
[题库] 解释器：...\_detached_run\题库.exe
[题库] 数据库：...\_detached_run\outputs\bank.db
[题库] 版本：local（本机单人使用，仅监听回环地址，无鉴权。）
[题库] 数据库不存在，正在创建一个空库（首次使用属正常）。
[题库] 建好后请在「导入试卷」页导入你的第一份旧卷。
[题库] 已执行迁移：...
```

### 回归（完整全流程，13/13 PASS）
```
空库 → 导入(36题) → 检索 → 建卷 → 加题 → 导出(12公式/15图/5页)
→ Word 与 WPS 双端改字符重开保留 → 备份
```
**修复未破坏任何已验证行为。**

---

## 七、遗留

| 项 | 说明 |
|---|---|
| **同类风险已排查** | 全项目 `isatty`/`sys.stdout` 依赖已 grep 过，其余为 `print(..., file=sys.stderr)`（对 None 安全） |
| **仍未做代码签名** | SmartScreen 首次运行仍提示"未知发布者" |
| **`console=False` 无实时反馈** | 用户看不到进度；日志文件是唯一窗口。若用户抱怨，可考虑加托盘图标或启动时弹「正在启动…」提示 |
| **🔴 MathType 路径仍未实证** | 与本次无关，仍是打包后最大的未知数 |
