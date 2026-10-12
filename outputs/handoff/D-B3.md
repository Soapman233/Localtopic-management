# 交接：B3 实施 / D

## 我做了什么
- PaperBuilderPage.tsx:178/196/378/396/400/430/617：紧凑首次收起筛选；1366双栏保留；一行视图、页数、内容状态；诊断展开只读；删除常驻批量提示；设置提取；清单态继续测量；首次打开才加载导出抽屉，随后关闭仍挂载保存局部结果。无卷沿用统一管理，空卷行动聚焦左侧搜题。
- PaperSettings.tsx:17 与 PaperPanel.tsx:87/176/229：标题、模板、模式、加入目标进展开层，写入沿用现有actions；清单不重复设置；空大题不再过滤，首尾禁用上下移；保留条目菜单、大题改删、设分、stale更新入口。未改 usePaperMutations 或跨大题守卫。
- LivePreviewPanel.tsx:79/81/225/343/381：新增展示props及带paperId/contentDigest的effect页数上报；只隐藏页面层，测量层仍在scale兄弟节点，默认消费者不变。
- ExportPage.tsx:105/294：无卷选择试卷；空卷返回携带本页ID。删除旧306底部实现说明。经核实按钮去重、正常B回程和readOnly早已由B1完成，本轮不重做；ExportDrawer、ExportDiagnostics、useExportGate业务源码未改。
- vite.config.ts:41/65：严格按A四次补冻的精确模块边界重聚原同屏共同依赖，独立非vendor preview/app-common；onlyExplicit防止根依赖被手工preview块吞入。没有业务进vendor，Katex独立，导出抽屉UI仍按需。增加B3行为4测，B1mock同步default导出和空态文案，不减少用例。

## 产出物
- frontend/src/components/PaperSettings.tsx、LivePreviewPanel.tsx、PaperPanel.tsx
- frontend/src/pages/PaperBuilderPage.tsx、ExportPage.tsx
- frontend/tests/unit/B3Redesign.test.tsx、B1ExportFlow.test.tsx；frontend/vite.config.ts
- .tmp_verify/b3-d/tsc.log、frontend-test.log、build.log、probe.json、probe.log、cold-pages.json、preview-fresh.json/log、server.py/log
- .tmp_verify/b3-d/builder-1366-light.png、builder-1366-dark.png、settings-open.png、export-fresh-context.png、current-pixel-preview.png（最后一张是失败态，绝不冒称PNG预览成功）

## 实测证据
### 正式门禁输出
- npx tsc --noEmit：exit=0，stdout空，tsc.log保存。
- npm test：exit=0；node:test真实输出 # tests 26 / # pass 26；vitest Test Files 41 passed (41) / Tests 316 passed (316)，Duration 11.15s。完整frontend-test.log。先前初跑312中3失败是lazy默认导出mock和空态文案未同步，已修正测试边界，未删测试。
- npm run build：exit=0，all 65 pairs pass，vite built in 10.41s。无新配色，原65配对未删。完整build.log。
- 后端本轮引用独立T执行证据 .tmp_verify/b3-t/backend-baseline.log：Ran 436 tests in55.117s / OK (skipped=1)；D没有修改Python交付资产，未把T运行冒称D自测。
- 原库D复核sha256=6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6，不变。

### 当前构建与网络
- 专属D服务8798（8799起服时已被另一副本占用，首轮连接立即弃用）；health.db=.tmp_verify/b3-d/bank.db。servedIndex与本地stat均index-wu9Cn37v.js，入口23569 bytes。
- 默认builder新context脚本响应body冻结快照：15请求 / 1058746 bytes，<=1064929/15；HTML只预加载原vendor+app-common，无preview/KaTeX提前预加载；vendor-react205205、vendor-misc65818与原一致。
- 冷search：14请求/744656 bytes；冷question/3761：14请求/1001268 bytes；均previewRequested=false。完整清单cold-pages.json。

| 默认builder脚本 | 原始bytes |
|---|---:|
| index-wu9Cn37v.js | 23569 |
| vendor-data-CemKEH6V.js | 92037 |
| vendor-react-bc3qjMp6.js | 205205 |
| vendor-mui-DVZZQ0ZO.js | 317869 |
| vendor-misc-BTghej2W.js | 65818 |
| app-common-CqskeM12.js | 11715 |
| ConfirmDialog-CKAGPQ4D.js | 1261 |
| useQuestionFilters-BjSmAWoy.js | 12416 |
| uiStore-DYkAyVuj.js | 2069 |
| preview-CQ6A3UT9.js | 34190 |
| PaperBuilderPage-CByEb04w.js | 26130 |
| StatusBadges-dDtA2p2d.js | 2030 |
| KatexFormula-CsrjdTVa.js | 2632 |
| EmptyState-DuBb2LfV.js | 731 |
| vendor-katex-Dc8nsIP1.js | 261074 |

### 浏览器实际布局与行为
- 1366×768：scrollWidth=1366/clientWidth=1366；左右栏可见；常驻Alert计数0。首卡默认601.5625px，展开筛选337.5625px，再收601.5625px。浅/深截图已实际查看；深色背景rgb(18,18,18)，无页面横溢。
- 顶行视图y116.5高38.75、页数/检查文字y125.921875高19.90625、详情按钮y120.5高30.75，同一行；约4页来自LP当前测量。所有measure祖先transform=none；清单态measure=1/pages=0，页数仍约4页；新增大题入口1。
- 设置展开实际模板/模式/加入目标combobox各1。
- 1199：开面板按钮1、内联视图0；开Drawer dialog1，点关闭后0。1200：按钮0/视图1。1440：筛选常驻1。
- A=1→export?paper_id=3→回程：builder.paperId3/itemCount23/exportOpentrue，标题导出·未命名试卷，请求仅papers/3及其export-data，无papers/1。
- 综合跨Drawer探针辅助button可访问读数出现0（R也观察到）；不能据此判断按钮消失。独立fresh context辅助页真实预览按钮1、无导出提交0/创建修订0、底部说明0；单击POST preview恰1。抽屉regen入口1。

## 反证与未通过尝试
- R改前常驻Alert真占位61.5px，改后计数0，截图支持；回程错选及Page/Drawer两个预览动作经核实不成立，B1已修，不能归功B3。
- 初始lazy build：首屏1049919/15但入口30841超51；第一次手工preview贪婪分组HTML错误提前preload，失败；onlyExplicit后1059866/19请求失败；补冻三1059211/17请求仍失败；按A最终精确清单现1058746/15正式通过。没有手改产物或只比入口掩盖总量。

## 验收标准（给独立T）
- 只从本交接、A-B3.md、R-B3.md及代码接手，用自己的副本/端口并核对入口。
- 新context复验1366/1199/1200、9页h1、skip-link/地标/aria-current/Drawer焦点，诊断阻断N项展开/收回及readOnly绝无POST revisions。
- 在副本造stale，从清单找到更新到最新并实际刷新。各写入先建立已预览状态，UI加删/排序/分值/大题增删改移/元数据/刷新后逐项看previewFresh=false与导出锁；键盘同大题一次移动，跨大题移动请求0。
- 冷首次清单页数、改内容及切卷摘要不可沿用旧digest；LP祖先无scale/动画、纸面完整滚动。真实空大题新增后马上可操作；未分组不能大题移动。
- Preview按钮一次发一次；回程A≠B题名/请求一致；以当前新作业产物验证，不使用历史导出。

## 我没做/做不到的
- 未做B4/B5、后端/API/公式/分页算法改动；未提交或push，主控最后一个B3提交。
- 未冒称完成全UI写链、stale/键盘/跨大题和9页独立验收，这些交T。D未写交付库。
- 当前真实新像素作业新产DOCX但未产PDF/PNG：2026-10-12T21:38:27 meta cached=False；warnings为PDF生成失败：KWPS.Application: (-2147221005, 无效的类字符串, None, None)。新DOCX outputs/webui/preview_cache/b08db3cf5038e6eec34bf17cb2e95c31c3355daf99e985b5f2015375444a0208/paper.docx。此为当前调用实测，不推断所有电脑均不可预览，不用结构覆盖冒充像素验证。

## 遗留风险
- WPS COM未注册造成当前新像素作业失败，T需复验或如实列限制；本轮不扩大冻结后端修复。
- 手工业务分包需独立T核查实际冷页、全部首屏字节与无分页扩载；多worktree服务不能仅看端口号。
- 综合Drawer切断点后辅助可访问按钮读数异常已由fresh context排除，独立T仍须检验真实用户关闭/焦点恢复。
