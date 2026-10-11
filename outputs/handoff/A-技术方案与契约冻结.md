# 交接：技术方案与契约冻结 / 架构师（A）

> **修订版 v2（2026-10-11）** —— 依据 `outputs/handoff/V-审查报告.md` 修订。
> **输入**：`outputs/handoff/P-需求与差距分析.md`（P-01…P-10、假设 A–H、明确不做的事）、`outputs/handoff/R-代码能力盘点.md`（9 轴代码级现状）、`AGENTS.md`（项目全景与铁律）、`webui/errors.py`（错误码定义，**本次亲自读**）。
> **角色边界**：本文件只回答"怎么改、改哪些文件、契约长什么样、拆成哪些可验收任务"，**不写业务实现代码**。
> **日期**：2026-10-11
> **范围**：仅 P0（P-01 / P-05 / P-09）与 P1（P-02 / P-03 / P-04 / P-06 / P-07 / P-08 / P-10）。
> **产出物**：本文件 `outputs/handoff/A-技术方案与契约冻结.md`（唯一写入物）。

---

## 〇、本次修订说明（v1 → v2）

**修订缘由**：V 判"需修正"，指出 4 类问题（错误码语义冲突、契约冻结遗漏、3 个漏看风险、2 个待拍板项引入未定义行为）。本次**逐条修正**，并**明确标注新冻结/变更**。

### 0.1 本次新冻结 / 变更清单（一眼可查）

| 变更号 | 类型 | 内容 | 依据 |
|---|---|---|---|
| **C-01** | **新增错误码** | `40009 = CODE_MISSING_UPLOAD`（上传文件缺失/为空） | 修正 1（V2） |
| **C-02** | **修正错误码** | E1 导入端点"file 缺失/为空"由 ~~`40001`~~ 改为 **`40009`**；"格式不支持/超限"为 `40008` | 修正 1（V2） |
| **C-03** | **新增端点冻结** | **E14 `PUT /api/settings`**（additive：`default_owner`、`features.import_enabled`） | 修正 2（V3） |
| **C-04** | **新增配置字段冻结** | `settings.default_owner`（默认 **`'待补充'`**，非空串）、`settings.features.import_enabled`（默认 `true`） | 修正 2/4（V3、待拍板 2） |
| **C-05** | **变更默认值** | `default_owner` 默认由 ~~`""`~~ 改为 **`'待补充'`**；统一"未指定"哨兵 | 修正 4（待拍板 2） |
| **C-06** | **收紧授权** | `bank/query.py` 授权收紧为"**新增一个函数**，不得改 `_build_where`/`search`/`search_full` 函数体"+ 两项回归 | 修正 4（待拍板 1） |
| **C-07** | **新增幂等分支定义** | 导入幂等重导时，**显式传入的 `owner` 覆盖来源归属**（内容仍 `skipped`）；job result 增 `owner_applied`/`owner` | 修正 3（风险 a） |
| **C-08** | **新增空集防护** | "考查口径/新维度"初始为空集 → UI 显式呈现"未标注桶 + 引导"，不静默返回空 | 修正 3（风险 b） |
| **C-09** | **新增写库防护** | Web 导入写交付库：**preimport 备份 + verify_backup + 单事务 + 失败回滚 + 恢复路径** | 修正 3（风险 c） |
| **C-10** | **加强 D 验收** | `T-05b`/`T-09b` 验收补"实际操作截图 / 请求-响应日志"（不再仅 `build` 绿） | V9 |
| **C-11** | **新增风险项** | P-05 风险节补"采纳率不确定性"（技术减负争议 2 vs 4 来源） | V7 |
| **C-12** | **新增缺口呈现** | 答案/解析覆盖欠账（50.0% / 58.4%）在 UI 明示；补录归 P-02/P-10 | V8 |

> **未变更（保持 v1 冻结）**：E1–E13 的路径/方法/字段（仅 E1 错误码修正）、4 个模型字段（v4）、`bank/db.py` 不改、串行作业范式、Windows-only 导出、备份铁律。

### 0.2 对 V 审查意见的逐条回应（V1–V10）

| V# | 意见摘要 | A 的处置 |
|---|---|---|
| **V1** | C13/C17 证据疑升格 → P-09 的 P0 依据存疑 | **契约与优先级无关**：P-09 的端点/字段（E2/E7/E8/E9/E11）**保持冻结不变**。若 P 修订后把 P-09 降为 P1，仅影响**排期**，不影响契约。证据强度判定属 R/P 职责，A 不改写。 |
| **V2** | E1 错误码 `40001` 与 `CODE_PLACEHOLDER_MISSING` 冲突 | **已修正**：见 §4.4 完整错误码映射表；新增 `40009`，E1 不再用 `40001`。 |
| **V3** | 冻结清单遗漏 `PUT /api/settings` 与 `features.import_enabled` | **已补**：新增 **E14**；见 §4.5 双向核对结果。 |
| **V4** | P 判 C11"已满足"与 C12 矛盾 | P/R 职责；对 A 无 schema 影响（P-06 阶段 2 仍被假设 E 门控）。A 记录：**P-06 阶段 1 探针结论须回写 P**。 |
| **V5** | P 规则不读"是否属于推论"列 | P 职责；A 记录其对 P-05 的影响：**假设 A/B 门控不变**（导入/归属均为可关闭增强）。 |
| **V6** | 双向细目表（强实证）落空 | **超出本期 P0/P1**（无 P 需求条目支撑）。A **明确声明本期不实现**；若 P 新增对应需求，**回 A 再冻结**。 |
| **V7** | 技术减负争议（2 vs 4 来源）未承接为风险 | **已补**：§二 P-05 风险节新增"采纳率不确定性"风险项。 |
| **V8** | 答案/解析覆盖缺口（50.0%/58.4%）无方案 | **已补**：§六 新增"答案/解析覆盖欠账"呈现设计；补录归 P-02/P-10，**不新增端点**。 |
| **V9** | `T-05b`/`T-09b` 仅"build 绿" | **已加强**：§三任务表改为须附实际操作截图 + 请求-响应日志。 |
| **V10** | 未评估"幂等重导不更新归属"与"写生产库" | **已补**：§八 风险 1 / 风险 3 给出定义与机制。 |

---

## 一、方案总览

### 1.1 一句话技术路径（逐 P0）

- **P-01 端到端省时实测**：新增**离线计时脚本** `scripts/bench_e2e.py` + 人工对照协议，冻结**计时日志 JSON 结构**；不碰 Web/DB，导出段**仅 Windows 宿主**可跑。
- **P-05 Web 零培训首次产出**：新增 **DOCX 导入**路由 `POST /api/import/docx`（multipart）→ **复用现有单线程作业范式**（`jobs.py` + `GET /api/jobs/{id}`）→ 编排 `pipeline.stage1.process_file` → `bank.importer` → `bank.enrich` → `bank.answers`，**写库走 `db.write_txn()`**（**写前 preimport 备份**，见 §八 风险 3）；前端新增导入页。
- **P-09 贡献者署名与组织归属**：新增**幂等迁移** `ensure_contributor_columns()`（`source_files.owner` / `questions.contributor`）+ **归属标识字符串模型**（无账号/无鉴权）；新增 `GET /api/contributors/summary`；`created_by` 落地；**统一"未指定"哨兵为 `'待补充'`**（见 §八 待拍板 2）。

### 1.2 三条贯穿全局的技术裁定（先立后破）

| # | 裁定 | 依据 |
|---|---|---|
| **裁定 A** | **新增列一律走幂等 `ensure_*_columns()`，绝不改 `bank/db.py` DDL、不 bump `SCHEMA_VERSION`** | 项目既有范式：`ensure_answer_columns` / `ensure_provenance_columns` / `ensure_version_snapshot_columns` 均如此；`bank/db.py` 是冻结文件 |
| **裁定 B** | **Web 导入/回填等长任务一律复用 `JobManager` 单后台线程**（不新造第二套作业系统） | `webui/jobs.py` 已保护 editor_sdk/COM 单实例；统一入口便于 `GET /api/jobs/{id}` 复用 |
| **裁定 C** | **免登录场景下"用户"= 归属标识字符串**（非账号、非鉴权） | 与 `editions/local` 免登录一致；假设 B 未验证前不得引入账号体系 |

### 1.3 现状校准（避免踩 R 已标注的坑）

- `paper_questions` 实测 **33**（非文档 25）；导出耗时**无原始证据**——P-01 必须**自己新测**，不得引用旧数字。
- 交付库在**主仓库** `D:/Open-source project/Localtopic-management/outputs/bank.db`，**不在本 worktree**。任何写库动作前先 `cp` 到副本或先备份。
- 知识点"97.2%"是**提及**口径，非**考查**——P-03 口径修正不得把提及当考查。
- **`papers.created_by` 为 `TEXT NOT NULL DEFAULT '待补充'`**（`bank/db.py:176`）——归属字段必须与该哨兵口径对齐（见 §八 待拍板 2）。
- **`question_labels.review_status` 实测 100% 为"待复核"、"已确认"=0**——"考查口径"上线即空集，必须做防护（见 §八 风险 2）。

---

## 二、逐需求方案（P0/P1）

### P-01 · 端到端净时间对照实测【P0】

**技术路径**
- 新增 `scripts/bench_e2e.py`（离线脚本，非 Web）：对"导入 N 份 DOCX → 检索选题 → 组卷 → 导出 DOCX"分步计时，重复 ≥3 次。
- 复用：`pipeline/stage1.py`（阶段1 计时已在 `stage1.py:124-156`）、`bank.importer`、`bank.paper`、`bank.export`。
- 人工对照（`T_manual`）为**流程任务**，非代码：≥2 名教师用 Word 手工组同一份 ≥10 题试卷并计时。
- **不涉及任何 DB schema / API / 前端**。导出段依赖 editor_sdk+Office，**只能 Windows 宿主执行**。

**契约冻结（本需求唯一冻结物 = 计时日志结构）**
- 文件：`outputs/bench/e2e-<run_id>.json`
- 结构（冻结）：
  ```json
  {
    "run_id": "string",
    "started_at": "ISO8601",
    "steps": [{"name": "import|search|compose|export", "start_ts": "ISO8601", "end_ts": "ISO8601", "seconds": 0.0}],
    "total_seconds": 0.0,
    "files_imported": 0,
    "questions_selected": 0
  }
  ```
- 汇总表：`outputs/bench/e2e-summary.md`，含 `T_tool`、`T_manual`、净节约分钟、中位数。

**风险与未知**
- 导出耗时**无历史可信值**（R 已证），P-01 必须新测；桥接抖动会造成单次异常 → 取中位数。
- `T_manual` 依赖真人，非自动可复现 → 以"原始计时日志 + 见证人"留证。

**工作量量级**：**小**（脚本 + 协议）。无前置依赖。

---

### P-05 · Web 零培训首次产出（DOCX 导入入口）【P0】

**技术路径（改哪些模块 / 新增哪些文件）**
- 新增后端：`webui/routers/ingest.py`、`webui/services/ingest_svc.py`；在 `webui/routers/__init__.py` 的 `ROUTERS` 注册。
- 复用：`pipeline.stage1.process_file(path, out_dir, timeout, verbose)`（**可编程调用**，非 CLI）；`bank.importer` 导入 JSON；`bank.enrich` 补元数据；`bank.answers` 抽答案；`webui.jobs.get_manager()` 提交作业；`webui.db.write_txn()` 写库。
- 上传文件落盘到临时目录（`.tmp_import/<job_id>/`），解析成功后**清理**；**失败必须回滚**（importer 单文件导入本身是原子事务）。
- 导入**幂等**：`source_files.sha256` UNIQUE，重复文件返回 `skipped=true`，不报错。
  - **归属例外（本次新增，见 §八 风险 1）**：重复导入若**显式传入 `owner`**，仍**覆盖**该来源归属并回填 `contributor`（内容不变，仅归属更新）。
- **写库防护（本次新增，见 §八 风险 3）**：进入写库前对目标 DB 做 **preimport 备份 + `verify_backup`**；写库段单事务，失败回滚。
- 新增前端：`frontend/src/pages/ImportPage.tsx`、`frontend/src/api/import.ts`；路由挂载到 `App.tsx`。
- 不改 schema。**新增功能位** `settings.features.import_enabled`（默认 `true`，见 §4.3 / §五）。

**契约冻结**

- **端点**：`POST /api/import/docx`
  - Method：`POST`，`multipart/form-data`
  - 请求字段：`file`（UploadFile，必填，`.docx`）、`owner`（str，可选，缺省取 `settings.default_owner`）、`stage`（str，可选，默认 `初中`）、`subject`（str，可选，默认 `物理`）、`enrich`（bool，可选，默认 `true`）、`extract_answers`（bool，可选，默认 `true`）
  - 响应：`{"code":0,"data":{"job_id":"<hex>","kind":"import"},"message":"ok"}`
  - 轮询：**复用** `GET /api/jobs/{job_id}`（不新增）
  - 作业 `result` 载荷（冻结，**本次新增 `owner` / `owner_applied`**）：
    ```json
    {"source_id": 1, "file_name": "xxx.docx", "sha256": "…", "skipped": false,
     "owner": "张三", "owner_applied": true,
     "questions_added": 0, "formulas": 0, "images": 0,
     "coverage": {"grade": 0.0, "textbook": 0.0, "chapter": 0.0, "qtype": 0.0},
     "elapsed_ms": 0, "backup_path": "outputs/bank.backup-<ts>-preimport.db"}
    ```
  - **错误码（修正：不再用 `40001`；完整映射见 §4.4）**：`40009`（file 缺失/为空）、`40008`（格式不支持/非 .docx/超限）、`50001`（stage1/桥接异常、写库失败）
- **新增错误码（本次）**：`CODE_MISSING_UPLOAD = 40009`；`CODE_INVALID_UPLOAD = 40008`（沿用 v1 冻结编号）
- **数据模型变更**：无（仅写既有表）
- **前端接口位**：
  - 页面：`ImportPage`，路由 `/import`
  - 依赖 queryKey：复用 `qk.job(jobId)`（`ROOT.job`），**不新增键**
  - api 模块：`frontend/src/api/import.ts`

**风险与未知**
- `stage1` 是否可被服务层"干净"地按单文件调用（其 `main()` 是目录级）→ **D 必须先写探针**确认 `process_file` 单文件路径，不得在生产代码试错。
- 导入是**写交付库**的操作：**运行期**按 §八 风险 3 的备份/事务/回滚机制执行；**D/T 的验证一律用副本**（铁律 5）。
- 复用单线程作业 ⇒ **导入会与预览/导出串行排队**（可接受，需在 UI 明示"正在导入"）。**导入时长上界未知**（阶段1 实测 ~0.32s/文件，但含公式的复杂文件可能显著更慢）→ 需在 job 内回报进度/耗时，UI 明示排队。
- **采纳率不确定性（本次新增，V7）**：报告"待完善 #6"指出技术减负证据不对称（支持方 2 来源 < 反对方 4 来源）。导入功能可能**未被教师采纳**（甚至被视为增负）→ 本需求设**功能位可关闭**（`features.import_enabled`），并把"实际采纳率"作为 T-05V 的观测项，**不得以"功能已实现"替代"被采纳"**。
- 假设 A 未验证前，本需求的**规模**存疑（见第五节开关）。

**工作量量级**：**大**（后端编排 + 前端页面 + 探针）。前置依赖：无（但**假设 A 影响规模**）。

---

### P-09 · 贡献者署名与组织归属【P0】

**技术路径**
- 新增 `bank/contributor.py`（**非冻结模块**）：
  - `ensure_contributor_columns(conn)`：幂等 `ALTER TABLE` 加 `source_files.owner TEXT`、`questions.contributor TEXT`（**仅当列不存在**）。
  - `set_source_owner(conn, source_id, owner)`：设来源归属，并**回填该来源下全部题的 `contributor`**。
  - `contributor_summary(conn)`：`papers/questions/sources` 三张 `GROUP BY` 统计 + `unassigned` 计数。
- 复用 `bank/edit.py::update_file_metadata`：扩展支持 `owner`（文件级、`confirm` 门禁、同步 `contributor`）。
- 复用 `bank/paper.py::create_paper`（签名已支持 `created_by`，`paper.py:526`），`webui/services/papers.py::create_paper` 补透传。
- 迁移**幂等、可回滚**：见 1.2 裁定 A；旧库 2 张 `papers.created_by='待补充'` 由一次性回填脚本按 `settings.default_owner` 处理（无配置则保留并显示"未指定"）。
- 前端：`PaperBuilderPage`/`PaperPanel`、`QuestionDetailPage`、`SourcesPage` 展示归属；`StatsPage` 增加贡献统计区块。

**契约冻结**

- **端点 1**：`GET /api/contributors/summary`
  - 响应 data：`{"papers":[{"created_by":"…","count":0}], "questions":[{"contributor":"…","count":0}], "sources":[{"owner":"…","count":0}], "unassigned":{"papers":0,"questions":0,"sources":0}}`
  - **`unassigned` 判定冻结（本次修订）**：`IN (NULL, '', '待补充')`（对齐 `bank/query.py:485-491` 的 `MISSING_SENTINELS` 口径）。
- **端点 2（既有，additive）**：`POST /api/papers` 请求体新增可选字段 `created_by: str | null`（缺省取 `settings.default_owner`，再缺省 `'待补充'`）
- **端点 3（既有，additive）**：`PATCH /api/papers/{paper_id}` 请求体新增可选字段 `created_by`
- **端点 4（既有，additive）**：`POST /api/sources/{source_id}/metadata` 请求体 `SourceMetadataRequest` 新增可选字段 `owner: str | null`；带 `owner` 时**同步该来源全部题的 `contributor`**，仍受 `confirm` 门禁（未确认 → `40903`）
- **端点 5（既有，响应 additive）**：`GET /api/questions/{id}` 响应新增字段 `contributor: str | null`
- **端点 6（既有，additive；本次补入）**：`PUT /api/settings` 请求体 `SettingsUpdate` 新增可选 `default_owner`（见 §4.3）
- **数据模型变更**（**v4，additive，全部 nullable，无 NOT NULL / 无类型变更 / 无删列**）：
  - `source_files.owner TEXT`
  - `questions.contributor TEXT`
  - 迁移方式：`bank/contributor.py::ensure_contributor_columns`（幂等）
  - **备份**：`cp` 交付库 → `outputs/bank.backup-<ts>-v4.db`；`verify_backup(原库, 备份)`（**原库在前**），判定 `structure_ok + integrity_ok + core_nonempty`
  - **回滚**：用备份文件覆盖还原（迁移为纯 ADD COLUMN，回滚即还原）
- **前端接口位**：
  - 页面/组件：`PaperBuilderPage`、`PaperPanel`、`QuestionDetailPage`、`SourcesPage`、`StatsPage`、`SettingsPage`
  - queryKey：新增 `qk.contributors()`（根 `'contributors'`）、`qk.contributorsSummary()`（`['contributors','summary']`）

**身份标识方案（A 裁定，回答 P-09 前置依赖）**
> **归属标识 = 字符串**。取值优先级：① 导入/建卷请求显式传入 → ② `settings.default_owner`（教师首次填一次）→ ③ **`'待补充'`**（统一哨兵；UI 显示"未指定"，可补填）。
> **不做账号、不做鉴权、不做权限**。理由：与 `editions/local` 免登录一致；假设 B（情感层）未验证，不引入账号体系。
> **归一规则（本次冻结）**：`owner`/`created_by`/`contributor` 若为 `NULL` 或空串 `''`，**一律归一为 `'待补充'` 后再入库/统计**（`papers.created_by` 为 `NOT NULL`，必须归一）。

**风险与未知**
- P-09 验收 #1 原写"字段非'待补充'"——**本次收紧**（见 §八 待拍板 2）：改为"**已配置 `default_owner` 为具体人名时，`owner` 等于该人名**"；并单列"未配置时如实显示'未指定'（= `'待补充'`）"对照用例。理由：`''` 也"非'待补充'"，原口径**可被空串假通过**。
- `settings.json` 需新增 `default_owner`（默认 `'待补充'`）；`SettingsUpdate` 与设置页需同步（additive）。
- 文件级 `owner` 变更会重写该来源全部题的 `contributor`（影响面 = 该来源题数，与既有 grade/textbook 编辑同构），必须走 `confirm`。

**工作量量级**：**中**（迁移 + 服务 + 4 处既有端点 additive + 前端展示）。前置依赖：无。

---

### P-02 · 素材沉淀标注覆盖率提升【P1】

**技术路径**
- 主要矛盾是**数据缺口**（教研补录），工程侧只做两件事：
  1. 增强 `bank/enrich.py` 的**文件名/路径推断**（八上/八下等缩写；R 记录"可靠文件名候选 0%"，需先诊断再改）。
  2. 让既有**知识点三态复核工作流**真正可批量执行（`labels.py` 已有 `set_review_status`/`import_review`，`question_labels` 100% 待复核）：新增**批量确认入口**。
- 不改 schema（复用 `labels` / `question_labels`）。

**契约冻结**
- **端点（既有，additive）**：`POST /api/labels/decision` 已存在；**新增** `POST /api/labels/decision/batch`，请求 `{label_name, decision, question_ids: [int], confirm: bool}`，响应 `{updated, missing}`；`confirm=false` → `40903`。
- 覆盖率读数复用既有 `GET /api/search` 的 `coverage` 域（`qk.coverage()`），**不新增**。
- **数据模型变更**：无。

**风险与未知**
- P-02 目标（grade/textbook ≥90%）**非纯工程可达**，依赖教研补录；工程只能提升"可确认效率"。若教研投入不足，目标须如实下调并呈现欠账（R 已警示）。
- 推断增强可能引入**错误标注**，必须配"抽样 30 题人工核对 ≥95%"（P 已定）反向约束，不得静默推断。
- **P-02 是 P-03"考查口径"可用的前置**（见 §八 风险 2）：未批量确认前，"已确认"标签数为 0。

**工作量量级**：**中**（推断诊断 + 批量确认 UI）。前置依赖：P-10（立项门禁）、教研数据源。

---

### P-03 · 元数据维度扩展与知识点口径修正【P1】

**技术路径**
- 新增 `bank/enrich.py::ensure_taxonomy_columns(conn)`（幂等）：`questions.cognitive_level TEXT`、`questions.content_domain TEXT`（**可空，不强制录入**，满足 C24）。
- 编辑链路：`bank/edit.py::save_question` 增加对这两个字段的**差异检测 + 写回**（与 `difficulty` 同构）；`QuestionPatch` 增加两字段。
- 检索链路：新增 `bank/query.py::search_with_taxonomy()`（**本次授权收紧，见 §4.6**）——复用 `_build_where`（**调用，不改**）+ 追加两个新 WHERE 片段；`webui/services/search.py` 切换到该函数。
- **知识点口径修正（提及→考查）**：不新增字段，**定义**为——`question_labels.review_status='已确认'` 的标签即"考查"口径；`待复核` = "提及"口径。复用既有三态工作流，教研用抽样 50 题对照产出证据。
  - **空集防护（本次新增，见 §八 风险 2）**：当前"已确认"=0，该口径上线即空集 → UI 必须显式禁用 + 引导，不得静默返回空。
- 前端：`QuestionDetailPage` 编辑表单加两字段（下拉可配置）；`FilterSidebar` 加两个筛选；`searchParams.ts` 扩展。

**契约冻结**
- **端点（既有，additive）**：`PUT /api/questions/{id}` 的 `QuestionPatch` 新增可选 `cognitive_level`、`content_domain`
- **端点（既有，additive）**：`GET /api/search` 新增可选查询参数 `cognitive_level`、`content_domain`
- **响应 additive（本次新增）**：`GET /api/search` 的 `facets`/`coverage` 增 `cognitive_level`、`content_domain` 的取值分布（含"未标注"桶），供前端呈现空集原因
- **数据模型变更**（**v4，additive，nullable**）：
  - `questions.cognitive_level TEXT`
  - `questions.content_domain TEXT`
  - 迁移：`ensure_taxonomy_columns`（幂等）；备份/回滚同 P-09（同一 v4 备份）
- **口径冻结**：`cognitive_level`/`content_domain` **v1 不做枚举强校验**（P-03 冲突 1 明确"字段口径需教研确认"）；UI 下拉列表来自可配置项，**非法值不阻断**（自由文本兜底）。
- **前端接口位**：`QuestionDetailPage`、`FilterSidebar`、`searchParams.ts`；queryKey 复用 `qk.search(params)` / `qk.question(id)`

**风险与未知**
- **`bank/query.py` 授权**是硬前置：未授权则本需求无法落地（不得把筛选逻辑塞进 webui 复制）。
- 认知层级/内容领域**标注成本与 C24 零录入存在张力**：v1 只提供**可选人工入口**，不做自动标注（P 已列"明确不做 8"）。
- 口径"考查=已确认"是**复用性裁定**，若教研不认可，需回到 A 再冻结（成本低，因不涉及 schema）。
- **自由文本精确匹配的预期行为（本次冻结）**：`cognitive_level=某值` 用 `=` 精确匹配，**不匹配时返回空集（`total=0`）而非报错**——这是**预期行为**，UI 需显示"0 结果（该维度无精确匹配）"，不得当作 bug。

**工作量量级**：**中**（迁移 + 编辑 + 检索授权 + 前端）。前置依赖：P-10、教研字段口径确认、P-02（考查口径可用）。

---

### P-04 · 难度检索维度可用【P1】

**技术路径**
- **API 已具备**：`GET /api/search` 已支持 `difficulty` 参数（`webui/services/search.py:54,74`；`bank/query.py:33`）。**无需新端点**。
- **真实缺口在数据**：难度 100% 未标注 → 依赖 **P-07 回填** 才有可用维度。
- 前端：`FilterSidebar` 难度筛选项可用；未标注题显示灰色"未标注"徽章（`questions.difficulty` 默认值即 `'未标注'`），**不隐藏**。

**契约冻结**
- **端点**：无新增（复用 `GET /api/search` 的 `difficulty`）。
- **数据模型变更**：无。
- **验收标准细化（不弱化，反而收紧）**：P 给的 `difficulty IS NOT NULL AND difficulty <> ''` 因列默认值为 `'未标注'`，**恒 >0、不构成有效判定**；冻结为：
  `SELECT count(*) FROM questions WHERE difficulty IN ('易','中','难');` **> 0**
- **前端接口位**：`FilterSidebar`、`searchParams.ts`；queryKey 复用 `qk.search(params)`

**风险与未知**
- 依赖 P-07 与**假设 G**（教师是否真按难度筛题）；若 G 证伪，仅需隐藏筛选项，**数据层零返工**。

**工作量量级**：**小**（数据就绪后几乎零代码）。前置依赖：**P-07**。

---

### P-06 · 物理规范图示行内位置保真【P1】

**技术路径（本需求按"先验证、后实现"设计）**
- **阶段 1（本轮只做，且必须先做）——探针/对照实测**（假设 E）：
  - 新增 `spike/image_inline/`（**非生产代码**）：构造 20 道含矢量箭头/单位/量纲/受力图/电路图/光路图/v-t 图的题，导出，请 **3 名教师**核对"是否可用/是否需手工重排"。
  - 冻结**对照报告结构**：`{"items":20,"needs_manual_rework":0,"ratio":0.0,"verdict":"升P0|保持P1"}`；判定阈值：>30% 需手工重排 → 升 P0。
- **阶段 2（仅当 E 证实后启动，本轮不实现）——行内锚定**：
  - 目标：题干内图片按占位符 `⟦I1⟧` 定位插入（与公式 `⟦Fn⟧` 同构），而非"统一居中附于题干后"。
  - 涉及：`pipeline/stage1.py`（产出图片行内位置/占位符）、`bank/db.py`（`images` 表，**冻结**）、`bank/export.py`（插入逻辑，**冻结**）。
  - **这两处冻结文件改动需明确授权**；`questions.text` 若引入图片占位符将改变 `content_hash` → 需迁移，风险大。

**契约冻结（本轮仅冻结探针产物，不冻结行内锚定的数据模型）**
- 冻结：`spike/image_inline/report.json` 结构（见上）。
- **不冻结**（待 E 证实后再由 A 冻结）：`images` 表新增列、`questions.text` 占位符方案、导出插入 API。
- **功能位预留**：阶段 2 实现必须置于开关 `export.inline_images`（默认 **关**），E 未证实不得开启。

**风险与未知**（本项目**最大技术风险**）
- 涉及 `export.py`（冻结）+ Windows-only + `pipeline` + schema 三线联动，且被**未验证假设 E** 门控。
- 超长单题跨页（AGENTS §8.2）与图片定位叠加，可能相互放大。
- 若阶段 1 判定"影响面小"，则**不实现阶段 2**（避免过度设计）。
- **须回写 P**（V4）：阶段 1 探针结论（图示失真影响面）应回填 P 的 C11/C12 判定。

**工作量量级**：阶段 1 **小**；阶段 2 **大**（且被 E 门控）。前置依赖：假设 E 实测。

---

### P-07 · 难度实测回填流程【P1】

**技术路径**
- 关键事实：`bank/edit.py::save_question` **已把 `difficulty` 变更当作版本事件**（`edit.py:318,372`），且 `_build_snapshot` **含 `difficulty`**（`edit.py:189`）→ 版本快照天然留存难度历史。
- 最小改动：`bank/edit.py::save_question` 增加可选参数 `change_source: str = "edit"`（**向后兼容**），替换 `edit.py:423` 的硬编码 `"edit"`。
- 新增 `webui/services/questions.py::backfill_difficulty()`：调用 `save_question(conn, qid, {"difficulty": level}, change_source="difficulty_backfill")`。
- **既有 `POST /api/questions/{id}/difficulty`（快速标注）保持原样、不建版本**；回填走**新端点**（建版本）。这是**冻结的刻意分歧**：快速标注是筛题辅助，回填是正式留痕（P-07 #2 只要求回填留版）。
- 历史查询：从 `question_versions.snapshot_json` 解析 `difficulty`。
- 前端：`QuestionDetailPage` 增加"实测回填"入口（含备注）；`VersionHistory` 可复用。

**契约冻结**
- **端点 1（新增）**：`POST /api/questions/{question_id}/difficulty/backfill`
  - 请求：`{"level":"易|中|难","note":null}`
  - 响应 data：`{"question":{…},"difficulty":"中","version":2}`
  - 错误码：`40002`（非法难度）、`40401`（题不存在）
- **端点 2（新增）**：`POST /api/questions/difficulty/backfill/batch`
  - 请求：`{"ids":[1,2],"level":"中","note":null}`
  - 响应 data：`{"updated":2,"missing":[],"difficulty":"中"}`
- **端点 3（新增）**：`GET /api/questions/{question_id}/difficulty/history`
  - 响应 data：`[{"version":1,"difficulty":"未标注","change_source":"import","created_at":"…"}]`
- **数据模型变更**：**无**（复用 `questions.difficulty` + `question_versions.snapshot_json`/`change_source`）。
- **前端接口位**：`QuestionDetailPage`；queryKey 新增 `qk.questionDifficultyHistory(id)`（根 `'question-difficulty-history'`）

**风险与未知**
- 回填会 `questions.version+1` → 已组卷的该题在 `GET /api/papers/{id}` 中标记 `stale=true`（语义正确但用户可能困惑）→ UI 需给出"题库已更新"提示（复用既有 `lockedSnapshot` 术语）。
- 快速标注（无版本）与回填（有版本）**双写路径**是刻意设计，需在 UI 文案上区分；若日后要求统一，属**再冻结**。

**工作量量级**：**小**（`change_source` 参数 + 3 端点 + 前端入口）。前置依赖：无。

---

### P-08 · 跨年级继承与结构化复用【P1】

**技术路径**
- **关键事实**：`bank.paper.add_questions` **本就跨来源/跨年级可用**（无年级限制）；快照锁定（`paper_questions.question_version` + `snapshot_json`）已实现；引用不复制，`source_id`/贡献者天然不变。
- 真实缺口仅在**前端交互**：`PaperBuilderPage` 的选题/拖拽（AGENTS §8.2：拖拽限同大题内）。本需求**不新建"继承机制"**，仅确保"跨年级检索 → 加入当前卷"路径畅通，并补一个归属不变的显式验证。
- 不改 schema、不新增端点（复用 `POST /api/papers/{id}/questions`）。

**契约冻结**
- **端点**：无新增。
- **数据模型变更**：无。
- **验收标准（细化为可执行）**：
  1. 从八下题加入九上卷：`POST /api/papers/{pid}/questions` 成功；`SELECT q.source_id, q.contributor FROM questions q JOIN paper_questions pq ON pq.question_id=q.id WHERE pq.paper_id=<pid>` 与加入前**逐行一致**。
  2. 改原题（`PUT /api/questions/{id}`）后，`SELECT snapshot_json FROM paper_questions WHERE paper_id=<pid>` **字节不变**（快照锁定）。
- **前端接口位**：`PaperBuilderPage`；queryKey 复用 `qk.paper(id)` / `qk.search(params)`

**风险与未知**
- 依赖**假设 F**（跨年级复用需求是否真实）；若不成立，本需求**零返工**（因为没建专属机制）。
- P-08 依赖 P-09 的 `contributor` 字段才能验证"贡献者不变"。

**工作量量级**：**小**（前端检索/加题交互 + 验证）。前置依赖：P-09、假设 F。

---

### P-10 · 功能成本-收益评审门禁【P1】

**技术路径**
- **纯流程产物，无代码、无 API、无 schema**。
- 新增 `outputs/process/功能立项模板.md`（必填：预计省时分钟数、证据来源主张编号、验证方式、优先级理由）+ 3 份填写记录。
- 可选：`scripts/check_feature_proposal.py` 做模板字段完整性 lint（非必需）。

**契约冻结**
- 无端点、无模型变更。
- **模板必填字段冻结**：`功能名 / 预计省时分钟数 / 证据来源(主张编号) / 验证方式 / 优先级理由 / 是否通过门禁`。

**风险与未知**：属"元要求"，若无人执行则形同虚设 → 由 P-10 作为后续所有立项的**前置约束**先行落地。

**工作量量级**：**小**。前置依赖：无（应最先落地）。

---

## 三、任务拆分

> 每条可独立验收；验收方式照抄/细化 P 的验收标准（**只收紧不弱化**）。归属：**D** 开发 / **T** 测试。
> 数据库相关任务**一律先备份 + 副本验证**（铁律 4/5）。**导入类任务的运行期写入按 §八 风险 3 执行。**

| 编号 | 标题 | 依赖 | 归属 | 验收方式（可执行） |
|---|---|---|---|---|
| **T-A00** | G1 契约冻结（本文件） | — | A | 本文件存在；第四节端点/模型/错误码清单齐备；§4.5 双向核对通过 |
| **T-P10** | 功能立项模板落地 | — | D | `outputs/process/功能立项模板.md` + 3 份记录；抽查 3 候选功能模板齐全 |
| **T-01** | P-01 计时脚本 + 协议 | — | D | `scripts/bench_e2e.py` 跑 ≥3 次，产出符合冻结结构的 `e2e-<id>.json`；汇总 `T_tool` 中位数 |
| **T-01V** | P-01 对照验证 | T-01 | T | 独立跑脚本；≥2 名教师手工计时记录；判定 `T_tool < T_manual` |
| **T-05a** | P-05 导入后端（探针→路由→服务） | T-A00 | D | ①先提交 `stage1.process_file` 单文件探针日志；②`POST /api/import/docx` 返回 job_id；③**副本库**导入 1 份 DOCX 后可检索；④重复导入 `skipped=true`；⑤**重复导入且显式带新 `owner` 时 `source_files.owner` 与 `contributor` 被更新**（job result `owner_applied=true`）；⑥**错误码**：缺 file→`40009`、非 .docx→`40008`、桥接异常→`50001`；⑦**写库前存在 `outputs/bank.backup-<ts>-preimport.db` 且 `verify_backup` 通过**；坏文件导入后库可回滚 |
| **T-05b** | P-05 导入前端 | T-05a | D | `ImportPage` 拖拽上传→轮询 `GET /api/jobs/{id}`→完成提示；`npx tsc --noEmit` + `npm run build` 通过；**附实际操作截图 + 请求-响应日志（网络面板或 curl），不得仅以 build 绿为证据**（V9） |
| **T-05V** | P-05 独立验证 | T-05a,T-05b | T | ≥3 名未受训教师仅凭界面完成"导入→检索→组卷→导出"，无 CLI；断网+免登录；额外学习步骤=0；计时表 + 操作日志；**记录实际采纳率观测**（V7） |
| **T-09a** | P-09 迁移 + 服务 + 端点 | T-A00 | D | 备份 `verify_backup(原库,备份)` 三项通过；`ensure_contributor_columns` 幂等（重复执行无副作用）；`GET /api/contributors/summary` 三张 GROUP BY 可统计；**`unassigned` 判 `IN(NULL,'','待补充')`；`owner=''`/NULL 归一为 `'待补充'` 后入库** |
| **T-09b** | P-09 前端展示 | T-09a | D | 试卷/题目/来源页显示归属；`tsc`/`build` 通过；**附界面截图（含"未指定"对照用例）**（V9） |
| **T-09V** | P-09 独立验证 | T-09a,T-09b | T | `SELECT created_by,count(*) FROM papers GROUP BY created_by` 可统计；**已配置 `default_owner` 为具体人名时新导入 `owner` == 该人名**；未配置时显示"未指定"（=`'待补充'`）；**构造 `owner=''` 反例确认不被计入"已归属"**；界面截图 |
| **T-14** | E14 设置端点 additive | T-A00 | D | `PUT /api/settings` 接受 `default_owner`（默认 `'待补充'`）与 `features.import_enabled`（默认 `true`）；`GET /api/settings` 回读一致；`default_owner=''` 归一为 `'待补充'`；关闭 `import_enabled` 后 `POST /api/import/docx` 返回明确错误（见 §4.4） |
| **T-03a** | P-03 迁移 + 编辑支持 | T-A00 | D | `ensure_taxonomy_columns` 幂等；`SELECT count(*) FROM questions WHERE cognitive_level IS NOT NULL` 可执行；导入不因字段缺失失败 |
| **T-03b** | P-03 检索维度 + 前端 | T-03a, **query.py 授权** | D | ①`search_with_taxonomy` 在**旧参数**下与 `search_full` 结果集（total+逐条 id 顺序）**逐条一致**（回归）；②`GET /api/search?cognitive_level=…` 返回集与等价 SQL `id` 列表逐条一致；③**自由文本精确匹配无命中 → `total=0`（空集，非报错）**，前端显示"0 结果"；④`git diff` 证明**未改** `_build_where`/`search`/`search_full` 函数体 |
| **T-03V** | P-03 独立验证 | T-03a,T-03b | T | 口径对照：抽样 50 题"考查"标签 vs "提及"结果，差异可量化；**空集防护验证**：构造"未标注占多数"副本，断言按新维度/考查口径筛选返回 0 时**界面有提示且 facets 含"未标注"桶**；schema 输出 + 界面截图 |
| **T-07** | P-07 回填服务 + 3 端点 | T-A00 | D | 回填后 `questions.difficulty` 更新；`question_versions` 新增行 `change_source='difficulty_backfill'`；前后 SQL 对照旧值可查 |
| **T-07V** | P-07 独立验证 | T-07 | T | 独立构造回填，读 `snapshot_json` 校验历史值；`GET /difficulty/history` 与 SQL 逐条一致 |
| **T-04** | P-04 难度筛选 | T-07 | D | `SELECT count(*) FROM questions WHERE difficulty IN ('易','中','难') > 0`；`GET /api/search?difficulty=易` 与等价 SQL 逐条一致；未标注题显示灰色徽章且**不隐藏** |
| **T-06S** | P-06 图示探针（假设 E） | — | D | `spike/image_inline/report.json` 符合冻结结构；3 名教师核对；判定升 P0 / 保持 P1；**结论回写 P（V4）** |
| **T-08** | P-08 跨年级复用验证 | T-09a, 假设 F | D | 跨年级加题后 `source_id`/`contributor` 逐行不变；改原题后 `snapshot_json` 字节不变 |
| **T-02** | P-02 推断增强 + 批量确认 | T-P10 | D | 覆盖率 SQL 输出；抽样 30 题人工核对 ≥95%；批量确认后 `question_labels.review_status` 变化可见 |
| **T-ALL-V** | 汇总独立验证（G3） | 全部 | T/V | 后端 `python -m unittest discover -s tests`（基线 387）；`cd frontend && npx tsc --noEmit && npm test`；**交付库 sha256 前后一致**（导入验证在副本上进行） |

**依赖关系图（关键路径）**
```
T-A00 ──┬─ T-05a ─ T-05b ─ T-05V
        ├─ T-09a ─ T-09b ─ T-09V ─ T-08
        ├─ T-14
        ├─ T-03a ─ T-03b(query.py授权) ─ T-03V
        ├─ T-07 ── T-04 ─ T-07V
        └─ T-01 ─ T-01V
T-P10 ──┬─ T-02 ── (P-03 考查口径可用前置)
        └─ (T-03/T-05 立项前置)
T-06S（独立，门控 P-06 阶段2）
```

**归属统计（修正 v1 的计数错误）**：D 任务 **14**（T-P10、T-01、T-05a、T-05b、T-09a、T-09b、T-14、T-03a、T-03b、T-07、T-04、T-06S、T-08、T-02），T 任务 **5**（T-01V、T-05V、T-09V、T-03V、T-07V），T/V 联合 **1**（T-ALL-V），A **1**（T-A00），**合计 21**。
> v1 声称"D 11 / T 8 / A 1"，实为误计；本版以实际行为准。

---

## 四、契约冻结声明（G1）

> 本清单为 **G1 门禁**产物。冻结后**不得擅自更改**；要改必须回到 A 重新冻结并通知所有依赖方。

### 4.0 现有全部错误码（**亲自读 `webui/errors.py` 的事实基础**）

| 码 | 常量 / 类 | 语义 | HTTP |
|---|---|---|---|
| 40000 | `ValidationError` | 参数/校验错误（**兜底**） | 400 |
| 40001 | `CODE_PLACEHOLDER_MISSING` / `PlaceholderMissing` | **题干占位符缺少对应公式** | 400 |
| 40002 | `CODE_INVALID_DIFFICULTY` / `InvalidDifficulty` | 非法难度档位 | 400 |
| 40003 | `CODE_INVALID_TEMPLATE` / `InvalidTemplate` | 非法模板/答案模式/试卷状态 | 400 |
| 40004 | `CODE_INVALID_SCORE` / `InvalidScore` | 非法分值 | 400 |
| 40005 | `CODE_INVALID_CSV` | CSV 非法 | 400 |
| 40006 | `CODE_INVALID_SETTINGS` | 非法设置 | 400 |
| 40007 | `CODE_INVALID_REVISION` | 非法修订请求（`PaperRevisionRequest`） | 400 |
| 40400 | `NotFoundError` | 资源不存在（**兜底**） | 404 |
| 40401 | `CODE_QUESTION_NOT_FOUND` | 题不存在 | 404 |
| 40402 | `CODE_PAPER_NOT_FOUND` | 试卷不存在 | 404 |
| 40403 | `CODE_ITEM_NOT_FOUND` | 试卷条目/题目不存在 | 404 |
| 40404 | `CODE_IMAGE_NOT_FOUND` | 图片缺失 | 404 |
| 40405 | `CODE_JOB_NOT_FOUND` | 作业不存在 | 404 |
| 40406 | `CODE_LABEL_NOT_FOUND` | 标签不存在 | 404 |
| 40407 | `CODE_REVIEW_NOT_FOUND` | 复核项不存在 | 404 |
| 40408 | `CODE_SOURCE_NOT_FOUND` | 来源文件不存在 | 404 |
| 40900 | `ConflictError` | 冲突（**兜底**） | 409 |
| 40901 | `CODE_CONTENT_CONFLICT` | 内容哈希重复 | 409 |
| 40902 | `CODE_NEED_FORCE` | 非空需 force | 409 |
| 40903 | `CODE_NEED_CONFIRM` | 批量/文件级操作未确认 | 409 |
| 40904 | `CODE_EXPORT_CONTENT_BLOCKED` | 导出内容被阻断 | 409 |
| 40905 | `CODE_EXPORT_EVIDENCE_STALE` | 导出证据过期 | 409 |
| 50001 | `CODE_INTERNAL` / `BridgeUnavailable` | 后端内部/环境错误（含 editor_sdk/COM/PDF） | 500 |

**空号**：`40008`、`40009`（本次占用）。其余 `400xx/404xx/409xx` 连续段内无其它空号。
**兜底映射注意**：`map_value_error` 按消息关键词映射（"占位符"→40001、"难度"→40002、"模板/答案模式/status 取值"→40003、"分值/分数"→40004、"不存在"→40401，默认 40000）。**导入服务必须显式抛带正确 code 的错误，不得依赖关键词兜底**（否则 "占位符" 等字样会误路由）。

### 4.1 本次冻结的端点清单（**E14 为本次新增；E1 错误码修正**）

| # | 路径 | 方法 | 关键字段 | 归属需求 | 类型 |
|---|---|---|---|---|---|
| E1 | `/api/import/docx` | POST | 请求：`file,owner,stage,subject,enrich,extract_answers`；响应：`{job_id,kind}`；**错误码见 §4.4** | P-05 | 新增 |
| E2 | `/api/contributors/summary` | GET | 响应：`papers[]/questions[]/sources[]/unassigned` | P-09 | 新增 |
| E3 | `/api/questions/{id}/difficulty/backfill` | POST | 请求：`level,note`；响应：`{question,difficulty,version}` | P-07 | 新增 |
| E4 | `/api/questions/difficulty/backfill/batch` | POST | 请求：`ids,level,note`；响应：`{updated,missing,difficulty}` | P-07 | 新增 |
| E5 | `/api/questions/{id}/difficulty/history` | GET | 响应：`[{version,difficulty,change_source,created_at}]` | P-07 | 新增 |
| E6 | `/api/labels/decision/batch` | POST | 请求：`label_name,decision,question_ids,confirm`；响应：`{updated,missing}` | P-02 | 新增 |
| E7 | `/api/papers` | POST | 请求 **新增可选** `created_by`（缺省 `default_owner` → `'待补充'`） | P-09 | 既有 additive |
| E8 | `/api/papers/{id}` | PATCH | 请求 **新增可选** `created_by` | P-09 | 既有 additive |
| E9 | `/api/sources/{id}/metadata` | POST | 请求 **新增可选** `owner` | P-09 | 既有 additive |
| E10 | `/api/questions/{id}` | PUT | `QuestionPatch` **新增可选** `cognitive_level,content_domain` | P-03 | 既有 additive |
| E11 | `/api/questions/{id}` | GET | 响应 **新增** `contributor` | P-09 | 既有 additive |
| E12 | `/api/search` | GET | **新增可选** 参数 `cognitive_level,content_domain`；响应 facets **新增** 两维度分布 | P-03 | 既有 additive |
| E13 | `/api/jobs/{job_id}` | GET | 复用（P-05 导入轮询），**不改** | P-05 | 复用 |
| **E14** | **`/api/settings`** | **PUT** | **请求新增可选 `default_owner`（默认 `'待补充'`）、`features.import_enabled`（默认 `true`）** | **P-09 / P-05** | **既有 additive（本次补入）** |

**统一响应**：一律 `{code, data, message}`；成功 `code=0`。
**错误码分段**：`400xx`（参数，**本次新增 `40008`、`40009`**）/ `404xx`（不存在）/ `409xx`（冲突）/ `500xx`（环境/桥接）。**完整映射见 §4.4。**

### 4.2 本次冻结的数据模型变更清单

| 表 | 字段 | 类型 | 约束 | 迁移方式 | 需求 |
|---|---|---|---|---|---|
| `source_files` | `owner` | TEXT | nullable | `ensure_contributor_columns()` 幂等 ADD COLUMN | P-09 |
| `questions` | `contributor` | TEXT | nullable | 同上 | P-09 |
| `questions` | `cognitive_level` | TEXT | nullable | `ensure_taxonomy_columns()` 幂等 ADD COLUMN | P-03 |
| `questions` | `content_domain` | TEXT | nullable | 同上 | P-03 |

- **不改** `bank/db.py` DDL、**不 bump** `SCHEMA_VERSION`（裁定 A）。
- **无** 删表 / 删列 / 改类型 / 加 NOT NULL。
- **迁移前置**：`cp 交付库 → outputs/bank.backup-<ts>-v4.db`，`verify_backup(原库, 备份)`（**原库在前**），判定 `structure_ok + integrity_ok + core_nonempty`。
- **回滚**：用备份覆盖还原（ADD COLUMN 可逆，回滚即还原）。
- **写入类验证一律用副本**（铁律 5）。

### 4.3 本次冻结的配置项清单（**本次新增，对应 E14**）

| 键 | 类型 | 默认值 | 语义 | 校验 | 归属 |
|---|---|---|---|---|---|
| `settings.default_owner` | string | **`'待补充'`**（**非空串**，本次修订） | 归属缺省人名；缺省时新导入/建卷 `owner`/`created_by` 落 `'待补充'` | `''`/`null` → 归一 `'待补充'`；其余保留原文 | P-09 |
| `settings.features.import_enabled` | bool | `true` | 导入功能位（假设 A 的开关，见 §五） | 必须为布尔 | P-05 |

- 落地位置：`webui/config.py::DEFAULT_SETTINGS`（新增两键）+ `webui/schemas.py::SettingsUpdate`（新增两可选字段）+ `webui/config.py::validate_settings`（新增校验/归一）。
- **归一规则冻结**：`default_owner` 收到 `''` 或 `null` → 存 `'待补充'`；`import_enabled=false` 时 `POST /api/import/docx` 返回 `40008`（"导入功能已关闭"）——**语义为"上传/功能不合法"**，不再新增码。

### 4.4 导入接口错误码映射表（**修正 1 / V2 的核心产物**）

> 原则：**优先复用语义相符的既有码**；确需新增的给出编号与语义，且不与既有码冲突。

| 失败场景 | 错误码 | 常量（新增/既有） | HTTP | 触发点 / 说明 |
|---|---|---|---|---|
| `file` 字段缺失 / 文件为空（0 字节） | **40009** | `CODE_MISSING_UPLOAD`（**本次新增**） | 400 | router 层显式校验 `UploadFile` 为 `None` 或 `size==0` → `bad_request(40009, …)`。**修正 v1 误用 `40001`** |
| 格式不支持（扩展名非 `.docx` / 非有效 DOCX 包） | **40008** | `CODE_INVALID_UPLOAD`（**本次新增**） | 400 | 扩展名/魔数/ZIP 头校验失败 |
| 文件过大（超过大小上限） | **40008** | `CODE_INVALID_UPLOAD`（同上，语义含"超限"） | 400 | 落盘前/后 `stat` 校验 |
| 功能已关闭（`features.import_enabled=false`） | **40008** | `CODE_INVALID_UPLOAD`（同上） | 400 | 服务层前置检查 |
| 其它请求参数非法（`stage`/`subject`/`enrich` 类型等） | 40000 | `ValidationError`（既有，兜底） | 400 | pydantic 校验 |
| 解析失败（stage1 内部异常 / 桥接 / COM 不可达） | 50001 | `CODE_INTERNAL`（既有） | 500 | `stage1.process_file` 抛异常 → `bridge_error` |
| 写库失败（importer/enrich/answers 事务异常） | 50001 | `CODE_INTERNAL`（既有） | 500 | `write_txn` 回滚后抛 50001 |
| 轮询作业不存在（`GET /api/jobs/{id}`） | 40405 | `CODE_JOB_NOT_FOUND`（既有） | 404 | 复用既有 |
| 非法难度（P-07 回填 `level` 非法） | 40002 | `CODE_INVALID_DIFFICULTY`（既有） | 400 | 复用 |
| 批量/文件级未确认（labels batch / metadata） | 40903 | `CODE_NEED_CONFIRM`（既有） | 409 | 复用 |

**新增错误码合计 2 个**：`40008 = CODE_INVALID_UPLOAD`、`40009 = CODE_MISSING_UPLOAD`。**均落在 `400xx` 参数段空号，不与既有码冲突。**

### 4.5 双向核对结果（**修正 2 / V3 的核心产物**）

> 对"**方案正文出现过的所有端点与字段**"与"**§4.1 冻结表**"做双向核对。

**(A) 正文有、冻结表原本没有 → 已补入**

| 正文出处 | 项 | 处置 |
|---|---|---|
| §二 P-09 端点 6 / §4.3 | **`PUT /api/settings`**（`SettingsUpdate` 增 `default_owner`） | **补入 E14** |
| §4.3 / §二 P-09 身份方案 | **`settings.default_owner`** | **补入 E14 字段 + §4.3 配置项** |
| §五 假设 A | **`settings.features.import_enabled`** | **补入 E14 字段 + §4.3 配置项** |

**(B) 冻结表有、正文没有 → 反向核查**

| 冻结项 | 是否在正文出现 | 结论 |
|---|---|---|
| E1–E13（v1 全部） | 均在正文出现 | ✅ 无"幽灵端点" |

**(C) 正文提及但属"既有端点、不变更" → 无需冻结（明确声明）**

| 项 | 出处 | 说明 |
|---|---|---|
| `POST /api/labels/decision` | §二 P-02 | 既有端点，**保持原样**，仅新增 `.../batch`（E6） |
| `POST /api/questions/{id}/difficulty` | §二 P-07 | 既有"快速标注"，**刻意保持原样、不建版本** |
| `GET /api/search` 的 `coverage` 域 | §二 P-02 | 复用读数，**不新增端点** |

**双向核对结论**：补入 **E14** 后，**正文与冻结表完全一致**；无遗漏、无幽灵端点。冻结表计数自洽：**7 新增（E1–E6、E14 中 E1–E6 为新增，E14 为既有 additive）+ 7 既有 additive（E7–E12、E14）+ 1 复用（E13）= 14 条**。

### 4.6 冻结后变更规则

1. 上表端点/字段**一旦冻结，后续不得擅自更改**（含改名、改方法、改响应结构、改错误码）。
2. 若要变更：**回到 A 重新冻结** → 更新本文件 → **通知所有依赖方（D/T/V 及前端/后端消费方）**。
3. **`bank/query.py` 授权（本次收紧，见 §八 待拍板 1）**：**仅授权新增一个函数**（建议名 `search_with_taxonomy()`），**不得修改 `_build_where` / `search` / `search_full` 的函数体**；FTS join 的 `CAST` 位置必须与既有 `search_full` **完全一致**（`q.id = CAST(question_fts.question_id AS INTEGER)`）。若实现上确需改既有函数体，**必须在冻结清单中逐函数列名**并重新冻结。
4. `bank/db.py`、`bank/export.py`、`bank/paper.py`、`bank/importer.py`、`bank/cli.py` 仍为冻结文件；P-06 阶段 2 若需改 `export.py`/`db.py`，须**单独申请授权**。

---

## 五、与待验证假设的接口设计

> **原则**：不得把假设当既定事实。凡依赖未验证假设的需求，设计必须**留可关闭的功能位/可空字段**，使假设被证伪时**改动成本低**。

| 假设 | 影响需求 | 留开关方式（具体） | 证伪后的成本 |
|---|---|---|---|
| **A** 谁建库/频率 | P-05 | 导入做成**独立可关闭功能位**：`settings.features.import_enabled`（**默认 true，本次冻结于 §4.3 / E14**）；后端端点与前端 `ImportPage` 解耦。若证伪（一次性建库）→ 关闭功能位，端点留作管理员工具 | **低**（关开关即可，不删代码） |
| **B** 情感层署名 | P-09 | 只做**组织资产层**（`owner`/`contributor` 为**可空字符串**）；**不建**署名墙/贡献榜/账号体系。若证实 → 在字符串之上扩展统计/展示，**无需改 schema** | **低** |
| **C** 命题意图顺带记录 | 不做（P 明确） | 设计上预留：`cognitive_level`/`content_domain` 的**可空列模式**可复用；若证实，照此模式加可空字段即可 | **低** |
| **D** 三级审议 | 不做 | 不建状态机；仅保留轻量复核（既有三态） | 零 |
| **E** 图示失真影响面 | P-06 | 阶段 2 置于 `export.inline_images`（默认**关**）；**E 未证实不实现阶段 2** | **低**（只做探针） |
| **F** 跨年级复用 | P-08 | **不建"继承机制"**，仅复用通用组卷路径 | **零** |
| **G** 难度检索需求 | P-04 | 难度筛选项**可隐藏**（UI 开关）；数据层不受影响 | **低** |
| **H** 情感决定成败 | 长期 | 不影响本期设计（长期观测） | 零 |

**红线**：不得把"上传归属/贡献统计"设计成硬依赖（假设 A/B 未验证前，导入与归属均为**可选增强**，不影响"检索→组卷→导出"主链路可用）。

---

## 六、明确不做的技术方案

> 对应 P 第五节"明确不做的事"，逐条说明**为什么在技术上也不该做**（避免过度设计）。

| # | 不做的事 | 技术理由（为什么不实现） |
|---|---|---|
| 1 | 三级集体审议 + 迭代闭环状态机 | 需完整**状态机 + 角色权限 + 审批表**；与免登录、无管理员定位冲突；当前无任何流程数据支撑，属**过度设计** |
| 2 | 智能出题算法 | 无标注数据（难度 100% 空、无考查标签）→ 算法无训练/评估基础；与产品定位冲突 |
| 3 | 学情数据分析主打 | 超出本期模块边界（需成绩/作答数据，本项目无此数据源） |
| 4 | 强制上传/审批制度 | 需**权限体系 + 审计链**；与本地免登录矛盾 |
| 5 | 情感/署名全套（署名墙/经验沉淀） | 假设 B 未验证；先做会引入**不可回退的用户预期** |
| 6 | 命题意图自动记录 | 假设 C 未验证；自动推断会**污染交付数据**（同难度自动推断的教训） |
| 7 | 难度自动推断 | **会污染交付库**（R/AGENTS 明确"刻意不推断"）；只做人工/实测回填 |
| 8 | 认知层级/内容领域**自动**标注 | 无可靠自动方法；只能提供**可选人工入口**（P-03） |
| 9 | 多人部署/权限体系 | 无主张支撑，属**架构议题**；`editions/online` 已提供部署外壳，多租户是另一量级 |
| **10** | **双向细目表支持**（本次明确声明，V6） | 报告该要素为强实证，但 **P 无对应需求条目**；本期不实现。若 P 新增需求，**回 A 再冻结** |

**答案/解析覆盖欠账（本次新增呈现设计，V8）**
- 事实：`answer` 3,973/7,945（50.0%）、`analysis` 4,639（58.4%）（R2 §2.3）。
- 设计：**不新增端点**；`GET /api/search` 既有 `coverage` 域与结果卡徽章（`has_answer`/`has_analysis`）已能呈现；在导出前/结果页**明示**"本卷 N 题无答案/解析"（呈现欠账，不掩盖）。
- 补录归 **P-02 数据缺口 + P-10 立项**，非本期工程范围。

**技术底线**：以上 1–6 是"证据不足，不得直接开发"；7–9 是"与定位/成本收益冲突"。**一律不写生产代码**。

---

## 七、给开发/测试的输入摘要（≤200 字）

冻结 **7 个新端点 + 7 个既有 additive + 1 复用**（含新增 **E14 `PUT /api/settings`**）：导入 `POST /api/import/docx`（复用作业范式，写前 preimport 备份）；归属 `GET /api/contributors/summary`；难度回填 3 端点；批量标签 1 端点。模型变更仅 **v4 四列**（`source_files.owner`、`questions.contributor/cognitive_level/content_domain`），走幂等 `ensure_*_columns`，**不改 `bank/db.py`**。**新增错误码 2 个：`40008`（上传不合法）、`40009`（文件缺失/为空）**；E1 不再用 `40001`。归属哨兵统一为 **`'待补充'`**（非空串）。迁移前备份 + `verify_backup(原库,备份)`；**验证用副本，运行期写入走备份+事务+回滚**。`bank/query.py` 仅授权**新增一个函数**，不得改 `_build_where`/`search`/`search_full` 函数体。P-06 只做探针（假设 E），P-08 不建新机制。开发先跑 T-A00 契约，测试走 G3 独立构造。最大风险：P-06 图示行内保真（冻结文件 + Windows-only + 假设 E）。改动冻结契约须回 A。

---

## 八、三个漏看风险的结论与两个待拍板项的最终契约（**本次修订核心**）

### 风险 1 · 幂等重导不更新归属（V 风险 a）

**核实（读 `bank/importer.py`）**：`import_file` 对已存在 `source_files.sha256` 的行**直接复用 `source_id`**（`importer.py:260, 275-276`），且对已存在 `(source_id, content_hash)` 的题 `continue` **跳过**（`importer.py:297-302`）——**既不更新题目内容，也不更新来源归属**。

**结论**：**A 原设计确实存在此缺陷**——二次导入带新 `owner` 时，`owner`/`contributor` **不会被写入**，归属会错记为首次导入者。

**方案（本次冻结）**：
1. 导入服务在解析/写库成功后，**独立执行归属应用步骤**：若请求**显式带 `owner`**，调用 `bank/contributor.set_source_owner(conn, source_id, owner)`（回填该来源全部题 `contributor`）——**即使 `skipped=true` 也执行**。
2. **语义冻结**：`owner` **缺省（未传）时不覆盖**既有归属（避免默认值清空首导者归属）；`owner` **显式传入时覆盖**。
3. job result 增字段 `owner: str` 与 `owner_applied: bool`（冻结，见 §二 P-05 载荷），供前端/测试断言。
4. **边界**：同一文件被不同教师二次导入且都显式传 `owner` → 归属以**最后一次显式导入**为准（覆盖语义），**必须在 UI 文案与验收中明示**。

### 风险 2 · "考查"口径初始为空集（V 风险 b）

**核实**：`question_labels` 实测 **38,588 条 100% 为"待复核"、"已确认"=0**（R2/V 复核）。P-03 把"考查口径"定义为 `review_status='已确认'` → **上线即返回空集**。

**结论**：与报告第 1 章"覆盖率必须排除'未标注'取值"**同源**——"未标注/未确认"必须**显式呈现**，不得被静默过滤成空。

**防护设计（本次冻结）**：
1. **后端**：`GET /api/search` 的 `facets`/`coverage` **新增 `cognitive_level`/`content_domain` 取值分布（含"未标注"桶）**；"考查口径"经 `label_review='已确认'` 过滤，其**可用标签数**随响应下发（若为 0，前端可判定）。
2. **前端**：
   - 新维度筛选值无匹配（`total=0`）时，显示 **"0 结果（该维度共 N 条，其中未标注 M 条）"**，而非空白。
   - **"考查口径（已确认）"开关**：当"已确认"标签数为 0 时**禁用 + 提示**"尚无已确认知识点标签，请先在复核页批量确认（P-02）"。
3. **依赖**：P-03 的"考查口径"实际可用**以 P-02 批量确认为前置**；在此之前 UI 明示不可用，**不静默返回空**。
4. **验收**（并入 T-03V）：构造"未标注占多数"的副本库，断言 (a) 按新维度/考查口径筛选返回 0 时**界面有提示**；(b) 已确认标签数为 0 时开关**禁用并给引导**；(c) facets **含"未标注"桶计数**。

### 风险 3 · Web 导入直接写生产库（V 风险 c）

**结论**：P-05 是**给教师用的功能**——每次导入都写交付库（`outputs/bank.db`），属**运行期写生产数据**，超出"验证用副本"的语境，必须给出**备份 / 事务边界 / 失败回滚 / 恢复路径**。

**机制（本次冻结）**：
1. **备份**：import job 启动、解析成功、**进入写库前**，对**目标 DB**（`config.get_db_path()`）执行 `cp → outputs/bank.backup-<ts>-preimport.db` + `verify_backup(原库, 备份)`（**原库在前**）；验证失败 → 中止导入（50001）。备份路径回填 job result（`backup_path`）。
2. **事务边界**：解析（`stage1`）在**事务外**（只产出 JSON，不写库）；写库段（`importer.import_file` + `enrich` + `answers`）在**同一 `db.write_txn()`** 内；`importer` 内部本身**单文件原子**（`commit`/`rollback`，`importer.py:359, 376-382`）。
3. **失败回滚**：写库段任何异常 → `write_txn` 回滚 → DB 回到导入前；job `status=error`（`50001`）；临时文件清理。
4. **恢复路径**：若提交后才发现逻辑坏数据，用 **preimport 备份覆盖还原**（+ `verify_backup`）；job result 含 `source_id`/`sha256`/`backup_path` 便于定位。
5. **与铁律 5"写入类验证必须用副本"共存**：
   - 铁律 5 约束的是 **D/T 的验证行为**——D/T 验证导入功能时，必须把 `settings.db_path` / `QB_DB_PATH` 指向**副本库**，**绝不指向交付库**；T-ALL-V 断言**交付库 sha256 前后一致**。
   - **产品运行期**导入写交付库是**设计意图**（教师功能），非"验证"；对运行期写入的要求由"**备份 + 事务 + 回滚 + 恢复**"保证。
   - 二者**不矛盾**：**验证用副本，运行写生产但可回滚**。

### 待拍板项 1 · `bank/query.py` 筛选键授权（V 意见，采纳）

**核实（读 `bank/query.py`）**：筛选分发**硬编码在既有函数 `_build_where` 内**（`query.py:30-36` 的 `_QUESTION_FILTERS` + `query.py:61-66` 的内联字面量字典）；加筛选键**必然**要改 `_build_where` 签名/内联字典 + `search`/`search_full` 签名 + `webui/services/search.py`。**A 原表述"只允许新增函数"不充分。**

**最终契约（本次冻结，取代 v1）**：
1. **授权范围**：**仅新增一个函数**（建议名 `search_with_taxonomy()`，置于 `bank/query.py` 末尾），**不得修改 `_build_where` / `search` / `search_full` 的函数体**。
2. **实现约束**：新函数**复用 `_build_where`（调用，不改）**并追加两个新 WHERE 片段（`q.cognitive_level = :x` / `q.content_domain = :y`）；select/order/limit 与 FTS join 的 `CAST` 位置必须与既有 `search_full` **完全一致**（`q.id = CAST(question_fts.question_id AS INTEGER)`）。`webui/services/search.py` 切换到新函数（服务层，非冻结文件，允许改）。
3. **兜底条款**：若实现上确需改既有函数体，**必须在冻结清单中逐函数列名**并**重新冻结**（属"再冻结"）。
4. **验收（并入 T-03b）**：
   - ①**旧参数回归**：`search_with_taxonomy` 在**仅用旧参数**时，与 `search_full` 的 `total` 与**逐条 `id` 顺序**完全一致；
   - ②新参数结果集与等价 SQL 的 `id` 列表逐条一致（沿用 T-03b）；
   - ③**自由文本精确匹配预期行为**：`cognitive_level`/`content_domain` 为可空自由文本，用 `=` 精确匹配，**不匹配时返回空集（`total=0`）而非报错**——**此为预期行为**，前端显示"0 结果"，不得当作 bug；
   - ④`git diff` 证明**未改** `_build_where`/`search`/`search_full` 函数体。

### 待拍板项 2 · `settings.default_owner` 验收口径（V 意见，采纳）

**核实（读 `bank/db.py` / `webui/schemas.py`）**：`papers.created_by TEXT NOT NULL DEFAULT '待补充'`（`db.py:176`）；拟新增的 `source_files.owner`/`questions.contributor` 为 **nullable TEXT**；`SettingsUpdate` 现**无** `default_owner` 字段。v1 的 `default_owner=""` 会引入 **`''`/`NULL`/`'待补充'` 三态混用**，且验收"非'待补充'"**可被空串假通过**。

**最终契约（本次冻结，取代 v1）**：
1. **统一"未指定"哨兵为 `'待补充'`**（与既有 `created_by` 一致）；`default_owner` 缺省即为 **`'待补充'`**（**不用空串**）。
2. **归一规则**：`owner`/`created_by`/`contributor` 收到 `''` 或 `NULL` → **一律归一为 `'待补充'` 后再入库/统计**；`papers.created_by` 为 `NOT NULL`，必须归一（覆盖客户端显式传 `null`）。
3. **`contributor_summary.unassigned`** 判定冻结为 **`IN (NULL, '', '待补充')`**，与 `bank/query.py:485-491` 的 `MISSING_SENTINELS` 口径对齐。
4. **E7 显式规定**：`POST /api/papers` 的 `created_by` **传 `null` 或缺失 → 落 `'待补充'`**（满足 `NOT NULL`）。
5. **验收改写**（取代 v1 "非'待补充'"）：
   - **主用例**：**已配置 `default_owner` 为具体人名**时，新导入的 `owner` **等于该人名**（非空、非 `'待补充'`）。
   - **对照用例**：**未配置**时，如实显示"未指定"（= `'待补充'`）。
   - **反例**：构造 `owner=''` 的入库路径，断言其**被归一为 `'待补充'`**且**计入 `unassigned`**（不得被当成"已归属"假通过）。

---

## 我做了什么

- **亲自读 `webui/errors.py`**，列出**现有全部错误码及其语义**（§4.0），作为修订的事实基础。
- 为导入接口**逐一分配错误码**（§4.4），新增 `40008`/`40009`，修正 E1 的 `40001` 误用。
- 对"正文端点/字段"与"冻结表"做**双向核对**（§4.5），补入 **E14 `PUT /api/settings`** 与两个配置字段，输出一致结论。
- 核实并给出**三个漏看风险**的结论与方案（§八 风险 1/2/3），含幂等归属覆盖、空集防护、写库备份/事务/回滚。
- 采纳 V 意见**收紧两个待拍板项**（§八）：`bank/query.py` 授权改为"新增一个函数 + 两项回归"；`default_owner` 统一哨兵为 `'待补充'` 并改写验收。
- 更新任务表（新增 T-14；加强 T-05b/T-09b 证据；T-03b 加回归与空集预期），修正 v1 的归属计数。
- 逐条回应 V1–V10（§0.2），并**明确标注本次新冻结/变更**（§0.1）。

## 产出物
- 本文件 `outputs/handoff/A-技术方案与契约冻结.md`（唯一写入物，v2）。

## 验收标准（给下一个角色 D/T）
- 第四节端点清单应 **14 行**（新增 7 + 既有 additive 7 + 复用 1）；**新增错误码 2 个（40008、40009）**，E1 **不再出现 `40001`**。
- §4.4 错误码映射表须覆盖导入接口**全部失败场景**，且新码不与既有码冲突。
- §4.5 双向核对须证明正文与冻结表**一致**（含 E14）。
- 模型变更应 **4 列**，全部 nullable，迁移走 `ensure_*_columns`，**未改 `bank/db.py`**。
- §4.3 配置项须含 `default_owner`（默认 `'待补充'`）与 `features.import_enabled`（默认 `true`）。
- 任务表应 **21 行**，每条含可执行验收（命令/SQL/渲染/回归），无"看起来对"；`T-05b`/`T-09b` 须含"截图/请求日志"。
- P0 技术路径三句话应可复述（导入/归属/计时）。

## 我没做 / 做不到的
- 未写任何业务实现代码（角色边界）。
- 未执行迁移、未触碰交付库（只读核实）。
- 未核实 `stage1.process_file` 单文件调用的可用性（留给 T-05a 探针）。
- 未确认"认知层级/内容领域"教研口径（P-03 冲突 1 已声明需教研确认，故 v1 不做枚举强校验）。
- 未改写 R/P 的证据强度判定（V1/V4/V5/V6 属 R/P 职责，A 仅标注影响与契约无关性）。

## 遗留风险
- **P-06 是最大技术风险**：涉及冻结 `export.py` + Windows-only + `pipeline` + schema 三线联动，且被未验证假设 E 门控。
- **P-05 是最大 P0 风险**：写交付库（已补备份/事务/回滚）+ `stage1` 编程复用未探针 + 单线程作业与导出串行争用 + **采纳率不确定性**（V7）。
- **P-09 身份方案**依赖 `settings.default_owner` 被配置；未配置时如实显示"未指定"（= `'待补充'`）；验收口径已收紧（§八 待拍板 2）。
- **`bank/query.py` 授权**已收紧为"新增一个函数"；未获批前 P-03 检索维度无法落地。
- **P-03 考查口径**初始为空集，须以 P-02 批量确认为前置；UI 必须显式呈现（§八 风险 2）。
- R 已警示：交付库在主仓库、导出耗时无历史证据、`paper_questions=33` 非 25——后续角色勿引用旧数字。
