# 交接：Phase 3 / 开发（D1）— 打包与便携

> 日期：2026-10-12
> 角色：**D1 导出内核开发**
> 上游：`outputs/handoff/D-导入闭环.md`（Phase 2）
> 结论：**便携客户端已产出并跑通全流程**（55.4 MB，双击即用，无需任何外部服务）

---

## 一、产出物

| 文件 | 说明 |
|---|---|
| `editions/local/portable_main.py` | 打包入口（**`freeze_support()` + 数据根目录钉位**） |
| `packaging/portable.spec` | PyInstaller 配置（onedir / 不打数据 / 排除项） |
| `packaging/build_portable.py` | 一键构建（前端 → 打包 → 体积统计） |
| `bank/backup.py` | 整库备份 / 恢复（**SQLite 在线备份 API**） |
| `webui/routers/backup.py` | 备份 API（info / create / download / restore） |
| `bank/cli.py` | 新增 `backup` / `restore` 子命令 |
| `webui/config.py` | 新增 `DATA_ROOT`（`QB_DATA_ROOT` 可覆盖） |
| `webui/__main__.py` | 首启**自动建库**（`QB_AUTO_INIT=0` 可关） |
| `tests/test_backup.py` | 10 项测试 |
| `spike/acceptance/verify_backup_restore.py` | 备份/恢复端到端验收 |
| `spike/acceptance/verify_portable_e2e.py` | **便携客户端全流程端到端验收** |

---

## 二、🔴 实现期发现并修复的 3 个真实缺陷

### 缺陷 1 · 打包后数据会写进临时目录（**退出即丢**）

PyInstaller 冻结后 `webui.config.ROOT = Path(__file__).parent.parent` 会解析到
**`_MEIPASS` 临时解包目录**——`outputs/bank.db` 写进去，**程序退出就被删**。

**修复**：新增 `DATA_ROOT`（可用 `QB_DATA_ROOT` 覆盖），`portable_main.py` 在冻结时
把它钉到 **exe 所在目录**。实测数据确实落在 exe 旁。

### 缺陷 2 · 首启被「库不存在 → 拒绝启动」挡住

`webui/__main__.py` 原本硬性要求库已存在，并提示"去命令行跑 `python -m bank.cli init`"。
**对老师来说这是不可能完成的动作**——便携客户端首启必须是零门槛。

**修复**：改为**首启自动建库**并给出引导文案；
保留 `QB_AUTO_INIT=0` 恢复旧行为（开发时避免误指向空库）。

### 缺陷 3 · `with sqlite3.connect(...)` **不关闭连接**

`bank/backup.py` 最初用 `with sqlite3.connect(...)` 做在线备份——
**这个写法只提交/回滚事务，不关闭连接**。句柄泄漏导致 Windows 上
**备份文件无法删除/覆盖**（测试清理阶段直接 `PermissionError: WinError 32`）。
生产上会表现为**恢复操作被自己的旧句柄阻塞**。

**修复**：改用 `contextlib.closing(...)` 显式关闭。

---

## 三、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 1) 备份/恢复单测（期望 10 tests, OK）
$PY -m unittest tests.test_backup -v
# 2) 备份/恢复端到端（期望 10/10 PASS）—— 用库副本
$PY spike/acceptance/verify_backup_restore.py
# 3) 构建便携包（前端 -> PyInstaller -> 体积）
$PY packaging/build_portable.py
# 4) 部署到干净目录并启动，然后跑全流程验收
#    （期望 13/13 PASS）
$PY spike/acceptance/verify_portable_e2e.py
```

---

## 四、实测证据

### 体积（3.1 预算）
```
体积   : 55.4 MB（58,138,483 字节，239 个文件）
可执行 : dist/题库/题库.exe
目标   : ≤ 200 MB -> ✅ 达标
最大文件: libcrypto-3-x64.dll 7.6MB / PIL/_avif 7.5MB / pdfium.dll 7.0MB
```
**55.4 MB 远低于预期**（原本按 100MB 估），可直接分发。

### 备份 / 恢复（10/10 PASS）
```
三重校验全通过 / 备份行数一致（18 表逐表比对）
拒绝非库文件 / 拒绝空文件
恢复成功 + 自动留 pre-restore 快照
恢复后数据一致、库可用
交付库未被污染（sha256 前后一致）
```

### 🔴 便携客户端全流程端到端（**13/13 PASS**）
```
[步骤1] health 正常 / 导入功能可用
[步骤2] 导入真实旧卷：2026年10月1日初中物理作业.docx -> 新增=36
        题库从空变有（0 -> 36）
[步骤3] 检索可用
[步骤4] 建卷 + 加题 -> 200
[步骤5] 导出 DOCX（native 引擎）
        产物 4,097,319 字节  公式=12 图=15 页=5
[步骤6] [word] 页5 OMaths=12 图=15 改字符重开保留=True
        [wps]  页5 OMaths=12 图=15 改字符重开保留=True
[步骤7] 整库备份 校验=True

✅ 通过：打包客户端可完成「空库 → 导入 → 组卷 → 导出 → 双端可编辑」全流程
```

**这是 Phase 2+3 的最终判定**：从**空库**起步，在**打包后的 exe** 上，
走**真实 HTTP**，完成老师要做的一切，且导出件在 Word 与 WPS 双端公式可编辑。

### 包内容检查
```
前端资源：31 个 JS（含 ImportPage chunk）✅
源码泄漏：无（包内 .py 仅 vendor 的 mtef_py，属有意分发的数据文件）
```

---

## 五、逐条对照 Phase 3 任务

| # | 任务 | 结论 |
|---|---|---|
| 3.1 | 依赖瘦身与体积预算 | ✅ **55.4 MB**，远低于 200MB 目标 |
| 3.2 | 打包（PyInstaller 目录模式） | ✅ onedir，**不打数据**（首启建空库），`freeze_support()` 已加 |
| 3.3 | 空库初始化 | ✅ 首启自动建库（实测 204,800 字节空库 / 19 表 / schema v3） |
| 3.4 | 便携数据路径 | ✅ 数据在 exe 旁，**无 AppData / 注册表写入**（`winreg` 仅只读查 Office） |
| 3.5 | 一键备份 / 恢复整库 | ✅ 核心 + CLI + Web API（4 端点），含**自动回滚点**与**候选校验** |

---

## 六、我没做 / 做不到的

1. **未做真实浏览器 UI 端到端**（点击导入页 → 上传 → 看进度）。
   本轮用 **HTTP 层**覆盖了同一批后端接口；前端交互由 vitest 覆盖。
   真实浏览器验证建议由 QA 补。
2. **未做代码签名**：Windows SmartScreen 首次运行仍会提示"未知发布者"。
   签名需证书，超出本轮范围。
3. **未验证 `freeze_support()` 在真实 MathType 路径下生效**：
   本项目**没有 MathType OLE 的真实样例**（样例全是 OMML），
   spawn 分支**未端到端跑过**。已按标准做法加了 `freeze_support()`，
   但**未获实证**——这是打包前最该补的验证项。
4. **未做安装包（MSI/NSIS）**：当前是绿色目录版（解压即用），符合"便携"定位。
5. **未测多用户并发**（便携版定位是单机单用户）。

---

## 七、遗留风险

| 风险 | 说明 | 建议 |
|---|---|---|
| **🔴 MathType 路径未实证** | `pipeline/mtef_conv.py` 的 spawn 分支在冻结后是否正常，**未验证**（无真实样例）。源试卷约 80% 含 MathType，这是**最大的未知数** | 找一份真实 MathType 旧卷，在打包版上跑导入 |
| **源文件累积** | 每导入一份 DOCX 在 `outputs/sources/` 留一份（**必需**，守卫要回读） | 已说明；可考虑加"清理未引用来源"功能 |
| **杀毒误报** | 未签名 exe 可能被拦 | 分发时说明；必要时购买证书 |
| **首启无控制台** | `console=False`，出错时看不到日志 | 建议补**启动日志文件**（写 `outputs/webui/start.log`） |
| **恢复需重启** | API 恢复后建议重启（响应中已提示） | 可考虑恢复后自动重启进程 |

---

## 八、给下游的输入摘要

**便携客户端已可用**：`dist/题库/题库.exe` 双击启动，自动建库并打开浏览器；
数据全在 exe 旁的 `outputs/`（含 `sources/` 源文件与 `backups/` 备份），
**换电脑只需拷整个目录**。导入 → 组卷 → 导出全流程在 Word/WPS 双端验证通过。

**最该补的一件事**：拿一份**真实 MathType 旧卷**在打包版上验证导入。
