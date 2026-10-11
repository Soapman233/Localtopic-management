# 交接：导出P0实施事实 / R

本轮R只读增量研究，供A冻结实施契约。只调查既已确认的7个答案区qid、qid7942及其3个源，未扩大为全库审计。**当前源SHA与scan坐标能证实这些样本的问题；旧快照没有源SHA，不能只凭qid/题号/正文hash把当前源结构套给任意历史版本。当前缓存可在完全跳过payload构建时直接返回/复制旧DOCX，必须在缓存命中前处理内容准入。** 本交接提供事实与边界，不代替A的字段/错误码决策。

## 我做了什么

1. 阅读根AGENTS与既有R对比、A路线、V复核；重新只读读取当前库、三个实际源DOCX和既有scan，未重跑预处理。源XML按当前scan的段落遍历方式重建定位（只调用`_collect_runs`，不转换OLE），验证index/text/is_table_cell逐项相等。
2. 核对`bank/paper.py:414`的锁定字段、`:920`的导出投影、`bank/export.py:618`的计划与媒体消费；核对`pipeline/segment.py:161`当前整卷答案边界缺失，并用内存段落重现五类反例。
3. 实际调用`papers.export_data`与`build_document_plan`，读取paper3当前输出；在SQLite `:memory:`与本报告目录的隔离缓存里制造哨兵DOCX，强制payload函数抛异常，验证三个缓存入口绕过内容构建及快照/来源改变不改变key。
4. 用源DOCX副本与内存来源路径验证源缺失、源SHA变化但图片字节不变的现有媒体行为；核对异常映射与前端类型/告警入口。
5. 探针前后守护库、四个生产源码、三个源DOCX与三个scan共11项，hash全部一致；交付库SHA保持`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`。阶段末回归结果见末尾补记。

## 可复用源定位：实测

原始证据：`outputs/export-upgrade-20261010/research/R-current-facts.json`的`questions`和`sources`；每个源包含当前全部段落、普通图/公式预览引用及媒体SHA，后续应只读取需要的题范围，不必全库处理。

|source_id|源SHA前缀|当前XML/既有scan段数|整卷答案标题scan index|
|---|---|---|---|
|144|678260f924980b42|322/322，逐字段0差异|125，`《…》参考答案`|
|2|8d2f61686f184c4b|90/90，逐字段0差异|64，参考答案标题|
|209|5343a29af46e54c7|656/656，逐字段0差异|本题为逐题内联答案，不能把整份解析版都排除|

|qid|scan起止|paper3 seq|当前确认|
|---|---|---|---|
|5542/5543/5544|171–176 / 177–179 / 180–185|5/6/7|在源144整卷答案标题125之后；不是独立完整题干|
|61/62/63/64|78–80 / 82 / 83 / 84|8/9/10/11及12|在源2标题64之后；qid64选入两次|
|7942|582–597|23|题干582起，image123在583；`【答案】(1)`及image124同在589；`【详解】`在592|

qid7942图SHA：image123=`28bd6ccb7b2e8b88f895dd8fa4809f317bf24cc98688d58eab758d1acdb214c3`；image124=`10229ba2c74cf9879491c30c7d5791befe6106dabbc856e16f219e082ea1e7ce`。两图源内各出现一次，当前题/锁定快照均持有两图；当前学生版plan仍有2张。既有R/V证明image124是已接线答案图，本轮重新确认位置和SHA，不重新宣称渲染验收。

**坐标必须区分**：scan index是0基、按body顺序递归进入表格格内的段落序列；源body直接`w:p`的XPath是1基且不计格内段。本题image123/124的body p353/p359对应scan583/589，不能以相同数字混用。`docx_scan.py:260`附近的`walk_block`描述此遍历。

### 旧快照可以证明什么

这8个独立qid的9个paper条目，本次实测快照text/plain_text/content_hash/version/number/answer/analysis/answer_source与当前q全部一致；images及完整formula列表也与当前库一致，锁定`question_version`对应版本行存在且text一致。JSON逐条记录版本行是否有完整snapshot，以及源范围拼接是否等于当前text。当前q的start/end与快照source也一致。因而本样本可把当前已核实源位置作为当前锁定内容的证据。

但`paper._snapshot_question`和`edit._build_snapshot`的source只保存source_id、file_name、元数据、start/end，**没有source SHA/path**。`content_hash`只对去空白、去公式占位符的纯文本计算：实测`1．水⟦F1⟧`与`1．水⟦F2⟧`hash相同，空白变化亦相同；不覆盖公式LaTeX、图、答案/解析。因此历史匹配不能只比较content_hash或当前version。应以锁定的实际文本/媒体/来源范围与被验证源建立佐证；已改正文、公式、图或答案的历史内容不能被当前源强制覆盖。无法证明时应保留问题/待复核，而非自动重写旧卷。这是基于字段事实的安全推断，具体状态由A冻结。

### 必须保留的反例

- 源缺失：本轮内存来源路径改为不存在文件，`resolve_media`实测返回`(None, source_docx_absent)`。
- 源变更：本轮另写源副本，只改document.xml中的一处答案文本、保持所有图片字节，副本SHA改变；内存source_files.sha256保持原值。`resolve_media`仍成功返回image123，因为它只查source_files.path和媒体SHA，不检查整份源SHA。**图片匹配不能证明段落角色仍可信。**
- 同号多节：内存反例含“一、选择题1”和“二、填空题1”，整卷答案区也有两个1；当前segment生成四条。只用number无法配对；当前真实源144的number1有qid5519和5542，最后section沿用不同大题更不能作可靠关联。
- 媒体复用：`docx_scan._collect_runs`通过`images.setdefault(target, paragraph_index)`只保留同一资源第一次出现。内存两处相同图片index0/1，scan.images只剩0。后续角色恢复不能只信该字典，需检查源全部出现实例；同段题干图/答案图混合时仅段号也不足，不能猜定角色。

## 各入口及缓存：实测与代码事实

|入口|当前实际行为/校验|本轮影响|
|---|---|---|
|GET `/api/papers/{id}/export-data`|`papers.export_data:279`→`paper.build_export_payload`→`media.enrich_export_images`；校验paper存在/模式|paper3实际23条；顶层无warnings/content_issues；学生版q7942仍2图。text仍原全内容，另有show_answer/show_analysis，消费方自行切文本|
|POST preview同步入口|`export_svc.preview_request:82`校验存在/模式/模板→算key→完整缓存立即返回→否则才自检/排队|隔离缓存命中时payload即使强制抛异常也没调用；无内容准入|
|preview作业/公共render|`preview.render:226`先is_cached直接返回，未命中才build_payload→plan→桥接→PDF→PNG|必须同时考虑同步命中和render命中；只在plan加校验会漏|
|POST export及执行|`export_request:122`校验格式/依赖→排队；`run_export_job:168`重算key→render→copyfile缓存DOCX/PDF|本轮强制payload抛异常，export仍复制22字节哨兵DOCX并报告cached=true；下载实质是本地路径产物，未发现DOCX下载HTTP端点|
|CLI|`cli.cmd_export:564`用connect_readonly→`export.export_paper_docx:1546`→build_payload→plan→render|不会复用Web缓存，但有独立调用路径，不能只拦Web|

现有Web key=`sha256(v1,paper_id,title,template,answer_mode,subject,stage,grade,有序item_id/question_version/score/seq/section_id)`。实测**修改snapshot_json.text而不改question_version，key不变；修改source SHA，key不变；实际有分组的另一张卷改section name，key仍不变**（paper3无分组，探针也如实记录0行，而非将0行更新当证据）。不含源指纹、snapshot内容hash、模板/renderer revision、section name/description。`is_cached`只看meta、DOCX存在、至少一页PNG路径齐全；哨兵文件也通过，未核对产物hash或对应内容。

推断供A：新增内容准入应在所有共享缓存复用之前运行，并确保处理依据进入cache指纹/版本；否则升级规则后旧DOCX仍可被返回。队列提交和执行之间也会出现状态变化，执行体需覆盖。仅换key一次能清旧缓存，但不能替代后续每次校验依赖指纹。旧PNG按key直接读取亦无内容校验；如何退役旧预览URL由A明确范围。原有本地已下载文件无法由服务撤回。

### 告警/错误已有承载

- plan.warnings现用于缺公式、未知私有字形、媒体缺失；CLI输出warnings/bridge_warnings/errors；preview.meta合并plan+bridge+PDF warnings；export job复制rendered.warnings。两处导出UI展示exportResult.warnings；结构payload/PreviewResponse类型没有内容问题字段，preview cached同步告警也未被类型完整声明。新增问题不能只放plan warnings，结构预览与命中缓存会看不到。
- `webui.errors`已有40001–40006、40401–40408、40901–40903、50001；没有专门内容不完整错误码。实测ValueError('内容完整性待核对')映射40000；ExportError同样文本映射50001（环境类）；不能借用它假装是正确语义。A须显式冻结新增或复用含义。
- ApiError已有data；`JobManager._worker`保存error/error_code/error_data（jobs.py:109），同步异常处理器也返回`{code,data,message}`。本轮实测带data的既有ApiError经过to_api_error原样保留。可复用传输，前端仍须实际展示定位信息。以上不是新增契约承诺。

## 防误切所需的最小边界事实

当前`segment`只收集Q_START，end固定为下一题起点-1或文档末，`SECTION`只更新current_section但不从前题body剔除。本轮五个内存反例完整保存在`segment_counterexamples`：

1. 题干→独立`参考答案`→`1．A【解析】…`：当前产2题，答案标题还吞进前题。修复既要阻止答案条目，也要在标题前截断最后正文题。
2. `1．小明对照参考答案后认为…`：当前正常保留；不能使用任意substring出现“参考答案”就切断。独立非题号标题/明确卷名后缀与题干短语是不同上下文；裸`【参考答案】`在answers.split_inline中是逐题标记，也需避免与整卷标题混淆。
3. 合法短题`1．1N`、`2．水`、短判断句：当前保留。不能以长度、仅A–D、是否有问号单独判定答案区。
4. 多大题各从1编号与答案多大题再编号：题号不能全局唯一配对；原section本身也可能由旧切分错误继承。原`answers._number_corroborated:338`要求除编号/答案外的正文佐证，不能退回唯一同号就写。
5. 最后一题→`参考答案`→表格“题号/1/答案/A”：表格没有Q_START，当前整张答案表都被并入最后一题；不应只停止新增题而留下末题泄漏。scan的is_table_cell只有真假，不能重建表的行列/合并；P0可识别已确认边界，不能宣称恢复完整答案表。

以上是反例与约束，未设计全部AST，未对新算法作通过判定。编号重置本身不是答案区证据，解析版文件名本身也不是答案条目证据。

## 产出物

- `outputs/handoff/R-导出P0实施事实.md`：正式交接。
- `outputs/export-upgrade-20261010/research/r_p0_probe.py`：可重跑探针，只写research子树，所有数据库改动均在`:memory:`。
- 同目录`R-current-facts.json`、`R-probe.log`：当前SQL/源SHA/scan/快照/入口反证；`isolated-cache`、`isolated-download`仅是哨兵探针，**不是有效可交付DOCX/PNG**。
- 同目录`changed-source-copy.docx`及`isolated-media`：仅供源变更反例，不能当作修复题库来源。

## 验收标准（给A/D/T）

1. 用项目Python运行`outputs/export-upgrade-20261010/research/r_p0_probe.py`；本轮原始结果要求3源SHA匹配、当前/scan0差异、11项保护一致。开发后不要要求旧绕过仍true；应另建独立T探针确认同类绕过被阻断。
2. A冻结历史匹配证据、未知/源缺失状态、图片分支、各入口错误/告警、缓存指纹前，不能由D各自发明字段。使用上表scan582–597和两图SHA构造学生/仅答案/答案解析三模式断言；未知/同图跨角色/同段混合需反例。
3. T从源与锁定快照独立重建，不导入本探针的候选判定；对无有效源、SHA变化、同号多大题、旧正文改而hash不变/公式变、缓存命中与排队执行变更分别验证。不能把warning存在当泄漏已阻止。
4. 无正式写库授权时交付SHA保持本轮值；如果涉及库写入，按AGENTS先备份核验、副本差异审计，另行冻结写入范围。本R未做任何写库。

## 我没做/做不到的

未写业务代码/库/原DOCX/原preprocess；未执行导出桥接、Word/WPS渲染或公式编辑；未统计全库答案误切、图分支规模，未补配任何答案；未实施确认UI、快照升级或cache revision。哨兵复制是入口控制反证，不能被称为真实DOCX导出验收。历史快照缺少源SHA是客观限制，本样本当前匹配不能扩大为所有历史版本可靠。

## 遗留风险

源移动/损坏、同资源多实例、同段混合、已编辑正文与当前源不一致都需要待核对路径。把所有解析版排除会误杀源209完整题；把所有未知图丢弃会掩盖内容丢失。source SHA计算与回源读取有成本，缓存新策略需实测后再承诺延时。源码行号为研究时版本，D修改后请以函数名定位。

## 阶段末回归补记

首次沙箱测试解释器提示`Failed to find real location ...python.exe`后持续挂起，已中断；记录`R-baseline-tests.log`，不能作通过证据。正常Windows环境阶段末全量回归**318项，317通过、1 skip，37.849秒，exit 0**，证据`outputs/export-upgrade-20261010/research/R-closure-tests.log`。此测试仅证明研究未破坏既有回归，不证明P0已实施。末次单独Get-FileHash再次确认库SHA未变。
