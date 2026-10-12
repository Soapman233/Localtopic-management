# 交接：B0 实施与自测 / D

## 我做了什么
- 按 R/A 冻结仅实施方案 §4 #1/#2/#5/#7/#18 与 HashRouter 开关遗漏。ExportPage:167 删除整段定位 caption；PaperPanel:460、VersionHistory:143 用 strong；题目原文不扫描、不替换。
- LivePreviewPanel:146–149 以显式 prop 优先，否则 isDebugMode；:334/:338 版本/测量与 PageView 同开关。等待态改为准备预览教师文案，测量算法/层级不动。glossary:261–277 兼容 search/hash/storage 及存储异常。
- SearchPage:334–335 缺字段给信息不可用事实，原诊断进入 debug。FormulaReviewPage:166/:214 中文未知回退，:224/:262/:267 kind/reason/part 仅 debug；源图失真提醒和 EMPTY 内容局限保留。glossary:282 共享五状态映射，StatsPage:224/:251、详情:56 接入，空/未知提示待核对。
- router:81 仅登录局部 LoginLoadBoundary:9 包 Suspense/ErrorBoundary；延迟 role=status，拒绝中文错误+刷新页面，原错误 URL/秘密不出 DOM。lazy 拒绝缓存故不提供无效局部重试；全站旧 ErrorBoundary 不变。
- 新增 36 项回归（原225 vitest→261），涉及筛选URL同步真实HashRouter六场景、统一debug六场景、hash与storage异常、五状态/未知/空、列表与详情 ** 数学原文、三系统文案DOM、登录延迟/拒绝/本地跳转/线上表单；既有a11y与认证五分支继续通过。

## 产出物
- 生产文件：frontend/src/components/{LivePreviewPanel,PaperPanel,VersionHistory,LoginLoadBoundary}.tsx；frontend/src/lib/glossary.ts；frontend/src/pages/{ExportPage,SearchPage,FormulaReviewPage,StatsPage,QuestionDetailPage}.tsx；frontend/src/router.tsx。
- 新测试：frontend/tests/unit/B0{PreviewDebug,LoginBoundary,SystemCopy,DetailStatus}.test.tsx；扩展 Glossary.test.ts、pages/{FormulaReviewPage,StatsPage}.test.tsx。
- 本文 outputs/handoff/D-B0.md；真实本地证据 .tmp_verify/b0/before-dom.log、{tsc,npm-test,build,backend}-final2.log、hash-sync-before/after.log、assets-after-final2.json；旧反证脚本 .tmp_verify/b0/B0Before.test.tsx（不提交）。

## 实测证据（G2）
收尾严格按用户顺序执行。Windows exec_command 在本会话不可用，经 Node child_process 调用真实 npx/npm CLI 和指定 Python（不是替代模拟），env PYTHONUTF8=1。

```text
npx tsc --noEmit
[真实输出为空，exit=0；3.409s]

npm test
ℹ tests 26
ℹ pass 26
ℹ fail 0
 Test Files  34 passed (34)
      Tests  261 passed (261)
   Duration  5.51s
[exit=0；总287项，原251项未减少]

npm run build
all 65 pairs pass
✓ built in 6.02s
[prune] 清理 17/17 个过期产物，释放 192 KB（保留 88 个，判定依据：Vite manifest）
[exit=0]

PYTHONUTF8=1 指定 Python -m unittest discover -s tests
Ran 436 tests in 32.768s
OK (skipped=1)
[exit=0]
```

- 实际 stat 入口 assets/index-Ji-omJBg.js = **31,130 bytes**，基线30,779，增加351 bytes（1.14%）。这是登录独立边界及安全错误/加载态、hash识别等必要实现增量；Vite日志28.92kB并非本次真实UTF-8文件字节，不能据它宣布预算无增长。未改变分包/vendor/预加载配置，也未搬代码入vendor：mui318244、data92037、misc65818、react205205、katex261074，各与基线完全相同。首屏真实请求留独立T重构验证。
- 库SHA256：6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6，与基线全值一致，未读写业务库连接。
- 旧实现真实 ready DOM 反证1/1通过：输出“BEFORE: hash=false; ready default layout-before-v1 + 测量 0.20ms · 重排 v1 visible”。新6项预览DOM覆盖缺省隐藏、true显示、普通/hash/storage开启、false覆盖，包含真实 PageView 徽标；新 glossary hash=true。旧临时测试已从生产测试目录删除并保留忽略目录复现副本。
- Stats未知两码+null+空同时显示四条相同中文标签，全部计数保留；既有 DistributionList 用 label+index 作 React key，无冲突，不改组件结构。

## 验收标准（给下一个角色）
1. 仅从交接+代码独立构造 fixture：ready默认无版本/测量/徽标；URL普通/hash/storage均开；显式false仍全关，storage getter抛错不白屏。
2. 三系统文案无裸星号；含 ** 的题干保留；检索缺答案字段默认无技术字段且无无答案误判。复核kind/part/reason默认隐藏、debug可达；三页对五状态与空/未知独立观察，源图提醒仍可见。
3. 用真实登录路由截获lazy网络请求，延迟/拒绝加载分别有可访问状态/中文错误，刷新真实恢复；本地跳转、线上原认证顺序保持。D行为测试挂 MemoryRouter 同构局部边界并另验真实声明；T应进一步真实浏览器造反例。
4. 九页内容就绪后核对h1/h2层级、skip-link/main/nav/aria-current与Drawer role=dialog；默认builder实测首屏JS请求，对照assets-before/after记录，vendor未变。复跑受影响检查，库SHA不变。

## 独立 T 返修 / A 补充冻结后的集成闭合
- T 的 fresh HashRouter 浏览器反证成立：共享 useQuestionFilters 原同步整体重建查询，会在 ready/300ms 防抖后删掉 debug。已读 A-B0.md 补充 G1，仅新增 frontend/src/hooks/useQuestionFilters.ts:85–91 修改：函数 updater 从当前路由复制 getAll('debug') 原值到新筛选串，其它未知键仍清除；filters/queryParams/facetsParams 不加 debug。
- frontend/tests/unit/useQuestionFilters.test.ts 新增6项真实 HashRouter 回归：builder/search初挂载、防抖301ms、关键词/筛选/页码/reset持续保留；debug=0/true/重复值保留但按首次值开启；原URL无debug不新增，未知参数不保留，API参数不含debug。旧测试执行5失败/7通过；修复后12/12通过，真实日志 hash-sync-before/after.log。
- 补修后重新完整按用户顺序执行门禁，本文上方数字/入口/日志已更新到最新：tsc0、node26+vitest261=287、build65/65/6.02s、后端436/39.323s/1skip；入口仍31130 (+351)，vendor五文件不变，库全SHA不变。旧初次门禁日志保留供历史审计，最终应读 -final2.log。

- A 同类补充冻结的 StatsPage:166 总览 hint 原「OK N」已改「转换完成 N」，仅系统文案变化；formulas_ok 值、字段和布局原样。既有Stats测试新增精确摘要「转换完成 8」与默认DOM无独立OK断言：旧1失败/3通过，新4/4通过，真实日志 stats-summary-before/after.log。最终再次完整按序门禁，日志 -final2.log，全文门禁数字更新到这轮；入口仍31130 bytes，五vendor全数不变。

## 经核实不成立
- “公式复核三类状态尚未中文化”经核实不成立：旧STATUS_LABEL已有不支持/未提取到内容/转换失败；本轮保留这些语义，只共用映射并补未知回退及技术字段。
- “当前登录必然报错”经核实不成立：只存在顶层边界结构缺口；用户当前构建正常实测与既有分支测试均支持，因此仅称结构加固。
- 测量文本旧真实行号336，334是分支入口，330是版本Chip。

## 我没做/做不到的
- 未实施B1–B5，未改布局/导航/后端/冻结bank文件/数据库，无全仓星号扫描替换，无配色新增、无构建产物/数据库提交、未提交/推送（由主控G3后提交）。
- D未执行浏览器九页标题、真实首屏请求、真实网络lazy故障；请独立T补齐，不用组件测试冒充浏览器证据。未做NVDA真人朗读。

## 遗留风险
- 入口增加351 bytes，用户允许如实说明必要增加，本报告未冒称达成≤30779。
- debug开关按渲染读取URL/storage，显式false设计上覆盖开关，供降级预览使用。
- 通用ErrorBoundary原有message行为仍在，本轮仅登录局部安全fallback；不宣称全站任意异常全部收敛。
