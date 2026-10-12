# 交接：B0 只读核实 / R
## 我做了什么
- 完整读取实施方案（§1、§4、§6 为 B0 门禁）与 AGENTS.md；限定方案 #1/#2/#5/#7/#18，加 glossary HashRouter 遗漏，不触及 B1–B5。
- 核实真实源码：ExportPage:167–171、PaperPanel:460、VersionHistory:143 是系统 JSX 文案裸 Markdown；题目原文不在处理范围。
- LivePreviewPanel:145 把 debug 默认为 false，:308 传 PageView；:330 layout_revision 无条件输出，:334–338 ready 后无条件输出测量/重排，实际文本在 :336。统一有效值必须是显式 prop 优先、缺省读 isDebugMode。
- glossary:261–274 实际读取 search 与 localStorage；FormulaReviewPage:60 已中文化，但 :171/:219 的未知值回退原始码，:229 kind、:267 reason、:272 part 默认露出；StatsPage:223/:250、QuestionDetailPage:56 原码输出。
- router:80 顶层 lazy 登录没有自身 Suspense/ErrorBoundary；既有 AuthLoginRoute 测试验证页面分支，不覆盖 lazy 路由失败。ErrorBoundary:52–54 直接输出原始 message，若用于登录加载失败，应加局部安全 fallback，避免 import 失败 URL/技术信息默认暴露，不扩大修改全局边界。
## 产出物
- outputs/handoff/R-B0.md（本文件）。无生产代码修改、无数据库写入。
## 验收标准（给下一个角色）
1. 仅三个指定系统文案处理裸 Markdown；含乘方记号 ** 的题干 fixture 原样保留，不扫描替换全仓。
2. LivePreviewPanel 在分页 ready 后：缺省 debug 且 URL/storage 关闭时无 layout_revision、测量、重排；URL 普通/hash 或 storage 开启时可见；显式 true 可见；显式 false 即使 URL 开启仍全部关闭（含 PageView 标记）。
3. glossary 测普通 query、hash query、storage、storage 抛错；debug 非 1 关闭；URL 开启不能因存储异常被反向关闭。
4. 构造检索答案字段缺失 fixture，默认有“信息不可用”事实，无 has_answer、has_analysis、/api/search，不误标“无答案”；debug 能看技术信息。
5. 公式复核 fixture 带 kind/part/reason 与未知状态；默认无原始字段，未知状态为“未知/待核对”事实；debug 可定位。统计和详情对 OK/UNSUPPORTED/EMPTY/FAIL/空值/未知值逐项验证，未知不能映为正常。状态仅展示转换结果，不宣称公式正确。
6. 真实登录边界可控 Promise 延迟时显示 role=status，拒绝时有中文可恢复错误态且默认不输出 URL/堆栈/密码；本地重定向、线上未登录、loading、needs_setup、auth_mode=error 原分支仍通过。
7. 依次 tsc / npm test / npm run build / 后端 unittest；前端原 251 项、后端原 436 项不得减少；对比度 65/65；入口 ≤30779 bytes 或如实说明必要增加，同时核对默认 builder 首屏请求，禁止调整 vendor 伪装。检查原地标/skip-link/aria-current/Drawer role 和九页标题。库全 SHA256 不变。
## 实测反证
- 经 Node 子进程执行从当前 glossary 提取的旧函数，exit=0，输出：{"ordinary":true,"hash":false,"storage":true,"storageThrows":false}。普通查询有效但 #/builder?debug=1 读不到成立。新函数必须同一输入 hash=true。
- LivePreview 的旧默认可见经 :330 和 ready 分支直接核实；这里只读结构证据，不能替代 D/T 的 ready DOM 实测，需先挂载旧组件证明泄漏再测新组件。
- 主控实测基线：Ran 436 tests in 43.958s / OK (skipped=1)；库 SHA256 6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6；git 初始无变更。
## 经核实不成立
- “公式复核三类状态未中文化”经核实不成立：:60–64 已映射并在 Tab/卡片使用；真正遗漏为技术字段和未知回退。
- “登录现在必然报错”经核实不成立：缺少局部边界仅结构事实，已有本地分支测试及用户正常实测；本轮只能称边界加固。
- “测量文本真实行号为 334”不精确：:334 是条件入口，文本位于 :336；版本字段位于 :330。
## 我没做/做不到的
- 未执行前端完整门禁、浏览器实际渲染、登录实际 lazy 失败、旧预览 ready DOM；留给 D 自测和独立 T。
- 未改布局、导航、后端/API/字段/错误码、冻结 bank 文件、交付库；未实施 B1–B5。
## 遗留风险
- reason 可能包含原始内部原因，宜随 kind/part 一起进入 debug；不能隐藏源图失真与未知状态事实。
- 通用 ErrorBoundary 默认 message 外露，不宜把它直接套到登录后宣称“内部信息已收敛”。局部 fallback 是 B0 登录边界必要范围。
- 路由包装会带来真实入口字节增量，应测量解释；不要为了预算改预加载/vendor。
