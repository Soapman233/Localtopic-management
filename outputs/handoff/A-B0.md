# 交接：B0 契约冻结 / A

## 我做了什么
- 完整读取实施方案、AGENTS.md 与 outputs/handoff/R-B0.md；核对 router.tsx:75–87、glossary.ts:261–274、LivePreviewPanel.tsx:145/:308/:330/:334–338、状态消费代码及现有 ErrorBoundary。
- 冻结本批仅方案 §4 #1/#2/#5/#7/#18，加 HashRouter debug 遗漏；B1–B5 全部排除，布局、导航、列数、间距、测量层与业务流程不变。
- 端点路径、请求/响应字段名、错误码、认证分支、createHashRouter、默认 /builder、既有 legacy 路径、导出门禁保持当前契约；不得修改后端、bank 冻结文件或交付库。
- 定义下面的展示契约及 D/T 可执行验收；本文件即 G1 冻结记录，需改变时返回 A 并通知依赖角色。

## 产出物
- outputs/handoff/A-B0.md（本文件）。无代码修改、无数据库写入。

## G1 冻结契约
1. 裸 Markdown 只处理三处系统 JSX：ExportPage 删除整段“定位” caption；PaperPanel / VersionHistory 用 strong 或纯文字保留事实。题目原文及公式中的 ** 原样保留，禁止全仓替换脚本。
2. LivePreviewPanel 使用唯一有效值：显式 prop 优先，缺省读取 isDebugMode()（语义为 debug ?? isDebugMode()）。同一值控制 layout_revision、测量/重排文字、PageView 调试标记；显式 false 即使 URL/storage 打开也关闭全部可见调试。保留窗口只读取证对象与测量算法，不扩展内部接口改造。加载态仍可见，但教师文案不得以 ms/v 或实现名解释系统。
3. isDebugMode 任一通路开启：普通 location.search 的 debug=1、location.hash 中 ? 后查询的 debug=1、localStorage.qb_debug=1。非 1 不由该通路开启；URL 成功开启不得因 storage 异常被反向关闭。storage 读取抛错安全兜底 false；无 window 安全，既有 node 注入 localStorage 通路保留。不增依赖、不改 URL。
4. SearchPage 缺答案字段时默认“答案/解析信息暂不可用”一类事实，不误标“无答案/无解析”；has_answer、has_analysis、/api/search 等原诊断仅 debug 可见。缺字段检测语义与查询不变。
5. 公式状态中文语义：UNSUPPORTED=不支持，EMPTY=未提取到内容，FAIL=转换失败，OK=转换完成（只指转换结果，不能称内容正确），UNVERIFIED=待核对。空/未知统一明确“状态信息不可用”或“未知状态，待核对”，绝不能默认为正常/OK，也不得默认透出原码。允许新增轻量共享映射，以避免三页面分叉；仅用于 FormulaReviewPage、StatsPage、QuestionDetailPage 本批消费点。复核页既有三中文映射不重复改业务；未知 Tab/卡片回退中文；kind、part、原始 reason 进入 debug。现有源图提醒、EMPTY 内容局限、处理动作及状态统计数量保持。
6. /login 单独包 Suspense 与 ErrorBoundary，不包 RequireAuth，不改 LoginPage 原认证分支/顺序。加载态可访问（role=status 或等价现有 LoadingState），失败态中文说明与实际可恢复操作。优先复用边界的可配置安全 fallback 或局部实现；错误 message/import URL/堆栈/密码默认不得输出。不得顺手修改全站其它错误边界。lazy 拒绝具有缓存性：若“重试”不能重新发起有效加载，至少提供刷新页面的真实恢复动作，不能承诺无效重试。提交/注释只称“登录加载边界加固”，不宣称现有构建必然报错。
7. 不增加配色、不修改 a11y 地标/标题/导航/Drawer 语义；不调 vite vendor 或预加载策略。入口目标 ≤30,779 bytes；必要的边界增量若不可避免，必须实测解释并核对首屏请求，不能移入 vendor 伪装。测试不得删除或减少现有 26 node:test +225 vitest、后端436项。

## 验收标准（给下一个角色）
1. D 在旧代码 ready DOM 实测 default 存在 layout_revision、测量/重排；新代码 DOM 实测缺省关闭/显式 true/URL 普通与 hash/storage 开启/显式 false 覆盖开启。全部检查含 PageView 标记；不得以源码条件替代 DOM。
2. 旧 glossary 函数同输入证明 hash=false，新函数 hash=true；补普通查询/hash/storage/抛错四种覆盖，再补 URL=true 且 storage 抛错与 debug非1，保留实际输出。
3. 渲染指定三个系统文案；包含 ** 的题目 fixture 保持原文。检索缺字段 fixture 默认显示信息不可用且无技术词，debug 可见诊断，题卡不得误标无答案。
4. 构造包含 UNSUPPORTED/EMPTY/FAIL/OK/UNVERIFIED/未知/空的状态 fixture，独立验证三个消费页中文语义、未知非正常；复核 kind/part/reason 默认隐藏，debug 可达，源图提示仍在。
5. 可控 lazy Promise 延迟触发 /login 加载态；拒绝触发中文错误态，断言秘密密码/堆栈/import URL 不出现在默认 DOM；执行可恢复操作。本地 auth_enabled=false 重定向 /builder；线上未登录/loading/needs_setup/error/成功返回原位置的既有认证测试保持通过。
6. 按用户顺序依次 npx tsc --noEmit、npm test、npm run build、指定 Python + PYTHONUTF8=1 unittest，保存真实输出。build 对比度65/65；实际 stat 入口字节、默认 builder 首屏 JS 请求；原9页标题层级与 skip-link/main/nav/aria-current/Drawer dialog 不回退。
7. 每次写入验证只用副本 QB_DB_PATH；本批无需写库。末尾全 SHA256 与基线 6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6 完全一致。D 给交接实测证据，T 仅从交接+代码重新构造，不依赖 D 对话。

## 我没做/做不到的
- A 不写实现、不代 D/T 证据；未重复运行测试、DOM/浏览器验证。
- 未实施导航、布局、抽屉、动效、维护 Tab、统计 Top5、题干折叠等 B1–B5 项。

## 遗留风险
- 原通用 ErrorBoundary 直接显示 message，不可无安全 fallback 套登录后称信息收敛。
- lazy 缓存拒绝时 resetErrorBoundary 不必然恢复；必须实测恢复动作，刷新可作真实兜底。
- 路由边界可能增加入口字节；报告必要增量，并真实核对首屏总量。
- 复核三个状态原已中文化，“登录必然报错”经核实不成立；反证只针对真实旧问题，结构加固用受控延迟/拒绝验收。

## G1 补充冻结：B0-3 的筛选 URL 同步集成（2026-10-12）

独立 T 浏览器证据见 .tmp_verify/b0/t-preview-browser.json：fresh /#/builder?debug=1 在 ready 后版本与测量均不可见，普通 query/storage 正常。A 只读核实 useQuestionFilters.ts:84–87：writeFiltersToUrl(filters, page) 重建查询串，setSearchParams 整体替换，丢掉不属于筛选字段的 debug。原 G1 的 hash 开通契约因此在真实消费者被破坏，必须补上最小集成修复。

冻结新增修改范围仅 useQuestionFilters.ts 的 URL 同步：从当前路由查询保留既有 debug 参数和值，再合并 writeFiltersToUrl 生成的筛选/页码串；建议 setSearchParams 的函数形式读取当前参数，复制 debug 的 getAll 值到新参数后 replace 写入。没有 debug 时不新增；debug=0/true 等原值也保留，开启规则仍仅为首次 debug 值等于1。不把 debug 写入 filters、queryParams、facetsParams，不保留或迁移其它非筛选参数，不改搜索 API、分页、300ms 防抖、reset 的筛选语义。

D/T 定向验证：真实 HashRouter fresh builder?debug=1 与 search?debug=1，等待字体/图片 ready 和超过300ms 防抖，URL 仍含 debug=1、默认 prop 预览调试保持可见；修改关键词/筛选/页码及 reset 后 debug 不丢，关键词/筛选/页码仍按旧契约更新；debug=0/true 保留但不启用；无 debug 时不得新增；API 请求中无 debug。补共享 hook 的路由集成测试，不能只测 glossary 函数。保留旧实现 fresh hash 被删除的实测反证，重建后由 T 重新采集同条件新证据。

本补充只闭合 B0-3，不实施 B1 查询迁移、路由解耦或任何筛选改版；若要保留其它参数，另回 A 冻结。现有全部门禁仍执行。

G1 同类别消费漏项补充：A 只读确认 StatsPage.tsx:166 公式总览卡仍默认输出 `OK ${s.formulas_ok...}`，属于 B0-4 原始状态码中文化的同页必要漏项；仅系统摘要 `OK` → `转换完成`（保持 formulas_ok 字段、数值和布局），不实施 B4。T 默认页面断言无独立 OK 原码，并确认转换完成计数与原字段相同。
