# 交接：复核公式修复 G1 契约冻结 / A

日期：2026-10-10。任务主流程为 R → D → T；A 仅补充 G1 门禁，不扩大实现范围。

## 我做了什么

1. 阅读根 `AGENTS.md`、`outputs/任务-复核公式分类与修复-RDT.md` 及 R 最终交接 `outputs/handoff/R-复核公式分类.md`，冻结本次允许集合与排除边界。
2. 核对 `bank/formula_repair.py:17` 的批量原子修复契约、`webui/routers/review.py:25` 起的既有队列/预览端点，以及 `webui/schemas.py:72`、`:92` 的人工公式编辑字段。
3. 核对 `pipeline/docx_scan.py:151` 的旧 ProgID 预判、`:297` 的 UNVERIFIED 标记，以及 `pipeline/mtef_conv.py:110`、`:122`、`:179` 的完整 v5 校验、严格解析和进程超时隔离。
4. 核对 `bank/db.py:99`、`:112`、`:152`、`:199` 的版本、公式、复核队列与锁定快照结构。结论：本次内部解析兼容与经证据批准的修复清单，可以完全复用现有接口和 schema。

## G1 冻结结论

**通过：不新增、不改名、不删除端点、字段、错误码、数据库结构或公开函数签名。** D 可以进入内部兼容修复与副本验证。若发现必须改变以下契约，停止该部分实现，交回 A 重新冻结并通知依赖方；本文件不构成对冻结文件的修改授权。

### 修复范围与准入

- 仅允许 R 的 13 条条件候选：rq_id `57,62,64,68,73,86,87,91,92,93,94,143,161`。逐项 formula_id/question_id/fid、原始指纹和期望内容以 `outputs/formula-rdt-20261010/candidates.json` 为准。该文件不是已批准的 apply 清单。
- 允许内部修正规范明确的短/长 nudge、FONT_STYLE_DEF 字段读取及合法单边括号语义；不得将截断输入、任意缺失子节点统一补空。优先限制影响范围；若接入全局解析路径，必须核验原有 OK 公式结果，没有差异证据不能宣称无回归。
- 真实 v3 共 127 条继续在安全门禁跳过，不强行进入 v5，不移除进程硬超时；旧 ProgID 只有经完整头长/声明长度/真实 v5 检查，才可走现有严格解析。严格路径解析成功仍为 UNVERIFIED，不能自动清除复核。
- rq74/75/76 源流与源图冲突、rq90 含未知标记/裸 `&`、rq85 原始空对象均排除。131+1 条不自动 resolved，不猜内容，不删未知私有字符，不把 EMPTY 等同于原始流为空。
- **解析非空、Valid、PNG 存在、OMML 节点存在均不等于语义正确或可编辑。** 每条须与当前源的可靠预览逐字和上下标核对、KaTeX 严格渲染、新导出内容核对，并完成 Word/WPS 改内部字符 → 保存 → 重开 → 比对。任何一项失败即保留待复核。四条 KSEE3 候选有既知上下标风险，不得改变语义迎合桥接。
- R 已证明现有 Pillow/GDI 预览部分有字距失真；现有入口可作为人工路径，但不能单凭该 PNG 批准内容。复用 R 当前源 WMF/Word 保真证据或独立重建保真对照，明确限制。此契约不授权扩展预览 API 或修改冻结导出文件。

### HTTP / CLI 冻结

| 路径 | 现有请求与返回 | 冻结错误/语义 |
|---|---|---|
| `GET /api/review` | 查询 `resolved=false,status=null,limit=50(1..500),offset=0(>=0)`；data 为 `total,items,limit,offset` | item 既有 `id,formula_id,question_id,status,kind,progid,part,preview,reason,resolved,number,section,chapter,file_name,question_text,fid,latex,preview_url` 保持；rq.status 为队列记录，不擅自变成当前公式状态 |
| `GET /api/review/summary` | data 为 `open,resolved,total,by_status` | by_status 仅统计未处理队列 |
| `GET /api/review/{rq_id}/preview` | 无请求体；成功直接返回 `image/png` 文件 | 不存在 404/40407；源图缺失、损坏或转换不支持 404/40404。成功图片不是 JSON envelope；失败沿用统一响应 |
| `POST /api/review/{rq_id}/resolve` | `{"resolved":true}`；data 为 `rq_id,question_id,resolved` | 不存在 404/40407；仅队列标记，不是公式修复，禁止用它批量清零 |
| `PUT /api/questions/{question_id}` | `{"patch":{"formulas":[{"fid":"F…","latex":"…"}]},"force":false}`，保留其余现有 patch 字段与返回 | 人工编辑留版；沿用 40001 占位符、40401 题不存在、40901 内容冲突及现有 ValueError 映射，不新建专用修复错误码 |

除图片成功响应外，沿用 `{code,data,message}`；成功 code=0，失败沿用 `webui/errors.py`，不让异常裸奔。

**当前没有独立公式批量修复 HTTP 端点或 CLI 子命令。** 本次不补建；批量修复用已有 Python 函数。现有 `python -m bank.cli review` 和 `python -m bank.cli export verify <新产物.docx> --out <报告.json>` 保持原样。不要为新增 CLI 修改冻结 `bank/cli.py`。

### 批量修复与数据契约

固定入口 `bank.formula_repair.apply_verified(conn, entries, *, evidence)`；entry 字段为 `formula_id,question_id,old_latex,old_status,latex`；返回 `{"formulas":实际改动数,"questions":实际留版题数}`。evidence 必须关联逐条源图、渲染和双端编辑证据；函数不会替调用者审核证据，因此 D/T 必须在调用前把守准入。

保留专用无未提交事务连接、BEGIN IMMEDIATE 整批原子性、前置归属/旧值/旧状态检查、重复公式拒绝、非空公式校验、失败整批 rollback 和重复执行零空版本语义。保留按题一次版本递增、旧版完整快照、`change_source=formula_repair` 与 evidence 留存。不得绕过入口用批量 SQL 直接 resolved。

不新增迁移；现有表、列、索引、约束、schema_version 保持。允许真实通过准入的子集更新公式及其复核记录、对应题目版本和版本历史；原有 OK 公式不得受污染。**`paper_questions.snapshot_json` 必须逐字节不变，其他锁定试卷内容不变；不得自动刷新快照。**

写入验证只用副本。交付库实际写入前必须新建备份并 `bank.enrich.verify_backup(original, backup)` 核验（原库在前）；先副本演练、幂等和回滚验证，再使用已批准子集单事务写入。不得重生成 `outputs/preprocess_final/`。

### 文件边界

`bank/db.py`、`bank/importer.py`、`bank/paper.py`、`bank/export.py`、`bank/cli.py` 继续冻结，本任务未给出更改这些文件的明确授权。`bank/query.py`、`bank/labels.py` 仍仅允许新增函数；本方案不需要修改它们。

允许内部解析文件及必要测试/修复执行产物，不能由此推导出其他模块重构权限。`.py` 交付资产改后同步重嵌文件头与重建 `outputs/metadata/asset_manifest.json/md`。中文注释和文案沿用。若需要冻结导出文件解决桥接错误，报告具体失败条目与证据，等待该文件明确授权；其余可验证子集继续推进。

## 产出物

- `outputs/handoff/A-复核公式契约冻结.md`（本文）。
- `.qa_formula_rdt_20261010/A-tests.log`（阶段全量测试原始日志；结果见下方阶段证据）。

## 验收标准（给 D / T / 主控）

1. 对照本表检查 `webui/routers/review.py`、`webui/schemas.py`、`bank/formula_repair.py`，公开契约与数据库 schema 不变；冻结文件无未经授权改动。D 交接给出改动路径清单，主控逐项复核。
2. 从当前源包重取候选流并复现修复前异常/空输出，再验证修复后源图语义；独立构造短/长/截断 nudge、style0/非0、单边/双边/损坏括号反例，真实 v3 不进 v5 且超时隔离仍有效。
3. 每条获准修复项给出实际 LaTeX、KaTeX 严格渲染、新导出内容及 Word/WPS 改字符保存重开证据。修复数量以真正通过子集计算，不承诺 13 条全部通过。
4. 副本上调用已有 apply_verified 两次，第二次返回 0/0；前置条件冲突及中途失败必须整批回滚。逐表差异仅在批准公式/复核项与对应题目留版范围；修复前所有 OK 行字段逐项一致；锁定试卷快照逐字节一致。
5. D/T 每阶段运行项目 Python `-m unittest discover -s tests`；T 独立重取源、独立构造反例和新导出，不把 D 的日志当独立验收。

## 阶段证据

- 开始前读取主控基线 `.qa_formula_rdt_20261010/baseline-tests.log`：311 tests，29.185 秒，OK (skipped=1)。
- A 只读复核交付库完整 SHA256：`2d1b3694aadae3355256bc7849f5b634ff1a7e78e873e5509d2536e250259601`，与基线一致。
- A 文档完成后阶段全量测试：`Ran 311 tests in 29.810s / OK (skipped=1)`，即 310 通过、1 跳过；原始日志 `.qa_formula_rdt_20261010/A-tests.log`。使用项目 Python，`PYTHONUTF8=1`，`TEMP/TMP=.qa_20261010/tmp`；运行前只读检查确认无遗留 unittest 进程，未重复并行执行。
- 阶段结束再次只读复核交付库 SHA256，与上方完整值一致。A 阶段完成，G1 通过；D 仅可在上述范围实施与验证。

## 我没做/做不到的

未修改任何实现、数据库、源文档或预处理产物；未代写 R/D/T 报告。未审批任何候选写库，也未实测候选的新导出或双端编辑，后两者由 D 与独立 T 完成。

## 遗留风险

现有修复函数通过 evidence 字符串表明审核前提，不能程序化证明源图和编辑已经核对；G2/G3 必须凭逐项证据把守。全局解析修补可能改变既有 OK 输出；四条候选的桥接上下标和现有源预览失真均须独立验证，不能靠本契约文字消除风险。
