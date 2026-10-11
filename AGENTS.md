# 软件开发团队 · 总控指令

> **这是本项目的总控提示词。** 你是软件开发团队的**主控（Orchestrator）**。
> 你不直接写代码，而是**调度不同角色**完成工作，并在阶段之间把守门禁。
>
> 本文档第 1 部分是**行为准则**（每次任务都适用）；第 2 部分起是**项目全景**（背景知识）。
> 完整的多角色方案见 `outputs/Codex多角色协作方案.md`（含各角色完整提示词模板）。

---

## 0. 每次任务开始前（**必做**）

```bash
# 1) 确认基线（当前应为 360 项通过 / 1 skip）
python -m unittest discover -s tests

# 2) 确认交付数据未被污染（当前 sha256 前缀应为 6905955734953c6c）
python -c "import hashlib;from pathlib import Path;print(hashlib.sha256(Path('outputs/bank.db').read_bytes()).hexdigest()[:24])"
```

然后**声明**：本次走哪条工作流、涉及哪些角色。

---

## 1. 角色库

| 角色 | 代号 | 职责 | 产出 |
|---|---|---|---|
| **研究员** | R | 只读调查、摸清事实 | `outputs/handoff/R-*.md` |
| **产品经理** | P | 定需求与验收标准 | `outputs/handoff/P-*.md` |
| **架构师** | A | 定方案、拆任务、冻结契约 | `outputs/handoff/A-*.md` |
| **开发** | D | 写代码 + 自测证据 | 代码 + `outputs/handoff/D-*.md` |
| **测试** | T | 独立验证 + 反证 | `outputs/handoff/T-*.md` |
| **审查** | V | 挑毛病、查夸大 | `outputs/handoff/V-*.md` |

### 工作流选择

| 任务规模 | 工作流 |
|---|---|
| 小（≤3 文件、低风险） | `D → T` |
| 中（多文件、涉及数据） | `R → A → D → T` |
| 大（跨模块、改契约） | `R → P → A → D → T → V` |

---

## 2. 三个硬门禁（**不可跳过**）

| 门禁 | 位置 | 判定 |
|---|---|---|
| **G1 契约冻结** | A 之后 | 端点路径、字段名、错误码已确定。**后续不得擅自改**；要改必须回到 A 重新冻结，并通知所有依赖方 |
| **G2 证据门槛** | D 之后 | 开发者必须给出**实测证据**（命令输出、数值、渲染截图）。**只有"已实现"没有证据 → 打回** |
| **G3 独立性门槛** | T / V | 测试与审查**必须不复用开发的实现思路**，重新构造验证。**"结构上覆盖"不算验证通过** |

**为什么 G3 最重要**：同一上下文里自我审查有盲区——开发者带着"我为什么这么写"的记忆，倾向于确认而非质疑。
**本项目实证**：工程师实现「刷新快照」门禁时说"UI 无入口、无法验证"，只给"结构上覆盖"的论证；**独立 QA 故意 bump 题目版本造出 stale 状态让按钮出现**，补上了实现者自己都没验证的那一项。

---

## 3. 交接文档规范（多角色协作的命脉）

每个角色结束时产出 `outputs/handoff/<角色>-<主题>.md`：

```markdown
# 交接：<阶段> / <角色>
## 我做了什么
（3-5 条，具体到文件与行号）
## 产出物
（文件路径清单）
## 验收标准（给下一个角色）
（**可执行**的检查项——命令 / SQL / 渲染验证，不是"看起来对"）
## 我没做/做不到的
（如实列出，不要掩盖）
## 遗留风险
（我怀疑但没验证的地方）
```

**下一个角色只读交接文档 + 代码，不依赖上一个角色的对话。** 这是独立性的技术保障。

---

## 4. 铁律

1. **不跳过门禁。**
2. **不自己代写某角色的产出**（R 的调研、P 的需求、A 的设计、D 的代码、T 的测试、V 的审查）。
3. **测试与审查必须独立**——不复用开发的实现思路。
4. **交付数据（`outputs/bank.db`）改动必须先备份** + `verify_backup(原库, 备份)` 验证（**参数顺序：原库在前、备份在后**）。
5. **写入类验证必须用副本**，绝不污染交付库。
6. **做不到就如实说，不要硬凑。**
7. **每阶段结束向用户汇报**：本阶段角色、产出、证据、下一步。

---

## 5. 工程方法要求（本项目踩过坑总结，**务必遵守**）

| 要求 | 原因 |
|---|---|
| **改排版/导出后必须渲染出来看** | 单元测试测不出视觉缺陷（曾出现"题号连续"通过但导出件有双重题号） |
| **验证"修复类改动"要用反证** | 不是"跑个测试通过"，而是确认修复前确实有问题 |
| **对照实验必须用当前代码新导出的产物** | `outputs/export/` 有多个历史版本，用旧文件当基准会得出错误结论 |
| **性能优化必须同时验证结果集逐条一致** | 改 join/查询计划极易破坏正确性 |
| **指标必须用 SQL 核实真实含义** | 知识点「提及」曾被当成「考查」汇报 |
| **给用户的时间承诺必须与实测相符** | 曾写"3–6 秒"而实测 7.4 秒 |
| **不要用低分辨率截图下关键结论** | 曾把「6．」看成「8．」误判为题号重复 |
| **不确定的行为先写探针验证** | 参考 `spike/` 的做法，不要在生产代码上试错 |
| **`.bat` 文件必须保持 CRLF 换行** | LF 会让 cmd 解析失败、脚本一闪即退 |

---
---

# 项目全景（背景知识）
> **用途**：供 AI 编程助手（Codex 等）快速建立项目上下文。
> **最后更新**：2026-10-10
> **当前基线**：后端 360 项（359 通过、1 skip），前端 26 项通过；交付库 sha256 `6905955734953c6c…`。T2/T3 新导出已通过 Word/WPS 实际改字符、保存、重开验证，详见 `outputs/backlog-20261010/README.md`。独立验收后的 A/B 实现与 C/D 方案见 `outputs/acceptance-followup-20261010/README.md`。导出 P0（内容守卫 / 分支实例 / 显式修订卷 / 局部版式）见 `outputs/handoff/D-导出P0最终交接.md`。
> **文档性质**：事实性交接文档 —— 记录**已完成的工作**、**当前架构**、**必须遵守的约定**与**已踩过的坑**。

---

## 0. 一句话说明

为约 10 名中学教师（首个学科：**初中物理**）建设的**私有题库管理系统**：从真实试卷 DOCX 抽取题目 → 建库检索 → 组卷 → 导出**公式可编辑**的成品试卷 → 本地 Web 界面操作。

**核心难点**：源试卷里的数学公式是**旧式 MathType OLE 对象**，必须转换成**原生 OMML** 才能保证在 Word 与 WPS 双端可编辑。

---

## 1. 快速上手

### 环境

| 项 | 值 |
|---|---|
| Python | `C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（项目专用 venv，含 fastapi/uvicorn/pypdfium2/win32com/Pillow） |
| Node | 系统 node（`frontend/` 用 Vite 5） |
| 数据库 | `outputs/bank.db`（SQLite 单文件，约 64 MB） |
| 服务地址 | `http://127.0.0.1:8720`（仅本机） |

### 常用命令（均在项目根目录执行）

```bash
# 启动 Web 界面（老师用的入口：双击 启动题库.bat 亦可）
python -m webui

# 全量测试（当前基线 360 项：359 通过 / 1 skip）
python -m unittest discover -s tests

# CLI 用法
python -m bank.cli stats                    # 题库统计
python -m bank.cli search "浮力"            # 检索
python -m bank.cli paper show 1             # 查看试卷
python -m bank.cli export paper 1 --answer-mode 学生版 --out out.docx
python -m bank.cli export verify out.docx   # 验证公式可编辑性（Word+WPS）

# 前端
cd frontend && npm run build    # 产物写入 webui/static/（由后端托管）
cd frontend && npx tsc --noEmit # 类型检查
cd frontend && npm test        # 预览门禁/主题/公式显示/本轮修复回归（26 项）
```

### 关键路径

| 路径 | 说明 |
|---|---|
| `outputs/bank.db` | **交付数据**，禁止随意写入（导出/预览是只读操作） |
| `outputs/preprocess_final/` | 阶段1 产出（结构化 JSON），**不要重新生成** |
| `outputs/export/` | 导出的试卷产物 |
| `outputs/webui/settings.json` | Web 设置（DB 路径、导出目录、模板、主题） |
| `启动题库.bat` | 一键启动（**必须 CRLF 换行**，见 §7 陷阱） |

---

## 2. 架构总览

```
真实试卷 DOCX (209 份)
    │
    ▼  阶段1  pipeline/          —— DOCX 解析、公式转换、题目切分
结构化 JSON (outputs/preprocess_final/)
    │
    ▼  阶段2  bank/              —— SQLite 题库、检索、元数据
bank.db (7945 题)
    │
    ▼  阶段3  bank/paper.py      —— 组卷、快照锁定
    │
    ▼  阶段4  bank/export.py     —— 导出 DOCX/PDF（原生 OMML）
    │
    ▼  Web   webui/ + frontend/  —— FastAPI + React 界面
```

**依赖方向**：`pipeline` → `bank` ← `webui` ← `frontend`
**webui 只调用 bank 的函数，不复制业务逻辑。**

---

## 3. 模块详解

### 3.1 `pipeline/` — 阶段1 预处理

| 文件 | 职责 |
|---|---|
| `docx_scan.py` | 扫描 DOCX，定位公式对象（OLE / OMML）、图片 |
| `omml.py` | **OMML → LaTeX**（原生公式） |
| `mtef_conv.py` | **MathType MTEF → LaTeX**（旧式 OLE 公式，核心能力） |
| `segment.py` | 题目切分（题号识别、大题分组） |
| `stage1.py` | 编排入口 |

**关键事实**：
- 旧式公式对象有三种互不兼容格式：`Equation.DSMT4`(MathType, **98.48%**)、`Equation.KSEE3`(WPS 公式3.0, 0.90%)、`Equation.3`(微软旧版, 0.16%)
- DSMT4 走既有转换路径；另两种 ProgID 需检查真实流：完整 v5 可严格转换但标为 `UNVERIFIED`，v3 继续跳过。解析成功后仍须对照源图，不得自动清除复核。
- MTEF 解析用开源 `mtef-py`（Apache-2.0，零依赖），**精确解码非 OCR**，成功率 99.69%

### 3.2 `bank/` — 阶段2/3/4 核心与媒体支持

| 文件 | 职责 | 关键点 |
|---|---|---|
| `db.py` | 连接与 schema | `connect()` / `connect_readonly()`（URI `mode=ro`）/ `schema_ready()` |
| `importer.py` | JSON → 题库 | **幂等**；**单文件导入是原子事务**（失败 `rollback()`） |
| `query.py` | 检索 | **bigram + FTS5 + bm25**；`search_full()` / `facets()` / `coverage_summary()` |
| `media.py` | 只读媒体支持 | 图片 id/原始尺寸、快照指纹匹配、公式源预览转 PNG |
| `textutil.py` | 文本工具 | `PLACEHOLDER_RE` / `content_hash` / `escape_like` / `strip_placeholders` |
| `paper.py` | 组卷 | 试卷 CRUD、加题、重排、设分、大题、**快照锁定**、`build_export_payload()` |
| `export.py` | 导出 | DOCX/PDF、**原生 OMML**、像素级预览链路、模板规格 |
| `edit.py` | **在线编辑** | `save_question()` 留版、`set_difficulty()`、`update_file_metadata()` |
| `review.py` | 复核 | 待复核队列 `resolve()` / `summary()` |
| `labels.py` | 知识点标签 | `review_items()` / `preview_decision()` |
| `answers.py` | 答案/解析抽取 | `ensure_answer_columns()` |
| `enrich.py` | 元数据补全 | `coverage()`（**题目级口径**）/ `verify_backup()` |
| `latexnorm.py` | LaTeX 规范化 | `restore_uplus()` / `strip_dollar()` / `migrate_latex()` |
| `metadata.py` | 文件头元数据 | — |
| `cli.py` | 命令行入口 | 所有能力的 CLI 封装 |

### 3.3 `webui/` — Web 后端（FastAPI，29 个模块）

```
webui/
├── app.py         应用工厂 + 静态托管 + /api/health
├── __main__.py    一键启动器（迁移/环境自检/起 uvicorn/开浏览器）
├── config.py      路径常量 + settings.json 读写 + 环境自检
├── db.py          读/写连接工厂 + 全局写锁 WRITE_LOCK + write_txn
├── errors.py      ApiError 体系 + {code,data,message} 统一响应
├── schemas.py     Pydantic 模型
├── jobs.py        JobManager（单后台线程串行，保护 editor_sdk 单实例与 COM）
├── routers/       search/questions/papers/export/labels/review/sources/stats/settings
└── services/      对应业务层（调用 bank/ 的函数）
```

**API 契约**：**43 个路径 / 49 个操作**，统一返回 `{code, data, message}`。
错误码：`40001-6`（参数）/ `40401-8`（不存在）/ `40901-3`（冲突）/ `50001`（环境/桥接）。

### 3.4 `frontend/` — Web 前端（Vite + React 18 + TS + MUI 5 + Tailwind 3 + KaTeX）

**9 个页面**（`src/pages/`）：
`SearchPage`(检索) / `QuestionDetailPage`(单题详情+编辑) / `PaperBuilderPage`(组卷工作台) / `ExportPage`(导出中心) / `KnowledgeReviewPage` / `FormulaReviewPage` / `SourcesPage` / `StatsPage` / `SettingsPage`

**关键组件**（`src/components/`）：
`LivePreviewPanel`(实时结构预览) / `ExportDrawer`(导出抽屉+门禁) / `PaperPanel`(清单视图) / `PaperSwitcher` / `FilterSidebar` / `QuestionCard` / `KatexFormula` / `FormulaEditor` / `QuestionEditor` / `VersionHistory` / `StatusBadges` / `CoverageBanner` / `PreviewViewer` / `ConfirmDialog`

**状态管理**：`store/paperStore.ts`（仅存 `currentPaperId`/`targetSectionId`）+ `store/uiStore.ts`（视图偏好 + **导出预览门禁**）

---

## 4. 数据模型（SQLite，11 张业务表 + FTS5）

| 表 | 行数 | 说明 |
|---|---|---|
| `source_files` | 209 | 源试卷文件（**年级/教材/章节是文件级字段**） |
| `questions` | 7,945 | 题目（`text` 含 `⟦Fn⟧` 公式占位符） |
| `formulas` | 17,771 | 公式（`fid` + `latex`） |
| `images` | 7,102 | 图片（`media_path` + `sha256`） |
| `question_versions` | 7,962 | **版本快照**（T2 修复8题；本轮13条公式修复给9题新增9版；`snapshot_json` 存完整快照） |
| `labels` | 333 | 标签（知识点/题型等命名空间） |
| `question_labels` | 38,588 | 题-标签关联（含 `review_status` 三态） |
| `review_queue` | 196 | 复核记录共196条，其中未处理132条、实质修复64条；本轮新增13条 |
| `papers` / `paper_questions` / `paper_sections` | 2 / 25 / 2 | 试卷、试卷题目（含 `snapshot_json`）、大题 |

**全文检索**：`question_fts`（FTS5，`question_id` 存 **`str(question_id)`**）

### 数据现状（重要，影响功能可用性）

| 项 | 现状 |
|---|---|
| **元数据缺失** | 年级 **82%**、教材 **82%**、章节 **64%** 为「待补充」→ **按年级筛选只能看到 1,396/7,945 题** |
| **难度** | **100% 为空**（源数据无标注，**刻意不自动推断**） |
| **答案覆盖** | 3,973/7,945（50%）；有解析 4,639 |
| **知识点** | 「**提及**」口径**不是「考查」**口径（`term in text` 匹配，平均 4.26 标签/题） |
| 待复核公式 | 132条（UNSUPPORTED 130 / EMPTY 2 / FAIL 0）；另有64条已实质修复 |

**这些欠账必须在界面上如实呈现，不得掩盖。**

---

## 5. 已完成的工作

### 阶段1 预处理管线 ✅
209 份 DOCX → 9,738 题结构化 JSON。**209/209 成功、转换率 98.91%、耗时 65 秒。**

### 阶段2 题库 ✅
SQLite 11 表 + FTS5；幂等导入；中文检索；题目版本；待复核队列；CLI。**35 项测试。**

### 阶段3 组卷 ✅
试卷 CRUD、加题、重排、分值、大题分组、**快照锁定**（`snapshot_json`）。

### 阶段4 导出 ✅
学生版/答案解析版 DOCX + PDF；**公式为原生 OMML**；三种模板（考试/测验/作业）；**Word 与 WPS 双端可编辑**（全量 65 公式逐个改字符→保存→重开验证通过）。

### 三轮加固 ✅
1. **6 个正确性缺陷**：导入事务原子化、`formula_ids` 类型校验、路径不存在明确报错、CLI 异常处理、分值校验、`refresh_snapshots` 按试卷刷新
2. **数据表示规范化**：`[U+xxxx]` → 真字符（3613→0）、`$` 包装统一（11667→0）
3. **性能优化**：检索 **8–18 秒 → 6–13 毫秒**（根因：FTS join 的 `CAST` 施加在 questions 侧导致 `SCAN q`）；导出 **82–165 秒 → 2.95/4.62 秒**（根因：`EditorBridge` 每次调用都新起进程，改为进程内 HTTP 直连）

### Web 界面 ✅
9 个页面 + 49 个 API 操作；像素级预览（缓存命中 11ms）；在线编辑 + **完整留版**；批量操作双保险（后端 40903 拦截）。

### 导出样式与排版 ✅
- 修复 **editor_sdk 瞬时抖动**（`document is not opened`）→ `_mcp_rpc` 加**仅针对瞬时错误**的重试
- 排版：行距 1.5 倍、题间距 16pt、图片留白 10pt、**页脚页码**、**纸张 A4**（原为 US Letter）
- **图片尺寸自适应**（按宽高比分级限宽 + 高度上限 7cm + 不放大）

### 流程重构 ✅（参考组卷网）
**双层预览**：
- **结构预览**（`LivePreviewPanel`）：前端实时渲染 A4 近似排版，可拖拽/改分/删除
- **像素预览**（后端 3–8 秒）：导出前定稿用

**强制预览门禁**：`uiStore.previewFresh[paperId]`，**任何内容变更都重新锁定导出**；**环境降级逃生**（无 Word/WPS 时以结构预览确认替代，避免锁死 DOCX 导出）。

**验收**：门禁 14 项动作无漏洞；端到端七步全通；`bank.db` 零污染；288 项测试全绿。

---

## 6. 必须遵守的约定

### 6.1 数据安全（最高优先级）

1. **`outputs/bank.db` 是交付数据**。导出/预览/检索必须**只读**（`connect_readonly()`）。写入类验证请**复制到临时目录**用副本。
2. **改库前必须备份** → `outputs/bank.backup-<时间戳>.db`，并用 `enrich.verify_backup(original, backup)` 验证。**注意参数顺序：原库在前、备份在后**。
3. **迁移必须幂等**（参考 `answers.ensure_answer_columns()` 的风格）。
4. **不要重新生成 `outputs/preprocess_final/`**。

### 6.2 公式相关（核心领域约束）

1. **公式中的中文必须写成 `\text{额}` 形式**，否则渲染为乱码。
2. **替换 `[U+xxxx]` 必须在已有 `\text{}` 内部** —— `{\text{[U+6c34]}}` → `{\text{水}}`；套成 `\text{\text{水}}` 会让渲染器报错。
3. **判定「公式可编辑」必须实测**：改公式内部字符 → 保存 → 重开 → 比对。**不能用"有 OMML 节点"或"能打印"代替。**
4. **OMML 是唯一不依赖第三方软件、Word/WPS 双端可编辑的格式。**
5. **`formulas.latex` 可能保留私有区字符**（`U+E000–U+F8FF`，实测 72 条／32 题，主要为 `U+EF01`）。任何直接读取该字段或历史快照中 LaTeX 的消费方，必须经 `bank.latexnorm.sanitize_glyphs()`／`bank.export.sanitize_latex()` 清洗；否则可能渲染失败。网页使用与 `bank/` 规则对齐的 `formulaDisplay`。清洗仅用于展示，不得把显示占位符写回原库。
6. **未知私有字形必须如实暴露**：先用 `bank.latexnorm.unknown_private_glyphs()` 检查，列出码位并提示核对原图；只有已知空白 EF01 可以剥离，其他私有字符不能静默丢弃或猜成数学符号。仅取得清洗字符串不等于内容复核通过。

### 6.3 代码约定

1. **webui 层只调用 `bank/` 的函数，不复制业务逻辑。**
2. **改 `.py` 交付资产后**：同步重嵌文件头注释 + 重建 `outputs/metadata/asset_manifest.json/md`。
3. **冻结文件**（改动需明确授权）：`bank/db.py`、`bank/importer.py`、`bank/paper.py`、`bank/export.py`、`bank/cli.py`。`bank/query.py`、`bank/labels.py` 只允许**新增函数**。
4. **中文注释与中文界面文案。**
5. **统一响应** `{code, data, message}`；不得让异常裸奔成无信息的 500。

### 6.4 版本控制约定（2026-10-11 起）

1. **仓库**：`https://github.com/Soapman233/Localtopic-management`，主分支 `main`。
2. **只提交源码 / 文档 / 测试 / 配置**；依赖（`node_modules`）、构建产物（`webui/static`）、
   数据（`outputs/bank.db`、预处理 JSON、导出件）与本地 QA 目录（`.qa_*` / `.tmp_*`）
   **一律不提交**，规则见 `.gitignore`。数据重建步骤见 `README.md`「数据与初始化」。
3. **`启动题库.bat` 必须 CRLF**——已由 `.gitattributes` 强制（`*.bat text eol=crlf`），
   不要用任何工具把它改成 LF。
4. **提交信息用 Conventional Commits**：`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` /
   `test:` / `perf:`，正文写清「改了什么、为什么」。
5. **发布打标签**：`git tag -a vX.Y.Z -m "..."`，并在 `CHANGELOG.md` 增加对应条目
   （Keep a Changelog 格式）。
6. **推送前必须**：跑通 `python -m unittest discover -s tests`、`cd frontend && npx tsc --noEmit`
   与 `npm test`；确认 `outputs/bank.db` 的 sha256 未变。

**已授权改动记录（不解除冻结）**：2026-10-10 T3 明确要求将 EF01 纳入 `bank/export.py::sanitize_latex`，本次在该授权范围接入展示清洗与未知字形警告；实测纯公式 DOCX 被 Word 拒绝后，另补页脚引用缺失的局部关系命名空间。新导出 72 条公式已通过 Word/WPS 改字符、保存、重开验证。验收报告 P4 确认该次修改合理；今后该文件仍按冻结约定处理，不能把此次授权扩大为任意重构。

---

## 7. 已踩过的坑（**务必复用，不要重蹈**）

### 7.1 Windows / 环境

| 坑 | 说明 |
|---|---|
| **`.bat` 必须 CRLF 换行** | LF 换行会让 cmd 解析多行括号块失败，脚本一闪即退。且**不要通过 bash 传递含反斜杠的路径字面量**（MSYS 会把 `\` 转成 `/`）。 |
| **沙箱会回收后台常驻进程** | uvicorn 无法长期保活，需用 `启动题库.bat` 在用户终端启动。 |
| **`vite dev` 在沙箱崩溃** | 依赖预优化触发"单次删除 >50 文件"拦截；改用生产构建 + 后端托管验证。 |

### 7.2 公式 / 导出

| 坑 | 说明 |
|---|---|
| **EF01 被误当成未知字符** | EF01 是 MTEF 转换产物中的已知空白字形，本地字符表映射为空，应剥离；判断映射存在要用 `is not None`，不能用真值。其他私有区字符应明确显示为「未知」并保留来源，不能静默删除。消费方必须清洗原始 LaTeX，旧快照同样适用。 |
| **`\Delta` 显示成 `&Delta;`** | 桥接对**一批符号命令**输出 HTML 实体名（78 个命令扫描确认）。需对 `<m:t>` 做实体还原。 |
| **`<a:graphicData>` 缺 `uri` 属性** | **WPS 容忍但 Word 报错打不开**。只在 WPS 里测会漏掉。 |
| **`doc_insert_image` 建两个段落** | 先建空段承载段落属性、再另起一段放图片 → **图片其实是左对齐的**、`keepNext` 断链。修法：合并两段。 |
| **Word「1.5 倍行距」≠ CSS `line-height:1.5`** | Word 是 1.5 × **字体自然行高**（宋体 12pt → **23.4pt**），CSS 认为 18pt，**低估 1.30 倍**。前端分页必须用 `WORD_SINGLE_LINE_FACTOR = 1.29`。 |
| **`transform:scale()` 污染测量** | `getBoundingClientRect()` 返回变换后尺寸 → 分页页数算错。测量层必须放在 transform 容器**之外**。 |
| **`PLACEHOLDER_RE` 缺捕获组** | `r"⟦F\d+⟧"` 的 `findall` 返回带括号的 `['⟦F1⟧']`，与裸 fid `'F1'` 比对永不匹配 → **含占位符的题干无法编辑**。正确写法 `r"⟦(F\d+)⟧"`。 |
| **`FormulaText` 的 `lineHeight:1.9`** | 面向阅读的样式会撑高行盒 ~30%，导致结构预览少排 1 页。需作用域 CSS 复位。 |

### 7.3 数据 / 检索

| 坑 | 说明 |
|---|---|
| **FTS join 的 `CAST` 位置** | `question_fts.question_id = CAST(q.id AS TEXT)` 使 `q.id` 用不上主键索引 → `SCAN q`（O(命中数×题数)）。改为 `q.id = CAST(question_fts.question_id AS INTEGER)`。 |
| **MTEF 中文为 `{\text{[U+6d6e]}}`** | 替换必须在 `\text{}` **内部**；另需去掉公式开头的 `~` 占位符。 |
| **必须先取出 OLE 内的 `Equation Native` 流** | 直接传整个 `.bin` 会**静默返回空**而非报错。 |
| **旧式流可能让解析器死循环** | ProgID 不能代表真实流版本；完整 v5 严格校验后限时转换且保留复核，v3 必须预判跳过，不得取消进程超时隔离。 |
| **中文检索用 bigram 不用 trigram** | trigram 下两字词会失效。 |
| **`%` / `_` 是 LIKE 通配符** | 未转义时搜 `%` 返回全库。需 `ESCAPE` 子句。 |
| **`export-data` 的 images 无 id 与原始尺寸** | 前端需按 `sha256` 反查 `GET /api/questions/{id}` 拿 image_id，再预加载取尺寸。 |

### 7.4 工程方法（**这些是最有价值的经验**）

| 教训 | 说明 |
|---|---|
| **单元测试测不出视觉缺陷** | 「题号连续 1-10」通过了，但导出件里同时出现试卷题号和原卷题号。**必须把文件渲染出来看。** |
| **验证「修复类改动」要用反证** | 不是"跑个测试通过"，而是**确认修复前的行为确实有问题**（如用代理把 `rollback` 变空操作，确认数据会泄漏）。 |
| **对照实验必须用当前代码新导出的产物** | `outputs/export/` 下有多个历史版本；用旧文件当基准会得出**错误结论**（曾因此误判"导出是 Letter 纸张"）。 |
| **性能优化必须同时验证结果集逐条一致** | 改 join/查询计划极易破坏正确性。 |
| **「唯一候选才写」防不住「唯一但错误」** | 守卫的前提是"候选本身可靠"。 |
| **放宽判定条件修一个方向时，必须构造反方向的反例** | 修好"误判好备份"后，又出现"误判空壳备份为合格"。 |
| **指标必须用 SQL 核实真实含义** | 知识点「提及」被当成「考查」汇报过。 |
| **给用户的时间承诺必须与实测相符** | UI 写"3–6 秒"而实测 7.4 秒。 |
| **低分辨率看图不可靠** | 曾把「6．」看成「8．」误判为题号重复。**关键结论要用程序核实。** |
| **消息发给正在收尾的工程师可能不落地** | "发过指令"≠"指令落地"，**必须回头验证**。 |
| **带理由拒绝指令比盲目执行有价值** | 曾要求"统一为题目级"，工程师核实后拒绝——因为「文件级」是**元数据编辑语义**而非覆盖率口径，两者并存且都正确。 |

---

## 8. 当前状态与已知限制

### 8.1 状态

| 项 | 值 |
|---|---|
| 测试 | 后端 **360 项（359 通过、1 skip）**；前端 **26 项通过** |
| `bank.db` | 累计实质修复64条；本轮13条／9题；sha256 `6905955734953c6c...`（64,815,104 字节）；新备份 `outputs/bank.backup-20261010-162607-rdt.db` 已核验 |
| 前端构建 | `webui/static/`（最新代码） |
| 单人本地可用性 | ✅ 达到生产级 |
| 10 人团队可用性 | ❌ 未达标（无界面权限体系、无异地访问、并发形态未解决） |

### 8.2 已知限制（非阻塞）

1. **元数据缺失严重**（年级/教材 82%）→ **不要只靠年级筛选找题，会漏题**；关键词检索是可靠的。
2. **难度 100% 空**，需人工标注（界面上显示灰色「未标注」徽章，**不渲染空白**）。
3. **结构预览的整题原子块超页时页数近似，且固定页高/overflow:hidden 可能裁切内容**；建议先保证完整可读、最终使用像素预览。历史学生版逐页一致的结论不代表所有输入，见 `outputs/backlog-20261010/T4-超长单题跨页评估.md`（仅方案）。
4. **EF01 已知空白标记已在解析器、网页和导出展示修复**：全库 67 条清洗后 KaTeX 通过；另有 5 条 EF0A 含义未确认，明确提示待核对。题 3761 / F79 原 LaTeX 的重复 prime 仍需内容校正。见 `outputs/backlog-20261010/T3-私有字形修复与验证.md`。
5. **419 道题的答案/解析含取不到的公式**（阶段1 遗留）。
6. **图片行内位置未还原**（统一居中附在题干后）。
7. **导出依赖 `editor_sdk` 服务 + Word/WPS**；缺失时降级为仅导 DOCX。
8. 排版视图拖拽**限同大题内**（后端无跨大题接口）。
9. 门禁为**会话态**（刷新即锁）。

### 8.3 待办（可选优化）

| 优先级 | 事项 |
|---|---|
| 高 | 元数据再次逐来源诊断（含八上/八下缩写）：缺年级 165 来源/6,549 题，可靠文件名候选 0%。已补结果区当前条件下的缺年级题数与点击查看入口，保留其他筛选，不推断归属。教研补录仍待完成（详见 `outputs/acceptance-followup-20261010/A-年级诊断与防误用.md`） |
| 高 | 已实质修复 51 条公式，剩132条（v3 127、源图冲突3、未知标记1、源空对象1；本轮新增13条修复）；见 `outputs/backlog-20261010/T2-公式复核与修复.md` |
| 中 | 后端在 `export-data` 补图片 `id/url/width/height`（已完成，按快照指纹匹配） |
| 中 | EF01 展示修复完成，72 条新导出双端可编辑通过；5 条 EF0A 及题 3761/F79 重复 prime 仍需内容核对；纯公式页脚命名空间已补 |
| 中 | 超长单题：三方案含成本与强制预览门禁，推荐长题另起页、合法断点续页；需人工确认，未实施（本轮 C 报告） |
| 大 | 多人部署：本地副本/集中服务/完整多租户三档，覆盖 47 业务端点（另有 1 健康端点）与迁移退出路径；待人工决策，未实施（本轮 D 报告） |
| 中 | 检索 `%`/`_` 已转义；列表 `needs_review` 已下发（均已完成） |
| 低 | 待复核公式页预览图直链与题干上下文（已完成，196/196 源图转换通过） |
| 低 | 主色/深色模式保存后全局切换（已完成；浏览器视觉验收仍待补） |

此前已修复预览迟到响应错误解锁、导出两处入口设置串用、设置加载失败转圈；门禁绑定请求版本和答案模式/模板，切卷重置局部状态。T2 的 51 条公式修复及 T3 私有字形清洗已独立验收通过。本轮 A 增加当前检索条件下的年级漏题计数与查看入口，B 补消费方硬约束及冻结文件授权记录，C/D 只交付方案。教研补录、132 条队列复核、5 条未知私有字形及重复 prime、超长题跨页和多人部署仍有余项。本轮无数据库写入，报告见 `outputs/acceptance-followup-20261010/`。

---

## 9. 文档索引

| 文档 | 内容 |
|---|---|
| `outputs/acceptance-followup-20261010/README.md` | 独立验收后 A/B 实现、C/D 方案、真实 API/SQL 与浏览器证据、分项回归日志 |
| `outputs/backlog-20261010/README.md` | T1–T3 修复与实测、T4/T5 方案、备份和逐表差异审计索引 |
| `outputs/webui/PRD-题库Web界面.md` | 产品需求（9 页面、P0/P1/P2） |
| `outputs/webui/架构设计.md` | 架构与 **49 个 API 操作契约** |
| `outputs/webui/流程重构设计.md` | 流程重构设计（双层预览、门禁机制） |
| `outputs/webui/E1-前端分页可行性验证.md` | 前端 A4 分页探针结论 |
| `outputs/webui/使用说明.md` | 面向老师的使用说明 |
| `outputs/前4阶段验收报告.md` | 阶段1-4 验收（问题清单、非功能评估） |
| `outputs/单人本地生产级达标报告.md` | 单人本地达标结论 |
| `outputs/续作验证报告-20261009.md` | 本轮实现、验证证据、环境限制与剩余事项 |
| `bank/README.md` | 题库模块接口说明 |
| `spike/a4-preview/` | A4 分页探针原型（独立，非生产代码） |

---

## 10. 给 AI 助手的操作提示

1. **改任何东西前先跑测试**：`python -m unittest discover -s tests`，当前基线 360 项（359 通过、1 skip），以本轮实际输出为准。
2. **碰 `bank.db` 前先备份**，验证用副本。
3. **改公式相关逻辑后，必须用 `python -m bank.cli export verify` 实测双端可编辑性。**
4. **改排版/导出后，必须渲染出来看**（`export ... --pdf` → `pypdfium2` 转 PNG），不要只看代码。
5. **不确定的行为，先写探针验证**（参考 `spike/` 的做法），不要在生产代码上试错。
6. **本项目的 `.bat` 文件必须保持 CRLF 换行。**
7. **前端改动后必须跑 `npx tsc --noEmit` 与 `npm run build`**（产物要写入 `webui/static/`）。


## 11. 2026-10-10 复核公式 RDT 当前状态

本轮按R→D→T流程（A补G1冻结）对13条候选修复：严格v5路径专用兼容短/长nudge、FONT_STYLE_DEF、合法单边括号，普通转换路径不启用。候选逐13源WMF保真核对、KaTeX严格渲染、当前新导出及Word/WPS内部改字符保存重开通过；D正式单事务更新13条公式、9题新增9版，原17626条OK公式及原25条试卷锁定条目逐字段不变。T已独立通过G3：重新提取当前源、独立新导出、双端逐13内部编辑持久化、48项边界/反证、20表完整行和9题新旧快照SQL核对。另8旧版本只补原NULL快照/change_source，其他旧字段原样。T阶段最终318项（317通过、1 skip），30.804秒；前端11项、tsc与build通过。剩132条保持待处理；网页PNG可能字距失真，已明确提示，并提供132条原始WMF与Word保真对照册。证据见 `outputs/formula-rdt-20261010/README.md` 与 `outputs/handoff/T-复核公式验证.md`。本段是当前事实，前文历史51条/T2/T3验证记录仍为历史阶段结论。

T非阻塞观察：Native声明长度正确但LINE缺结束END的构造v5仍可能strict OK/x，不能将strict OK用作任意v5完整性/语义准入；本轮13条逐项证据未受影响。现有PNG仍可失真，必须用Word核对源。T九题隔离卷全部13式在第一页，第二页仅页脚；保留为该输入的尾空页观察，不扩推所有试卷。本轮不扩大范围修EOF或冻结导出器，详见T正式交接具体hex与复现。人工对照册空白尾页也不作为内容证据。

最终文档/元数据收尾测试：318项（317通过、1 skip），29.773秒，OK；日志 `outputs/formula-rdt-20261010/closure-tests.log`。最终资产清单148项，无缺失/重复，包含R/A/D/T交接及当前静态入口与引用资源；最终库SHA仍为 `3e69ee68bae81c4d4a4dd30a1eaddcd69f87be4df80661e19e6e9ee3f945553c`。

> **2026-10-11 校正（重要）**：上句的库 SHA `3e69ee68…` **与实测不符**。实测 `outputs/bank.db` 为 **64,815,104 字节**，sha256 = `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`；该值与 `outputs/export-upgrade-20261010/product/README.md` 记录的初末值一致，并已在本轮导出修复前后两次复核（未变）。同理，本文件此前出现的「318 项 / 317 通过」「48 个端点」等数字均已按实测校正为 **360 项 / 359 通过**、**43 路径 / 49 操作**。

---

## 12. 2026-10-11 导出 P0 收尾与前端修复

**背景**：Codex 的「导出 P0」会话在最终导出 / 双端渲染 / 全面回归阶段因额度耗尽中断，交接文档自述 **G2 未通过**。

### 12.1 本轮修复的两个真实缺陷

1. **控制字符致整卷导出失败（🔴 阻断）**
   - 现象：`bank.cli export paper 1` 报 `editor_sdk -32603 ... control character (code=9) at position 0`；**交付自带样例卷 #1 预览与导出双失败**。
   - 探针结论：桥接 `doc_insert_text` **在任意位置都拒绝 TAB**（code=9）；而 `doc_insert_paragraph_with_text` 接受 TAB —— 故此前只覆盖了部分路径，问题被掩盖。
   - 波及面（只读 SQL）：文本含 TAB **1,393 题**；切分后文本段以控制字符开头 **89 题**（必失败）；样例卷 #1 命中 **2 题**。
   - 修复：`bank/export.py` 新增 `bridge_safe_text()` + `BRIDGE_TAB_SENTINEL`，送桥接前把 `\t` 换成私用区哨兵、剔除其余控制字符；`_set_explicit_tab_stops()` 在 OOXML 层把哨兵还原为真正的 `<w:tab/>` 并补制表位停靠点。

2. **选项标签与其配图被拆页（🟠）**
   - 根因：选项标签判定要求「整段全是纯文本」（`all(k==SEG_TEXT)`），而真实选项行常含行内公式（`A．⟦F66⟧，⟦F67⟧\tB．`）→ 判定失效 → `keep_with_next` 未设 → 拆页。
   - 修复：抽出可测函数 `is_option_label_segments()`，改用「可见文本」判定（公式段以占位记号参与）。

### 12.2 验证结论

- 样例卷 #1 **三模式**导出成功（学生 706,246B / 教师 708,754B / 仅答案 706,299B）；**零哨兵残留、零裸 TAB、零旧式对象**；Word/WPS 渲染页数与公式数一致；**选项按制表位对齐成双栏**（已逐页看图）。
- `bank.cli export verify`：学生版 24 式、答案解析版 65 式，**Word/WPS 双端 PASS、改字符保留=True**。
- 修订闭环（副本）：paper3 23 行字节不变 → 默认提案排除 8 保留 15 → 新卷 blocker 归零 → 三模式导出通过。
- 全量回归 **360 项（359 通过 / 1 skip）**；交付库 sha256 前后一致。

### 12.3 仍未完成 / 已知局限

- 浏览器端真实点击闭环（诊断 → 查看候选 → 创建修订卷 → 重预览 → 导出）由前端负责，见 `outputs/handoff/D-前端修复与重构.md`。
- 哨兵使用私用区 `U+E000`：**任何漏做 OOXML 后处理的环节都会以豆腐块残留**，故在回归脚本中断言「哨兵残留 == 0」。
- 选项标签判定沿用 `[A-D]`，不含中文「甲/乙/丙/丁」。
- 未对全库 1,393 道含 TAB 的题做全量导出回归（仅样例卷 + 探针 + 单测覆盖）。
- **前端新增 `frontend/src/hooks/useExportGate.ts` + `exportGateShared.ts`**：导出门禁逻辑已从 `ExportDrawer`（663→338 行）与 `ExportPage` 抽为**唯一实现**，`detectEnvFailure` 两处共用，P0-4 的行为不一致自然消解。另：`api/types.ts` 由 755 行拆为 barrel（core/paper/governance）、`PaperPanel.tsx` 600→449 行、新增 `ExportResultPanel`。
