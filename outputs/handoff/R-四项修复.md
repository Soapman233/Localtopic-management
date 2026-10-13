# 交接：四项修复调查 / R

## 我做了什么

- 只读核对 AGENTS.md 与 outputs/handoff/V-B0-B5全量独立复核.md；根代理已实测基线436项（435通过、1 skip），38.600秒，HEAD b962fc8972ceabc9ee9a46bec400b32045eeec17。
- 核对 KnowledgeReviewPage.tsx:106–109、199–209、517–524：batch只保存decision/preview；openBatch异步返回未验证请求仍属于当前选中标签；弹窗文字读preview.label_name，写入读当前selected。
- 核对 useExportGate.ts:293–321、exportGateShared.ts:25–30 与 webui/services/preview.py:230、262–294：后端PDF失败正常完成作业，保留DOCX，以pages=[]、pdf=null、warnings[]返回；hook done空页分支只报错锁定，没有消费环境warning。
- 核对 AnimatedList.tsx:8、17–23、30–42 与已安装AutoAnimate index.mjs:537–628、751–806：移除节点由插件重新插入，cleanUp只在finish事件调用；disable会cancel动画，destroy另负责注销观察器/父节点集合。源码stop注释“disable只阻止未来动画”不符合本地库实现。
- 新建忽略目录中的独立Vitest探针，挂载真实页面和真实hook，仅mock外部API/轮询边界，实测FIX1/FIX2现存错误；读取旧V浏览器/SQL实证补充FIX3/FIX4。

## 产出物

- outputs/handoff/R-四项修复.md（本文）。
- frontend/.tmp_fix_r/fix12.test.tsx、vitest.config.ts、fix12.log（改前反证；均QA临时文件，不是生产代码）。
- 既有证据：.tmp_review_B0_B5/independent-evidence.json；关键键labelRace、previewEmptyJobs、noEscape、motionCancel、motionNatural、observerLeak。

## 事实与实测证据

### FIX-1 标签不同源与迟到

新探针输出：太阳能预检请求延迟期间切音调，返回太阳能2条预检，弹窗仍显示太阳能；点击确认，真实页面传给decideLabel的请求体为 {"label_name":"音调","decision":"确认","confirm":true}。
旧V真实副本SQL证据：太阳能仍2条待复核，音调4条变已确认。新探针无实际数据库写入；它证明真实组件提交参数错源，SQL影响结论来自明确标注的旧V证据。
需冻结的前端语义：预检开始时保存目标与decision；接受返回前验证标签上下文及请求代次，不能让旧预检覆盖新预检；弹窗展示和提交必须使用同一个不可变目标；切标签/取消/卸载使旧预检失效。同标签A→B→A不能只比较标签字符串。
API端点/字段无需改变；不应增加force覆盖已有决定。

### FIX-2 done空页环境降级

新探针挂载useExportGate，当前摘要digest/diagnostics允许，通过startPreview拿到jobId后输入done、pages=[]、pdf=null、docx存在路径、warning含KWPS.Application。输出 envFail=null，unlocked=false，previewError=“预览作业完成但未返回页面（可能 PDF 生成失败）。”。
旧V实际返回同类WPS COM错误，24公式/8图片DOCX已经生成；noEscape.buttonCount=0且exportDisabled=true。
既有降级入口条件：ExportDrawer.tsx:261依赖envFail非null；ExportPage.tsx:166显示环境提示并要求回工作台结构确认。只修共享hook即可触发已有两处展示，不需新端点。
需冻结：识别done空页中明确的环境warning；未知空页原因继续锁定、不能一律归类Office失败。内容阻断、失配摘要、迟到票据不能因环境原因解锁；用户显式结构确认前仍锁定。结构确认后内容/模板/答案模式变化仍重锁。
Backend warning不仅PDF失败，也有PDF位图化失败；不可用所有warnings.join包含任意字样就无条件降级。

### FIX-3 reduce取消移除节点

本地库remove() index.mjs:564标记__aa_del、567–577重新插入临时节点、599写绝对定位样式、626仅finish事件cleanUp。disable()751–769会cancel并移除animations映射，不触发finish清理。AnimatedList stop额外cancel也无法恢复finish。
旧V浏览器实测：勾选→清空→暂停移除动画→reduce；checkbox=false，toolbar children=1，文本仍“已勾选1题”，动画0，残留绝对定位样式。等待自然时长仍残留；再选出现重复工具条。此轮R未重跑真实浏览器，独立T正于8871重构验证。
需冻结清理边界：只清插件所有的移除临时直接子节点，不能删React仍渲染的正常节点，也不能以position:absolute或任何getAnimations目标作为删除依据。禁止放宽到纸面/DnD/测量区域。可使用完成移除动画的方式或显式跟踪移除节点；具体方案交A定，插件私有__aa_del是实现事实而非公开契约。

### FIX-4 卸载资源释放

本地控制器有destroy，类型index.d.ts AnimationController里destroy可选；AnimatedList自定义Controller类型只列enable/disable/isEnabled，cleanup只stop并清ref，未destroy。
destroy 772–805注销MutationObserver、ResizeObserver、IntersectionObserver、interval/debounce、parents集合及弱映射；disable只取消动画/部分timer。
旧V观察器探针：找题↔设置三轮，已脱离DOM但MutationObserver未disconnect对象数量2→4→6；这是观察器生命周期实证，内存持续增长仍为风险推断，没有heap快照。冷启动reduce无动画另已通过，不能由此证明卸载已释放。
需冻结：每个实际创建控制器在reduce导致effect清理及组件卸载时destroy；迟到import不得创建已失效控制器；StrictMode重放与no-preference→reduce→no-preference应只保留当前实例；不让全局观察器计数误算为组件泄漏。

## 验收标准（给A/D/T）

1. 改前探针命令（项目frontend cwd）：node node_modules/vitest/vitest.mjs run --config .tmp_fix_r/vitest.config.ts。当前2项通过是“成功观察到旧错误”，不能当修复验收；修复后这些旧错误断言必须失败，另写正向安全断言。
2. FIX1用独立延迟promise/浏览器route控制：A预检→选B→放回A；应不出现旧A确认，且无写请求。A第一次确认慢返回、A第二次否决快返回，慢请求不得覆盖新decision。弹窗目标和实际POST一致，取消/卸载迟到零写；在8871副本按label_name/review_status分组SQL核对目标与非目标关联。
3. FIX2构造done pages=[]/Office warning、editor_sdk warning、未知warning、无warning、有页面正常成功、摘要失配、内容阻断、失效ticket。仅可靠环境失败出现结构确认；确认前锁定，确认后允许DOCX；两入口保持一致；变更模板/模式/内容后重锁。真实Office环境失败可复用副本预览，不能仅模拟抛ApiError覆盖done路径。
4. FIX3真实浏览器延长/暂停移除WAAPI，清空后立即切reduce：等待>=原动画时长，toolbar children=0、checkbox全未选、无ghost；重选仅一个工具条。反向验证正常剩余节点没被删，以及新增/移动动画取消时DOM正确。不可仅测试canAnimateList纯函数。
5. FIX4在浏览器init script包MutationObserver.observe/disconnect，仅追踪data-testid search-selection-motion/search-results-motion对应目标；找题↔设置至少3轮，已卸载目标未disconnect数为0。再验证实时偏好往返及StrictMode/迟到import；destroy调用计数可作补充，不替代真实observer证据。
6. 保持现有API和数据契约；D给出实测日志后G2，T独立重构反例后G3。完成前跑前端tsc/test/build与后端基线，交付库SHA不变。

## 我没做/做不到的

- 没改生产源码/依赖/静态构建，也没构建或启动服务；没写任何数据库。
- 新探针只新测FIX1/FIX2；FIX3/FIX4引用已存V浏览器证据与本地库源码，未称新浏览器通过。
- 未测真实heap增长、Word/WPS编辑、线上登录；这些不作为本轮四项验收。
- rg扫描项目时两个旧tmp目录拒绝访问，已从进程stdout保留其余列表；四项所需文件均成功读取。

## 遗留风险

- 自动动画包本地实现须以实际版本源码为准，disable与destroy语义不同；cancel不代表临时DOM已清理。
- 单比较selected可遗漏A→B→A，也可遗漏同标签不同decision乱序；应验证独立请求身份。
- 环境warning识别过宽会绕过未知导出失败；页面为空本身不构成安全降级证据。
- 交付库研究末sha256=6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6，与根代理起始值一致。
