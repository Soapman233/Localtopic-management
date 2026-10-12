# 交接：B3 契约冻结 / 架构师 A

## 我做了什么

- 完整读取 AGENTS.md、deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md 与本轮用户范围；仅设计 B3，不实施 B4/B5。
- 核对 PaperBuilderPage.tsx:98–152 的统一写操作失效、:330–350 的跨大题拖拽守卫、:181–188 的两个断点和筛选初态。
- 核对 LivePreviewPanel.tsx 的工具条、测量层与可缩放页面层，冻结页数上报与清单态测量接口，避免布局精简影响实际分页。
- 核对 ExportDiagnostics.tsx:40 既有 readOnly，以及 ExportPage、ExportDrawer 与 PaperPanel 现有入口；冻结现有后端契约与抽屉唯一写入出口。

## 产出物

- outputs/handoff/A-B3.md（本文件）；正式研究证据见 outputs/handoff/R-B3.md。

## 研究交接复核

已完整读取正式 outputs/handoff/R-B3.md。R 以8799副本服务、新上下文取证，本地/服务入口均 index-CRapoS36.js。改前 Alert 实测高61.5px；1366 scrollWidth=clientWidth=1366，题卡筛选开337.5625/收601.5625；1199/1200行为已正确。A=1→辅助页B=3→返回已正确选B，Page/Drawer已各仅1预览动作；上述错误假设均经核实不成立，不重做B1。当前fresh首屏1,066,203 bytes /15请求（参考上限多1,274），D必须收敛到用户1,064,929上限。PaperPanel空大题过滤、缺moveSection UI属真实现有入口缺口。

## G1 冻结：范围和业务边界

工作流 R → A → D → T，需求已由本轮用户明确，不重做 P；本轮不改 API、不改数据库、不改 useExportGate/exportGateShared 的业务判断。B0/B1/B2 成果原样保留；旧 /export URL、四项导航、唯一试卷管理、h1 层级不改。源码及本报告是 D/T 的独立交接输入。

所有请求路径、字段和错误码维持 frontend/src/api/papers.ts、api/export.ts、api/errors.ts 当前定义；响应仍为 {code,data,message}。尤其冻结：

| 既有接口 | 字段 / 用途 |
|---|---|
| GET /api/papers/{id}/export-data | answer_mode、template 查询字段；content_digest、diagnostics.export_allowed/blocker_count/warning_count/issues 等返回字段不变 |
| POST /api/papers/{id}/preview | answer_mode、template；复用现有共享门禁及作业轮询 |
| POST /api/papers/{id}/export | answer_mode、template、formats、out_dir；只在抽屉提交 |
| POST /api/papers/{id}/revisions | title、exclude_item_ids、diagnostic_digest、confirm；只在抽屉诊断创建 |
| PATCH /api/papers/{id} | 现有 PaperPatchBody；元数据仍经 usePaperMutations.patch |
| POST /api/papers/{id}/sections/{sid}/move | position；大题上下移只调用既有 actions.moveSection |
| POST /api/papers/{id}/refresh-snapshots | 空 body，仍按指定试卷刷新 |

加题/删题/条目移动/设分/大题增删改/批量等其余现有接口也全部不变。错误码 40001–40007、40101、40301、40401–40408、40901–40905、50001 原样；尤其内容阻断 40904 与依据过期 40905 不改。

## G1 冻结：组件接口和布局

### 工作台

1. 右栏折叠仍是 MUI down('lg')，<1200 为可开关 Drawer，>=1200 内联；1366 保持双栏。筛选 compact 仍为 max-width:1439px；首次 filtersOpen 初始化为 !compact，>=1440 始终展示，紧凑态用户可展开/收起。筛选按钮保留文字并提供 aria-expanded/aria-controls。
2. 右栏一行保留排版/清单切换、约 N 页、内容状态。加载/错误必须明确；通过显示小文字状态，阻断显示“需处理 N 项”+“查看问题”按钮。N 取 diagnostics.blocker_count，不另推断问题总数或改变 export_allowed。点击展开完整诊断，允许收回，只影响展示。
3. 工作台 ExportDiagnosticsPanel 传 readOnly=true；原 issues、来源和提示保持可触达。修订创建动作与候选写操作仅在 ExportDrawer；工作台可提供“到导出处理”入口。仅复用既有 readOnly，不新增后端判断。
4. 删除常驻“切到清单视图更快” Alert。无卷仍调用全局 openPaperLibrary；空卷行动聚焦左侧搜题/加入，窄屏可同时关闭试卷 Drawer 以触达题库。
5. 新增轻量 PaperSettings.tsx，props 冻结：paper:Paper、onUpdate:(patch:PaperPatchBody)=>void、targetSectionId:number|null、onTargetSectionChange:(id:number|null)=>void、onOpenLibrary:()=>void。提取 PaperPanel 原标题/模板/答案模式/加入目标/管理控件，放入工作台“试卷设置”展开层；以 key={paperId} 隔离不同卷草稿。所有写入经现有 actions/usePaperMutations；加入目标变化只更新既有目标 store。
6. PaperPanel 增 showSettings?:boolean，默认 true；工作台 false 避免清单重复。保留清单所有条目菜单、较大触达入口、确认/撤销、设分、大题与 stale 刷新。保留空大题并增首尾禁用的上移/下移按钮，调用 actions.moveSection；未分组不参与大题调序，不新增业务能力或 API。

### LivePreviewPanel

保持现有 props 兼容，新增以下可选展示接口：

- toolbarMode?: 'full' | 'compact' | 'hidden'，默认 full；工作台 hidden，将摘要交给右栏顶行，其他消费者保持默认。
- showPages?: boolean，默认 true；false 仅不渲染可见页面层，测量层及 usePagination 继续工作。
- onPageSummary?: (summary: LivePreviewPageSummary) => void。
- 新导出类型 LivePreviewPageSummary = { paperId:number; contentDigest:string; pageCount:number; overflowPages:number; ready:boolean }。

页数仅来自既有 usePagination，用 effect 上报，依赖 paperId/contentDigest/pageCount/overflowPages/ready 与稳定回调；禁止在 render 中更新父状态。工作台清单态也保留此测量组件、showPages=false，确保首次清单与改内容后页数能刷新。父级只采用匹配当前 paperId/contentDigest 的摘要；ready=false 显示准备/计算状态，不编造确定页数。长题保留近似页数说明。

.lp-measure 不移动到 transform:scale 或动画容器；禁止对其祖先 display:none。测量层仍是可见纸面缩放容器的兄弟。允许纸面内部 overflow:auto，不得用裁切掩盖溢出，不改字体行高因子/块模型/分页规则。B3 不接动效、不新增第三方依赖。

### 辅助预览页与抽屉

ExportPage 保留 B1 标题、唯一预览动作、像素/结构预览和只读诊断；仅删底部实现说明（有遗留定位段才删），无卷空态加“选择试卷”调用统一管理。所有返程入口含空卷行动均携带本页 paperId，通过既有一次性 state {openExportForPaperId}，沿用 B1 消费、选卷、清目标、打开抽屉、replace 清 state 的机制。保留抽屉 key={paperId}。

预算允许的唯一按需加载调整：工作台 ExportDrawer 改 React.lazy + Suspense，首次未打开时不加载抽屉chunk；记录首次打开标志（everOpened/exportLoaded），首次开过后即便关闭仍保持抽屉挂载，保留本次结果和作业状态。换卷依旧key={paperId}隔离；回程state指定B时首次就挂载B，不先请求A。Suspense仅加载轻量LoadingState，不改变加载完成后的role=dialog语义、关闭/焦点恢复。此优化是真正推迟低频业务加载，禁止搬入预加载vendor。不得每次关闭卸载抽屉导致本次结果丢失。

ExportDrawer 正常工具条最多一个预览动作；空态无动作时可保留唯一工具条，若空态替代则二者互斥。若研究证实当前已唯一，不为去重而改动。runPreview、autoPreview、内容/过期/迟到/降级/格式门禁完全复用 useExportGate，不重写业务。

## 验收标准（给 D / 独立 T）

### 基础门禁

在 frontend 运行 npx tsc --noEmit、npm test、npm run build；根目录设置 PYTHONUTF8=1 后用项目 Python 运行 -m unittest discover -s tests。保存真实完整日志；不得减少 26 node:test + 312 vitest、后端 436（含原 skip）。build 对比度原65组全部通过；新增颜色组合追加配对，不删旧组。

独立端口服务（如8799），QB_DB_PATH 指向新副本。浏览器前读取 / 与本地 webui/static/assets/index-*.js 比对入口名称，保存 health 中副本路径；严禁使用8720旧会话。冷启动 /builder 的实际 JS 请求数<=15、原始字节总量<=1,064,929，入口<=30,790；截图/网络证据使用深拷贝快照，不能被后续导航请求污染。禁止转移到预加载 vendor 假达标。

### 浏览器实测

- 1366×768，左右栏同时可见，打印 documentElement.scrollWidth/clientWidth，前者<=后者；截图常驻 Alert 计数为0。筛选展开/收起打印同一首张题卡 getBoundingClientRect().width，必须真实改变；宽屏>=1440常驻。
- 1199：试卷面板按钮可开 Drawer、按钮/Escape可关；1200：无面板打开按钮、右栏恢复内联。打印每项 DOM 数量，不能用 media query 源码代替。
- 右栏顶行同一行的切换/页数/状态；清单首次加载与内容改变后页数不沿用旧 digest。测量节点祖先无 scale/动画，实测 transform 为 none，纸面超长内容可滚动到末尾。
- 当前卷 A，访问 #/export?paper_id=B，点击回程；记录抽屉标题、window.__builder.paperId 和后续请求全部属于B。正常辅助页无export提交/创建修订写操作；只读诊断展开不会POST revisions。
- 在副本复制样例卷并独立 bump 一题版本生成 stale，进入清单可找到“更新到最新”并实际刷新；原库不写。加题、删题、条目重排、改分、大题增删改移、元数据、刷新快照分别先构造已预览状态，完成UI操作后逐项记录previewFresh=false与抽屉导出重锁，不能只调用API代表UI通过。
- 键盘拾起/方向键排序/放下提交一次同大题移动；跨大题拖拽记录移动请求0。空大题新增后立即可命名/移动/删除；未分组不显示大题上下移。
- 页/抽屉各一预览动作，单击一次记录POST preview恰一次；autoPreview独立记录，不与单击计数混合。用于对照的像素预览必须当前构建新生成，不能取历史导出件。
- 对九业务页数h1恰1，保留skip-link、main/nav、aria-current、Drawer role=dialog、键盘焦点可达。1366浅/深色截图实际查看，不只跑单元测试。

### 反证和回滚

改前证据必须引用R真实数据：Alert占位；回程错选和重复预览只有真实失败才记修复，否则写“经核实不成立”。本轮B3一个提交，源码/测试/文档可提交，数据库、产物、PNG、本地QA目录不提交、不push。回滚时工作台导出入口、辅助页、共享组件及测试一起回滚；无迁移，不涉及交付库回滚。

## 我没做/做不到的

- A未编辑实现，未代写R事实，未执行D/T验收，本文验收项不代表通过。
- 本轮不做B4/B5，不新增导出历史或自动复核，不修改冻结后端文件。

## 遗留风险

- 页数回调若无digest匹配/稳定effect会显示旧卷或触发重渲染循环；需T以切卷/改模式/清单首次加载反证。
- JSX增长可能超首屏预算，须实测总量；不要因原改前产物略超预算放宽用户门禁。
- Word/WPS及editor_sdk若不可用，当前新像素预览验证必须如实列环境限制；不可用结构覆盖冒充像素验证。

## G1 补充冻结：入口预算的最小业务分包（2026-10-12）

D当前构建入口30,841 bytes（超51），实际默认builder首屏1,049,919 bytes /15请求（通过总量）；新增独立LP共享chunk增加路由依赖映射。主控和A同意只恢复原有预览业务共享组，保持抽屉UI首次打开按需加载：vite.config.ts 的 manualChunks 可将 LivePreviewPanel.tsx 与 useExportGate.ts、exportGateShared.ts 归入同一非vendor preview业务chunk；components/livePreview/ 内的生产 ts/tsx/css 子模块也可显式归入此组，测试文件不纳入。不得改变任何node_modules vendor归属、CSS/vendor判定或页面/抽屉动态加载策略；KatexFormula保持独立，禁止把LP合并Katex导致已完成B2的详情/找题额外拉取约22KB。

此次属于B3抽屉按需加载直接导致的预算修正，不是B5全站分包；不批准简单缩短产物名、改业务无关文案或篡改构建产物来凑入口数字。构建配置源文件中文说明真实原因，原产物自然重建。入口HTML不得新增预加载preview组，工作台页面实际需要时加载；对照manifest验证静态入口、默认builder和动态ExportDrawer依赖。

旧基线builder本已请求包含LP和Gate的业务共享块，此补冻恢复该关系，只推迟低频抽屉UI，不引入详情页反向扩载。首屏预计1,061,149仅用于预算估算，不是实测证据。D须重新执行正式build并实测入口<=30,790、首屏<=1,064,929且请求<=15，报实际各chunk字节/请求清单；确认主入口vendor未因变化扩载。若失败不得扩为全站分包或LP+Katex，返回A重新冻结。T按新构建独立验证9页标题、shared gate及测量行为；单一B3提交包含此配置与实现，整批回滚。

### G1 预算补冻二：显式分包限定

D首次手工preview分包实测失败：入口虽23,544 bytes，但Rollup默认归集依赖吞入根共享模块，使index.html新增preview与vendor-katex预加载；该构建不得作为验收通过证据。A只读核实当前frontend/node_modules/rollup/package.json为4.64.0，dist/rollup.d.ts实际含 onlyExplicitManualChunks?: boolean，类型支持明确。

主控/A批准仅在当前output增加 onlyExplicitManualChunks:true，限制manualChunks只划入明确匹配的生产预览模块，禁止共享根依赖被贪婪拖入业务组。节点规则仍是LP/livePreview生产模块+useExportGate/exportGateShared，既有每个node_modules的vendor分类原样，不修改依赖版本、vendor策略或其他页面分包。此选项目的为落实上一节边界，不是放宽预加载门禁。

类型支持不等于实际成功，D需当前本地版本正式build、检查index.html及manifest，确认preview与vendor-katex未新增入口预加载、根共享不被拖入业务组；随后独立新上下文实测默认builder入口/总量/请求数。若onlyExplicit使其他模块归属或既有页面加载显著变化，应提交具体manifest及网络差异回A，不能以入口变小掩盖总量/功能回退。失败产物与失败事实保留在D交接，不入最终通过结论。

### G1 预算补冻三：恢复显式分包拆散的共同依赖

D第二次显式build入口23,835 bytes、首屏1,059,866 bytes，但19个JS请求，违反15请求门禁，仍不接受为通过。A读取该构建manifest与当前paperStore产物，确认新增自然小块为commonjsHelpers、paperStore共同业务聚合、useJob、glossary、ErrorState；属于显式分包拆散原有共同依赖，非新增功能。

批准最小恢复三项：

1. Rollup生成的commonjsHelpers虚拟模块归回vendor-react既有第三方运行时组。它不是项目业务；只恢复框架辅助函数归属，不准将任一src业务模块塞入vendor。
2. hooks/useJob.ts 归preview，与其既有useExportGate消费者同组；不修改轮询业务。preview仍不出现在入口HTML预加载列表。
3. 新独立非vendor app-common 聚合当前共同业务小块：store/paperStore.ts、lib/glossary.ts、components/ErrorState.tsx；为避免当前paperStore产物已有的API/加载模块再碎裂，可同时明确分配 api/client.ts、api/queryKeys.ts、api/errors.ts、api/papers.ts、components/LoadingState.tsx。这些是本次manifest/产物已显示共用代码，禁止吞入LP、KaTeX、页面或额外低频业务模块，禁止扩大为全站分包。

原onlyExplicit限定继续有效；所有其他node_modules的原vendor规则保持，动态页面与首次导出抽屉仍按需。D在源码用中文注释说明共同依赖恢复原因。app-common可能与入口静态共享而预加载，这是原根共同依赖重聚，仍必须连同所有JS计入首屏；不允许只比较index体积宣称达标。

D需正式build后以新上下文取得全部原始响应字节、请求清单、index名称及入口HTML预加载清单，确认入口<=30,790、默认builder<=1,064,929/15请求；对冷Search/Detail验证不新增preview/LP请求、无业务扩载。编译、全量测试、65配对、9页h1、LP测量以及回程B门禁继续通过。任何预计数字都不作为通过证据；若仍超门禁或出现page依赖回退，停止继续加分包规则并回A/主控审查。之前两次失败构建留在D交接，不能淡化成已通过。

### G1 预算补冻四：共同依赖最终精确清单

补冻三build仍失败：入口23,706、默认builder总量1,059,211 bytes但17请求。A已完整核本次manifest首屏共同依赖、读取源import消费关系：剩余settingsStore（334B）由main.tsx直接引用，也被SearchPage/KatexFormula/PaperLibraryDrawer使用；api/export（348B）仅被PaperBuilderPage、useExportGate、useJob与ExportDiagnostics引用，SearchPage/QuestionDetailPage不引用它。将两者恢复现有共同组不会引入冷找题/详情分页消费。

主控/A批准以下最终精确规则，前面补冻统合以本清单为准：

- preview（独立非vendor业务组）：components/LivePreviewPanel.tsx；components/livePreview/内生产ts/tsx/css；hooks/useExportGate.ts；hooks/exportGateShared.ts；hooks/useJob.ts；api/export.ts。
- app-common（独立非vendor共同业务组）：store/paperStore.ts；store/settingsStore.ts；lib/glossary.ts；components/ErrorState.tsx；components/LoadingState.tsx；api/client.ts；api/queryKeys.ts；api/errors.ts；api/papers.ts。
- Rollup commonjsHelpers虚拟运行时恢复vendor-react，不含任何项目src业务代码。其余所有node_modules沿用原vendor判定；CSS不进入vendor；onlyExplicitManualChunks:true保持。
- KatexFormula.tsx及其他页面/业务/store不显式改组。不得额外扩规则、缩短产物名凑预算、改既有vendor分类、关闭真实请求计数。

新settingsStore并app-common属入口已经必需的根共同依赖聚合；api/export并preview属已冻结Gate/工作台请求边界。最终必须正式新build/新浏览器上下文实测：入口<=30,790、首屏<=1,064,929/15请求、HTML不预加载preview/KaTeX；冷Search/Detail不新增preview请求，并给实际字节证据。先前17请求仍如实列失败，不得预估成15通过。当前manifest所见共同业务岛已完整核实，若再有碎片或预算失败，不继续逐模块加规则，应回主控/A比较撤回分包与其他最小方案。
