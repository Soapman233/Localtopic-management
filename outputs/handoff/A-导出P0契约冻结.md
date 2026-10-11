# 交接：导出P0契约冻结 / A

2026-10-10。工作流：R → P → A → D → T → V。本文件只承担A角色，不包含实现或实现通过声明。

**G1通过：已依据正式R《导出P0实施事实》与更新后的正式P《导出P0需求与验收》复核；以下路径、字段、错误码、签名、默认与兼容边界冻结，可交D开工。变更必须回A并通知所有依赖方。**

R本轮实测的三个源SHA匹配、322/90/656段扫描坐标逐字段0差异；q7942范围scan582–597，题干image123在scan583/body p353，答案image124在scan589/body p359并与`【答案】(1)`同段，解析始于592。7个答案区qid/8条目均有源标题边界证据。9相关锁定条目全文/公式/图与当前一致，但对应question_versions.snapshot_json均空，不能称完整历史版本快照齐全。A接受这些事实作实施输入，仍要求D实际旁路解析与T/V独立重建，不把本契约当PoC。其余15候选未全部人工确认，qid2905/qid15源标题残留保留待核对warning，不裁正文。

## 我做了什么

1. 阅读AGENTS、前轮A《达到组卷网导出效果方案》、V《DOCX对比分析复核》与本轮正式R《导出P0实施事实》、更新后的正式P《导出P0需求与验收》，直接检查segment、scan、paper、export、媒体、CLI、Web作业/缓存与结构预览。
2. 将P0限定为只读源证据投影、内容守卫、逐条诊断、显式新卷修订及局部版式，保留现有SQLite schema和bridge。不做全库富文本迁移、重跑预处理、自动改历史快照。
3. 冻结下述数据字段、函数、端点、错误码、缓存/布局revision和失败规则，拆出领域实现、前后端消费与独立验证边界。
4. 独立原生基线318项，317通过、1 skip，34.722秒；源码与库保护记录见architecture目录。沙箱两次失败日志一并保留，不算通过。

## 授权边界与文件范围

用户在完整路线后明确“开始推进”，主控已确认落实第一批及必要局部冻结文件修改。本次具体允许：

|文件|仅允许的功能边界|
|---|---|
|`bank/paper.py`（局部解冻）|新选题前只读内容守卫；payload接统一内容审计/分支投影；新增复制原锁定快照的新卷修订函数；新快照可追加来源SHA，旧快照不回填；不改既有CRUD、组卷语义或迁移体系|
|`bank/export.py`（局部解冻）|消费已裁剪有序块；按实例/分支解析图；统一内容阻断；局部间距/keep/TAB/可信源图尺寸；保留现有公式清洗、OMML与Word兼容后处理|
|`bank/cli.py`（局部解冻）|统一诊断及内容阻断退出码；不加绕过安全的force选项|
|新增`bank/export_content.py`|只读源证据、整卷答案边界、实例归属、诊断、digest；统一业务真源|
|`pipeline/segment.py`|调用统一整卷答案边界识别，新增保留答案区报告；不自动配对、不重跑既有产物|
|`bank/media.py`|补实例显示信息，维持SHA匹配与只读；不按资源去重实例|
|`webui/services/papers.py`、`webui/routers/papers.py`、`webui/schemas.py`|下述只读诊断与显式修订端点/字段；只调用bank|
|`webui/services/export_svc.py`、`webui/services/preview.py`、`webui/routers/export.py`、`webui/errors.py`|同步及后台内容重检、缓存revision和错误映射；旧缓存不可旁路|
|`frontend/src/api/{types,papers,export}.ts`、`frontend/src/pages/{PaperBuilderPage,ExportPage}.tsx`、`frontend/src/components/{ExportDrawer,LivePreviewPanel,PaperPanel}.tsx`|诊断、候选审阅/新卷操作、统一内容清单消费、两处导出入口同门禁|
|`frontend/src/components/livePreview/`、`frontend/src/store/uiStore.ts`|有序分支实例消费、长块完整可读、同revision样式、预览票据digest绑定|
|`tests/`、前端相关测试、`spike/export-p0/`、本轮outputs、Python头注释与asset_manifest、`webui/static/`|必要反证/回归/隔离探针/构建与证据|

`bank/db.py`、`bank/importer.py`继续冻结且本轮不改；`bank/query.py`/`bank/labels.py`不改。`pipeline/docx_scan.py`不改生产扫描行为；只读旁路复现其坐标/公式占位遍历。`bank/edit.py`不新增归属编辑器或PATCH字段。若D发现必须超出清单，应交主控回A冻结，不能自行扩大。

交付库、源DOCX、`outputs/preprocess_final/`始终只读。实现修订能力可写用户主动操作的库，但本轮验收只在副本点击/调用。无正式迁移、批量修库、修改历史清单或自动刷新快照。

## G1数据契约：P0投影，而非新富文本真源

常量固定：`CONTENT_GUARD_REVISION = "export-content-p0-v1"`，`LAYOUT_REVISION = "export-layout-p0-v1"`。改变判断、分支/实例排序或样式即递增revision；不得仅改代码继续命中旧key。

JSON稳定digest统一为SHA256，UTF-8，`json.dumps(..., ensure_ascii=False, sort_keys=True, separators=(",", ":"))`；排除时间戳、缓存本地路径、临时job id。原始snapshot保护另对数据库存储的`str(snapshot_json).encode("utf-8")`逐字节计算，不能用规范化hash代替“字节不变”。

每个导出题在既有字段上追加：

```text
content_status: "ready" | "blocked"
snapshot_digest: 64位hex
evidence_digest: 64位hex
issues: ExportIssue[]
content_blocks: ContentBlock[]
```

`ExportIssue`固定字段：

```text
kind: "answer_region_item" | "source_unavailable" | "source_changed" |
      "snapshot_source_mismatch" | "image_role_unknown" | "image_missing" |
      "source_heading_residue" | "duplicate_question" | "current_version_differs" |
      "source_structure_unsupported"
severity: "blocker" | "warning"
blocked_modes: ("学生版" | "仅答案" | "答案解析版")[]
paper_id: int|null; item_id: int|null; seq: int|null
question_id: int; question_version: int
summary: string                 # 教师定位摘要，不作学生卷正文
message: string; suggested_action: string
source: {
  source_id: int|null, file_name: string|null,
  expected_sha256: string|null, actual_sha256: string|null,
  start_scan_index: int|null, end_scan_index: int|null,
  answer_region_start_scan_index: int|null,
  body_paragraph_number: int|null
}
instance_id: string|null
```

scan index为0起，body paragraph number为1起且只数body直属w:p；不混用。表内段落只有scan index/XPath时body段号为null。摘要/诊断不能被拼进成品DOCX。

`ContentBlock`两种，按最终输出次序排列，字段名固定：

```text
{kind:"paragraph", branch:"stem"|"answer"|"analysis", text:string}
{kind:"image", branch:"stem"|"answer"|"analysis",
 instance_id:string, media_path:string, sha256:string,
 scan_index:int|null, body_paragraph_number:int|null,
 source_width_emu:int|null, source_height_emu:int|null,
 id:int|null, url:string|null, width:int|null, height:int|null}
```

实例id固定为源SHA前16位+`:p`+scan index+`:i`+该段普通图出现序号（0起）。同资源出现两次拥有两个id；不同分支共享资源不能共享“角色”。普通图不包含OLE公式预览，公式仍是段落text里的`⟦Fn⟧`与锁定公式表。

字段兼容：旧payload字段继续存在，但**本轮所有消费者必须改读content_blocks**。`text/plain_text`仅表示投影后的stem；`answer/analysis`按模式裁剪；`images/image_paths`仅是当前模式可见图实例的同序投影（允许重复资源），`formulas/latex_list`只保留当前可见块引用的fid。不得把完整原始快照/答案专属图留在学生版导出payload供消费者再次猜。blocked条目仍保留item/seq/qid/版本和issues，但`content_blocks=[]`、正文/答案/图投影为空，由结构预览显示可定位问题卡；不生成空题成品。

没有本轮新增字段的外部纯数据计划调用保持原行为可用于隔离旧路径反证；所有真实数据库出卷入口统一生成本轮payload，并要求有通过的审计。不能把legacy调用作为内容绕过。`build_document_plan`收到带diagnostics且被阻断的payload必须抛内容错误，不因images空而放行。

payload顶层追加：

```text
content_guard_revision: "export-content-p0-v1"
layout_revision: "export-layout-p0-v1"
content_digest: 64位hex
diagnostics: {
  diagnostic_digest: 64位hex, export_allowed: boolean,
  blocker_count: int, warning_count: int, issues: ExportIssue[],
  duplicate_groups: [{question_id:int,item_ids:int[],seqs:int[]}],
  revision_proposal: {
    exclude_item_ids:int[], keep_item_ids:int[], unresolved_item_ids:int[],
    message:string
  }
}
```

`blocker_count`按受当前模式影响的**条目数**计，warning_count按warning记录计；诊断issue包含三模式blocked_modes。`diagnostic_digest`与当前模式/模板无关，覆盖完整有序item原始snapshot hash、分值/分组、卷元数据、全模式issues及源证据；同一卷不同模式候选审阅token保持一致。`content_digest`覆盖当前模式、选定模板、两revision、卷/大题元数据、顺序/分值、可见块/公式及证据digest。模板覆盖通过下述export-data新增可选参数统一进入content_digest。

默认proposal只建议排除**有源结构证据确认的answer_region_item**，不自动勾选未知图或其他待核对项；unresolved_item_ids列其余blocker。合法重复不排除；源标题残留仅警告，不裁文字、不擅分大题。paper3候选为8坏条目排除、其余15条保留，15只是候选，仍逐条审计。

## G1来源核验、分支归属与降级

新增旁路只读打开源ZIP/XML，不重新做MTEF转换，不改源，不调用全量stage1。遍历必须与`pipeline.docx_scan.scan.walk_block`一致：body和表格的段落顺序、oMathPara一占位、oMath/object计数和FID相同；同时捕获每次普通DrawingML/VML图及可信extent，排除w:object中的公式预览。源复杂浮动位置/无法重现扫描顺序等明确unsupported，不臆造支持。

### legacy快照证据准入（全部成立才允许恢复媒体分支）

1. 快照的source_id及start/end scan范围有效；按source_id查询来源**只取源路径、导入SHA和元数据**，不得取当前questions.text/formulas/images替换锁定内容。来源文件SHA必须与导入receipt匹配；新快照可追加`source.sha256`，有该值时还须与其匹配。
2. 以固定扫描遍历恢复该范围全文，按原segment规则连接非空段落；仅统一CRLF→LF，允许原segment本来就做的首尾空白处理，禁止去字/去数字/模糊相似。结果必须与锁定snapshot.text逐字符相等。分支文本实际输出取锁定值，源只供分支/锚点证据。
3. fid序列及可用的kind/progid/part身份与快照吻合，不比较源重算LaTeX、不覆盖已复核公式。图片资源路径及SHA集合与快照吻合，源范围出现的每个普通图必须被快照资源集支持，快照每个资源也必须找到；两边不匹配阻断。源出现次数用于恢复实例，不能用现有images表的去重次数替代。
4. 源全文唯一对应锁定范围，无法唯一锚定/单一但正文不匹配均不通过。证据digest覆盖源实际SHA、导入receipt、新/旧source锚点、snapshot_digest、扫描规则revision、实例有序锚点和分支。

legacy快照未保存导入时SHA，这是既有数据限制；本轮所用source_files.sha256是导入receipt，不冒充历史快照内部已锁定SHA。正文/公式身份/全部媒体指纹严格匹配是额外必要条件。不能仅凭当前同名源文件、source_id或唯一候选采信。新快照记录SHA增强以后证据，**不回写旧JSON**。

图片角色按源文档中**精确逐题答案/解析标记及其出现次序**判定；与`bank.answers`标记枚举一致，不按image123/124编号、图中文字、文件顺序或SHA猜。同行标记前/后的图必须按XML token位置区别；前图stem，答案标记后到解析标记前answer，解析后analysis。没有逐题标记但整卷答案区存在时不把该区题当stem。分支不可识别为unknown，受影响模式全部阻断，教师版也不能用“全放进去”伪装完整。

q7942须实测源精确恢复stem image123和answer image124，三模式分别裁剪；不能为qid写条件。所有已确认分支按源相对段落/出现顺序消费；不承诺P1任意行内浮动保真。若已锁定独立answer/analysis与inline源文本不同，文本继续用锁定独立字段；能够核对分支但无法精确匹配该分支字符位置的图片放该分支末尾并保留source锚点，不插入源文本覆盖编辑值。

模式仍为：学生版stem；仅答案stem+answer（沿用既有“仅不含解析”语义）；答案解析版stem+answer+analysis。不可偷偷将“仅答案”改成无题干另册。隐藏分支既不进入块，也不解析/打包其专属资源；跨分支共资源只输出可见实例对应引用。

### 缺源/变化/编辑的明确处理

- 无法核验源SHA、源被移走/修改、锚点冲突、快照正文或媒体被改时，原有源证据立即失效。对需要源恢复归属的图、来源位于答案区的条目及无法确认源区的来源绑定legacy条目，给该item blocker，不把整卷其他item标坏。
- 完全不依赖源的无source、无媒体、无“整卷答案区来源”证据的手工纯文本snapshot可走锁定文本分支，不因别题源缺失阻断。源不可用时不能借删除source字段/删除图片自动获得通过；来自数据库真实条目的source_id来源一致性也纳入检查。
- 文本编辑导致不再精确匹配源、且需要媒体归属/原误切判定时，明确待核对；本轮不新增“勾选完整”洗白字段。最小修订出口为在新卷明确排除此题，或经实际修正形成可靠的新版本后重新选入。现有编辑接口不会自动证明媒体安全。
- 无媒体且锁定源范围可被证实不在答案区时，纯文本已编辑可按锁定文本分支输出，给`current_version_differs`/来源投影不可用说明；不使用源字串覆盖它。若范围被确认属于答案区，无论字数或用户勾选都不得直接通过。
- source_heading_residue等疑点只报warning，不按章节标题正则删正文。未知公式私有字形继续原有显式警告/展示清洗；本轮不改变公式内容复核制度。

## G1整卷答案边界与新选题守卫

统一函数识别**独立标题段**（如整段“参考答案”及明确标题形式），并要求其后的编号答案序列/题号答案表等结构佐证；正文中提及、带引号材料、逐题【答案】不可作为整卷截断。不得以答案字母或文本长度为坏题依据；结构不确定报告待复核，不自动配同题号。

在`pipeline.segment`中题目结束范围止于已确认答案区前一scan index，答案区不生成Question。`SegmentResult`新增默认空的`answer_regions`，`to_dict`追加：

```text
answer_regions:[{start_scan_index:int,end_scan_index:int,title:string,
                 reason:string,paragraphs:[{index:int,text:string}]}]
```

该报告保留原文本/坐标，阶段1 scan本身仍含全部公式/图资源；不自动绑定原题、不改answers配对、不丢原数据。实际两个已知来源增量扫描在临时目录运行，既有preprocess文件不写。

`bank.paper.add_questions`在任何新增section/条目写入前完成**最终展开清单**的快照内容审计；某题blocked即全批拒绝，不能部分添加或先建section。重复不是blocker，返回追加`warnings`和`duplicate_groups`，UI在已存在/批内重复时显示具体位置，教师可明确继续保留，后端不自动去重。整卷诊断独立复核所有重复，包括历史卷和不同大题。

为避免现有`_snapshot_question`缺版本行时INSERT污染预检，可局部增加`readonly: bool = False`参数；预检调用readonly=True，缺版本行只以当前锁定候选构建临时数据不写。全部候选通过后才补既有外键所需版本行并正式写入。不能在内容拒绝前调用会commit的创建section/留版helper。

## G1函数与端点

新增领域模块公开签名固定（内部helper自由）：

```python
inspect_snapshot(conn, snapshot: dict, *, paper_id: int | None = None,
                 item_id: int | None = None, seq: int | None = None) -> dict
# 返回所有模式证据/分支候选和issues，不写库；内部候选不得被当成已批准正文。
inspect_paper(conn, paper_id: int) -> dict
# 返回全模式diagnostics及只读证据；无snapshot替换。
project_question(snapshot: dict, inspection: dict, answer_mode: str) -> dict
# 返回当前模式content_blocks/兼容投影/状态，文本只读锁定值。
require_export_allowed(diagnostics: dict, answer_mode: str) -> None
# 阻断时ExportContentError(diagnostics)，不得因环境降级跳过。
class ExportContentError(RuntimeError): ...
class ExportEvidenceStale(RuntimeError): ...
# 两种异常均携带diagnostics属性，Web分别映射40904/40905，不能落成50001。
find_answer_regions(paragraphs: list) -> list[dict]
# 纯数据函数，接受具index/text/is_table_cell的段落对象或同名dict，
# 返回上述answer_regions；segment和只读源审计共用，不依赖DB/文件/桥接。
```

上述纯边界识别函数可位于新增`pipeline/answer_regions.py`再由`bank.export_content`统一导出（此新增文件属于授权范围），以避免pipeline反向加载bank业务或循环导入；业务判定结果仍仅一份，不能在segment与Web分别实现。无论内部位置，公开签名/报告字段不变。

`paper.build_export_payload(conn, paper_id, *, answer_mode=None, template=None) -> dict`仅新增可选template，默认沿用paper.template；所有真实入口共用。`bank.export.build_document_plan`保持既有签名，消费content_blocks，将paragraph经现有sanitize流程生成segments，把image按可见实例解析；不得再次从原快照/数据库补全隐藏分支。

新增`paper.create_revision(conn, paper_id, *, title: str | None, exclude_item_ids: list[int], diagnostic_digest: str) -> dict`：**不commit**，由Web write_txn或CLI调用者提交；失败抛异常保证全事务回滚。下面规则不可省。

|路径|契约|
|---|---|
|`GET /api/papers/{paper_id}/export-data?answer_mode=...&template=...`|保留路径，追加可选template，返回上述完整payload；即使blocked也HTTP200/code0供诊断和问题卡，export_allowed=false不可解锁。非法模式/模板仍40003|
|`POST /api/papers/{paper_id}/preview`|请求不变；先审计后环境检测/缓存；blocker直接HTTP409/code40904，data为diagnostics|
|`POST /api/papers/{paper_id}/export`|请求不变；相同守卫；不得先以50001环境错误覆盖已知内容问题|
|`POST /api/papers/{paper_id}/revisions`（唯一新增路径）|见下述请求/响应；原卷不改；显式新卷|
|`GET /api/jobs/{job_id}`|保持；后台同类错误error_code=40904，error_data=diagnostics；源/快照/请求digest变动为40905|
|`GET /api/preview/{key}/page_{n}.png`|读取前核对meta revisions、原paper/模式/模板当前digest及内容守卫；旧revision/过期key 40905，当前内容blocked 40904；不能凭已知旧URL继续读本轮泄漏缓存|

修订请求：

```json
{"title":"未命名试卷（修订）","exclude_item_ids":[113,114,115,116,117,118,119,120],"diagnostic_digest":"64位hex","confirm":true}
```

title可省，默认原title+`（修订）`；显式空串或超200字符非法。exclude_item_ids必需，允许空列表（显式复制），必须每个为当前卷item且唯一；不允许排除全部，空卷修订也拒绝。允许用户额外排除未知图/其他问题题，不能仅依默认proposal机械写入。confirm默认false；未确认40903。无合法64hex/非法列表/title/全删为HTTP400/code40007。paper不存在仍40402。其他卷item/重复item也40007。

在**同一写事务内**重新审计并比对diagnostic_digest，不一致HTTP409/code40905，data返回最新diagnostics，零写入。比对通过后复制原paper元数据（新id、title、新时间、draft），复制全部section元数据到新section id；按原seq/id顺序复制保留item的question_id/question_version/score/**原始snapshot_json字节串**，映射新section_id并连续seq。保留原空section，不凭内容自动重组。禁止调用add_questions重新抓当前最新版、refresh_snapshots或改原卷updated_at。

成功HTTP200/code0：

```text
{source_paper_id:int,paper_id:int,
 excluded_item_ids:int[],
 item_mapping:[{source_item_id:int,item_id:int,source_seq:int,seq:int}],
 paper:<现有get_paper完整结构>, diagnostics:<新卷最新diagnostics>}
```

新卷仍有blocker允许创建（教师保留决定可继续修订），但响应/界面明确无法出卷，不能自动声明成功达标。默认15项候选若全部内容合格则blocker_count=0，qid12重复等warning保持。

Web新增常量：`CODE_EXPORT_CONTENT_BLOCKED=40904`、`CODE_EXPORT_EVIDENCE_STALE=40905`、`CODE_INVALID_REVISION=40007`。错误体仍`{code,data,message}`；不可把ExportContentError先映射为泛50001。CLI `export paper`内容错误打印逐item定位和下一步、退出3；`paper export-data`输出诊断payload并在blocked时退出3（允许输出供诊断），参数错误2、环境/文件1保持；不存在“force导出”开关。CLI路径、模式枚举不增不改。

## G1缓存、作业与前端门禁

旧cache_key v1不再可命中。新key=SHA256规范化对象，覆盖content_digest、两revision与渲染所需metadata；content_digest已覆盖每条snapshot和源**实际内容SHA**，不能只看mtime/文件大小。每次请求、后台执行、缓存返回、导出copy前都重核内容；同尺寸mtime不变的源篡改也须失效。

后台接收提交时expected content_digest/key，执行时重新算；不一致40905，不用新内容冒充已确认旧预览。渲染结束发布meta前和copy下载前再次重核，避免源/快照在渲染中变化。meta写入两revision、content_digest、diagnostic_digest、docx_sha256；命中须文件hash一致且revision/current digest一致。不删除历史缓存，但旧meta无revision默认过期。已生成的用户本地旧DOCX不会被本轮撤回，不能声称已清除所有旧泄漏文件。

内部作业签名追加`expected_content_digest: str`：`run_preview_job(paper_id, answer_mode, template, key, expected_content_digest)`、`run_export_job(paper_id, answer_mode, template, formats, out_dir, expected_content_digest)`；`preview.render(paper_id, answer_mode, template, key, *, expected_content_digest: str | None = None)`，省略只用于内部直接调用，仍重新审计并要求key与当前计算一致，不能跳守卫。

preview/export同步结果和job result追加`content_digest`、两revision、diagnostics；结构预览query key含mode/template。前端PreviewTicket追加`contentDigest`，beginPreview/markFresh基于当前结构payload digest及返回digest一致才解锁；失败、诊断变化、修订新卷、模板/模式变化一律invalidate。禁止旧late response解锁。`export_allowed=false`两入口都禁用正式输出；无Office结构确认只能在当前digest合格时生效。后端守卫为最终边界，不信任前端布尔。

界面保留原23条清单；逐问题卡显示source坐标体系、item/seq/qid/版本/原因/操作，支持复制完整诊断JSON。提供“查看修订候选”清单：逐项保留/移除、默认只勾8坏项排除、重复与其他疑点仍显示；用户显式“创建修订卷”才POST；成功切新卷并锁预览，原卷仍可打开。检查中/失败/未获取diagnostics不能把按钮当已通过；诊断请求失败显示可重试原因，不能无限转圈。

## 局部版式冻结：先探针，失败如实分项不达标

本轮不新增模板枚举或用户配置。保留三模板既有A4、字号、页边距、大题分页和标分语义，降低修改面；参考10.5pt/17mm不本轮全局套用。明确局部参数：题末16pt→8pt；图片前后10pt→4pt；标题和大题间距保持。中文/西文默认字体不改，避免借字号缩小掩盖内容问题。

保留原TAB不转四空格：源/锁定text中`\t`输出为真实w:tab及模板显式tab stops，按当前版心宽度的1/4、1/2、3/4设置左对齐停靠点（pt转换为twip），不依据TAB自动认定选项数。含宽公式/图/多行复杂选项保守保持原段或一项一行，禁止按字数猜四列；不增加自动识别选项图布局。bridge是否正确保留TAB先做隔离PoC，若不支持用受控OOXML局部修复并双端看图，不把文档描述当成功。

keep：大题标题连首段；每段keep_together。只有无图/无公式/无答案解析、最多4非空段且可见正文≤180字符的短题连keep_next；这是布局保守条件，**不是内容正确性判定**。其他题仅题首连下一段，图连紧邻说明/同分支下一段，分支标题连首段，不能整题长链锁死；跨stem/answer/analysis边界不连。长题在段落边界自然分页，续页不重新输出顶层题号/分值；本轮不保证任意复杂表格拆分。

尺寸：可信source extent可用时保持比例，显示width=min(现有fit上限、源显示宽度、当前版心宽度)，height依比例并受既有7cm上限；不得为了最小3cm放大可信小图。无extent沿原fit策略但报告无源尺寸，不宣称源尺寸保真。宽高比相对误差≤1%。结构预览同一spec/revision；超高整题容器必须完整可读（可让块自然增高/标“结构分页近似”），不能overflow:hidden裁切正文。页面数与Word/WPS允许不同。

## 分工与可执行验收

D主开发先隔离探针证明源projection/TAB/局部keep，再实现统一bank守卫与修订事务；Web/frontend只消费固定契约，不各写一套答案区/图角色猜测。若分D角色并行，以bank字段/错误优先冻结给依赖方；任何字段/默认变更回A，不只口头发消息。

G2最少实测交付：

1. 在副本用源码备份旧路径**本轮新导出**复现q7942image124泄漏和paper3坏条目，保存同清单/同模式输入；修复后新导出三模式同内容对照。压缩包普通图实例/资源SHA位置清单、Word/WPS逐页PNG与人工逐项核对均需有。
2. paper3只读诊断精确命中113–120、8item/7qid；重复64/12分开显示。副本调用新端点采用默认8排除，原23条JSON字节/分值/seq不变，新15条快照字节逐项相等且顺序/分组/分值一致。qid12重复warning保持；全删/外卷item/重复排除/digest变化/中途异常注入均零残留新卷。
3. 新15候选blocked归零再预览/导出；原23卷preview/export/CLI/旧PNG key均不可绕过。q7942学生stem image123=1、answer image124=0且纯答案媒体包内0；教师两图角色正确；仅答案不含analysis。图片共享跨分支资源/同资源重复实例作独立反例。
4. 新scan→segment临时源2题+答案标题/编号答案/答案表只生成2题，并留answer_regions；实际两个已知来源增量验证；同号大题、正文提及参考答案、逐题答案后下一题、合法短题/字母对象不得误伤。
5. 移源、同名异SHA、同mtime异内容、唯一错误锚点、改snapshot text/images、最新questions变更、渲染中变化，逐项验证证据失效/旧卷不变。验证源缺失只影响相关item，不把其他正常题标坏。
6. 内容blocked+Office缺失时40904优先；合格无Office可DOCX降级；结构/像素/下载的item/分支/实例清单一致，下载DOCX与缓存hash相等；旧revision/修改源后不命中旧cache并锁预览。
7. 局部版式同内容当前新导出对照：没有新增裁切、孤立选项标签、空白尾页；TAB真实保留、小图不放大、长题可续页，编号/小问/分值/所有内容逐项一致。公式仍按sanitize_glyphs/sanitize_latex；未知私有字形提示保持。任何触及公式消费/导出后，运行`bank.cli export verify`及Word/WPS内部改字符→保存→重开，不能仅报OMML数量。
8. 全量后端、前端npm test/tsc/build；同步Python资产头和manifest。正式库/源/preprocess初末hash相同；副本写表差异审计。D交接须逐项列通过/失败/未做；T/V重新取源和构造反例，不只复跑D脚本。

## 版本与回退

本轮无schema迁移；旧快照reader继续读旧JSON，运行时overlay从不落回旧snapshot。新卷保留原锁定JSON；新增source.sha256只在新选题快照产生。现有edit留版机制不改。任何回退仍必须保留内容守卫与两revision校验；不能回退到已知泄漏路径或删图绕过。布局可回退既有间距/keep（递增LAYOUT_REVISION），内容安全不可回退。无法源核验的题给诊断和排除出口；本轮没有人工逐图确认/富文本修复器，不暗示所有未知题已可自动恢复。

## 产出物与阶段证据

- `outputs/handoff/A-导出P0契约冻结.md`：本契约。
- `outputs/export-upgrade-20261010/architecture/baseline-tests-native.log`：318项、317通过1skip，34.722秒，exit0。
- `outputs/export-upgrade-20261010/architecture/protected-before.json`：10项源码/库初始hash。
- `outputs/export-upgrade-20261010/architecture/protected-after.json`：A阶段末10项全部不变；此检查在D实施前完成。
- `outputs/export-upgrade-20261010/architecture/closure-tests-native.log`：A末测318项，317通过1skip，35.258秒，exit0。正式库SHA仍为`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`。
- `outputs/export-upgrade-20261010/architecture/baseline-tests.log`、`baseline-tests-workspace-temp.log`：沙箱失败/挂起证据，已停止本A会话，不作为通过。

## 我没做/做不到的

未写生产实现、未修改任何源代码/交付库/历史快照/源文件/预处理、未实施schema、未做本轮源恢复PoC或新DOCX双端渲染/内部编辑。基线通过仅证明已有基线健康，不证明上述P0契约已经实现。源扫描恢复、TAB/keep及15条候选可用性必须由D实测及T/V独立验证。

## 遗留风险

legacy没有源SHA内嵌，需导入receipt+全文/公式身份/全部媒体指纹共同核验；原题富文本、复杂表格/浮动图信息不完整，P0不普遍恢复P1效果。范围语义/源答案区识别可能存在未覆盖变体，不可靠结构明确待核对。保留的重复及源标题疑点可继续警告，blocker归零不意味着全库内容已人工审定。
