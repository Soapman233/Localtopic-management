# 项目目标与约束

- 用户希望参照学科网，为约10名不同学科教育工作者建设题目管理、组卷与随时导出的应用；需求背景为本地教育知识库，尤其关注DOCX内容与排版保真。
- 当前仍在真实资料诊断与可行性验证阶段，未授权正式应用开发、开通后端或部署。用户明确要求异地访问、导出公式必须可编辑；公式图片不能作为达标回退。
- **验收环境已明确：统一使用 WPS（版本不一定一致），且需同时兼容 Microsoft Word**。本机 WPS 12.1.0.28505 与 Word 16.0.20326 均已实测。团队共享授权与部署选择仍待确认。
- 首批真实素材仅物理，来源为 `C:\Users\SOAP\Desktop\物理\初中\2026学科网教案` 与 `D:\Open-source project\Localtopic-management\2026_10_05_西附国庆练习卷`。初盘589个文件，后续读取时增至748个（567 DOCX、14 PDF）；源目录在变化，统计需标注时间与范围。未展开ZIP、未去重，不等于题目数。源文件只读保留，未授权上传。先以物理验证，不能据此宣称其他学科已兼容。
- 参考对话：https://chat.deepseek.com/share/bmwbcfzgsrs2aau0d7 。
- **30题三路径验证已完成（2026-10-06）**：A 原生 OMML 10/10 通过；B 旧式 OLE **0/10 通过**（通用另存不转换，`OMaths.Add` 只生成空公式占位，本机未装 MathType）；C 扫描 PDF 重建 9/10（视觉识别+人工校准，非全自动 OCR）。约 80% 的 DOCX 含旧式公式对象，是首要阻塞项。交付物见 `outputs/公式可编辑验证报告-30题.md`。
- **两条已实测的硬规则**：① 公式中的中文必须写成 `\text{额}` 形式，否则渲染为乱码；② 判定“公式可编辑”必须实际改公式内部字符→保存→重开→比对，不能用“有 OMML 节点”或“能打印”代替。
- **跨客户端结论（2026-10-06）**：原生公式 OMML 在 Microsoft Word 与 WPS 上均 10/10 可编辑；MathType 对象（`Equation.DSMT4`）在两端均不可编辑（本机未装 MathType）。**OMML 是唯一不依赖第三方软件、双端可编辑的格式。**
- **学科网技术路线考证**：直接检查用户下载文件确认学科网 Word 导出**压倒性使用 MathType**（学科网目录 `Equation.DSMT4` 11,845 个，99/209 份文件无原生公式）。建议**复现其架构（文本存储 + 导出时渲染）但不复现其输出格式**——渲染目标用 OMML，避免商业授权依赖并满足双端兼容。
- **保持 MathType 对象可行且无损（2026-10-06 实测）**：980 个对象往返后嵌入数据逐字节一致、预览图全保留、显示正常、零转换成本；代价是**编辑必须装 MathType**（本机未装，Word/WPS 中均不可编辑；模拟双击时客户端挂起）。**推荐架构：原件原样归档 + 题库存 LaTeX 文本 + 导出时按需渲染成 MathType 或 OMML**（即学科网架构）。「MathType → LaTeX」这一步无论哪条路线都绕不开。
- **旧式公式阻塞已解除（2026-10-06 关键突破）**：用户确认**无 MathType 授权**。实测用开源 **mtef-py**（Apache-2.0，零依赖）解析 OLE 内 `Equation Native` 流（MTEF 二进制）→ LaTeX，**精确解码非 OCR，成功率 99.69%**（977/980，耗时 0.21 秒）；再 LaTeX → OMML 后 **Word 与 WPS 中均渲染为原生可编辑公式（8/8）**。**不需要购买 MathType。** 唯一仍需人工介入的只剩扫描 PDF。
- **转换踩坑（必记）**：MTEF 输出中文为 `{\text{[U+6d6e]}}`，替换**必须在已有 `\text{}` 内部**；套成 `\text{\text{浮}}` 会导致渲染器报 `ToCommands returned empty`。另需去掉公式开头的 `~` 占位符。另：必须先取出 OLE 容器内的 `Equation Native` 流再解析——直接传整个 .bin 会**静默返回空**而非报错。
- **阶段1 预处理管线已实现并全量验证（2026-10-06）**：项目 `pipeline/` 包（omml/mtef_conv/docx_scan/segment/stage1 + vendor/mtef_py）。**全量 209 份文件：209/209 成功、9,765 题、18,131 公式、转换率 98.91%、65 秒**。**格式覆盖率关键修正**：旧式对象至少三种互不兼容格式，`Equation.DSMT4`(MathType) 占 98.48% 且实测转换率 99.93%；`Equation.KSEE3`(WPS公式3.0) 0.90% 与 `Equation.3`(微软旧公式编辑器) 0.16% **不支持**，`DSEquations` 0.45% 未验证 → 约 1.06% 需人工处理。
- **管线三个必记陷阱**：① 必须先取出 OLE 容器内的 `Equation Native` 流再解析，直接传整个 .bin 会**静默返回空**；② `Equation.KSEE3` 会让解析器**死循环**（不是报错），必须按 ProgID 预判跳过；③ 进程 spawn 约 0.43 秒/次，务必用**流式单进程 + 逐条回报**（卡住即重启续跑），不要分块新建进程池。
- **阶段2 题库数据模型已完成并通过两轮独立验证（2026-10-06）**：`bank/` 包（SQLite 11 表 + FTS5）、幂等导入、中文检索、题目版本与组卷快照、待复核队列、CLI；`tests/` 35 项通过。最终库：**题目 7945、公式 17771（OK 17575）、图片 7102、待复核 196**。中文检索用 **bigram + FTS5 + bm25**（不用 trigram，两字词会失效）。
- **元数据真实覆盖率（补全前，保留作对照）**：subject/stage 100%（源自路径）、chapter 20.9%、grade 11.0%、textbook 10.9%、qtype 已分类 70.0%、difficulty 0%（源数据无标注）。
- **元数据补全已完成（2026-10-06）**：题库侧新增 `bank/enrich.py` + `cli enrich`，迁移加 provenance 列；覆盖率 grade 21.1%、textbook 18.7%、chapter 35.4%、**difficulty 0%（源数据无标注，刻意不编造）**、知识点 97.2%。交付物侧 `outputs/metadata/asset_manifest.json/md`（43 条）+ 38 个文件内嵌元数据块（author 全「待补充」、version 0.1.0）。备份 `outputs/bank.backup-20261006-191013.db`（迁移前，合格回滚点）。
- **两条必须记住的指标口径**：① **知识点是「提及」口径不是「考查」**——`term in text` 匹配，平均 4.26 标签/题、泛词命中量大（压强 2378/重力 1849/质量 1480 题），只能作检索辅助，**不能当考查范围筛选**；② **难度字段全空**，需教研组人工标注，任何自动推断都会误导。
- **`verify_backup(original, backup)` 参数顺序是「原库在前、备份在后」**，传反会得出错误结论（我踩过）。判定为三条件：`structure_ok` + `integrity_ok` + `core_nonempty`（核心表 source_files/questions/formulas/images 行数 > 0）；核心表被清空必须判不合格。
- **多轮 QA 抓到的真实教训（务必复用）**：① 版头判定 `looks_like_header` 若对全篇生效会**误删含「学校」的真题**（如「清华大学校园内」），必须收窄作用域到首个真题之前；② **交付产物可能早于代码修改时间**，DB 会从旧数据导入——必须比对时间戳并重生成；③ 指标容易被汇报成「齐全/高覆盖」，**必须用 SQL 或 trace 核实真实含义**（如知识点「提及」被当成「考查」）；④ 放宽判定条件修一个方向时，**必须同时构造反方向的反例**（verify_backup 从「误判好备份」修好后，又出现「误判空壳备份为合格」）；⑤ **「唯一候选才写」防得住"多候选"，防不住"唯一但错误"**——守卫的前提是"候选本身可靠"（答案抽取的题号路径：编号看似唯一但语义不可靠）；⑥ **单元测试测不出视觉缺陷**——「题号连续 1-10」通过了，但导出件里同时出现试卷题号和原卷题号（双重题号），必须**渲染出来看**才能发现。
- **阶段3 组卷已完成（2026-10-06）**：`bank/paper.py`（试卷 CRUD、加题、重排、分值、大题分组、导出 payload）。**快照锁定靠 `snapshot_json`**（加题时把 text+formulas+images+source 全量拷入），改题 v1→v2 后已出卷仍取 v1 的原公式原图，**公式与图片也被锁定**。
- **答案/解析抽取已完成（2026-10-06）**：`bank/answers.py`。有答案 3,973、有解析 4,639（inline 3,090 / paired_file 1,739）。**刻意排除裸「参考答案」标记**——实测它们是整卷答案表，逐题用会错配。曾出现 1 处答案错配（id=2919）已修：根因是「题号路径盲信答案版编号」+「幂等守卫失效（同轮内读到旧行重复写入）」，修复为题号路径必须前缀佐证。
- **阶段4 导出已完成（2026-10-07，经两轮 QA 验证）**：`bank/export.py`。**三条硬性要求达标**：公式为原生 OMML（`word/embeddings=0`，非图片冒充）、**Word 与 WPS 双端可编辑**（改字符→保存→重开保留）、支持学生版/答案解析版。测试 130→**172 项**。
  - **关键兼容性坑**：桥接 `doc_insert_image` 生成的 `<a:graphicData>` **缺 `uri` 属性**，**WPS 容忍但 Word 报错打不开**——只在 WPS 里测会漏掉这个致命问题。
  - **`\Delta` 显示成 `&Delta;` 是系统性根因**：桥接对一批符号命令输出 HTML 实体名（78 个命令扫描确认），需对 `<m:t>` 做实体还原。
  - **导出已改为真正只读**（`db.connect_readonly()` + `schema_ready`），完整导出后 `bank.db` hash/mtime 未变。
  - **题号剥离保险**：行首数字必须等于快照原题号才剥离，避免误删 `3．14` 这类正文数字。

## 导出控制字符（2026-10-11，🔴 级，务必记住）
- **桥接两个插入工具对 TAB 的容忍度不同**：`doc_insert_text` **在段首/段中/段尾任意位置都拒绝** TAB（`code=9`）、垂直制表 `code=11`；而 `doc_insert_paragraph_with_text` **接受**。只测一条路径会漏掉致命问题。
- 真实故障：`A．⟦F66⟧，⟦F67⟧\tB．` 这类「占位符后紧跟 TAB」切段后产生**以 TAB 开头的文本段**，直送 `doc_insert_text` 即失败，**整卷导出中断**。波及：文本含 TAB **1,393 题**、必失败 **89 题**、交付样例卷 #1 命中 2 题。
- 修复：`bank/export.py::bridge_safe_text()` 把 `\t` 换哨兵 `BRIDGE_TAB_SENTINEL`（`U+E000`，实测桥接可接受且原样落盘）、剔除其余控制字符；`_set_explicit_tab_stops()` 在 OOXML 层还原为**真正的 `<w:tab/>`** 并补制表位停靠点。**哨兵残留必须为 0**（漏做后处理会显示豆腐块）。
- **`text_to_lines` 的 docstring 曾谎称「`\t` 转 4 空格」**——不要相信 docstring，要看代码。
- 选项标签判定（`is_option_label_segments`）**不能用「整段全是纯文本」**：真实选项行含行内公式，须用「可见文本」判定。
- **构建漂移**：实现者构建后若源码又改动，其报告里的产物 hash 即失效，**以当前源码重建为准**。
- `embed_metadata.py::insert_html` 曾按大写 `<!DOCTYPE html>` 查找，Vite 产物是小写 → 已改大小写不敏感，并**跳过 `webui/static/` 构建产物**。
- `webui/static/assets` 因 `emptyOutDir:false` 堆积旧 hash 入口包 → `frontend/scripts/prune-stale-assets.mjs` 已接入 `npm run build`。

## 本轮基线（2026-10-11）
- 后端 **360 项（359 通过 / 1 skip）**；前端 **26 项**；tsc exit 0；build 成功。
- `outputs/bank.db` sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（64,815,104B）。
- API：**43 路径 / 49 操作**。资产清单 **164 条**。
- 导出门禁 revision：`export-content-p0-v5`；布局 revision：`export-layout-p0-v4`。
- 测试必须用 venv：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（裸 `python` 会跑成 215 项 / 20 errors）。
- 测试基数：后端 **373 项（372 通过 / 1 skip）**、前端 **26 项**（截至 2026-10-11）。

### 上线就绪度（2026-10-11 评估，勿重复踩）
- **两种口径结论不同**：单人本地基本就绪（差 Git 凭据、`启动题库.bat` 硬编码 venv 路径不可移植、首启需手动 init+导入且 `bank.db` 62MB 不分发）；**10 人团队口径远未就绪**——缺权限体系（`webui/` 零认证代码）、缺局域网/异地（只绑 `127.0.0.1`，`webui/config.py:53`）、桥接**必须串行**（并发 `WinError 10048`）、数据分发未定义。
- ⚠️ **元数据「100%」是占位符假象**：`difficulty` 全为「未标注」（有效 0%）；`grade` 有效 44/209=21%、`textbook` 39/209=19%、`chapter` 53/209=25%；答案 50%、解析 58%。**统计覆盖率必须排除「未标注/待补充」取值**，否则会误判为「齐全」。
- 其余：前端单 chunk 1058kB 无分割、无错误监控、无备份 SOP、`\begin{array}` 1 条公式桥接不支持（降级+告警）。
- 评估文档：`deliverables/上线就绪度评估-2026-10-11.md`。

### 版本拆分（editions，2026-10-11）
- **架构：一个内核 + 两个版本外壳**。`bank/` `pipeline/` `webui/` `frontend/` 共享，业务代码零分叉；
  差异全部收敛到 `webui/edition.py`（`QB_EDITION` / `QB_HOST` / `QB_PORT` / `QB_AUTH_TOKEN`）。
- `QB_AUTH_TOKEN` **不设置 = 不启用鉴权**，与历史行为完全一致（既有测试零改动通过）。
- **线上版硬约束**：导出依赖 editor_sdk+Office（Windows 专有）→ 线上版必须 Windows 宿主；
  桥接单实例 → 并发导出 `WinError 10048`；鉴权仅访问控制级，无用户/角色。
- 启动器：`editions/local/启动题库.bat`（可移植，`BANK_PY` > `.venv` > `PATH`）；根目录旧脚本已删。
- 测试基数：后端 **387 项（386 通过 / 1 skip）**、前端 26 项。资产清单 168 条。

### 前端重构准备（2026-10-11）
- **技能市场工具 `search_and_install_skills` 返回 404 不可用**；改用 SkillHub API
  （`https://lightmake.site/api/v1/search?q=...`，见 `find-skills` 技能）检索下载。
  已装（用户级）：`ui-design`、`web-accessibility`、`ux-usability-auditor`、`ui-ux-pro-max`。
- **npm 素材库踩坑**：`vitest` 必须用 **2.x**（5.x 要求 vite≥6，与本项目 vite 5 冲突 ERESOLVE）。
- 前端分析结论（`deliverables/前端完整分析与重构方案-2026-10-11.md`）：
  **Tailwind 是挂名依赖（0 工具类使用，建议移除）**；**测试基座是最大风险**
  （26 项为源码字符串断言，重构即失效，须先建 vitest 组件测试）；5 项 P0 可用性问题。
  重构分 6 阶段（护栏先行 → 术语/IA → 设计系统 → 主流程 → 两版适配 → 性能/a11y），**不推倒技术栈**。

### 前端重构 · 阶段 0「护栏先行」（2026-10-11 完成）
- **测试基座**：`frontend/vitest.config.ts` + `tests/unit/`（jsdom + Testing Library）。
  `npm test` = `node --test`(26) + `vitest run`(49) = **75 项**。
  ⚠️ **`vitest` 必须 2.x**（5.x 要 vite≥6，与本项目 vite 5 冲突 ERESOLVE）；
  ⚠️ `vitest.config.ts` 的 `include` **必须限定** `tests/unit/**`，否则会收集 `tests/*.test.cjs`（node:test 语法）而报错；
  ⚠️ jsdom 缺 `matchMedia`/`ResizeObserver`/`IntersectionObserver`/`document.fonts`，setup 里必须补桩。
- **错误边界**：`components/ErrorBoundary.tsx`（react-error-boundary v6），顶层（main.tsx）+ 页面级（App.tsx 包 `Outlet`，`resetKeys=[location.pathname]`）。
- **反馈底座**：`lib/feedback.ts`（`useNotify()` + 全局 `notify`）+ `components/NotifierBridge.tsx`；
  消费方：SearchPage 加入失败、`MutationCache.onError`（仅无本地 onError 的 mutation）。
  ⚠️ **notistack 容器懒渲染**：无提示时 `.notistack-SnackbarContainer` 不在 DOM，别用它做断言。
- **契约**：`api/errors.ts` + `api/queryKeys.ts`；**11 个文件内联 queryKey 全量迁移，残留 0**。
- **`webui/config.py` 支持 `QB_DB_PATH` / `QB_EXPORT_DIR`**（此前 `.env.example` 承诺但未实现）。
- 验证：后端 387 / 前端 75 / tsc 0 / build 成功 / 浏览器冒烟 7/7 / toast 端到端 5/5（零写入）/ 反证成立。
- 文档：`deliverables/前端重构阶段0-护栏先行-2026-10-11.md`。

### 前端重构 · 阶段 1「术语与信息架构」（2026-10-11 完成）
- **术语映射唯一来源**：`frontend/src/lib/glossary.ts`（`GLOSSARY` + `describe*` 函数 + `isDebugMode()`）。
  **原始技术字段默认不渲染**，仅 `?debug=1` 或 `localStorage.qb_debug=1` 下显示（折叠区「给技术人员的信息」）。
  ⚠️ 改术语口径时**必须同步 `tests/preview-and-theme.test.cjs`**（旧断言与新口径冲突）。
- **导航**：`NAV_GROUPS`（日常备课 / 数据治理）+ 底部 `SETTINGS_ITEM`；治理页 `/manage/*`；
  **默认落地 `/builder`**；**旧链接重定向 `LEGACY_REDIRECTS` 必须注册在 `*` 通配之前**。
- **难度死功能**：`FilterSidebar.dimensionUsable()` 通用判定（items 为空即「暂不可用」+ 折叠 + 说明）；
  `CoverageBanner` 覆盖率 0 显示「未标注（N 题）」而非「0%」。
- 测试基数：后端 387、前端 **109**（26 node:test + 83 vitest）。
- **1366×768 截图基线**在 `.tmp_verify/baseline-1366x768/`（已 gitignore，未入库；阶段 2 视觉回归前需定存放/比对方式）。
- 文档：`deliverables/前端重构阶段1-术语与信息架构-2026-10-11.md`。

### 前端重构 · 阶段 2「设计系统统一」（2026-10-11 完成）
- **Tailwind 已彻底移除**（全库 0 处工具类使用）：删配置与依赖、清 `@tailwind` 指令；
  ⚠️ **必须保留 `autoprefixer`**（否则 CSS 产出变化，视觉回归失去基准）。CSS 产物 −8.8%，`--tw-` 118→0。
- **设计 token 单一来源** `src/theme.ts`（难度色/徽章色/间距/圆角/字号/阴影），挂到 `palette.difficulty`、
  `palette.badge`、`theme.designTokens`。⚠️ **刻意不覆写 MUI `typography` 字号与 `theme.spacing`**（会改字面量→真实 CSS 差异）。
- **四态规范组件**：`LoadingState` / `EmptyState` / `ErrorState` / `ProgressStages`；
  规范：首屏→LoadingState、空→EmptyState、错→ErrorState（走 `describeApiError`）、长任务→ProgressStages、
  **横幅类 Alert 不动**。
- 测试基数：后端 387、前端 **123**（26 node:test + 97 vitest）。
- **视觉回归工具** `.tmp_verify/compare_baseline.py`（像素比对 + 热力图 + 度量自校验）。
  ⚠️ **视觉基线未入版本库**（`.tmp_verify/baseline-1366x768/`，gitignore）；阶段 3 前需定基线机制。
- 文档：`deliverables/前端重构阶段2-设计系统统一-2026-10-11.md`。

### 前端重构 · 阶段 3「主流程重构」+ 遗留清算（2026-10-11 完成）
- **断点**：`PaperBuilderPage` 用 `theme.breakpoints.down('lg')`（<1200 折叠右栏）。实测题卡宽
  **1366→338 / 1280→281 / 1440→386 / 1920→716**；1366 下排版预览默认可见。
- **门禁**：表达层重写（三态文案同源、锁定态直接给「生成预览」按钮、解释「刷新即锁」）；
  ⚠️ **语义零改动**——`uiStore.ts` 不动、`glossary.ts` 纯新增。
- **🔴 真实缺陷（务必记住）**：**MUI Button 键盘焦点不可见**。根因：`Button.js:114` 默认焦点样式是
  `boxShadow: shadows[6]`，但本项目 `disableElevation: true` 走 `:176` 的 `boxShadow:'none'`，
  叠加 `ButtonBase.js:51` 的 `outline:0`。已在 `theme.ts` 的 `MuiButton.styleOverrides.root` 补 `outline` 焦点环。
- **遗留 L1–L8 全部清算**（`describeEnvFailure` / Chip 中文化 / 键盘 e2e / 导出阶段 / `useJob` 超时 /
  `validateTargetSection` / 页面级集成测试 / 视觉基线机制）。
- **视觉基线机制**：`frontend/tests/visual/`（capture.mjs + compare.py + README + baseline-manifest.json）。
  ⚠️ 基线 PNG **不入库**（派生产物），manifest 记录 sha256 + 接受理由；**更新基线必须先人工看图确认**。
- 测试基数：后端 387、前端 **169**（26 node:test + 143 vitest）。
- ⚠️ 踩坑：MUI focus-visible 由 **React state** 驱动，`blur()` 后必须**等一帧**再采样（否则误报「聚焦无反馈」）。
- 文档：`deliverables/前端重构阶段3-主流程重构-2026-10-11.md`。

### 前端重构 · 阶段 5「性能与无障碍」（2026-10-11 完成）
- **代码分割**：入口 1.12MB → **24KB**，首屏 **−36%**（1,155,129 → 734,606 B）。
  ⚠️ `Suspense` 必须放 **`Outlet` 外层**（放 router 根会让外壳每次懒加载卸载重挂）；
  ⚠️ **CSS 不能参与 vendor 分包**（否则入口会连带预加载 258KB KaTeX JS）。
- **构建产物清理**：代码分割后 js/css 2 → 125 个；旧脚本按「是否被 index.html 引用」会**误删懒加载 chunk**。
  已改用 `build.manifest` 清单判定；只删 `.js`/`.css`、分批删。实测 77 → 27，幂等。
- **对比度**：**65/65 达标 WCAG AA**（浅+深）。主色 `#3370FF`→`#2F63EA`，语义色作文字改深
  （`#15803D`/`#B15008`/`#D32222`），中性灰→`#667085`。
  ⚠️ MUI `getContrastText` 阈值 3:1 → 深色 main 上**误选深色文字**，必须显式 `contrastText`。
  ⚠️ 深色删除按钮压在**恒白纸张**上，须按白底算。
  **门禁已接进 `npm run build`**；校验器 vendored 在 `frontend/scripts/check-contrast.mjs`。
- **无障碍**：skip-link（⚠️ HashRouter 下 `href="#..."` 会改写 hash 触发路由，须拦 onClick）、
  `role=main`、`aria-current`、**5 处 `<Drawer>` 补 `aria-labelledby`**（MUI `Drawer` 不自动派生）、
  标题层级 9/9 页无跳级（MUI `subtitle1/2` 默认渲染 `<h6>`，是跳级根源）。
- 测试基数：后端 387、前端 **204**（26 node:test + 178 vitest）。
- **3 项待用户决策**：深色模式 primary 作文字 3.52:1；`settings.json` 旧主色迁移；
  `tokens.difficulty`/`palette.badge` 零消费方（建议删除，接线会重新引入对比度失败）。
- 文档：`deliverables/前端重构阶段5-性能与无障碍-2026-10-11.md`。

### 阶段 4「两版适配」+ 用户体系（2026-10-11）
- **鉴权库独立**：`outputs/webui/auth.db`，**绝不往交付数据 `bank.db` 里加表**（否则污染交付库 + 改变其 sha256）。
- 后端：`webui/auth.py` + `routers/auth.py` + `tests/test_auth.py`；角色 viewer(read)/editor(read+write)/admin；
  `pbkdf2_hmac`+`compare_digest`（纯标准库）；会话优先 Bearer、兼容 Cookie `qb_session`；
  CLI `python -m webui.auth user add|list|set-password`。
  ⚠️ **仅 `QB_EDITION=online` 且库中有用户时才启用鉴权**，否则单机全权（本地版零影响）。
- 前端：`lib/deployMode.ts`（`VITE_DEPLOY_MODE`，**缺省 local 是安全默认**）、`app/auth/{AuthProvider,RequireAuth}`、
  `pages/LoginPage`、`lib/permissions.ts` + `hooks/usePermission` + `components/Can`、`components/SessionControls`。
- ⚠️ **令牌在 `api/client.ts` 全局自动附加**（逐个 api 函数传 header 必漏）；
  登录接口须传 `skipAuthRedirect`（否则"密码错"会连带跳转、冲掉提示）。
- ⚠️ **`useAuth` 缺 Provider 必须抛错**（静默兜底 = 鉴权被无声绕过）；测试侧补生产同款 Provider。
- ⚠️ `vi.mock('api/client')` 的测试替身需同步新导出（`setAuthToken`/`getAuthToken`/`setUnauthorizedHandler`）。
- 测试基数：后端 **423**、前端 **240**（26 node:test + 214 vitest）。
- **本地版零影响的证据**：视觉回归 8 页 **全部 0.00**（像素级一致）。
- 读屏：**NVDA 2026.2 已装且能启动**，但**语音未捕获**——`%APPDATA%\nvda\addons\` 为空说明插件未真正安装
  （NVDA 只认 `addons/<包名>/` + `manifest.ini`，**缺字段会静默不加载**）。

### 真实读屏（NVDA）实测 —— 已完成（2026-10-11）
- 报告：`deliverables/读屏实测报告-2026-10-11.md`。**方法**：add-on hook
  **`speech.manager.SpeechManager.speak`**（NVDA 所有语音必经的单一漏斗）+ 自检语句证明 hook 生效。
- **结果：6 通过 / 1 部分 / 1 未捕获**。已用真实播报确认：skip-link、主导航地标、`aria-current`、
  main 地标 + h1、`role="alert"` 播报、路由改 `document.title`。
- ⚠️ **NVDA 工程踩坑（复用）**：`nvda.exe` 启动器受**残留单实例互斥量**影响会**静默退出**，
  须用 `nvda_noUIAccess.exe`；`manifest.ini` 的 `description` **含逗号 → 被解析成 list → 静默不加载**；
  中文 argv 经控制台代码页损坏 → 窗口匹配须用 **ASCII 标记**；**捕获依赖浏览器持有 OS 前台**。
- ⚠️ **NVDA 不念「对话框」角色词**（用最小参照 ARIA dialog 对照实验证明与标准行为一致，非项目缺陷）。
- ⚠️ **仍不等于完整 WCAG 合规**；未做 browse mode / VoiceOver / Narrator。

### 两个易踩的 MUI 坑（2026-10-11 实测）
- ⚠️ **`sx` 里的 `width`/`height` 不要写数字**：`width: 1` 会被当 spacing 乘数，
  实测产出 `width: 1366px`（=视口宽）→ 撑出横向溢出。**必须写 `'1px'` 字符串**。
- ⚠️ **`<Drawer>` 顶部内容会被固定 AppBar 遮挡**（项目把 AppBar 的 zIndex 设为 `drawer+1`）：
  需在抽屉内容顶部放 `<Toolbar variant="dense" />` 占位。

### 视觉回归机制修正
- ⚠️ **不要用 `sha256` 判断基线是否被换过**：实测同一代码两次采集字节不完全一致
  （builder 约 40px，mean≤0.0017）。**判定一律以像素阈值（mean_diff / pct_gt32）为准**。

### 鉴权体系安全审计与收口（2026-10-11）
> 报告：`deliverables/gstack/phase4-closeout-auth-2026-10-11.md`
- 🔴 **已修的 3 个 P0**：① **fail-open**（`auth.db` 不可读 → 回落 `off` → 无凭据可读写全站；
  修法：`auth_store_status()` 区分 ok/missing/error，`uninitialized`/`error` **fail-closed 返回 503**
  `50301`/`50302`）；② `/api/auth/me` 未豁免导致**线上版无登录入口**；③ **请求风暴**（登出后 12s 内 7328 次，修后 1~3 次）。
- ⚠️ **契约陷阱**：`/api/auth/me` **豁免 + 恒返回 200**（令牌失效时也 200、只是 `user:null`）
  → **不能用它判断会话有效性**，一律以**受保护端点的 401** 为准。
- ⚠️ **耦合**：`interactions.mjs` 的写路径安全闸门依赖 `GET /api/health` 的 `data.db`；
  线上版不回显该字段 → 闸门**安全 SKIP**。
- ⚠️ **删依赖必须同步 lockfile**：只改 `package.json` 不跑 `npm install` → **`npm ci` 会失败**。
- ⚠️ **`tokens.neutral` 不是零消费方**（`ThemeContrast.test.ts` 在用）；
  difficulty token **接线有害**（鲜艳值作浅底文字 2.28/2.15/3.76:1，且 `contrast-pairs.json` 无该组合 → 门禁抓不到）。
- 测试基数：后端 **436**、前端 **251**（26 node:test + 225 vitest）。

