# 交接：B0 独立验证 / T

## 我做了什么
- 仅从 R/A/D-B0 交接、实施方案与当前代码重新构造浏览器验证，未复用 D 新测试的实现思路。副本后端端口 8739，QB_DB_PATH=.tmp_verify/b0/t-bank.db；真实 API fixture 只做浏览器 route fulfillment，所有实际请求均未写库。
- .tmp_verify/b0/t-preview-browser.json:1 独立发现 hash debug 被筛选 URL 同步清除：fresh #/builder?debug=1 在 ready 后变 #/builder，版本/测量关闭。向主控打回，A 补 G1，D 定向修补后在 t-hash-integration-after.json:1 确认两页防抖、关键词、翻页、学段筛选及重置均保留 debug，search/facets API 无 debug。
- .tmp_verify/b0/t-harness-results.json:1 使用独立 esbuild 浏览器 harness 挂真实 LivePreviewPanel，未 mock 分页/测量 hooks。ready 默认关闭、显式 true 开启、普通/hash/storage 开启、显式 false 覆盖 hash/storage均包含真实 PageView 徽标；存储 getter 抛错与 URL 优先开启实测通过。
- .tmp_verify/b0/t-fixture-browser.json:1 用缺答案字段、原文 x**2/**标记保留**、五公式状态与未知/空/null重构消费页；技术字段默认隐藏、debug可见，未知中文待核对、各行计数保留、源图失真/EMPTY风险说明保持。t-login-browser.json:1 在真实 /login 截获 lazy chunk：延迟可访问状态、含路径/秘密的模块异常不泄漏、解除拦截后点击刷新真实恢复到本地 /builder。
- .tmp_verify/b0/t-heading-landmarks.json:1 核对9页标题；t-system-copy.json:1 实际打开大题删除确认并取消、查看版本历史/导出页；t-first-screen-final.json:1 对最新构建采集 fresh 默认builder脚本请求。保存独立可复现探针并实际运行 exit=0。

## 产出物
- outputs/handoff/T-B0.md（本文）。T 没有修改生产代码或长期测试。
- .tmp_verify/b0/t-independent-browser.mjs、t-replay.log/json：最新 build 上独立探针真实 exit=0，7组关键验证通过。
- .tmp_verify/b0/t-hash-integration-after.json、t-preview-browser.json（保留修补前反例）、t-harness.tsx/js/css、t-payload.json、t-harness-results.json。
- .tmp_verify/b0/t-fixtures-baseline.json、t-fixture-browser.json、t-login-browser.json、t-system-copy.json；t-login-loading.png、t-login-error.png、t-fixture-*.png、t-paperpanel-delete-copy.png（已视觉核对）。
- .tmp_verify/b0/t-heading-landmarks.json、t-first-screen-final.json、t-first-screen-comparison.json、t-safety.json、t-service.log、t-cleanup.json。
- .tmp_verify/b0/t-stats-summary-final.json/png、t-stats-cleanup.json：最终补充摘要独立复验。

## 验收标准（给下一个角色）
1. G3 通过。复现方式：用副本 QB_DB_PATH 启动 uvicorn 8739 后运行 node .tmp_verify/b0/t-independent-browser.mjs http://127.0.0.1:8739；必须 exit=0。此探针覆盖真实hash交互、API参数隔离、指定删除确认文案、登录lazy延迟/异常/真实刷新。
2. 九页标题层级 9/9，均恰一个 h1；统计/设置/详情章节 h2无跳级，main与skip-link存在，导航页aria-current正确，Drawer真实role=dialog保持。详情路由原有无选中导航的事实见遗留风险。
3. 三指定系统文案验收：删除大题确认“不会丢失”无裸星号，VersionHistory“仅供查看”无裸星号，Export定位caption不存在；题目fixture中的 ** 逐字保留。检索缺字段默认无 has_answer/has_analysis/api路径且不误标无答案；debug可见原诊断。复核kind/part/reason默认不在DOM、debug可见。
4. 公式复核/统计五状态语义中文；未知、空、null统一“状态信息不可用，待核对”，未默认为正常，unknown sentinel不在默认DOM。详情OK沿用原先不显示异常Chip的行为，其余四状态及三未知值逐行中文；不宣称转换完成等于公式正确。
5. 最新入口 index-Ji-omJBg.js 实际31,130 bytes，较基线30,779增加351（1.14%），如实承认必要边界增量。fresh默认builder实际16个JS请求，raw总1,068,908 bytes；历史同请求集合manifest总1,068,142，增加766（其中URL同步补丁75）。历史数为同集合字节推算，非旧网络实测；五vendor全同，无额外vendor搬移。不是压缩传输量。
6. 已核对最新D完整门禁实际日志：tsc exit0；node26+vitest261=287均通过，未减少原251；build6.02s、65/65配对；后端436、1skip。T未冒称自己重跑整套门禁，独立证据来自上述浏览器反例与重构fixture。
7. t-safety.json 记录副本health实证路径。交付库完整SHA256仍6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。T自建浏览器已关闭；服务清理结果见t-cleanup.json。

## 我没做/做不到的
- 未实施B1–B5；未改导航/布局/后端/冻结bank文件/交付库；未提交或推送。
- 未实测线上部署完整登录业务流程；本批真实浏览器检验顶层lazy边界与本地返回，线上既有认证分支由最新完整测试保持。未做NVDA真人朗读。
- 未进行Word/WPS导出与公式内部编辑，本批未改导出或公式处理逻辑。

## 遗留风险
- 详情question/1现有导航无aria-current，因为原精确路径匹配；B0未改导航，故为已存缺口而非本轮回退。不得宣传9/9 aria-current或全无障碍。
- 入口高于原预算351 bytes；已真实解释且验证vendor不增，不能宣称≤30,779。通用全站ErrorBoundary原message展示未改，本轮安全隔离仅登录局部边界。

## 最终补充复验：Stats 总览摘要

A补充冻结StatsPage.tsx:166的同页漏项后，T仅对新build真实统计页重新验证，不重复已完成的其他浏览器测试。当前 /api/stats 的 formulas_ok=17639、formulas=17771；默认DOM恰一个“转换完成 17,639”，无独立OK原码，计数和公式总数保持。证据见t-stats-summary-final.json及已视觉核对的PNG。最新入口index-Ji-omJBg.js实stat仍31,130 bytes；Stats不进入builder首屏，前次16请求及总量对照的逻辑不变。T自建浏览器/副本服务再次清理，8739停止，交付库完整哈希不变。G3最终通过。
