# 项目记忆 · 私有题库管理系统

> 整理于 2026-10-12。过程细节见 `.workbuddy-ai/memory/2026-10-*.md` 日志。

## 1. 定位与约束
- 为中学教师（首个学科 **初中物理**）建**私有题库**：DOCX 抽题 → 建库检索 → 组卷 → 导出**公式可编辑**试卷 → 本地 Web 操作。
- **验收环境**：WPS（版本可不一致）+ 兼容 Word。本机 WPS 12.1.0.28505 / Word 16.0.20326。
- **硬要求**：异地访问；导出公式必须可编辑，**公式图片不算达标**。
- 源素材：`C:\Users\SOAP\Desktop\物理\初中\2026学科网教案`、`D:\Open-source project\Localtopic-management\2026_10_05_西附国庆练习卷`（只读）。

## 2. 当前形态：便携轻量个人客户端（2026-10-12 定案）
**`dist/题库/题库.exe` 双击即用，无需任何外部服务。实测 55.4 MB。**
- 数据全在 exe 旁 `outputs/`（`bank.db` / `sources/` 源文件 / `backups/` 备份 / `webui/` 缓存）→ **拷目录即迁移**。
- 首启**自动建空库**；不随包分发 62MB 预建库。
- 构建：`python packaging/build_portable.py`（前端 → PyInstaller onedir → 体积统计）。
- **无 AppData / 注册表写入**（`winreg` 仅只读查 Office 路径）。

### 两条链路都已脱离 editor_sdk
- **导出引擎可选**（`bank/export.py::resolve_export_engine`）：`native`（**默认**，自研 `bank.docx_writer`，**不需 editor_sdk/Office**）/ `bridge`（原 editor_sdk 链路，后备）/ `auto`。
  优先级：显式参数 > `QB_EXPORT_ENGINE` > 默认 native。
- 验证：把 `editor_sdk_port` 指向死端口 → bridge 失败（反证）→ **native 成功**（CLI 与 Web API 两条路径都验过）。

## 3. 公式可编辑路线（核心能力）
- 源试卷约 **80% 含旧式 MathType OLE**。三种互不兼容格式：`Equation.DSMT4`(98.48%，可转 99.93%)、`Equation.KSEE3`(0.90%，**会让解析器死循环，须按 ProgID 预判跳过**)、`Equation.3`(0.16%，不支持)。
- 解法：vendor 的 `mtef-py`(Apache-2.0) 解析 OLE 内 `Equation Native` 流 → LaTeX（精确解码非 OCR，成功率 99.69%）→ 再转 OMML。**无需 MathType 授权。**
- **OMML 是唯一不依赖第三方软件、双端可编辑的格式**；MathType 对象两端均不可编辑。
- 30 题三路径验证（`outputs/公式可编辑验证报告-30题.md`）：原生 OMML 10/10；旧式 OLE 0/10（未装 MathType 时）；扫描 PDF 重建 9/10（唯一仍需人工）。

### 转换踩坑（必记）
- 公式中文必须写成 `\text{浮}`；MTEF 输出 `{\text{[U+6d6e]}}`，替换**必须在已有 `\text{}` 内部**（套成 `\text{\text{浮}}` 报 `ToCommands returned empty`）。
- **必须先取出 OLE 容器内 `Equation Native` 流**再解析，直接传整个 .bin 会**静默返回空**。
- 需去掉公式开头 `~` 占位符。进程 spawn ~0.43s/次 → 用**流式单进程 + 逐条回报**。

## 4. 自研导出内核（2026-10-12 完成）
- `bank/latex2omml.py`：LaTeX → OMML（与 `pipeline/omml.py` 互为逆运算）。**纯标准库**。
- `bank/docx_writer.py`：直接生成 .docx（`zipfile` + 拼 XML）。复用既有 plan 契约（`build_document_plan` 本就与桥接无关），**只替换渲染那一步**。
- 数据规模：阶段1 209/209 成功、9,765 题（`outputs/preprocess_final/`，**勿重新生成**）；题库 **7945 题**、17771 公式、7102 图片、待复核 196。

### 🔴 自研实现踩的坑（与桥接版对照得出）
- **MathType 填充空格**：`{ \rm{ k } }{ \rm{ g } }` 表示 `kg`，填充空格是**记号分隔符不是真实空格**，须剥首尾。
- **`^` 会绑到空格**：MathType 风格 `} ^ {` 中间有空格，**LaTeX 数学模式中空白不显著**，解析器必须跳过纯空白 token。
- **单字符脚标贪婪吞 `^`**：`parse_script_arg` 无花括号分支须用 `parse_base()` 而非 `parse_atom()`，否则 `x_i^2` 错成 `sSub(x, sSup(i,2))`。
- **`\rm{...}` 内容可能含结构**（真实语料有 `{ \rm{ {}^\text{3} } }`）→ 不能当纯文本读，须正常解析后再 `_uprightify`。
- **图片尺寸三层规则，顺序不可颠倒**：① 档位上限（按宽高比）② 最小宽度**有限放大** `min(4.0, natural×1.5)` ③ **最后**钳到**源文档中原图尺寸**（`source_width_emu`）。顺序错会把已缩小的图重新放大 → **整卷 4 页膨胀到 6 页**。
- **题号不要再加**：`build_document_plan` 已把题号写进 `stem_lines` 首段，渲染层重复添加产生**双重题号**。
- **`<a:graphicData>` 必须带 `uri`**：缺了 WPS 容忍但 **Word 报错打不开**。
- **TAB 直接写 `<w:tab/>`**：自研不走桥接，**`U+E000` 哨兵方案整体不再需要**。
- 公式中文/实体：转换器直接输出 Unicode，**无 HTML 实体残留**（桥接版有 `&Delta;`）。
- 真实试卷对照（试卷#1 学生版）：页数 4/4、公式 24/24、图片 8/8、**图片宽度逐张一致**。

## 5. 导入闭环（2026-10-12 完成）
- 个人客户端「自己建库」→ **导入是唯一建库途径**。`webui/services/import_svc.py` + `routers/imports.py`。
- 链路：`pipeline.stage1.process_file` → `bank.importer.import_file`（**不依赖 editor_sdk/COM/cwd/环境变量**）。
- 错误码 **40010**（未提供/空文件）、**40011**（格式/大小/功能关闭）。
  - ⚠️ 架构师方案原定 40008/40009，**已被 `CODE_AUTH_DISABLED`/`CODE_INVALID_ROLE` 占用** → **新错误码必须查现有码表**。
- ⚠️ `import_file` 返回键是 **`new`/`updated`/`skipped`/`junk`**（不是 `inserted`）。
- 🔴 **源 DOCX 必须持久保留**：内容守卫在组卷/导出时会**回读源 DOCX 核验题目来源**，删除即报 `source_unavailable` blocker → **打断「导入→组卷→导出」主流程**。归档到 `outputs/sources/`，**按内容哈希命名**（同内容同路径=幂等；不同内容不同路径=绝不互相覆盖）。

## 6. 备份 / 恢复
- `bank/backup.py`（核心）+ `routers/backup.py`（info/create/download/restore）+ CLI `backup`/`restore`。
- **用 SQLite 在线备份 API**（`Connection.backup`）取一致快照，不是直接 copy 文件。
- **恢复前强制留回滚点**（`backups/pre-restore-<时间戳>.db`）+ `verify_backup` 校验候选，不合格拒绝。
- ⚠️ **`with sqlite3.connect(...)` 不关闭连接**（只提交/回滚事务）→ 句柄泄漏，Windows 上备份文件无法删除/覆盖。必须 `contextlib.closing(...)`。

## 7. 必须遵守的工程规则（踩坑总结）
- **改排版/导出后必须渲染出来看**：单测测不出视觉缺陷（曾"题号连续"通过但导出件双重题号）。
- **验证「修复类改动」要用反证**；**对照实验必须用当前代码新导出的产物**。
- **判定「公式可编辑」必须实际改字符→保存→重开→比对**，不能用「有 OMML 节点」代替。
- **写入类验证必须用副本**（含**验证脚本自己**——曾直接改到源文件导致误判）；改交付库前必须备份 + `verify_backup(原库, 备份)`（**参数顺序：原库在前**）。
- **放宽判定条件时须构造反方向反例**；**「唯一候选才写」防不住"唯一但错误"**。
- **指标必须用 SQL 核实真实含义**；**时间承诺必须与实测相符**；性能优化必须验证结果集逐条一致。
- 不确定行为先写探针（`spike/`）。`.bat` 必须 **CRLF**。
- 测试必须用 venv：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（裸 `python` 会跑成 215 项/20 errors）。
- ⚠️ **`TestClient(app)` 默认 `raise_server_exceptions=True`**，会把经通用 `Exception` 处理器映射的异常**重新抛出**；要断言 4xx 必须用 `TestClient(app, raise_server_exceptions=False)`。
- ⚠️ **"临时文件"的判断不能只看名字**：上传的 DOCX 是**长期依赖**（来源核验凭据）。这类问题**只有跑完整业务链路才会暴露**。
- ⚠️ **判断"某链路是否已切换"不能只看产物表面特征**：桥接后处理会掩盖缺陷使两引擎产物趋同。可靠判据=**依赖缺失时是否仍能工作** + 产物部件构成。
- 🔴 **验证条件必须与真实使用条件一致**（本项目实证）：打包版「从 shell 启动全绿」，
  但**用户双击即崩**——`console=False` 的 exe 是 `WINDOWS_GUI` 子系统，**不分配控制台**，
  `sys.stdout` 为 `None`，uvicorn 配日志 `sys.stdout.isatty()` 直接崩。
  从 shell 启动会**继承有效句柄**，于是双击路径完全没被覆盖。
  **「能启动」≠「用户那样启动也能启动」**；打包类改动**必须**跑 `spike/acceptance/verify_portable_detached.py`
  （`DETACHED_PROCESS` + **不传任何 std 参数**）。
  ⚠️ 构造该反例时**别传 `stdout=DEVNULL`**——那等于给了有效句柄，反证会假失败。
  **"模拟条件"本身也要被验证**。
- 🔴 **视觉验证必须用真实数据**（2026-10-13 实证）：`shoot_ui.py` 早期用**独立空库**起服务，
  于是所有截图都是「题库为空」的引导态——**题干/公式/图片/题目卡片一个都没验证过**，等于没验证。
  现在复制真实交付库到临时数据根（`QB_DB_PATH` 指向副本），源 DOCX 只读。
  **「页面能渲染」≠「有数据的页面能渲染」**。
- 🔴 **截图脚本 `goto` 只改 hash 不会重载文档** → React 状态（侧栏折叠分组）**跨页泄漏**，
  拍出的不是「直接打开该页」的样子。必须带递增 query 强制真实导航。
- 🔴 **组件级 `sx` 优先级高于主题 `styleOverrides`**（2026-10-13 实证）：筛选栏碎片化在主题层
  改过、并「基于设计原则」宣布已修复，但 `FilterSidebar` 把边框写在**每个** Accordion 上，
  把主题修复**整个盖掉**，实际没生效。**只改主题层就下结论 = 错误结论**；
  改主题必须连带搜一遍组件里有没有同名样式覆盖。
- ⚠️ **逐元素溢出检测必须排除不可见元素**：关闭态的右侧滑出面板停在 `translateX(100%)`，
  天然「右边界越界」，不排除就每页稳定报 21 个假阳性、把真实信号淹掉。
  判据用 `document.scrollWidth > clientWidth`，逐元素取样只用于定位。
- 🔴 **测试不得依赖人去点对话框**（2026-10-13 实证）：`portable_main._fatal()` 调
  `ctypes.windll.user32.MessageBoxW(...)`（**阻塞式模态弹窗**），而
  `test_portable_startup.py::TestFatalShowsSomething` **没打桩** → 整条后端套件**卡死 11 分钟无进展**
  （正常 1 分 42 秒），并在桌面留下一个没人点的对话框。
  **该用例过去是「靠有人恰好点掉弹窗」才通过的**。修法：打桩 + 断言弹窗内容（0.008s 通过）。
  ⚠️ **套件变慢/卡住要先有界 verbose 定位到具体哪一条，别先猜原因**（我先后猜错两次）。
- ⚠️ **重建打包产物与跑测试不要并行**：`dist/题库/` 是部分测试的依赖（`grep portable tests/` 可见），
  重建期间跑测试会得到无意义的失败。
- 🔴 **门禁必须能被反证触发，并固化为测试**（2026-10-13 实证）：
  新增的「硬编码颜色扫描」在启用当天就抓出**人工 grep 漏掉的一处**
  （`bgcolor: 'rgba(255,255,255,.75)'`——只找 `#hex` 的 grep 看不到 `rgba(`）。
  **人工清点会漏，规则不会**；且门禁自身要有测试（注入缺陷→报错、豁免无理由→报错）。

## 8. 版本拆分（editions）与鉴权
- **一个内核 + 多个外壳**：`bank/` `pipeline/` `webui/` `frontend/` 共享，差异收敛到 `webui/edition.py`（`QB_EDITION`/`QB_HOST`/`QB_PORT`/`QB_AUTH_TOKEN`）。
- `editions/local/`：`启动题库.bat`（源码版）、`portable_main.py`（打包入口）。
- **鉴权库独立**：`outputs/webui/auth.db`，**绝不往交付库 `bank.db` 加表**。角色 viewer/editor/admin。
  ⚠️ **仅 `QB_EDITION=online` 且库中有用户时才启用**，否则单机全权。
  ⚠️ **fail-closed**：`auth.db` 不可读 → 503（50301/50302），**绝不回落为"无鉴权"**。
  ⚠️ **`/api/auth/me` 豁免 + 恒返回 200**（令牌失效也 200、只是 `user:null`）→ **不能用它判断会话有效性**，以受保护端点的 401 为准。
  ⚠️ 令牌在 `api/client.ts` **全局自动附加**（逐个函数传 header 必漏）；`useAuth` 缺 Provider **必须抛错**。

## 9. 前端
- Vite 5 + React 18 + TS + **MUI 5**（**Tailwind 已彻底移除**）。设计 token 单一来源 `src/theme.ts`；术语唯一来源 `lib/glossary.ts`；路由元数据（标题/面包屑/限宽）唯一来源 `lib/routeMeta.ts`；四态组件 `LoadingState`/`EmptyState`/`ErrorState`/`ProgressStages`。
- **页面骨架组件（必须复用，别手写标题/面包屑/分区卡片）**：`PageHeader`（`level="page"`→h5/`<h1>`；`level="section"`→h6/`<h2>`，且 **section 默认不派生面包屑**——父页已给过，否则出现两条重复）、`BreadcrumbBar`、`SectionCard`（`variant="card"|"plain"`）、`SlideOver`（右侧滑出，破坏性确认仍用 `ConfirmDialog`）、`CommandPalette`（⌘K）。
- ⚠️ **内容限宽由 `App.tsx` 按路由统一处理**（设置/导入 1100、详情 1200、工具类全宽），页面内**不要**再自己加 `maxWidth`。
- ⚠️ `vitest` 必须 **2.x**（5.x 与 vite 5 冲突 ERESOLVE）；include 限定 `tests/unit/**`；jsdom 需补 `matchMedia`/`ResizeObserver`/`IntersectionObserver`/`document.fonts`/`Element.scrollIntoView` 桩。
- ⚠️ `Suspense` 放 `Outlet` 外层；CSS 不参与 vendor 分包；构建产物清理按 `build.manifest` 判定（按"是否被 index.html 引用"会误删懒加载 chunk）。
- ⚠️ **对比度 65/65 达 WCAG AA**，门禁接入 `npm run build`（`scripts/check-contrast.mjs`）。
- ⚠️ **MUI 坑**：`sx` 里 `width`/`height` **不要写数字**（`width:1` 被当 spacing 乘数 → `1366px` 横向溢出，须写 `'1px'`）；`<Drawer>` 顶部内容会被固定 AppBar 遮挡，需 `<Toolbar variant="dense"/>` 占位；`Button` 键盘焦点不可见根因是 `disableElevation`+`ButtonBase outline:0`，已在 `theme.ts` 补焦点环；`subtitle1/2` 默认渲染 `<h6>` 是标题跳级根源；`Drawer` **不设 `role`**（要显式把 `role="dialog"`+`aria-labelledby` 放 `PaperProps`）；`Tabs` 项多时窄屏会撑破布局，须 `variant="scrollable"`。
- ⚠️ **视觉回归不要用 `sha256` 判断基线是否被换过**（同代码两次采集字节不完全一致），一律以**像素阈值**为准。
- **视觉验证工具**：`spike/acceptance/shoot_ui.py`（Playwright 驱动本机 Chrome，**零下载**；真实库副本；`--dark` 深色；桌面 1440 + 移动 390；横向溢出检测）。

## 10. 当前基线与常用命令
- 后端 **543 项**（540 通过 / 2 既有失败 / 1 skip）。**2 个既有失败**：`test_edition.TestAuthMiddleware`（500≠200，环境相关，已反证与近期改动无关）。
- 前端：tsc 0 错误；vitest **44 文件 / 339 测试**全过；对比度 65/65。
- 截图验收：浅色/深色各 20 页，**横向溢出 0/20**。打包版 `verify_portable_detached.py` 7/7。
- 打包产物 `dist/题库/`：**65.5 MB**（含 cryptography 的 Rust 扩展 9.4MB + Python 运行时）。
  **判断产物新鲜度的可靠方法**：比对 `dist/题库/_internal/webui/static/assets/index-*.js` 的 hash 与源码侧是否一致。
  ⚠️ **重新打包前必须结束占用 `dist/题库` 的进程**（`netstat -ano | grep :8720`），
  否则 `mv`/`rm` 报「资源被占用」、PyInstaller `--clean` 被沙箱删除守卫拦截 → **静默打包失败、旧 exe 不被替换**。
- `outputs/bank.db` sha256 `6905955734953c6c…`（64,815,104B）。**导出是只读操作**，导出后 hash/mtime 不变。
  ⚠️ 本 worktree 的 `outputs/bank.db` 是 **0 字节占位**（真库在 `D:/Open-source project/Localtopic-management/outputs/bank.db`）。
- API：统一 `{code,data,message}`。服务地址 `http://127.0.0.1:8720`（仅本机）。
- 命令：`python -m webui`（启动）；`python -m unittest discover -s tests`（全量）；
  `python -m bank.cli {init,import,stats,search,paper,backup,restore,...}`。

## 11. 🔴 仓库拓扑：本仓库有**两条已分叉的线**（2026-10-13 查清）

| | `main` | 本线 `workbuddy/main-14dd9452` |
|---|---|---|
| worktree | `D:/Open-source project/Localtopic-management` | `C:/Users/SOAP/WorkBuddy/Worktrees/Localtopic-management/main-14dd9452` |
| 前端结构 | `AnimatedList` / `listMotion.ts` / `questionText.ts` / `routeTransitions.css` | `PageHeader` / `BreadcrumbBar` / `SectionCard` / `SlideOver` / `CommandPalette` / `routeMeta.ts` |
| 入口 chunk | 21,832 B | **45,770 B** |
| 首屏 JS / 请求数 | 1,058,331 B / 15 | **765,086 B / 6** |
| 对比度配对 | 77 组 | **65 组** |
| 前端测试 | 26 node:test + 340 vitest | 2 node:test 文件 + **341 vitest** |
| 后端测试 | 436 | **543** |

- merge-base `f3455f6`；`main` 独有 **40** 提交 / 本线独有 **28** 提交；`frontend/src` 差 **46 文件 / +5471 −1524**。
- **两份设计文档（`UI设计评审与优化方案-2026-10-13.md`、`设计语言与人机交互规范-2026-10-13.md`）
  只在 `main` 上**，其评审基线是 `main@f9ae867`。
- ⚠️ **引用外部文档前必须先确认它在哪条线、基线是哪个提交**——否则会拿 `main` 的结论去改本线的代码。
- 本线任务表：`deliverables/任务表-设计落地-本线校准-2026-10-13.md`（T01–T21 + R01–R12）。
- 🔴 **规范与本线实现的 6 处冲突**（§2.2 字重 600/700、§2.4 按钮胶囊 999 vs radius.md=8、
  §2.4 radius.lg=10 vs 本线 12/16/24、§4.1 阅读型 720 vs 本线 1200、§2.1 硬编码色 6 处、§4.4 入口 ≤30KB）
  —— **均为"需拍板"项，未定之前不要单方面按任一方改**。

## 12. 已知未做 / 遗留风险
- **🔴 MathType 路径在打包后未实证（最大未知数）**：`pipeline/mtef_conv.py` 用 `multiprocessing` spawn，已按标准加 `freeze_support()`，但**本项目没有 MathType OLE 真实样例**，冻结后该分支**未端到端跑过**。源试卷约 80% 含 MathType。
- 未做真实浏览器 UI 端到端（前端交互由 vitest 覆盖，后端由 HTTP 层覆盖）。
- 未做代码签名（SmartScreen 会提示"未知发布者"）；`console=False` 首启无日志。
- 未做错误监控 / 备份 SOP；`\begin{array}` 1 条公式桥接不支持（降级+告警）。
- 团队多人口径仍未就绪（鉴权仅访问控制级；桥接单实例串行）。
- 读屏实测仅 NVDA（`deliverables/读屏实测报告-2026-10-11.md`：6 通过/1 部分/1 未捕获），**不等于完整 WCAG 合规**。
