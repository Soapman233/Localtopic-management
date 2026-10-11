---
title: "T复核公式独立验证交接"
description: "13条G3独立验收、源图及双端编辑、完整数据审计与非阻塞限制。"
keywords: ["公式", "交接"]
author: "待补充"
created: "2026-10-10T16:58:59.604810+08:00"
modified: "2026-10-10T16:58:59.604810+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# 交接：复核公式独立验证 / T

日期：2026-10-10。结论：**本轮13条/9题实质修复通过G3独立验收**；132条继续待处理。本结论限本轮已逐式核对的13条，不声称任意v5都可安全自动批准，也不声称所有132条已经通过视觉内容验收。

## 我做了什么

1. 完整阅读AGENTS、任务与R/A/D交接、当前解析和原子写入代码，自行编写T探针，没有运行或照抄D/R验收脚本。所有写入实验仅使用T副本，未写交付库、源DOCX或生产实现。
2. 从当前源DOCX重新提取13个OLE原生流、13张WMF，独立核对源文件SHA、XML中的ProgID/OLE/预览关联。用独立Word实例重新生成源WMF对照DOCX/PDF，并查看高分辨率页面，逐13核对字符、数字、单位、上下标、中文及单边括号。
3. 在当前交付库副本通过正式编辑留版、建卷与导出入口隔离出13条实际库公式，新导出13个OMML且无桥接警告/错误；严格KaTeX13条通过。自行编写COM探针，Word/WPS各13条均在公式Range内部改数字、另存、关闭、重开，全26次修改持续存在；另独立运行任务要求的CLI verify，两端PASS。
4. 独立设计48项记录边界、截断与硬超时恢复验证；关闭严格兼容路径复现4 FAIL、5 EMPTY。逐表完整行比较原始基线与正式库，独立SQL核对旧8条补快照及9题全部新旧完整快照；副本验证重复执行零写入、前置冲突及中途插入失败整批回滚。
5. 检查132条人工路径的源SHA、XML关联、原始WMF与附件逐字节相等、现有PNG转换链路；重读127个真实v3且全部在v5入口前拒绝，保真抽查rq5、77。阶段开始/结束全量测试及前端回归完成，交付库阶段前后完整SHA不变。

## 产出物

- 独立探针：`.qa_formula_rdt_20261010/T/audit.py`、`office.py`、`boundaries.py`、`extra.py`、`katex.cjs`。这些为T隔离实验，不属于生产实现。
- 证据根目录：`outputs/formula-rdt-20261010/T/`。
- 源证据：`sources.json`、`rq-*.native/wmf`、`T-source.docx/pdf`及当前`T-source-1.png`至`-8.png`。当前源册内容在1/3/5/6/8页，2/4/7页为空白；这是T对照册分页，不能据空白页推断源公式为空。
- 新产物：`export-copy.db`、`T-payload.json`、`T-export.json`、`T-new-export.docx/pdf`和两页PNG；双端另存件`T-Word-edited.docx`、`T-WPS-edited.docx`；`T-office-edits.json`逐式记录before/after/位置/替换字符/reopened。CLI报告`cli-verify.json/log`。
- 正确性与反证：`T-katex.json`、`counterfactual.json`、`boundaries.json/log`、`extra.json/log`。
- 数据/人工路径：`audit.json/log`（完整逐行差异，含旧快照）、`entries.json`、`manual.json`、`manual-png/`。
- 回归：`.qa_formula_rdt_20261010/T/start-tests-normal.log`、`final-tests.log`；证据根目录`frontend-tests.log`、`frontend-tsc.log`、`frontend-build-normal.log`。

## 逐条正确性与可编辑性

以下源页均指T本次重建的`T-source.pdf`；全13的实际库LaTeX及当前源指纹在`sources.json`。T查看源保真图后再与本次新导出比较，不使用D截图或历史导出作为正确性证据。新导出第一页含全部13条，第二页空白的排版观察见下文。

| rq / formula / question / fid | 源页 | 独立逐字与上下标核对要点 | 严格KaTeX / Word / WPS |
|---|---:|---|---|
|57 /332 /463 /F48|1|U主体、下标L、上标2；P下标L；(2.5V)²/1.25W|PASS / PASS / PASS|
|62 /337 /463 /F53|1|U主体、下标R、上标2；P下标R；(6V)²/0.72W|PASS / PASS / PASS|
|64 /339 /463 /F55|1|U主体、下标L、上标2；P下标L；(6V)²/1.2W|PASS / PASS / PASS|
|68 /343 /463 /F59|1|U主体、下标L、上标2；P下标L；(6V)²/3W|PASS / PASS / PASS|
|73 /561 /564 /F133|3|I′=U₀′/R₀=5V/10Ω=0.5A；prime附U，0为下标|PASS / PASS / PASS|
|86 /1397 /2164 /F152|3|F浮带prime，ρ水g；6000N/(1.0×10³kg/m³×10N/kg)；浮/水均对应下标|PASS / PASS / PASS|
|87 /4464 /2625 /F67|3|V水=m水/ρ水=50g/(1g/cm³)=50cm³；三个水及两处³均对应源图|PASS / PASS / PASS|
|91 /6439 /3662 /F322|3|V水′=m水′/ρ水=1500g/(1g/cm³)=1500cm³；V、m各自带prime|PASS / PASS / PASS|
|92 /6440 /3662 /F323|5|h₂=V水′/S容=1500cm³/150cm²=10cm；容为下标|PASS / PASS / PASS|
|93 /6901 /3691 /F784|5|p=ρ水gh₀=1.0×10³kg/m³×10N/kg×0.11m=1100Pa；h下标0|PASS / PASS / PASS|
|94 /7492 /3778 /F257|5|p₁′=F₁′/S_A=(G_B+ΔG_A)/S_A=(ρ_BS_Bh_Bg+ρ_AS_A(Δh₁−h_B)g)/S_A；prime、A/B/1和Δ位置均核对|PASS / PASS / PASS|
|143 /9864 /4272 /F23|5|L(U额=2.5V，仅左括号；额为U下标，没有擅补可见右括号|PASS / PASS / PASS|
|161 /10039 /4326 /F49|6|同rq143，独立源流/WMF已重取并核对|PASS / PASS / PASS|

Word/WPS的PASS表示实际修改和持久化：四个平方指数2改3、rq73的U下标0改1、rq86的6000改7000、rq87的50改60、rq91的1500改2500、rq92的h下标2改3、rq93的h下标0改1、rq94的p下标1改2、两条单边括号式2.5改3.5。不是在公式外加字，也不是仅数OMML节点。`T-office-edits.json`按索引1至13与上表同序记录两端全部before/after与重开全文。编辑成功与语义正确是分别验证的两项。

新建卷的隔离方式：只在副本删除9题的非候选公式和图片，通过`bank.edit.save_question`把题干换为RQ标签及原fid占位符后留版，再`paper.create_paper/add_questions`与`export_paper_docx`。实际候选LaTeX不改。这样新导出精确包含13目标式；原始完整题干及公式仍由只读数据审计覆盖。首个直接改副本题干的实验触发旧版本文本语义，T改用正式留版后重新导出，本报告只引用最终13式新产物。

## 独立反证与边界

`boundaries.py`自行构造输入，未调用D测试作为独立验证：

- 当前源13流经普通路径（严格兼容关闭）得到4 OK、5 EMPTY、4 FAIL；严格路径得到13 OK。普通仍失败/空的9条为rq73、86、87、91、92、93、94、143、161。四条KSEE的“普通OK”不意味着源图/桥接已正确，故另逐式验证新导出上下标。
- 短nudge覆盖(-128,127)、(127,-128)、(-1,1)、(1,-1)、(0,96)，长nudge覆盖两个int16极值、(-500,500)、(0,0)，各自验证尾随TAIL字节未被吞掉；6种截断均抛EOFError。
- 独立最小二进制v5覆盖FONT_STYLE_DEF style=0/1/127/254/255，后接x字符仍得到x；缺char_style拒绝。
- 括号variation=0/1/2/3分别验证零/左/右/双边，空节点和多余节点拒绝。它验证本次括号语义边界，不代表任意模板完整性。
- 头缺失、Native声明长度不符、增加尾字节、版本改v3均在v5预判拒绝。真实127个v3也逐条验证预判拒绝，没有把v3喂给不兼容解析器。
- T构造挂死worker并在同批放下一条有效公式，生产`convert_many`先TIMEOUT再OK；实测0.832698秒，`multiprocessing.active_children()`为0。测试的是可杀隔离和恢复，不拿进程内软超时代替。
- 反向源内容反例：独立重解rq74/75/76均为R_x；其中rq74保真源图为1/R，证明确有源冲突。rq90仍有裸&，源图无可见&；rq85仍EMPTY。五条都未被写回或resolved，不能由解析OK批准。

### 非阻塞问题及明确限制

1. **缺END输入仍可返回OK。** 复现：运行`python .qa_formula_rdt_20261010/T/extra.py`；其`missing_end_probe`使用完整Native hex `1c000000000000000f00000000000000000000000000000000000000050101060054000001000200837800`。头长28、声明payload长15匹配，但LINE/x之后缺结束END。实际普通与strict均`OK/x`；期望严格完整性判定拒绝缺结束记录。原因路径是`MTEF.readRecord`遇EOF结束循环而未令Valid=False，AST还能输出x。当前关闭本轮兼容开关的普通路径同样复现，且输入不含nudge、FONT_STYLE_DEF或括号，说明与本轮三种兼容分支无关；这是共同EOF路径的既有限制判断，未声称持有旧实现完整副本做历史版本二进制比对。影响：不得把strict OK当作任意v5完整性或语义准入。本13真实源逐式比对及编辑未触发此反例；交付写回受逐项证据约束，因此本轮非阻塞。已报告主控，由主控确认保持范围，不擅改生产解析器。
2. **现有PNG仍可能严重失真。** 全132张转换成功只证明链路可用。T源册第8页rq90保真图为清晰的压强等式，而`manual-png/72f6039bac2ef82f8da6fe319fda2598275c8ed96bb260bdf6c0d390508091a5-144.png`字符重叠。复核页已明确提示字距/重叠失真及使用Word核对来源；D附件132张原始WMF与当前源逐字节一致，T已保真抽查v3 rq5=U/R、rq77=U₁/U₂。其余127类不宣称逐字审核通过。
3. **T隔离卷尾空页。** 当前`T-new-export.pdf`有2页，全部13式在第1页正确可读，第2页仅页脚。复现`office.py export`后`office.py edit`（生成编辑前PDF）；期望无无内容尾页。冻结`bank/export.py`与基线SHA一致，本轮未改排版链路，不将其归为本轮13公式修复造成；影响范围只实证该9题隔离输入，不能推成所有试卷。已报告主控，作为非阻塞排版观察，未自行改冻结文件。

## 数据差异与安全

原基线`.qa_formula_rdt_20261010/bank-before.db`与正式备份`outputs/bank.backup-20261010-162607-rdt.db`完整SHA均为：

`2d1b3694aadae3355256bc7849f5b634ff1a7e78e873e5509d2536e250259601`

独立调用`verify_backup(原基线,正式备份)`全部结构/完整性/核心表非空/逐表行数检查通过，且两文件字节哈希相同。T开始、结束当前交付库完整SHA均为：

`3e69ee68bae81c4d4a4dd30a1eaddcd69f87be4df80661e19e6e9ee3f945553c`

T用Counter完整行多重集比较全部20张表（包括FTS内部表），不是只比较总行数；sqlite_master所有记录完全相等。允许变化精确为：

| 表 | 结果 |
|---|---|
|formulas|仅13个准入id，字段仅latex/status/needs_review；原17626条OK全部字段相同|
|review_queue|仅13个准入rq，字段仅reason/resolved；其余所有记录原样，132未处理保持|
|questions|仅9个题，字段仅version/updated_at，每题版本+1|
|question_versions|7953→7962；9新行，另8旧行只补NULL的snapshot_json并将NULL change_source补为import；旧文本/散列/长度/时间等所有其他字段不变|
|sqlite_sequence|仅question_versions的序号推进|
|其余全部表|完整行完全相等；paper_questions25条全部字段与snapshot_json字符串逐字节相同|

旧8行id/question分别564、2164、2625、3662、3691、3778、4272、4326。T另以独立SQL重建预期（不调用开发的`_build_snapshot`），核对这8条及原已有非空快照的463/v2，共9题所有旧快照；再核对9新快照。题干/答案/解析、全部354条公式的每个快照字段、图片/标签/来源均与修前或修后库对应状态相同。9题版本分别463:2→3，其他8题1→2；`audit.json.snapshot_sql_checks`逐题留证。旧非空历史快照未被覆盖。

副本事务：首应用`13/9`，重复`0/0`且`total_changes`增量0。最后一个entry旧状态故意冲突，整批拒绝；TEMP触发器在新版本插入时抛ABORT，已有公式更新与旧快照补写全部回滚。两种故障前后完整`iterdump`完全一致。

冻结边界：逐个与`baseline-files.json`SHA对照，差异只在`pipeline/mtef_conv.py`、vendor解析器、`frontend/src/pages/FormulaReviewPage.tsx`、资产清单构建脚本、AGENTS事实更新。新增测试另独立核实存在。五个冻结bank文件及query/labels、API/schema文件SHA未变。三份改动Python交付资产文件头字段存在、清单条目存在且size精确匹配。T正常环境重建了前端static，已通知主控最终刷新清单时间信息；T未改资产构建实现或代写D交接。

## 命令与实测数值

项目Python为`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`，`PYTHONUTF8=1`，全量测试`TEMP/TMP=.qa_20261010/tmp`。沙箱首轮Python真实路径解析失败，精确终止本次挂起进程后用正常环境重试；该环境失败不计业务失败。前端首次build为沙箱EPERM，正常环境重试成功。

```text
python -m unittest discover -s tests
开始：Ran 318 tests in 30.039s / OK (skipped=1)
结束：Ran 318 tests in 30.804s / OK (skipped=1)

python .qa_formula_rdt_20261010/T/audit.py
完整20表差异、17626原OK、25锁定行、新旧快照、首13/9→0/0、两种故障整批回滚 PASS

python .qa_formula_rdt_20261010/T/office.py source
python .qa_formula_rdt_20261010/T/office.py export
python .qa_formula_rdt_20261010/T/office.py edit
13候选源图及4个人工反例独立Word保真渲染；新导出13式、0桥接错误/警告；Word/WPS各13持久化 PASS

python -m bank.cli export verify outputs/formula-rdt-20261010/T/T-new-export.docx --out outputs/formula-rdt-20261010/T/cli-verify.json
word PASS 13→13 改字符保留=True；wps PASS 13→13 改字符保留=True

node .qa_formula_rdt_20261010/T/katex.cjs
13 strict KaTeX PASS (throwOnError=true, strict=error)

python .qa_formula_rdt_20261010/T/boundaries.py
PASS 48 boundary checks; manual 132; v3 127; ordinary EMPTY5/OK4/FAIL4

cd frontend
npm test          11 PASS, 0 FAIL
npx tsc --noEmit  exit 0
npm run build    成功6.77秒，仅已有大chunk警告
```

## 验收标准（给主控）

1. 查`T-office-edits.json`两端count=13、all13_internal_edits_persist=true，逐式before与after不同且reopened等于after；结合源页与新导出图确认内容正确，不能只看编辑PASS。
2. 查`audit.json`仅上述允许行/字段变化、snapshot_sql_checks九题均true、两种fault all_rows_equal=true，交付SHA与上方一致。
3. 查`manual.json`132条全部xml_anchor/wmf_equal=true，v3_rejected=127；保留当前132待处理及PNG限制文案，不把解析OK或标记resolve当修复。
4. 查开始/结束全量及前端日志；最终清单刷新后不得改变生产代码/交付库。非阻塞限制必须随交付如实说明。

## 我没做/做不到的

未逐字审阅全部132个未批准公式；只对13批准条目逐字/导出/双端编辑全覆盖，并对人工路径全量取证、代表保真抽查。未实现v3、未知标记或源冲突修复。未修改解析器EOF边界、冻结导出器或PNG渲染。未做浏览器交互视觉验收；前端此次修改只涉及准确提示，已完成现有11项回归、类型检查和生产构建。未把本轮13成功扩大为任意v5、任意试卷排版或全部历史公式导出正确性结论。

## 遗留风险

缺END严格边界、PNG保真限制、隔离卷尾空页见上方具体复现。13条修复准入依赖逐项证据，`apply_verified`本身不审核源语义，今后不能用解析非空批量自动审批。当前未发现本轮13条内容、持久化、原OK数据或锁定快照的阻塞回归。
