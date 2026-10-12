# 交接：B1 架构与 G1 契约冻结 / A

## 我做了什么

- 完整读取 AGENTS.md、deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md 及正式 outputs/handoff/R-B1.md、P-B1.md；仅以用户本轮 B1 为实施范围。旧分批表将辅助预览只读化/动作去重列到 B3，不改变本次授权。
- 只读核实 frontend/src/router.tsx:38/:65/:73、App.tsx:119/:135/:193/:367，冻结路由、四项导航、独立标题和兼容重定向契约。
- 核实四维护页所有成功/加载/失败标题分支，冻结父 h1、嵌入页 h2、内部章节 h3 及内外 Tab 可访问名称。
- 核实 PaperBuilderPage.tsx:248/:258/:631/:694、PaperSwitcher.tsx:74/:81、PaperPanel.tsx:155/:195/:358，冻结单一懒加载管理抽屉、空态入口及唯一工作台主导出按钮。
- 核实 api/papers.ts:40/:45/:50/:60、api/paperRestore.ts:12、useQuestionFilters.ts:84、ExportPage.tsx:62/:161/:185、ExportDrawer.tsx:78/:161/:245、ExportDiagnostics.tsx:40/:57，冻结副本重建、一次性指定卷回程、辅助页只读和共享门禁边界。

## 产出物

- outputs/handoff/A-B1.md（本文件）。未修改生产代码、API、冻结文件、交付库或构建产物。
- G1 状态：**已冻结，D 可以按本文件实施**。任何路径、共享接口、state 字段、API 字段或错误码变更须回 A 重冻，并通知所有依赖方。

## G1 冻结契约

### 1. 范围、基线与不可修改边界

本轮只实现 B1 信息架构、入口整合。不做 B2–B5 的列数/间距/卡片/维护内部业务/设置/动效改版，不改变导出渲染、纸面测量、公式、数据业务。

当前 B0 基准 HEAD=a72d196。后端主控实测 436 项、1 skip、OK；前端 26 node:test + 261 vitest。原始入口 31,130 bytes；默认 /builder 冷首屏 1,068,908 bytes / 16 JS 请求。R 已以空 localStorage/CDP 禁 cache/1366×768实测复现，明细 .qa_B1_R/cold-js-B0.json。这组用户本轮基准覆盖方案旧 30,800、旧测试数。D/T 用同一 raw bytes、冷缓存和完成加载口径比较，不得回退；必须同时报告入口、全部首屏 JS bytes/count 和实际请求文件。不可把新增业务搬进预加载 vendor 伪装入口变小。

outputs/bank.db 完整 SHA256 冻结为 6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。真实写验证仅用 QB_DB_PATH 指向独立副本；真实设置保存用内存接口拦截。后端、bank 冻结文件、本轮 API 均不改。

### 2. 导航、正式路由、标题和旧路径

必须先从 router.tsx 删除“由 NAV_ITEMS 生成业务路由”的依赖，再精简侧栏。NAV_ITEMS 只含无前导斜杠的 builder/search/manage/settings，显示名依次为组卷工作台/找题/数据维护/设置。日常两项；低频维护使用 MUI Collapse 默认关闭，触发器 aria-expanded/aria-controls；访问 /manage 或分段 /manage/* 自动展开；四维护链接仅存在于外壳 Tab。设置在底部。导航描述不再常驻第二行。

正式路由与导航独立定义：

| URL | element / 行为 |
|---|---|
| /login | 独立 lazy + 现有 LoginLoadBoundary，不套 RequireAuth |
| / | RequireAuth + App；index replace 到 /builder |
| /builder | PaperBuilderPage lazy |
| /search | SearchPage lazy |
| /question/:id | QuestionDetailPage lazy |
| /export | ExportPage lazy，只读全屏预览辅助页 |
| /settings | SettingsPage lazy |
| /manage | DataMaintenancePage lazy；index replace 到 knowledge，保留 query/state |
| /manage/knowledge | KnowledgeReviewPage lazy、嵌入标题 |
| /manage/formula-review | FormulaReviewPage lazy、嵌入标题 |
| /manage/sources | SourcesPage lazy、嵌入标题 |
| /manage/stats | StatsPage lazy、嵌入标题 |
| * | replace 到 DEFAULT_LANDING_PATH=/builder |

保留 createHashRouter。四兼容路径 /knowledge、/formula-review、/sources、/stats 分别到同名 /manage 子路径。LegacyRedirect 读取 location，使用 replace，完整保留 location.search 与必要 location.state；/manage 的 index 重定向同样遵守，不用会丢 query/state 的裸 Navigate。既有 /manage/* 直接有效，不再二次迁移。

选中/aria-current 使用精确路径或分段前缀：/builder 与 /export 选 builder；/search 与真实 /question/:id 选 search；/manage 与 /manage/* 选 manage；/settings 选 settings。/search-other 不选 search；只有实际匹配项带 aria-current=page。

使用独立轻量路由标题表，不能由 NAV_ITEMS 推导。标题覆盖工作台、找题、详情、试卷预览、数据维护、四具体维护页、设置；四子页仍分别为“知识点复核/公式复核/来源文件/题库统计 · 初中物理题库”。BASE_TITLE 未知路径兜底保留。现有 App 导出的 documentTitleForPath 可 re-export，以避免无关消费者迁移；标题模块不能导入页面实现。

### 3. 维护外壳与标题共享接口

新增 DataMaintenancePage：唯一 h1“数据维护”；外 Tabs 可访问名“数据维护分类”，四 Tab 文案为知识点复核/公式复核/来源文件/题库统计。value 直接由 pathname 推导，切换提交对应 URL，不维护第二份 tabIndex。只渲染当前 Outlet，不预挂载其他三页，不 preload 四页。

每个外 Tab 有稳定唯一 id 和 aria-controls，当前 tabpanel 有对应 id、aria-labelledby。内层公式状态 Tabs 可访问名“公式复核状态”，ID 使用独立前缀，不能与外层复用。Tab 键盘方向/激活行为须可操作且 URL/选中/panel 一致。

四页公共嵌入参数冻结为 **headingLevel?: 1 | 2**，默认 1，路由四子页传 2；页面主标题统一据此选 h1/h2，内章节相应 h2/h3。视觉 variant 不改。StatsPage 的加载、错误、成功三个标题分支全部适配；Knowledge 当前标签标题和 Stats 分布/治理标题全部适配。已有来源详情 Dialog 的自身 h2/h3 保留，不把模态标题当主页面新增 h1。加载/错误/空态公共提示继续 div/status/alert，不引入跳级标题。

外壳在当前 panel 中提供 Suspense 和局部错误恢复，父 h1/Tabs 在子模块延迟/失败时仍存在。必要时 fallback 保留当前页 h2 语义。不得扩大四页业务布局改版。

### 4. 单一懒加载试卷管理及开发共享接口

新增轻量 **frontend/src/store/paperLibraryStore.ts**，只依赖当前已有 zustand，公开接口：

- usePaperLibraryStore：非持久化 UI store。
- 状态 **open: boolean**，初始 false。
- 动作 **openPaperLibrary: () => void** 与 **closePaperLibrary: () => void**，仅切换 open。

App 为唯一管理宿主；工作台、辅助预览无卷空态从该轻量 store 调用同一个 openPaperLibrary；PaperPanel 沿用 onOpenDrawer 回调但文案统一“试卷管理”。store 模块不得导入 App、页面、Drawer 实现、DnD、公式/导出模块。它不保存试卷数据、selected ID或门禁，测试必须重置开关，不能用第二个管理宿主兜底。

新增 **PaperLibraryDrawer** 首次打开时才 React.lazy/import 下载并挂载；独立 Suspense/ErrorBoundary 可重试。首次加载后可保留同一组件实例并以 open=false 关闭，供删除成功的重建提示存续；不能再次创建第二宿主。Props 冻结为 **{ open: boolean; onClose: () => void; onSelectPaper: (paperId: number) => void }**。App 的统一 onSelectPaper 选卷、清 targetSectionId、关闭管理并到 /builder；切换/新建/重建共用此动作。App/PaperSwitcher 可保留现有列表查询和快捷下拉，但全局管理按钮/窄屏 aria-label 均为“试卷管理”。原 App 简版 Drawer 与工作台旧管理 Drawer/删除确认迁走，不能保留第二套。

抽屉读 listPapers/qk.papers()、paperStore；新建调用现有 createPaper({title, template: 默认模板})。新建与重建遵守 paper.edit 权限；删除遵守 paper.delete。界面守卫与实际动作均需检查，后端仍为真正授权边界。pending 防重复提交；失败保留可读错误和重试，加载失败不得当空列表。

删除流：点击删除先完整 getPaper(id)，GET 失败不打开可提交删除确认；确认题数来自该整卷 items.length，不能用可能过时的列表 item_count。取消不得 DELETE；确认按钮才调用 deletePaper(id,true)，保留整卷作重建输入。若确认等待期间最新整卷读取发现题数变化，更新确认事实并要求重新确认，不能用旧题数静默删除；无需新增后端契约。整卷重读与确认时权限检查可复用已有GET，不新增契约。删除成功失效 papers/对应 paper/export-data 缓存并锁定被删卷；使用**完成时 store 当前 id**判断是否清 current/target，避免删除 A 期间已切 B 却误清 B。

删除提示明确“重建副本”，调用现有 recreatePaperCopy(full)。成功得到新 ID，失效列表、显式 invalidatePreview(newId)、选中新 ID并清 targetSectionId。不能声称恢复原 item ID/原锁定快照：既有 helper 依据 question_id 加当前版本，并非历史快照恢复。多请求中断可能产生部分副本，失败须如实反馈，本轮不新增后端原子恢复能力。

### 5. 唯一导出入口、只读辅助页与指定卷回程

工作台只保留 builder-export-button 主“导出”按钮；PaperPanel 当前 :358 的第二导出按钮及其专用 onGoExport 接口删除，避免清单视图双入口。ExportDrawer 保持 key={paperId}，模式/模板/格式/内容诊断/stale/降级确认/作业结果及 useExportGate 唯一业务实现保留。抽屉一个 runPreview 动作、一个 exportMut 提交动作；锁定提示不能再额外复制预览按钮。预览工具条/预览空态替代动作互斥；点击一次只请求一次。

/export?paper_id=X 保留双预览、模式/模板、只读诊断、预览失败重试和真实来源风险，标题“试卷预览”。移除导出提交、导出格式选择/本次导出结果及所有创建修订入口。辅助页不承诺导出历史或抽屉本次结果。预览 POST 是现有只读生成能力，允许保留。

ExportDiagnosticsPanel 新增 **readOnly?: boolean（默认 false）**。辅助页传 true；该模式只显示诊断/逐项问题/来源/debug，不挂载可创建修订的对话框或写入控件，不发 revisions 请求。工作台/抽屉默认 false 保留原修订能力。不得通过全局关闭共享组件写能力实现辅助页只读。辅助页仍复用 useExportGate 的预览与安全判定，不复制门禁。

返回工作台唯一意图字段冻结为 **{ openExportForPaperId: X }**，X 为正整数试卷 ID；不用 export=1。返回时携带当前必要查询串，不将 paper_id 当作当前 store 的替代。工作台必须在首次 useQuestionFilters URL effect 可能清 state 前捕获该意图，按 location entry 只消费一次：选中 X、清 target、打开 X ExportDrawer，然后 replace 清已消费字段并保留当时完整 search 和其他必要 state。无其他 state 可置 null。非法 ID不请求导出；不存在 ID走指定卷明确错误，不退回旧全局卷 A。清 state 后刷新/关闭/返回不重复打开。需覆盖 StrictMode、冷 lazy 和现有筛选 URL 同步的竞态；B0 debug及重复值保留语义不可回退。

### 6. API 冻结

全部沿用当前 {code,data,message}、API request/response 字段与错误码。B1 不新增端点，不修改 webui/bank：

- 试卷 list/create/get/delete、paperRestore 的 create/addSection/addQuestions 复用 frontend/src/api/papers.ts 和 paperRestore.ts 的现有路径/字段。
- GET /api/papers/{id}/export-data、POST /api/papers/{id}/preview、POST /api/papers/{id}/export、POST /api/papers/{id}/revisions 契约保持；后两者在辅助页不能提交，抽屉原流程保持。
- 现有 403 权限、409 冲突/内容守卫/证据过期和 50001 环境错误均保留，不把内容阻断误降级为环境失败。

### 7. 可并行的 D 文件边界

| 开发子任务 | 独占文件范围 | 共享依赖 |
|---|---|---|
| D 主：导航/路由/维护/管理 | App、router、四维护页、DataMaintenancePage、PaperLibraryDrawer、PaperSwitcher、paperLibraryStore、轻量 route metadata、对应导航/维护/管理测试 | 输出 store/Drawer Props/headingLevel 契约；唯一宿主在 App |
| D 辅：入口与导出回程 | PaperBuilderPage、PaperPanel、ExportPage、ExportDrawer、ExportDiagnostics、对应导出/回程测试 | 只 import paperLibraryStore 使用 openPaperLibrary；readOnly 默认 false；state 字段固定 |

uiStore/paperStore/API helper原则上复用，不改共享语义。若需要共享文件编辑先协调 owner，不让两个开发者同时改同一文件。实现细节可以变化，但本文件公开接口及外部可见行为不擅自改。文档与手工证据由各 D 自己产出，主控不得代写。

## 验收标准（给 D、独立 T/V）

1. D 留存真实 npx tsc --noEmit、npm test、npm run build（含原65/65对比度）、指定 Python/PYTHONUTF8=1 全后端日志；不少于当前 26+261 前端/436 后端且保留 skip。原对比度配对不删除；新组合追加。入口及冷 /builder 全部 JS 实际 bytes/count 不回退，打开前 PaperLibraryDrawer chunk 未加载，打开后才请求。
2. 对路由/导航解耦与旧 Navigate 用同等前后用例反证。R 已提供三项真实探针，但 T 必须根据需求重新构造，不沿用 D 解释；覆盖四旧 hash URL的 debug/query/state/replace、新直接URL、manage index、六类 aria-current及 search-other 反例。
3. 逐四 Tab 请求/挂载证据，父h1/子h2/内部h3及延迟/失败/空态；标题检查报告实际路径列表和新增父页后的分母，不照抄9/9。Tab/panel ID连通、内外名称分离，键盘切换有效；document.title精确具体。
4. 副本验证统一顶栏/工作台/PaperPanel入口；切换/新建默认模板；陈旧 list item_count与新整卷不一致；GET/DELETE失败；取消零DELETE；viewer零写；删除当前/非当前/删除期间切卷；重建新ID、题序/零分/无分/重复题/大题归属及新门禁锁定。记录交付库初末完整SHA相同。
5. 全局A、辅助预览B回工作台，含 keyword/debug和重复debug；第一次开B、清目标、请求归B，replace清意图后不重复开；StrictMode与冷lazy不串卷。辅助页无export/revisions写请求；抽屉正常/锁定/旧图/无图/错误的预览动作最多一个、单击一请求，导出一个，原门禁迟到/内容阻断/降级行为保留。
6. 1366×768浅/深浏览器实际查看维护壳/管理Drawer及导出回程，标题/关闭可见；skip-link、main/nav、模态role=dialog、关闭焦点恢复实测。未做NVDA实际朗读须注明，不宣传全部无障碍通过。当前B1不改文档排版/公式，无需虚构Word/WPS新验收。
7. G2 必须实测输出/数值/截图，只有“实现”打回；T/V独立G3通过后主控一个B1 Conventional Commit、中文正文、不push。构建/PNG/数据/QA目录不提交。

## 我没做/做不到的

- 只读设计、契约冻结，不写生产代码或 D/T/V 产出，不执行浏览器/写验证/构建，也不声称 G2/G3 已通过。
- 基线数引用正式 R/P 和主控本轮实测日志，未重复跑长测试；R 的旧行为探针证明缺陷，不证明新实现通过。
- 不处理B2–B5，未引入持久导出历史、严格删除恢复、多人并发数据事务等新能力。

## 遗留风险

- 现有筛选effect会清state：必须先可靠捕获意图；“发过replace”不等于指定B卷已打开，需实际请求证据。
- 删除确认与写入之间后端无原子版本锁，题数重读能发现已变题数，但不能宣称完全并发安全；快照重建为现有多请求当前版本副本，失败可能部分完成。
- 精简入口不自动证明首屏改善；manifest共享chunk、vendor预加载必须与冷网络实测一起审。
- 新父页/loading边界、模态焦点和深色实际可读性需独立DOM/截图验证，不能靠类型或静态结构推断完成。


## G1 局部重冻：回程 URL/state 与筛选同步（2026-10-12）

### 触发事实与授权边界

D 使用真实 useQuestionFilters 的延迟测试发现：工作台首次消费/replace 瞬间正确，300ms 防抖后的筛选同步仍再次剥掉未知查询参数及必要 state。A 只读核实 useQuestionFilters.ts:84–92 使用 writeFiltersToUrl 重建 query，且 setSearchParams replace 未带 state；searchParams.ts:10/:23/:48 明确管理的只有字符串/布尔筛选键与 page。该问题阻止用户“保留 query/state”的结果稳定成立，不能把瞬间 replace 正确当验收通过。

### 新增共享接口与行为冻结

- UseQuestionFiltersOptions 新增 **preserveLocation?: boolean**，默认 **false**。既有 SearchPage 和普通工作台默认 false 的行为、300ms 防抖、page归1、debug及重复值、filter/API语义全部保持。
- Builder 从 render 前已捕获的回程 entry 判断启用：捕获过 state 自有 openExportForPaperId 字段即启用，本次工作台挂载内锁存，不因清完字段立刻回 false。合法ID照原契约选X/清目标/开X；非法ID只清意图、保留其它state/query，不选卷/不开抽屉。不得为了保留 marker 将非法ID当成有效请求。
- preserveLocation=true 时，从当时完整 location.search 继承所有非筛选参数及重复值；只替换/删除 **FILTER_STR_KEYS、FILTER_BOOL_KEYS、page** 这些 hook 管理的键，再加入当前 writeFiltersToUrl 的筛选输出。debug继承一次、重复值原样，不因合并双份追加。用户后续主动编辑/清除筛选，已知筛选键仍正常更新，不回灌原来的旧筛选。
- 未知参数只是URL保留信息，不能写进 filters、queryParams、facetsParams 或任何API请求。不添加 export=1，不添加新的全局/持久化回程意图字段，不改变paperStore/uiStore/API。
- preserveLocation=true 的筛选 replace 保留**当前最新的剩余 location.state**；不能从旧意图快照重新附回 openExportForPaperId。首次capture和一次性consume仍由Builder负责，hook不能消费或打开抽屉。可使用最新location ref避免为state变化增添筛选同步触发；实现不得生成navigate循环。
- 原5节state清理保留完整query的要求，扩为“首次清理及至少650ms真实防抖/后续正常筛选effect后稳定保持”；不接受只在一次render时比较通过。

### 文件 owner 与门禁

- **D主**拥有 frontend/src/hooks/useQuestionFilters.ts 的最小实现和hook回归；只有该文件新增本可选接口。searchParams.ts 现有键表可只读复用，不改其默认函数语义。
- **D辅助**拥有 PaperBuilderPage 的 preserveLocation 接线与真实hook回程测试，不并行编辑hook。继续拥有ExportPage/ExportDrawer/ExportDiagnostics/PaperPanel边界。
- 独立T根据正式P/A和当前代码重新构造：合法B、5种非法ID、未知source/重复debug/剩余marker，等待>=650ms；确认未知query及剩余state保持、意图不复活、关闭不再开、A/B请求不串。另测普通默认false行为、筛选修改/清空和未知query不进入API。D测试日志仅证据，不替代T独立重构。
- 初版其余G1完全不变。该局部新增接口已冻结并通知主控、D主、D辅助；T启动时必须读取本增补。

### 已知边界

preserveLocation是本次挂载的回程模式，未增加持久标志。真正刷新后已无openExport意图，不重复开抽屉；正常搜索筛选/debug按现有URL语义恢复。未知URL参数在无回程意图的新挂载中仍遵守原默认false策略，不能夸大为任意未知query跨刷新永久保留。若用户要求未知参数跨所有刷新/新挂载也永久保留，须另回A明确与默认旧策略的取舍；本轮稳定回程query保留仍必须实测。
