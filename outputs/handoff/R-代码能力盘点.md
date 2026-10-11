# 交接：代码能力盘点 / 研究员（R）

> **角色**：研究员（R）——只读调查，不写业务代码、不做设计。
> **范围**：盘点代码库在 9 个能力轴上的**真实实现程度**，每条附代码级证据与实测数据。
> **数据源**：交付库 `D:/Open-source project/Localtopic-management/outputs/bank.db`（只读 `mode=ro`）。
>   ⚠️ 本 worktree（`main-14dd9452`）是**纯源码检出**，`outputs/bank.db` 被 `.gitignore` 排除、**不存在**；
>   交付库实际位于主仓库 `D:/Open-source project/Localtopic-management/outputs/bank.db`。以下实测均针对该库。
> **实测时间**：2026-10-11
> **铁律遵守**：全程只读（`bank.db.connect_readonly()` / URI `mode=ro`），未写入任何业务文件或数据库。

---

## 一、能力轴现状总表

| # | 能力轴 | 实现程度 | 代码证据（路径:行号 / 函数 / 表） | 实测数据 | 缺口 |
|---|---|---|---|---|---|
| 1 | **素材沉淀与标注** | 🟡 部分实现 | 元数据字段 `bank/db.py:57-96`；自动推断 `bank/enrich.py:652 enrich()` + `infer_grade/textbook/chapter/knowledge_points`（词典 `enrich.py:85-141`）；知识点三态复核 `bank/labels.py:155 set_review_status()`；公式复核队列 `bank/review.py:27 resolve()`；前端 `KnowledgeReviewPage.tsx`/`FormulaReviewPage.tsx` | grade 17.6% / textbook 17.5% / chapter 35.4% / qtype 70.0% / **difficulty 0.0%** / knowledge 97.2%；`question_labels.review_status`：**待复核 38,588（100%）、已确认 0、已否决 0**；`review_queue` 未处理 132 / 已处理 64 | 年级/教材/章节覆盖率极低；难度全空；知识点全为「提及」口径且**人工复核零执行**；无标注任务分配/进度看板/一致性检查 |
| 2 | **版式保真** | 🟢 已实现 | 原生 OMML：`bank/export.py:10`（`doc_insert_math` LaTeX→OMML）、`export.py:1461-1478 _resolve_math_entities`；双端验证 `export.py:1981 verify_cross_client()`（Word.Application + KWPS.Application，改字符→保存→重开）；控制字符 `export.py:195-214 bridge_safe_text()` + `BRIDGE_TAB_SENTINEL`；A4/1.5 倍行距 `export.py:221-225` | `verify_report.json`：word `maths=24`、`pages=6`、edits `EDITED`（改字符保留）；`formula-rdt/T/cli-verify.json`：word `maths=13`、`EDITED`；`formulas.status`：OK 17,639 / UNSUPPORTED 130 / EMPTY 2；含 TAB 题 **1,393**；私有区字形 EF01×67 式 + EF0A×5 式（涉 72 式） | 图片行内位置未还原（统一居中附于题干后）；超长单题跨页为近似 |
| 3 | **可检索** | 🟢 已实现 | `bank/query.py:112 search()` / `query.py:530 search_full()`；bigram 分词 `bank/textutil.py:83-128`；FTS5 `bank/db.py:233`；bm25 排序 `query.py:154`；单字 LIKE 兜底 + `escape_like`；筛选维度 `query.py:24-36`（stage/subject/grade/textbook/chapter/qtype/difficulty/section/number + labels/needs_review/label_review/has_answer/has_analysis/缺失桶） | 本轮实测：浮力 818 命中 **8.4ms**、压强 1753→**13.5ms**、力 4387→**14.7ms**、阿基米德原理 190→3.1ms；qtype=选择题 2448→4.4ms；facets 全量 220.5ms | grade/textbook 因数据缺失**会漏题**；difficulty 维度筛不出（全空）；无排序选项（仅 bm25 / id） |
| 4 | **可复用** | 🟢 已实现 | 组卷 `bank/paper.py:523 create_paper()` / `730 add_questions()` / `839 set_score()`；内容快照 `paper.py:415 _snapshot_question()`；版本锁定 `paper_questions.question_version` + 复合外键（`db.py:191-203`）；刷新快照 `paper.py:1104 refresh_snapshots()`；修订卷 `paper.py:1058 create_revision()`；导出载荷 `paper.py:975 build_export_payload()` | `papers` 2 张；`paper_questions` 33 条，**33/33 snapshot_json 非空**；`question_versions` 7,962（version>1 的题 16 道） | 题目版本**不提供回滚**（`edit.py:12` 明确）；结构预览拖拽限同大题内 |
| 5 | **可追溯** | 🟢 已实现 | 题目→来源 `questions.source_id → source_files`（`db.py:75`）；原题号 `questions.number`；段落定位 `start_paragraph/end_paragraph`；快照溯源 `paper.py:474-485 snapshot["source"]`（source_id/file_name/sha256/start/end_paragraph）；版本留痕 `question_versions.change_source/note`（`edit.py:57-61`） | **7,945/7,945 题有 source_id（100%）**；**7,945/7,945 题有 number（100%）**；`question_versions.change_source`：import 16 / formula_repair 17 / NULL 7,929 | 段落级「共用材料」识别未实现（`paper.py:489-495` 仅按 文件+大题 组） |
| 6 | **归属明确** | 🔴 未实现 | 仅 `papers.created_by`（`bank/paper.py:67,94`、`db.py:176`，`DEFAULT_AUTHOR='待补充'`）；`webui/services/papers.py:48 create_paper()` **不接收** created_by；前端仅类型定义 `frontend/src/api/types/paper.ts:17`，**无展示** | `papers.created_by` 两条记录均为 `'待补充'` | 题目无「谁创建/贡献」字段；无任何界面展示；asset_manifest 的 author 亦全为「待补充」 |
| 7 | **易用性与迁移成本** | 🟡 部分实现 | DOCX→JSON：`pipeline/stage1.py`（CLI `python -m pipeline.stage1`）；JSON→库：`bank/importer.py` + `bank/cli.py:75 cmd_import`；补元数据 `cli.py:293 cmd_enrich`；抽答案 `cli.py:375 cmd_answers`；**webui 无导入/上传端点**（routers 无 import；唯一 `UploadFile` 为 `/labels/import-review`，`webui/routers/labels.py:70`） | 端到端 = **4+ 条 CLI 命令**（stage1 → import → enrich → answers），全部命令行；Web 界面仅覆盖 检索/组卷/导出 | **无 Web 导入**；无「拖一个 DOCX 即可用」的入口；首次使用需理解 pipeline 与 bank 两层 |
| 8 | **时间节约** | 🟡 部分实现 | 阶段1 计时 `pipeline/stage1.py:124-156`；预览计时 `webui/services/preview.py:296 elapsed_ms`；导出计时 `webui/services/export_svc.py`；基准脚本 `outputs/export/_probe/bench_p1.py`/`bench_p2.py` | 阶段1：**209 文件 67.0 秒**（`preprocess_final/_summary.json`）；检索：本轮 3–15ms，`_p1_bench.log` 优化前 7,118.6ms→6.9ms；facets 220.5ms | **导出耗时（文档称 2.95/4.62s）未找到原始日志 → 未实测**；无「省时 vs 手工组卷」对照实测 |
| 9 | **隐性需求支撑** | 🔴 未实现 | 全库检索 `贡献/署名/经验沉淀/谁创建/uploader/owner` —— **代码与前端零命中**；仅在 `deliverables/` 研究报告里作为「缺口/建议」出现 | — | 无贡献者字段、无经验沉淀结构、无署名界面 |

**图例**：🟢 已实现　🟡 部分实现　🔴 未实现

---

## 二、关键实测数据

> 全部经**只读**连接取得。命令模板：
> ```bash
> cd C:/Users/SOAP/WorkBuddy/Worktrees/Localtopic-management/main-14dd9452
> PY="C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe"
> "$PY" -c "import sys;sys.path.insert(0,'.');from bank.db import connect_readonly;
>            c=connect_readonly('D:/Open-source project/Localtopic-management/outputs/bank.db');..."
> ```

### 2.1 交付库指纹

| 项 | 实测值 |
|---|---|
| 文件 | `D:/Open-source project/Localtopic-management/outputs/bank.db` |
| 字节数 | **64,815,104** |
| sha256 | `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6` |
| schema_version | 3 |
| 表 | 11 张业务表 + `question_fts`(FTS5) + 内部表 |

### 2.2 逐表行数（`SELECT COUNT(*)`）

| 表 | 实测行数 | AGENTS.md 记载 | 是否一致 |
|---|---|---|---|
| source_files | 209 | 209 | ✅ |
| questions | 7,945 | 7,945 | ✅ |
| formulas | 17,771 | 17,771 | ✅ |
| images | 7,102 | 7,102 | ✅ |
| question_versions | 7,962 | 7,962 | ✅ |
| labels | 333 | 333 | ✅ |
| question_labels | 38,588 | 38,588 | ✅ |
| review_queue | 196 | 196 | ✅ |
| papers | 2 | 2 | ✅ |
| **paper_questions** | **33** | **25** | ❌ **不一致（+8）** |
| paper_sections | 2 | 2 | ✅ |

### 2.3 元数据覆盖率（题目级，`bank.enrich.coverage()` 实测）

```
questions_total = 7945
grade      n=1396  17.6%    textbook  n=1392  17.5%
chapter    n=2810  35.4%    qtype     n=5559  70.0%
difficulty n=0      0.0%    knowledge n=7723  97.2%
answer 非空 3973/7945 (50.0%)    analysis 非空 4639/7945 (58.4%)
```

- **difficulty 100% 为「未标注」**（7,945/7,945）——源数据无标注，代码**刻意不推断**（`enrich.py:11-13, 771-773`）。
- **knowledge 97.2% 是「提及」口径**（`term in text` 词典命中），非「考查」口径；`question_labels` 知识点关联 32,936 条 / 有标签题 7,723 → **平均 4.26 标签/题**。

**provenance（来源留痕）分布**（`bank/enrich.py:390-407` 迁移列）：

| 字段 | filename | path | importer | chapter_map | unresolved |
|---|---|---|---|---|---|
| `source_files.grade_source` | 14 | — | 30 | — | 165 |
| `source_files.textbook_source` | — | 14 | 25 | — | 170 |
| `questions.chapter_source` | 1,147 | — | 1,663 | — | 5,135 |

**source_files 维度取值**：`stage` 全为「初中」(209)；`grade` 待补充 165 / 八年级下册 43 / 八年级 1；`textbook` 待补充 170 / 苏科版 30 / 人教版 9。

### 2.4 复核队列（标注如何产生 / 有无复核队列）

| 队列 | 表/字段 | 实测 |
|---|---|---|
| 公式复核 | `review_queue.resolved` | 未处理 **132** / 已处理 **64**（共 196） |
| 公式复核 | `review_queue.status` | UNSUPPORTED 185 / EMPTY 7 / FAIL 4 |
| 公式复核 | `formulas.needs_review=1` | **132** |
| 知识点复核 | `question_labels.review_status` | **待复核 38,588（100%）/ 已确认 0 / 已否决 0** |

> **关键事实**：知识点三态复核**工作流已完整实现**（`labels.py` 含 `review_summary`/`set_review_status`/`export_review`/`import_review`/`review_items`/`preview_decision`，前端有 `KnowledgeReviewPage.tsx`），但**至今零条人工决定**——38,588 条关联 100% 停留在「待复核」。标注**全部由自动词典产生**（`question_labels.source`：chapter_title 9,110 / dictionary 23,826 / NULL 5,652）。

### 2.5 公式与版式

| 项 | 实测 |
|---|---|
| `formulas.status` | OK 17,639 / UNSUPPORTED 130 / EMPTY 2 |
| `formulas.kind` | mathtype 11,863 / omml 5,908 |
| `formulas.preview` 非空 | 11,863（全部 mathtype 有源图预览） |
| 含 TAB 的题 | **1,393**（与 AGENTS 记载一致） |
| 私有区字形（U+E000–U+F8FF） | EF01 × **132** 处、EF0A × **5** 处；涉及 **72** 条公式 |
| 双端可编辑验证（历史报告） | `outputs/export/_probe/verify_report.json`：word maths=24, pages=6, edits=`EDITED`；`outputs/formula-rdt-20261010/T/cli-verify.json`：word maths=13, `EDITED` |

### 2.6 检索性能（本轮现场实测，warm）

```
搜索 '浮力'         total=  818    8.4 ms
搜索 '压强'         total= 1753   13.5 ms
搜索 '密度'         total= 1126   10.6 ms
搜索 '力'           total= 4387   14.7 ms   (单字 → LIKE 兜底)
搜索 '阿基米德原理'  total=  190    3.1 ms
筛选 qtype=选择题    total= 2448    4.4 ms
facets 全量                        220.5 ms
```

历史基准 `outputs/_p1_bench.log`（优化前后）：

```
裸『浮力』(818)     7118.6 → 6.9 ms  (1034x)
裸『压强』(1753)   15583.3 → 12.4 ms (1255x)
单字『力』(4387)     630.3 → 0.4 ms  (1550x)
```

### 2.7 组卷 / 版本 / 快照

| 项 | 实测 |
|---|---|
| `papers` | 2 条（#1 八年级物理·浮力与压强单元测验；#3 未命名试卷），`created_by` 均 `'待补充'` |
| `paper_questions` | #1=10 条、#3=23 条（共 33）；`snapshot_json` 非空 33/33 |
| `paper_sections` | 2 条（均属 #1：一、选择题 / 二、计算题） |
| `questions.version` | 1:7,929 / 2:15 / 3:1 |
| `question_versions.version` | 1:7,945 / 2:16 / 3:1（version>1 的题 16 道） |
| `question_versions.snapshot_json` 非空 | **33**（其余 7,929 行为文本版本行，无完整快照） |
| `question_versions.change_source` | NULL 7,929 / import 16 / formula_repair 17 |

### 2.8 追溯与归属

| 项 | 实测 |
|---|---|
| questions 有 `source_id` | 7,945 / 7,945（**100%**） |
| questions 有 `number`（原题号） | 7,945 / 7,945（**100%**） |
| `papers.created_by` 非「待补充」 | **0 / 2** |
| 代码/前端出现「贡献/署名/经验沉淀/uploader/owner」 | **0 处**（仅 deliverables 研究报告作为缺口提及） |

### 2.9 端到端导入路径（代码级）

```
真实 DOCX
  └─ pipeline/stage1.py         (CLI: python -m pipeline.stage1 <dir> --out ...)   → 结构化 JSON
       └─ bank/cli.py:75  import (CLI: python -m bank.cli import <json|dir>)         → bank.db
            └─ bank/cli.py:293 enrich (CLI)                                          → 补元数据/知识点
                 └─ bank/cli.py:375 answers extract (CLI)                            → 答案/解析
```

- 全路径**均为 CLI**；`webui/routers/` 无 import/upload 端点（46 个路由装饰器，唯一 `UploadFile` 在 `labels.py:70` 用于**复核 CSV** 导入）。
- 人工介入：至少 **4 条命令**（且需先理解 pipeline 与 bank 两层），**Web 界面无法导入 DOCX**。

---

## 三、文档与代码不一致之处

> 以代码/实测为准。

| # | 文档记载 | 实测 | 判定 |
|---|---|---|---|
| 1 | `AGENTS.md §4`：`paper_questions` = **25** | **33**（#1=10 + #3=23） | ❌ **文档过期/有误**，以实测 33 为准 |
| 2 | `AGENTS.md §3.3`：API「**43 个路径 / 49 个操作**」 | `webui/routers/` 中 `@router.(get\|post\|put\|delete)` **46 个装饰器** | ⚠️ 口径可能不同（"路径"去重后可能更少），**未逐条对齐**；装饰器计数为 46 |
| 3 | `AGENTS.md §11`（历史段）：库 SHA `3e69ee68…` | `6905955734953c6c…`（64,815,104 字节） | ✅ 该文段**已自校正**，实测与校正值一致 |
| 4 | `AGENTS.md §11`（历史段）：测试「318 项 / 317 通过」 | 文段已自校正为 387/386 | ✅ 已自校正（本轮未复跑全量测试，见第四节） |
| 5 | `AGENTS.md §3.1`：阶段1「耗时 65 秒」 | `_summary.json` 实测 **67.0 秒** | ⚠️ 轻微差异（65 vs 67），可能为不同批次；以产物记录 67.0s 为准 |
| 6 | `AGENTS.md §5`：导出耗时「2.95 / 4.62 秒」 | **未找到对应原始日志** | ⚠️ **未实测**，无法证实/证伪 |

> 其余核心数字（题目 7,945、公式 17,771、图片 7,102、标签 38,588、复核 196、答案 50%、难度 100% 空、含 TAB 1,393 题、阶段1 209/209 成功）**均与实测一致**。

---

## 四、无法验证 / 未实测项

1. **导出端到端耗时**：文档称 2.95 / 4.62 秒，未找到原始计时日志；`bench_p2.py` 脚本存在但无落盘结果文件。**未实测**（需 Word/WPS + editor_sdk 环境）。
2. **双端可编辑的"当前代码新导出"验证**：仅核对了**历史报告 JSON**（`verify_report.json`、`cli-verify.json`）的字段，**本轮未重新导出并改字符验证**（依赖 Word/WPS COM 环境，且属写入类操作，超出只读边界）。
3. **全量测试基线**：未运行 `python -m unittest discover -s tests`，故 387/386 的当前有效性**未复核**（属 R 只读范围外的耗时操作，且 AGENTS 已记录）。
4. **图片行内位置还原 / 超长单题跨页**：属已知限制，代码注释与文档一致，**未做端到端渲染复核**。
5. **`papers` 的 `created_by` 是否可经任何非 Web 路径设置**：`create_paper()` 签名支持传参（`paper.py:526`），但 Web 服务层不透传（`services/papers.py:48-60`），**CLI/其他调用方是否传入未逐一追查**。
6. **"经验沉淀 / 贡献者"是否为在建分支**：本轮仅检查当前 worktree 与主仓库 `main`，**未检查其他分支/未合并 PR**。
7. **`webui/` 模块数「29 个」**：未逐个数模块核对。

---

## 五、给下一角色（A / P）的提示（仅陈述事实，不含设计）

- **可复用/可追溯/版式保真/可检索**四条轴有**扎实的代码与历史验证证据**，是当前最成熟的部分。
- **归属明确（轴6）与隐性需求支撑（轴9）完全空白**——数据库无贡献者字段、前端无署名展示，`created_by` 是唯一占位且全为「待补充」。
- **易用性（轴7）**：导入链路全在 CLI，Web 无入口，是"首次使用能否快速产出结果"的最直接短板。
- **素材沉淀（轴1）**：复核**工作流**已就绪但**零执行**（38,588 条知识点关联 100% 待复核）；难度维度 0% 可用。
- **数字注意**：文档 `paper_questions=25` 应更正为 **33**；导出耗时数字缺原始证据。

---

## 我做了什么

- 通读 `AGENTS.md` 全景，逐条在代码中定位 9 个能力轴的实现。
- 以 `bank.db.connect_readonly()` 对交付库（主仓库 `outputs/bank.db`）跑**只读**统计：行数、覆盖率、provenance、复核队列、公式状态、版本/快照、检索性能。
- 阅读核心模块：`db.py`、`query.py`、`labels.py`、`enrich.py`、`review.py`、`paper.py`、`export.py`、`importer.py`、`edit.py`、`stage1.py`、`webui/services/export_svc.py`、`webui/services/papers.py`。
- 核对历史验证报告 JSON 与性能基准日志。

## 产出物

- 本文件 `outputs/handoff/R-代码能力盘点.md`（唯一写入物）。

## 验收标准（给下一角色）

- 复现任一实测数字：用上文 §二 的连接方式对 `D:/Open-source project/Localtopic-management/outputs/bank.db` 只读查询。
- 复核文档不一致项：`SELECT COUNT(*) FROM paper_questions;` 应得 **33**（非文档的 25）。
- 复核归属空白：全库 `grep -r "贡献\|署名\|created_by" bank/ webui/ frontend/src/` 应仅命中 `papers.created_by` 与前端类型定义。

## 我没做 / 做不到的

- 未做任何写入（含未跑会写库的迁移/导入）；未重新导出 DOCX；未跑全量测试。
- 未使用 Word/WPS COM 做双端实机验证。
- 未检查非 main 分支/未合并 PR。

## 遗留风险

- 交付库位于主仓库而非本 worktree，若后续角色只在本 worktree 找 `outputs/bank.db` 会**找不到**。
- 文档 `paper_questions=25` 与实测 33 的差异来源未查明（可能为某次加题未同步文档）。
- 导出耗时数字无原始证据，直接引用有夸大风险。
