# 项目记忆 · 私有题库管理系统

> 更新 2026-10-12（已压缩去重）。过程细节见 `.workbuddy-ai/memory/2026-10-*.md`。

## 1. 定位与约束
- 为约 10 名中学教师（首个学科：**初中物理**）建**私有题库**：DOCX 抽题 → 建库检索 → 组卷 → 导出**公式可编辑**试卷 → 本地 Web。参照学科网。
- 验收：统一 WPS + 兼容 Word（本机 WPS 12.1.0.28505 / Word 16.0.20326）。硬要求：异地访问；导出公式必须可编辑，**公式图片不算达标**。
- 素材仅物理，源文件只读、未授权上传；统计须标注时间与范围。
- 参考对话：https://chat.deepseek.com/share/bmwbcfzgsrs2aau0d7

## 2. 公式可编辑路线（已定案）
- 源试卷约 **80% 含旧式 MathType OLE 公式**，是首要阻塞项。
- 三种互不兼容格式：`Equation.DSMT4`(MathType) **98.48%**（可转 99.93%）；`Equation.KSEE3`(WPS公式3.0) 0.90% 与 `Equation.3`(微软旧版) 0.16% **不支持**；`DSEquations` 0.45% 未验证。
- 解法：开源 `mtef-py`(Apache-2.0) 解析 OLE 内 `Equation Native` 流(MTEF) → LaTeX，**精确解码非 OCR**，成功率 **99.69%**（977/980，0.21s）；再 LaTeX → OMML，Word/WPS 双端原生可编辑。**无需 MathType 授权。**
- **OMML 是唯一不依赖第三方软件、双端可编辑的格式**；MathType 对象两端均不可编辑。
- 架构：原件原样归档 + 题库存 LaTeX + 导出时按需渲染（OMML，可选 MathType）。
- 学科网 Word 导出压倒性使用 MathType（其目录 DSMT4 11,845 个）。
- 30 题三路径（`outputs/公式可编辑验证报告-30题.md`）：原生 OMML 10/10；旧式 OLE 0/10；扫描 PDF 重建 9/10（唯一仍需人工校准的环节）。

### 转换踩坑
- 公式中文必须写 `\text{浮}`；MTEF 输出中文为 `{\text{[U+6d6e]}}`，替换**必须在已有 `\text{}` 内部**（套成 `\text{\text{浮}}` 报 `ToCommands returned empty`）。
- 去掉公式开头 `~` 占位符。
- **必须先取出 OLE 容器内 `Equation Native` 流**再解析，直接传整个 .bin 会**静默返回空**。
- `Equation.KSEE3` 会让解析器**死循环** → 按 ProgID 预判跳过。
- 进程 spawn ~0.43s/次 → 流式单进程 + 逐条回报。

## 3. 里程碑与关键数字
- **阶段1** `pipeline/`：209/209 成功、**9,765 题**、18,131 公式、转换率 98.91%、65 秒 → `outputs/preprocess_final/`（**勿重新生成**）。
- **阶段2** `bank/`（SQLite 11 表 + FTS5）：**7,945 题**、17,771 公式（OK 17,575）、7,102 图片、待复核 196。中文检索 **bigram + FTS5 + bm25**（不用 trigram）。
- 元数据 `bank/enrich.py`：grade 21.1%、textbook 18.7%、chapter 35.4%、**difficulty 0%（源无标注，刻意不编造）**、知识点 97.2%。⚠️ 知识点是「**提及**」口径非「考查」（平均 4.26 标签/题），仅作检索辅助；⚠️ 覆盖率**必须排除「未标注/待补充」取值**。
- **阶段3** `bank/paper.py`：快照锁定靠 `snapshot_json`；改题后已出卷仍取原公式原图。
- 答案/解析 `bank/answers.py`：答案 3,973、解析 4,639（inline 3,090 / paired_file 1,739）；刻意排除裸「参考答案」标记。
- **阶段4** `bank/export.py`：原生 OMML（`word/embeddings=0`）、双端可编辑、学生版/答案解析版。

## 4. 工程铁律（踩坑总结）
- 改排版/导出后**必须渲染出来看**（单元测试测不出视觉缺陷）。
- 验证「修复类改动」要用**反证**；对照实验必须用**当前代码新导出**的产物。
- 判定「公式可编辑」必须**实际改字符→保存→重开→比对**。
- 指标必须用 **SQL 核实真实含义**；时间承诺必须与实测相符。
- 放宽判定条件修一个方向时，**必须构造反方向反例**。
- 「唯一候选才写」防得住多候选，防不住**唯一但错误**。
- 交付产物可能早于代码修改时间 → 比对时间戳并重生成。
- 性能优化必须同时验证**结果集逐条一致**；不确定行为先写探针（`spike/`）。
- `.bat` 必须 **CRLF**（LF 会让 cmd 闪退）。
- 测试必须用 venv `C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（裸 `python` 会跑成 215 项/20 errors）。
- 改交付库前必须备份 + `verify_backup(原库, 备份)`（**原库在前**；structure_ok + integrity_ok + core_nonempty）；写入类验证用副本。

### 导出控制字符（🔴）
- `doc_insert_text` 任意位置**拒绝** TAB(9)/垂直制表(11)；`doc_insert_paragraph_with_text` **接受**。真实故障：占位符后紧跟 TAB → 以 TAB 开头的段直送失败 → **整卷导出中断**（波及 1,393 题，必失败 89 题）。
- 修复：`bridge_safe_text()` 把 `\t` 换哨兵 `U+E000`，`_set_explicit_tab_stops()` 在 OOXML 层还原 `<w:tab/>`。**哨兵残留必须为 0**。
- `text_to_lines` docstring 谎称「`\t` 转 4 空格」→ **不要信 docstring**。
- `is_option_label_segments` 须用「可见文本」（真实选项含行内公式）。
- 桥接 `doc_insert_image` 的 `<a:graphicData>` **缺 `uri`** → WPS 容忍但 **Word 打不开**（只在 WPS 测会漏）。
- 桥接对 78 个符号命令输出 HTML 实体名（`\Delta`→`&Delta;`）→ 对 `<m:t>` 做实体还原。
- 导出已真正只读（`db.connect_readonly()` + `schema_ready`），导出后 `bank.db` hash/mtime 不变。
- 题号剥离保险：行首数字必须等于快照原题号才剥离。
- 构建漂移：源码在构建后又改动 → 报告产物 hash 失效，以当前源码重建为准。
- `embed_metadata.py::insert_html` DOCTYPE 查找已大小写不敏感，并跳过 `webui/static/`。
- `frontend/scripts/prune-stale-assets.mjs` 已接入 `npm run build`。

## 5. 版本拆分（editions）
- **一个内核 + 两个外壳**：`bank/` `pipeline/` `webui/` `frontend/` 共享，差异收敛到 `webui/edition.py`（`QB_EDITION`/`QB_HOST`/`QB_PORT`/`QB_AUTH_TOKEN`）。`QB_AUTH_TOKEN` 不设 = 不鉴权。
- 线上版硬约束：导出依赖 editor_sdk+Office（Windows 专有）；桥接单实例 → 并发导出 `WinError 10048`；鉴权仅访问控制级，无用户/角色。
- 启动器 `editions/local/启动题库.bat`（`BANK_PY` > `.venv` > `PATH`）。

## 6. 前端重构（阶段 0/1/2/3/5 已完成）
- ⚠️ `vitest` 必须 **2.x**（5.x 要 vite≥6，冲突 ERESOLVE）；`vitest.config.ts` include 限定 `tests/unit/**`；jsdom 缺 `matchMedia`/`ResizeObserver`/`IntersectionObserver`/`document.fonts`，setup 需补桩。
- 阶段0：ErrorBoundary、`lib/feedback.ts`+NotifierBridge（别用它做断言）、`api/errors.ts`+`api/queryKeys.ts`（残留 0）；`webui/config.py` 支持 `QB_DB_PATH`/`QB_EXPORT_DIR`。
- 阶段1：术语唯一来源 `lib/glossary.ts`（技术字段仅 `?debug=1` 显示）；`NAV_GROUPS`；默认落地 `/builder`；`LEGACY_REDIRECTS` 必须注册在 `*` 之前。⚠️ 改术语须同步 `tests/preview-and-theme.test.cjs`。
- 阶段2：**Tailwind 已彻底移除**；token 单一来源 `src/theme.ts`；四态组件。
- 阶段3：`PaperBuilderPage` 断点 `down('lg')`；🔴 MUI Button 焦点不可见根因（`disableElevation` → `boxShadow:'none'` + `ButtonBase outline:0`）→ `theme.ts` 补 outline 焦点环；视觉基线 `frontend/tests/visual/`。
- 阶段5：代码分割（入口 1.12MB→24KB）；⚠️ `Suspense` 放 `Outlet` 外层；⚠️ CSS 不参与 vendor 分包；产物清理按 `build.manifest` 判定；对比度 65/65 WCAG AA（`frontend/scripts/check-contrast.mjs`）；skip-link 在 HashRouter 下须拦 onClick；MUI `subtitle1/2` 默认渲染 `<h6>` 是标题跳级根源。
- 待决策：深色 primary 作文字 3.52:1；`settings.json` 旧主色迁移；`tokens.difficulty`/`palette.badge` 零消费方。

## 7. 基线与常用命令
- 后端 **436** 项、前端 **251** 项（26 node:test + 225 vitest）；tsc 0；build 成功。
- `outputs/bank.db` sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（64,815,104B）。
- API **43 路径 / 49 操作**；资产清单 168 条；导出门禁 revision `export-content-p0-v5`，布局 `export-layout-p0-v4`。
- 服务 `http://127.0.0.1:8720`（仅本机）；`python -m webui`。

## 8. 阶段4 鉴权 / 两版适配（2026-10-11）
- **鉴权库独立** `outputs/webui/auth.db`，**绝不往 `bank.db` 加表**（否则污染交付库 + 改 sha256）。
- 后端 `webui/auth.py` + `routers/auth.py` + `tests/test_auth.py`；角色 viewer/editor/admin；`pbkdf2_hmac`+`compare_digest`；会话优先 Bearer、兼容 Cookie `qb_session`；CLI `python -m webui.auth user add|list|set-password`。⚠️ **仅 `QB_EDITION=online` 且库中有用户才启用**，否则单机全权。
- 前端 `lib/deployMode.ts`（**缺省 local 是安全默认**）、`app/auth/{AuthProvider,RequireAuth}`、`pages/LoginPage`、`lib/permissions.ts` + `usePermission` + `Can`、`SessionControls`。
- ⚠️ 令牌在 `api/client.ts` **全局自动附加**；登录接口须传 `skipAuthRedirect`。
- ⚠️ `useAuth` 缺 Provider **必须抛错**；`vi.mock('api/client')` 替身需同步 `setAuthToken`/`getAuthToken`/`setUnauthorizedHandler`。
- 本地版零影响证据：视觉回归 8 页全部 **0.00**。

### 鉴权安全审计收口
> 报告：`deliverables/gstack/phase4-closeout-auth-2026-10-11.md`
- 🔴 已修 3 个 P0：① **fail-open**（`auth.db` 不可读 → 回落 off）→ `auth_store_status()` 区分 ok/missing/error，`uninitialized`/`error` **fail-closed 返回 503** `50301`/`50302`；② `/api/auth/me` 未豁免 → **线上版无登录入口**；③ **请求风暴**（登出后 12s 内 7328 次 → 修后 1~3 次）。
- ⚠️ `/api/auth/me` **豁免 + 恒返回 200**（失效也 200、`user:null`）→ **不能用它判断会话有效性**，以受保护端点的 401 为准。
- ⚠️ `interactions.mjs` 写路径闸门依赖 `GET /api/health` 的 `data.db`；线上版不回显 → **安全 SKIP**。
- ⚠️ 删依赖**必须同步 lockfile**（否则 `npm ci` 失败）。
- ⚠️ `tokens.neutral` 不是零消费方（`ThemeContrast.test.ts` 在用）；difficulty token **接线有害**。

### 真实读屏（NVDA）实测（2026-10-11）
- 报告 `deliverables/读屏实测报告-2026-10-11.md`。方法：add-on hook **`speech.manager.SpeechManager.speak`** + 自检语句。
- 结果 **6 通过 / 1 部分 / 1 未捕获**（skip-link、导航地标、`aria-current`、main+h1、`role="alert"`、`document.title` 均已真实播报）。
- ⚠️ 工程踩坑：`nvda.exe` 受残留单实例互斥量影响**静默退出** → 用 `nvda_noUIAccess.exe`；`manifest.ini` 的 `description` **含逗号 → 被解析成 list → 静默不加载**；中文 argv 经控制台代码页损坏 → 窗口匹配用 **ASCII 标记**；捕获依赖浏览器持有 OS 前台。
- ⚠️ NVDA 不念「对话框」角色词（对照实验证明与标准行为一致）；仍**不等于完整 WCAG 合规**。

### 其他实测坑
- ⚠️ MUI `sx` 里 `width`/`height` **不要写数字**（`width: 1` 被当 spacing → 1366px）；必须写 `'1px'`。
- ⚠️ `<Drawer>` 顶部内容会被固定 AppBar 遮挡 → 抽屉内容顶部放 `<Toolbar variant="dense" />`。
- ⚠️ 视觉回归**不要用 sha256** 判断基线被换（同代码两次采集字节不一致）→ 一律用像素阈值（mean_diff / pct_gt32）。
- 上线就绪度：单人本地基本就绪；10 人团队远未就绪（只绑 `127.0.0.1`、桥接串行、数据分发未定义、无监控/备份 SOP）。文档 `deliverables/上线就绪度评估-2026-10-11.md`。

## 9. 仓库与 Git（2026-10-12：误合并已撤销）
- 远程 `git@github.com:Soapman233/Localtopic-management.git`；本地与 `origin/main` 一致于 `e99390b`。
- **误合并已撤销**：`6efac2c`（PR #1）曾把 `workbuddy/main-14dd9452` 的**便携化 / 自研导出**研究线合进 main（60 个文件：`bank/latex2omml.py`、`bank/docx_writer.py`、2 个测试、`tools/md2pdf/`、5 个 `spike/` 目录、29 份文档，并改 `.gitignore` + 2 个 memory 文件）。
  → 2026-10-12 以 `git revert -m 1 6efac2c`（`e99390b`）**整体撤销**，未改写历史；`MEMORY.md` 冲突取 `--ours`（保留压缩版）；`2026-10-11.md` 移除合并带入的 166 行日志。
  验证：`git diff 0ac33aa HEAD` 只剩 gstack 两文档 + 2 个 memory 文件。备份分支 `backup/pre-revert-2026-10-12`（**仅本地**，指向 `338583f`）。
- 该分支 tip `596c25c` **从未合入 main**（12 个提交：导出引擎切 native、DOCX 导入 API、导入试卷页、便携打包等仍留在分支上）。
- worktree：`C:/Users/SOAP/WorkBuddy/Worktrees/Localtopic-management/main-14dd9452`。
- ⚠️ **测试基数口径**：后端 main 自身 **436** 项（撤销前含合并带入的 31 项 = 467）。**基数下降须逐项归因，不能只看数字是否相等。**
- ⚠️ 用户报障时的前提可能是错的：曾称"按本地文件夹清理"，但本地与远程同提交。**先核实前提再动手。**
