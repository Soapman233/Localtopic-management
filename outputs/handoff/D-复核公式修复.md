---
title: "D复核公式修复交接"
description: "13条公式准入、双端编辑、事务备份与剩余人工路径。"
keywords: ["公式", "交接"]
author: "待补充"
created: "2026-10-10T16:35:19.168970+08:00"
modified: "2026-10-10T17:01:38.856548+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# 交接：复核公式修复 / D

日期：2026-10-10。流程R→D→T，A补G1；D仅按R交接和A冻结执行，G2由主控复核逐条证据后放行正式写入。此报告是开发实测，不能替代独立T的G3验收。

## 我做了什么

1. `pipeline/vendor/mtef_py/mtef.py:47` 新增默认关闭的严格兼容开关；`:136` 按单字节读取FONT_STYLE_DEF char_style；`:390` 规范读取短/长nudge及拒绝截断；`:735` 按variation声明处理左/右可选括号并拒绝节点缺损。普通MTEF转换路径不启用开关，避免改变既有OK语义。
2. `pipeline/mtef_conv.py:131` 仅严格v5路径开启兼容；完整Native头长/声明长度/真实版本预判、原有严格错误检查及可杀worker硬超时保留。真实127条v3均在解析前拒绝，主动挂死worker在0.277秒产生TIMEOUT。
3. 新增 `tests/test_mtef_strict_records.py` 七项规范与反方向验证，覆盖短/长/有符号/截断nudge、style0/2/255、单边/双边/缺损括号、普通开关关闭。复核页 `frontend/src/pages/FormulaReviewPage.tsx` 纠正EMPTY等同源空、FAIL等同LaTeX渲染失败的错误提示，明确PNG字距失真限制，不催促清零。类型检查、构建和前端11项回归通过。
4. 从当前源包重取13候选流/WMF，逐条核对Native/WMF/源DOCX SHA256，原普通路径反证4条FAIL、5条EMPTY。严格修复后13条非空；逐13KaTeX严格渲染、源WMF经Word保真展示对照、新导出语义核对，以及Word/WPS内部改字符→另存→重开→比对均通过。
5. 新备份并verify_backup合格；副本演练首13公式/9题，再次0/0无空版本，两种故意故障整批回滚。主控G2复核后用已有apply_verified单事务正式修复13条/9题，逐表全行审计与基线一致范围内变化；原17626条OK公式和原25条试卷锁定条目全部字段不变。

## 产出物

- 实现：上述两个解析Python、一个前端页面；新增七项测试。冻结的`bank/db.py/importer.py/paper.py/export.py/cli.py`未改，query/labels未改；API/schema未改。
- `outputs/formula-rdt-20261010/D/`：`parsed-candidates.json`实际写回LaTeX与反证、13原始源WMF、`katex.json`与严格渲染HTML、`candidate-export.docx/pdf`及两页高分辨率PNG、`semantic-check.json`、`office-edit.json`与双端另存DOCX、`admission.md`逐项准入表。
- `rejected-script-order.docx/pdf`与`rejected-script-order-edit.json`为首轮反例。上标先行`U^{2}_{L}`仍被桥接转成错误的`L_2^U`，虽13条可编辑也拒绝准入。第二轮`{U_L}^{2}`及同类prime嵌套分组与原LaTeX数学等价，渲染和OMML结构均核实，未修改导出器。
- 数据安全：`backup.json`、`rehearsal.json`、`final-data-audit.json`、`safety.json`及原始日志。全表比较含FTS内部表；没有仅比较行数。
- 人工路径：`manual-source-index.md`、132个`manual-wmf/rq-*.wmf`、`manual-source-manifest.json`、`manual-source-previews.docx/pdf`（Word132图片、25页），当前源WMF逐字节指纹相同。
- 可重跑D探针：`.qa_formula_rdt_20261010/D/evidence.py`、`data_audit.py`、`timeout_probe.py`、`manual_sources.py`。写入验证仅副本，正式apply子命令需重新具备备份与准入前提，勿随意重跑。
- 元数据：修改Python文件头已同步，`.workbuddy-ai/build_asset_manifest.py`登记新测试和交接，重建`outputs/metadata/asset_manifest.json/md`。`AGENTS.md`仅项目全景事实区更新本轮计数、hash和索引。

## 实测证据与逐条准入

逐13完整LaTeX在下节。`admission.md`表对应math index 1至13：rq57/62/64/68→1至4；rq73→5；rq86/87→6/7；rq91/92/93/94→8至11；rq143/161→12/13。每条均当前源指纹一致、KaTeX严格PASS、第二轮新导出语义PASS、Word/WPS逐式EDITED并持久化PASS。

源可靠对照为本轮原始WMF，展示参照 `outputs/formula-rdt-20261010/word-source-previews.pdf` 四页；不是Pillow失真PNG。D查看每条数字、单位、上下标及可见括号。四条KSEE的U为主体、L/R为下标、2为上标；prime分别附属于对应U/F/V/m/p；rq143/161只有左括号，未补可见右括号。`semantic-check.json`另核实嵌套sSup/sSub归属，13式无高风险错序sSubSup节点。

Word/WPS实测使用既有`bank.export.verify_cross_client`，独立DispatchEx实例，逐式寻找公式Range内部可编辑字符并修改，另存新文件、关闭本次文档、重开比对。最终报告两端`maths=13,reopened_maths=13,all_edited=true,edit_persistence=true,status=PASS`。未操作或关闭用户其他文档；WPS遵循现有逻辑不退出可能共享的应用。

### 数据安全与数量

正式新备份：`outputs/bank.backup-20261010-162607-rdt.db`。调用顺序`enrich.verify_backup(original,backup)`，`ok/structure_ok/integrity_ok/core_nonempty/rowcounts_equal`均true，核心表齐全。

写前/备份完整SHA256：`2d1b3694aadae3355256bc7849f5b634ff1a7e78e873e5509d2536e250259601`。

写后完整SHA256：`3e69ee68bae81c4d4a4dd30a1eaddcd69f87be4df80661e19e6e9ee3f945553c`。

实际13公式/9题，题目版本历史7953→7962。仅formulas、review_queue、questions、question_versions、sqlite_sequence有变化：13个批准formula id、13个批准rq id、9题版本/更新时间和9新版本；另8旧版本只补原NULL snapshot_json及NULL change_source=import，旧非空快照不覆盖，旧文本/散列/时间等其他字段不变（收尾按T独立SQL审计补充明确）。原17626条OK公式全部字段相同、paper_questions全25行全部字段及snapshot_json相同；其他所有表全行相同。副本首13/9再0/0且零total_changes；末条旧状态冲突和新版本插入触发器故障均使所有业务行完整回滚。

本轮前145待处理→132；历史51加本轮13，累计64已处理。剩132=127真实v3+3源流/源图冲突+1未知标记+1源空对象；状态口径UNSUPPORTED130/EMPTY2/FAIL0。rq74/75/76、90、85均未处理。

### 命令与日志

项目Python：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`；`PYTHONUTF8=1`，全量测试`TEMP/TMP=.qa_20261010/tmp`。受限Python真实路径启动失败后改用已授权正常环境执行，未把权限失败当不可验证。

- `python -m unittest discover -s tests` D开始基线：311项、29.556秒、OK(skip1)，`.qa_formula_rdt_20261010/D-baseline-tests.log`。
- `python .qa_formula_rdt_20261010/D/evidence.py parse/make_export/office/pdf/semantic`（分别子命令）：各日志在证据目录；当前源硬超时隔离解析，副本新导出13式零桥接错误。
- `node`加载`frontend/node_modules/katex`逐13`throwOnError:true,strict:error`，`katex.json`13PASS。
- `python -m unittest tests.test_mtef_strict_records tests.test_mtef_legacy_v5 tests.test_private_glyphs`：17项通过，`targeted-tests.log`。
- `python .qa_formula_rdt_20261010/D/data_audit.py rehearse`：13/9→0/0、两种回滚、全行差异见`rehearsal.json`；正式`backup`与G2后`apply`日志分开留存。
- `python .qa_formula_rdt_20261010/D/timeout_probe.py`：挂死worker被终止，TIMEOUT，0.277秒；127条v3在解析前拒绝，`safety.json`。
- 前端`npx tsc --noEmit`、`npm run build`、`npm test`：类型检查成功，生产构建7.00秒、11项全部通过；`frontend-*.log`。构建仅有已有大chunk警告。
- 正式apply后最终全量测试：318项（317通过、1 skip），28.948秒，OK(skipped=1)，日志`D/final-tests-after-apply.log`，完成后已立即回报主控。

## 验收标准（给T/主控）

1. 独立从当前源重新取13流/WMF，不直接复用D判断；逐字/数字/上下标与新导出比较；自行严格KaTeX和副本建卷新导出，Word/WPS每式内部改字符保存重开。
2. 自行构造短/长/截断nudge、style0/非0、合法左右/双边/缺损括号反例。用普通路径确认修复前反证；真实v3不入v5，硬超时不移除。
3. 用主控原基线`.qa_formula_rdt_20261010/bank-before.db`或正式备份全行对照当前库；允许变化必须精确限制为13公式、13复核项、9题及留版；所有原OK字段和历史试卷条目/快照相同。副本独立执行幂等和事务故障。
4. 独立全量后端/前端回归，核对冻结文件及接口/schema未改、元数据反映当前代码。未完成验收不能宣称G3通过。

## 我没做/做不到的

- 未移植v3解析器，未猜rq90未知标记，也未用错误源流替代rq74/75/76源图，未给rq85空对象编造内容；这些项目保持待处理。
- 132条人工对照册由Word直读WMF，已查看代表页确认可用展示链路，未逐字验收全部132条。原图可能位于下一页，应用文档搜索RQ定位；原始WMF/来源DOCX路径均可单独打开核对。
- 既有网页PNG转换可能失真，本轮只加如实提示，未更改preview API；未声称PNG存在即内容已通过。
- D未进行独立T验收，未代写T报告；未刷新既有快照、未重跑预处理、未改冻结文件。

## 遗留风险

严格兼容仅修规范字段，不证明任意v5内容正确；解析非空仍须人工源对照。桥接同时上下标存在既有错误，本轮只为13候选使用数学等价分组并实测；其他历史输入仍需逐式核对。人工标记resolved只代表队列操作，不能替代实际内容修复。


## 实际写回LaTeX（逐13）

rq57 / formula 332 / question 463 / F48

```latex
\frac { {U_{\mathrm{L}}}^{2} } { P_{ { \rm{ L } } } }=\frac { (2.5{ \rm{ V } }) ^ { 2 } } { 1.25{ \rm{ W } } }
```

rq62 / formula 337 / question 463 / F53

```latex
\frac { {U_{R}}^{2} } { P_{ R } }=\frac { (6{ \rm{ V } }) ^ { 2 } } { 0.72{ \rm{ W } } }
```

rq64 / formula 339 / question 463 / F55

```latex
\frac { {U_{\mathrm{L}}}^{2} } { P_{ { \rm{ L } } } }=\frac { (6{ \rm{ V } }) ^ { 2 } } { 1.2{ \rm{ W } } }
```

rq68 / formula 343 / question 463 / F59

```latex
\frac { {U_{\mathrm{L}}}^{2} } { P_{ { \rm{ L } } } }=\frac { (6{ \rm{ V } }) ^ { 2 } } { 3{ \rm{ W } } }
```

rq73 / formula 561 / question 564 / F133

```latex
I'=\frac { {U_{0}}^{\prime} } { R_{ 0 } }=\frac { { \rm{ 5 } }{ \rm{ V } } } { { \rm{ 1 } }{ \rm{ 0 } }{ \rm{ \Omega } } }{ \rm{ = } }{ \rm{ 0 } }{ \rm{ . } }{ \rm{ 5 } }{ \rm{ A } }
```

rq86 / formula 1397 / question 2164 / F152

```latex
\frac { {F_{\text{浮}}}^{\prime} } { \rho _{ {\text{水}} } g }=\frac { 6000{ \rm{ N } } } { 1.0\times 10 ^ { 3 } { \rm{ k } }{ \rm{ g } }{ \rm{ / } }{ \rm{ m } } ^ { 3 } \times 10{ \rm{ N } }{ \rm{ / } }{ \rm{ k } }{ \rm{ g } } }
```

rq87 / formula 4464 / question 2625 / F67

```latex
V_{ {\text{水}} } =\frac { m_{ {\text{水}} } } { \rho _{ {\text{水}} } }=\frac { 50{ \rm{ g } } } { 1{ \rm{ g } }{ \rm{ / } }{ \rm{ c } }{ \rm{ m } } ^ { 3 } }=50{ \rm{ c } }{ \rm{ m } } ^ { 3 }
```

rq91 / formula 6439 / question 3662 / F322

```latex
{V_{\text{水}}}^{\prime} =\frac { {m_{\text{水}}}^{\prime} } { \rho _{ {\text{水}} } }=\frac { 1500{ \rm{ g } } } { 1{ \rm{ g } }/{ \rm{ c } }{ \rm{ m } } ^ { 3 } }=1500{ \rm{ c } }{ \rm{ m } } ^ { 3 }
```

rq92 / formula 6440 / question 3662 / F323

```latex
h_{ 2 } =\frac { {V_{\text{水}}}^{\prime} } { S_{ {\text{容}} } }=\frac { 1500{ \rm{ c } }{ \rm{ m } } ^ { 3 } } { 150{ \rm{ c } }{ \rm{ m } } ^ { 2 } }=10{ \rm{ c } }{ \rm{ m } }
```

rq93 / formula 6901 / question 3691 / F784

```latex
p=\rho _{ {\text{水}} } gh_{ 0 } =1.0\times 10 ^ { 3 } { \rm{ k } }{ \rm{ g } }{ \rm{ / } }{ \rm{ m } } ^ { 3 } \times 10{ \rm{ N } }{ \rm{ / } }{ \rm{ k } }{ \rm{ g } }\times 0.11{ \rm{ m } }{ \rm{ = } }{ \rm{ 1 } }{ \rm{ 1 } }{ \rm{ 0 } }{ \rm{ 0 } }{ \rm{ P } }{ \rm{ a } }
```

rq94 / formula 7492 / question 3778 / F257

```latex
{p_{1}}^{\prime} =\frac { {F_{1}}^{\prime} } { S_{ { \rm{ A } } } }=\frac { G_{ { \rm{ B } } } +\Delta G_{ { \rm{ A } } } } { S_{ { \rm{ A } } } }=\frac { \rho _{ { \rm{ B } } } S_{ { \rm{ B } } } h_{ B } g+\rho _{ { \rm{ A } } } S_{ { \rm{ A } } } \left( \Delta h_{ 1 } -h_{ { \rm{ B } } } \right)g } { S_{ { \rm{ A } } } }
```

rq143 / formula 9864 / question 4272 / F23

```latex
{ \rm{ L } }\left( U_{ {\text{额}} } =2.5{ \rm{ V } }\right.
```

rq161 / formula 10039 / question 4326 / F49

```latex
{ \rm{ L } }\left( U_{ {\text{额}} } =2.5{ \rm{ V } }\right.
```

