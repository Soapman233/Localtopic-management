# 项目记忆 · 私有题库管理系统

> 整理于 2026-10-11。过程细节见 `.workbuddy-ai/memory/2026-10-*.md` 日志。

## 1. 项目定位与约束
- 为约 10 名中学教师（首个学科：**初中物理**）建**私有题库**：DOCX 抽题 → 建库检索 → 组卷 → 导出**公式可编辑**试卷 → 本地 Web 操作。参照学科网。
- **验收环境**：统一 WPS（版本可不一致）+ 兼容 Microsoft Word。本机 WPS 12.1.0.28505 / Word 16.0.20326。
- **硬要求**：异地访问；导出公式必须可编辑，**公式图片不算达标**。
- 首批素材仅物理：`C:\Users\SOAP\Desktop\物理\初中\2026学科网教案`、`D:\Open-source project\Localtopic-management\2026_10_05_西附国庆练习卷`。源文件只读、未授权上传；统计须标注时间与范围（589→748 文件，567 DOCX/14 PDF）。
- 参考对话：https://chat.deepseek.com/share/bmwbcfzgsrs2aau0d7

## 2. 核心结论：公式可编辑路线（已定案）
- 源试卷约 **80% 含旧式 MathType OLE 公式**，是首要阻塞项。
- 旧式对象三种互不兼容格式：`Equation.DSMT4`(MathType) **98.48%**（可转，99.93%）；`Equation.KSEE3`(WPS公式3.0) 0.90% 与 `Equation.3`(微软旧版) 0.16% **不支持**；`DSEquations` 0.45% 未验证。
- **解法**：开源 `mtef-py`(Apache-2.0) 解析 OLE 内 `Equation Native` 流(MTEF) → LaTeX，**精确解码非 OCR**，成功率 **99.69%**（977/980，0.21s）；再 LaTeX → OMML，Word/WPS 双端原生可编辑（8/8）。**无需 MathType 授权。**
- **OMML 是唯一不依赖第三方软件、双端可编辑的格式**；MathType 对象两端均不可编辑。
- **推荐架构**：原件原样归档 + 题库存 LaTeX 文本 + 导出时按需渲染（OMML，可选 MathType）。复现学科网架构但**不复现其输出格式**。
- 学科网 Word 导出**压倒性使用 MathType**（其目录 DSMT4 11,845 个，99/209 文件无原生公式）。
- 30 题三路径验证（`outputs/公式可编辑验证报告-30题.md`）：原生 OMML 10/10；旧式 OLE 0/10（未装 MathType 时）；扫描 PDF 重建 9/10（需人工校准，唯一仍需人工环节）。

### 转换踩坑（必记）
- 公式中文必须写成 `\text{浮}`；MTEF 输出中文为 `{\text{[U+6d6e]}}`，替换**必须在已有 `\text{}` 内部**，套成 `\text{\text{浮}}` 会报 `ToCommands returned empty`。
- 需去掉公式开头 `~` 占位符。
- **必须先取出 OLE 容器内 `Equation Native` 流**再解析，直接传整个 .bin 会**静默返回空**。
- `Equation.KSEE3` 会让解析器**死循环**，必须按 ProgID 预判跳过。
- 进程 spawn ~0.43s/次 → 用**流式单进程 + 逐条回报**（卡住即重启续跑）。

## 3. 里程碑与关键数字
- **阶段1 预处理** `pipeline/`（omml/mtef_conv/docx_scan/segment/stage1 + vendor/mtef_py）：209/209 成功、**9,765 题**、18,131 公式、转换率 98.91%、65 秒。产出 `outputs/preprocess_final/`（**勿重新生成**）。
- **阶段2 题库** `bank/`（SQLite 11 表 + FTS5）：**7945 题**、17771 公式（OK 17575）、7102 图片、待复核 196。中文检索 **bigram + FTS5 + bm25**（不用 trigram，两字词会失效）。
- **元数据补全** `bank/enrich.py`：grade 21.1%、textbook 18.7%、chapter 35.4%、**difficulty 0%（源数据无标注，刻意不编造）**、知识点 97.2%。
  - ⚠️ **知识点是「提及」口径不是「考查」**（`term in text`，平均 4.26 标签/题），只能作检索辅助。
  - ⚠️ 统计覆盖率**必须排除「未标注/待补充」取值**，否则误判为「齐全」。
- **阶段3 组卷** `bank/paper.py`：**快照锁定靠 `snapshot_json`**（加题时拷 text+formulas+images+source）；改题 v1→v2 后已出卷仍取 v1 原公式原图。
- **答案/解析** `bank/answers.py`：答案 3,973、解析 4,639（inline 3,090 / paired_file 1,739）。**刻意排除裸「参考答案」标记**（整卷答案表，逐题用会错配）。
- **阶段4 导出** `bank/export.py`：原生 OMML（`word/embeddings=0`，非图片冒充）、Word+WPS 双端可编辑、学生版/答案解析版。测试 130→172。

## 4. 必须遵守的工程规则（踩坑总结）
- **改排版/导出后必须渲染出来看**：单元测试测不出视觉缺陷（曾出现「题号连续」通过但导出件有双重题号）。
- **验证「修复类改动」要用反证**（确认修复前确实有问题）；**对照实验必须用当前代码新导出的产物**（`outputs/export/` 有历史版本）。
- **判定「公式可编辑」必须实际改公式内部字符→保存→重开→比对**，不能用「有 OMML 节点」或「能打印」代替。
- **指标必须用 SQL 核实真实含义**；给用户的时间承诺必须与实测相符。
- **放宽判定条件修一个方向时，必须构造反方向反例**（verify_backup 从「误判好备份」修好后出现「误判空壳备份为合格」）。
- **「唯一候选才写」防得住"多候选"，防不住"唯一但错误"**——守卫前提是"候选本身可靠"。
- **交付产物可能早于代码修改时间** → 必须比对时间戳并重生成。
- 性能优化必须同时验证结果集逐条一致；不确定行为先写探针（参考 `spike/`）。
- `.bat` 必须 **CRLF** 换行（LF 会让 cmd 闪退）。
- 测试必须用 venv：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（裸 `python` 会跑成 215 项/20 errors）。
- 写入类验证必须用副本；改交付库 `outputs/bank.db` 前必须备份 + `verify_backup(原库, 备份)`（**参数顺序：原库在前、备份在后**；判定 structure_ok + integrity_ok + core_nonempty）。

### 导出控制字符（🔴 级）
- 桥接工具对 TAB 容忍度不同：`doc_insert_text` 任意位置**拒绝** TAB(9)/垂直制表(11)；`doc_insert_paragraph_with_text` **接受**。
- 真实故障：占位符后紧跟 TAB 切段 → 以 TAB 开头的文本段直送 `doc_insert_text` 失败 → **整卷导出中断**。波及含 TAB 1,393 题、必失败 89 题。
- 修复：`bridge_safe_text()` 把 `\t` 换哨兵 `BRIDGE_TAB_SENTINEL`(`U+E000`)，`_set_explicit_tab_stops()` 在 OOXML 层还原为真正 `<w:tab/>`。**哨兵残留必须为 0**。
- `text_to_lines` docstring 曾谎称「`\t` 转 4 空格」——**不要信 docstring，看代码**。
- 选项标签判定 `is_option_label_segments` 不能用「整段纯文本」，须用「可见文本」（真实选项含行内公式）。
- 桥接 `doc_insert_image` 的 `<a:graphicData>` **缺 `uri`** → WPS 容忍但 **Word 报错打不开**（只在 WPS 测会漏）。
- 桥接对一批符号命令输出 HTML 实体名（如 `\Delta`→`&Delta;`，78 个命令）→ 需对 `<m:t>` 做实体还原。
- 导出已改为真正只读（`db.connect_readonly()` + `schema_ready`），导出后 `bank.db` hash/mtime 不变。
- 题号剥离保险：行首数字必须等于快照原题号才剥离（避免误删 `3．14`）。
- **构建漂移**：实现者构建后源码若又改动，其报告产物 hash 失效，以当前源码重建为准。
- `embed_metadata.py::insert_html` 的 DOCTYPE 查找已改大小写不敏感，并跳过 `webui/static/` 构建产物。
- `frontend/scripts/prune-stale-assets.mjs` 已接入 `npm run build`（清理旧 hash 资产）。

## 5. 版本拆分（editions）
- **一个内核 + 两个外壳**：`bank/` `pipeline/` `webui/` `frontend/` 共享，业务零分叉；差异收敛到 `webui/edition.py`（`QB_EDITION`/`QB_HOST`/`QB_PORT`/`QB_AUTH_TOKEN`）。
- `QB_AUTH_TOKEN` 不设置 = 不启用鉴权（与历史行为一致）。
- **线上版硬约束**：导出依赖 editor_sdk+Office（Windows 专有）→ 必须 Windows 宿主；桥接单实例 → 并发导出 `WinError 10048`；鉴权仅访问控制级，无用户/角色。
- 启动器：`editions/local/启动题库.bat`（可移植，`BANK_PY` > `.venv` > `PATH`）。

## 6. 前端重构（阶段 0/1/2/3/5 已完成）
- 技能市场 `search_and_install_skills` 返回 404；改用 SkillHub API（`https://lightmake.site/api/v1/search?q=...`，见 `find-skills`）。已装用户级：`ui-design`、`web-accessibility`、`ux-usability-auditor`、`ui-ux-pro-max`。
- ⚠️ `vitest` 必须 **2.x**（5.x 要 vite≥6，与本项目 vite 5 冲突 ERESOLVE）；`vitest.config.ts` 的 include 必须限定 `tests/unit/**`；jsdom 缺 `matchMedia`/`ResizeObserver`/`IntersectionObserver`/`document.fonts`，setup 需补桩。
- **阶段0 护栏**：ErrorBoundary（顶层+页面级）、`lib/feedback.ts`+NotifierBridge（notistack 容器懒渲染，别用它做断言）、`api/errors.ts`+`api/queryKeys.ts`（11 文件内联 queryKey 全迁移，残留 0）；`webui/config.py` 支持 `QB_DB_PATH`/`QB_EXPORT_DIR`。
- **阶段1 术语/IA**：术语唯一来源 `lib/glossary.ts`（原始技术字段默认不渲染，仅 `?debug=1` 或 `localStorage.qb_debug=1` 显示）；`NAV_GROUPS`（日常备课/数据治理）+ `SETTINGS_ITEM`；默认落地 `/builder`；`LEGACY_REDIRECTS` 必须注册在 `*` 之前。⚠️ 改术语口径须同步 `tests/preview-and-theme.test.cjs`。
- **阶段2 设计系统**：**Tailwind 已彻底移除**（保留 `autoprefixer`）；设计 token 单一来源 `src/theme.ts`；四态组件 `LoadingState`/`EmptyState`/`ErrorState`/`ProgressStages`。
- **阶段3 主流程**：`PaperBuilderPage` 断点 `theme.breakpoints.down('lg')`（<1200 折叠右栏）；🔴 **MUI Button 键盘焦点不可见**根因（`disableElevation` 走 `boxShadow:'none'` + `ButtonBase outline:0`）→ 已在 `theme.ts` 补 outline 焦点环；视觉基线机制 `frontend/tests/visual/`（基线 PNG 不入库，manifest 记 sha256，更新基线须人工看图）。
- **阶段5 性能/无障碍**：代码分割（入口 1.12MB→24KB，首屏 −36%）；⚠️ `Suspense` 放 `Outlet` 外层；⚠️ CSS 不参与 vendor 分包；构建产物清理改按 `build.manifest` 判定（按「是否被 index.html 引用」会误删懒加载 chunk）；**对比度 65/65 达 WCAG AA**（门禁接入 `npm run build`，校验器 `frontend/scripts/check-contrast.mjs`）；skip-link 在 HashRouter 下须拦 onClick；MUI `subtitle1/2` 默认渲染 `<h6>` 是标题跳级根源。
- 待用户决策：深色 primary 作文字 3.52:1；`settings.json` 旧主色迁移；`tokens.difficulty`/`palette.badge` 零消费方。

## 7. 当前基线与常用命令
- 后端 **387 项（386 通过 / 1 skip）**；前端 **205 项**（26 node:test + 179 vitest）；tsc 0；build 成功。
- `outputs/bank.db` sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（64,815,104B）。
- API：**43 路径 / 49 操作**；资产清单 168 条；导出门禁 revision `export-content-p0-v5`，布局 `export-layout-p0-v4`。
- 服务地址 `http://127.0.0.1:8720`（仅本机）；`python -m webui` 启动。

## 8. 上线就绪度（2026-10-11 评估）
- **单人本地基本就绪**（差 Git 凭据、`启动题库.bat` 硬编码 venv 路径不可移植、首启需手动 init+导入、`bank.db` 62MB 不分发）。
- **10 人团队口径远未就绪**：`webui/` 零认证代码、只绑 `127.0.0.1`（`webui/config.py:53`）、桥接必须串行、数据分发未定义。
- 其余：无错误监控、无备份 SOP；`\begin{array}` 1 条公式桥接不支持（降级+告警）。
- 文档：`deliverables/上线就绪度评估-2026-10-11.md`。
