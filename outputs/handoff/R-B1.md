# 交接：B1 信息架构只读调查 / R

## 我做了什么
- 完整读取 AGENTS.md、outputs/Codex多角色协作方案.md 和 deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md；本轮范围为导航/路由解耦、维护外壳、统一试卷管理及只读辅助预览，不实施 B2–B5。
- 核实 frontend/src/router.tsx:38、:65、:73 的路由与导航耦合和旧重定向；App.tsx:119、:135 的标题/选中逻辑仍依赖导航或宽泛前缀。
- 核实 App.tsx:193、:367 和 PaperBuilderPage.tsx:248、:258、:631、:694 的两套管理能力，以及 api/paperRestore.ts:12 的重建副本语义。
- 核实四维护页的所有标题分支，ExportPage.tsx:62、:161、:185 的指定卷、返回及修订接线，以及 useQuestionFilters.ts:84 的 URL/state 竞态。
- 实跑三项反证和既有导航/无障碍测试，保存当前完整 B0 静态产物，未修改生产代码或交付库。

## 产出物
- outputs/handoff/R-B1.md（本文件）。
- frontend/.qa_B1_R/probe.test.tsx、config.mjs、probe.log：三项可执行旧行为探针，QA 目录不提交。
- frontend/.qa_B1_R/existing-tests.log：导航/无障碍 27 项实测日志。
- .qa_B1_R/static-B0/：当前 webui/static 完整副本，供后续同基线比较，构建产物不提交。
- .qa_B1_R/cold-js.mjs、cold-js-B0.json、cold-js.log、builder-B0-light.png：真实冷首屏请求/截图基准。副本后端为 http://127.0.0.1:8732，静态资产固定读取 static-B0，不受后续构建覆盖。

## 实测证据
在 frontend 执行：

```powershell
node node_modules/vitest/vitest.mjs run --config .qa_B1_R/config.mjs
node node_modules/vitest/vitest.mjs run tests/unit/Navigation.test.ts tests/unit/Navigation.render.test.tsx tests/unit/A11y.test.tsx
```

实际结果：3/3 探针通过；3 个既有测试文件、27/27 用例通过。仅 React Router v7 future flag 提醒，无用例失败。

1. **删导航会删路由（实测）**：探针只替换 App 导出的 NAV_ITEMS，加载真实现有 router.tsx 并捕获 createHashRouter 注册表。原表包括 export、manage/knowledge、manage/formula-review、manage/sources、manage/stats；移除这五个导航项后，五个实际路由均消失，旧路径仍在但目标失效。这证明必须先独立路由定义再删导航。
2. **旧 Navigate 丢参数和 state（实测）**：按 router.tsx:73 同一 Navigate(to,replace) 用真实 React Router 挂载。输入 /formula-review?debug=1&filter=pending，state={source:old-bookmark}；实际 /manage/formula-review，search=空串、state=null。不是只做字符串推断。
3. **现有筛选同步清 state（实测）**：挂载真实 useQuestionFilters；输入 /builder?keyword=test&debug=1，state={openExportForPaperId:2,source:preview}； effect 后 keyword/debug 保留，但 state=null。因此工作台必须在首次 URL 同步前可靠捕获/消费一次性意图，并验证打开的是指定卷，不能假定 state 会一直在 location 上。

本轮初始状态由主控执行：HEAD a72d196，git 干净；交付库完整 SHA256 为 6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。主控最新前端完整基线为 26 node:test + 261 vitest（B0 之后）；实施方案旧 251 为最低保留数，不能减少当前真实 287 项。

## 事实与可复用依赖
- router.tsx:28–36 已页面 lazy，登录使用 B0 的 LoginLoadBoundary；仍 createHashRouter。新增外壳和管理抽屉需保留这些分包边界。
- App.tsx:119 当前具体文档标题来自 NAV_ITEMS；精简到 manage 后必须另有路由标题表，四维护子页仍有具体 title。:135 startsWith 会误选 /search-other，详情未选找题，辅助 export 未选 builder。
- 维护页现无嵌入参数。KnowledgeReviewPage.tsx:149 为 h1、:275 当前选中标签 h2；FormulaReviewPage.tsx:127 h1；SourcesPage.tsx:302 h1（详情 dialog 自有 h2/h3）；StatsPage.tsx:129、:139、:155 包含加载、错误和成功三种 h1，DistributionList:87 及 :185/:210/:228 为 h2。只改成功分支会遗留加载/失败双 h1。
- App 全局抽屉只有切换、新建；工作台另有删除、题数确认、抓整卷、Snackbar 撤销。工作台无卷空态 :423 和 PaperPanel 接线 :455 目前打开第二套抽屉；都须接统一入口。
- PaperSwitcher.tsx:74、:81 目前入口名“试卷列表”，要统一为“试卷管理”，包含窄屏 aria-label。
- 删除实际 API：GET /api/papers/{id}（api/papers.ts:50）后 DELETE /api/papers/{id}?force=true（:60）；listPapers 返回 item_count 供目前确认题数。usePermission('paper.delete') 是现有体验守卫，真正授权仍后端；新建/重建也属于 paper.edit。
- 重建 helper api/paperRestore.ts:12 复用 createPaper、addSection、addQuestions，创建新 ID。它按 question_id 重新加题，未恢复原 item ID 或锁定 snapshot_json；只能如实说“重建副本”，不能新增原锁定快照完全恢复承诺。多请求失败可能留下部分副本是既有风险，本轮不扩成后端事务功能。
- paperStore.ts:35 setCurrentPaperId 不自动清目标；统一切换/删除当前卷/新建/重建均需显式 setTargetSectionId(null)。当前旧 delete onSuccess 只清 currentPaperId，未清 target；重建当前旧 onSuccess 未显式重新锁定新卷，需要迁移时落实。
- ExportPage.tsx:62 用 paper_id 优先于全局卷 ID，:63 key=paperId 防串卷；:161 仅 navigate('/builder') 因而当前会回全局旧卷。:185 接 ExportDiagnosticsPanel，组件 :57/:91/:98 仍提供写修订。辅助页只读不能仅删导出按钮，需禁止修订对话框及提交。
- ExportDiagnosticsPanel 为工作台、导出抽屉共享：新增只读模式必须默认维持原消费者能力，不能全局关闭修订。useExportGate 当前局部作业状态无共享持久历史，辅助页不能宣称看抽屉本次结果。
- useQuestionFilters.ts:84 保留 B0 debug 参数及重复值，但丢弃其他未知键，且 setSearchParams replace 默认清 state；禁止用 export=1 意图。清一次性 state 时应保留当下 search 及其他必要 state，并让抽屉 key={paperId}。
- vite.config.ts:68 vendor-data 共装 react-query/zustand/DnD；新增抽屉 lazy 并不自动证明首屏无额外模块，须查看 manifest 和实际冷首屏请求，不改 vendor 分组藏体积。

## 验收标准（给 A 冻结、D 实施、独立 T 重构验证）
1. 独立路由集合包含 builder/search/question/:id/export/manage 四子页/settings；修改导航列表不能删辅助路由。四项导航只为 builder/search/manage/settings。
2. HashRouter 逐个打开四个旧路径，附 ?debug=1&filter=pending 和必要 state，跳到对应正式页，query/state 保留且 replace 无额外历史；/manage 默认进入 knowledge，同样保留 query/state。
3. /question/1 高亮找题；/export 高亮工作台；/manage/* 自动展开维护组并高亮维护；/search-other 不高亮找题。分组触发器有 aria-expanded/aria-controls。
4. 每个维护 Tab 分别测正常、延迟、错误、空态：父 h1 一个、子页 h2、内部 h3；tab/panel ID 与 aria-controls/labelledby 对应，内层公式状态 Tabs 另有名称；监控请求证明只挂载当前 Tab。
5. 统一管理从顶栏、工作台无卷空态、PaperPanel 空态打开同一 dialog；关闭可达且恢复焦点。新建套用默认模板、失败显示错误、成功选中新 ID 并清目标。
6. 管理删除构造列表 item_count 与最新整卷数量不一致、GET 失败、DELETE 失败和只读角色；确认展示可靠影响题数，取消时 DELETE=0，先完整读取再删除。删除当前卷清 current/target，删除其他卷保留当前，权限不足不发写请求。
7. 副本后端删除并重建带大题、无分值/零分值、重复 question_id 的试卷；核实新 ID、题序、分值、大题归属与可用内容，清目标并重新锁导出。不能假定旧锁定快照完全恢复；失败如实显示，不宣称已恢复。
8. 当前全局卷 A，访问 /export?paper_id=B；辅助页无导出提交及创建修订写动作；返回 state 指向 B，工作台第一次加载即选中 B/清目标/开 B 抽屉，后续 replace 清已消费意图而保留 query，不重复开、不串 A。
9. App 不静态导入 PaperLibraryDrawer 实现、工作台、DnD、公式预览、导出模块；打开前对应抽屉 chunk 未请求，打开后按需请求。
10. 全量后端测试、tsc、npm test、npm run build，对比度保留原65组，当前真实前端287项不得减少。入口原始字节 <=31130（本轮用户明确的 B0 基线优先于旧方案 30800）；默认 builder 冷首屏总字节/请求数与保留的 B0 基准同口径比较；库 full SHA256 前后一致。1366x768 浅/深截图实际查看。

## 我没做/做不到的
- 不冻结设计（由 A 完成），不改生产源码/API/后端/冻结文件，不写交付库，不 commit。
- 未实施 B1 新行为；当前27项只证明旧导航现状，不能替代新路由、嵌套标题、统一抽屉与只读辅助页验收。
- 未实测真实删除/重建写链路；留给 D/T 副本验证。未作 Word/WPS 或文档导出变更验证，本轮不改排版/公式。

## 遗留风险
- 一次性 state 与筛选同步存在已实测的清空竞态，需专门回归含关键词/debug、StrictMode 与冷 lazy 的路径。
- 删除读取的时点、确认题数与实际写请求数量需要 A 明确，不能只迁移旧 UI 后声称对并发完全安全。
- 旧重建 helper 的多请求/新快照限制必须如实报告，不能把“撤销”扩写成严格恢复。
- 入口紧预算受独立路由标题表、懒加载宿主、Tab 壳影响，按真实产物报告；禁止删错误态/无障碍能力凑数。

## 补充：B0 冷首屏 JS 实测基准

执行 `node .qa_B1_R/cold-js.mjs`（项目根）。副本 health 返回 code=0、schema_version=3、degraded=false，并明确 DB 为 .qa_B1_R/bank.db。Chromium 新隔离 context、CDP 禁用缓存、1366x768、localStorage 全新无当前卷；导航 /#/builder 等待 networkidle 和 h1。逐条 JS HTTP response.body() 的未压缩原始字节相加；CSS/字体/API 不计入。

实际 **16 个 JS 响应，1,068,908 bytes**，入口 **31,130 bytes**。与用户 B0 数值严格相符；不是 manifest 静态依赖和推测，也不是网络压缩传输量。全部请求 status=200；逐请求文件名/字节记录在 cold-js-B0.json。独立 T 可用同一个副本服务和保留资产重新核实，然后用新代码资产以相同空 context/空当前卷口径比较。

补充定位：PaperPanel.tsx:358–359 有清单视图第二个“导出”按钮（onGoExport），工作台顶部另有主导出；是否在 B1 统一此入口由 A/P 明确冻结，不能在迁移管理时暗中删掉清单行为。
