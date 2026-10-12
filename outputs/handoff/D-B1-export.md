# 交接：B1 入口与导出回程 / D

## 我做了什么

- `frontend/src/pages/PaperBuilderPage.tsx:157` 在筛选 URL effect 前捕获一次性 `openExportForPaperId`；首次查询直接使用指定卷，消费后选卷、清目标、开抽屉并 replace 清字段，保留剩余 state。合法 ID 必须为正安全整数；非法意图不开抽屉，不存在的指定卷明确显示加载失败，不退回旧全局卷。
- `PaperBuilderPage.tsx:201` 接 A 局部重冻的 `preserveLocation`，仅本挂载捕获过意图时锁存启用；普通页面沿用 B0 同步策略。删除原工作台管理 Drawer、新建/删除/确认/重建逻辑，空态及 `:435` 的 PaperPanel 回调都接 D 主提供的轻量 `paperLibraryStore`。
- `frontend/src/components/PaperPanel.tsx:149` 空态文案统一“试卷管理”；删除 `onGoExport` 和底部第二导出按钮。工作台保留 `PaperBuilderPage.tsx:517` 主导出和 `:612` 按 paperId key 的抽屉。原列数、间距、题卡、DnD/公式/导出门禁业务保持。
- `frontend/src/pages/ExportPage.tsx:51/:142/:166` 把辅助页改为“试卷预览”：保留模式/模板/双预览/诊断，去掉格式、导出提交、导出结果、修订创建和历史承诺；显式非法 paper_id 不退全局卷。回程携带指定 ID、当前查询串与必要 state。
- `frontend/src/components/livePreview/ExportDiagnostics.tsx:41/:92/:99` 新增默认 false 的 readOnly；辅助页不挂载候选写控件/对话框，其他消费者保持修订。 `frontend/src/components/ExportDrawer.tsx:238/:347` 保留一个预览动作和一个导出动作，删除锁定/空态/预览失败额外预览按钮；保留过期、降级、诊断、结果与共享安全判断。

## 产出物

源码：
- frontend/src/pages/PaperBuilderPage.tsx
- frontend/src/pages/ExportPage.tsx
- frontend/src/components/PaperPanel.tsx
- frontend/src/components/ExportDrawer.tsx
- frontend/src/components/livePreview/ExportDiagnostics.tsx

测试：
- frontend/tests/unit/B1ExportFlow.test.tsx（8 项；真实 data router、筛选 hook、工作台；只替换渲染/请求边界）
- frontend/tests/unit/B1ExportDrawer.test.tsx（7 种门禁/预览状态，真实 Drawer DOM）
- frontend/tests/unit/ExportDiagnosticsDebug.test.tsx（原3项 + 只读模式1项）
- frontend/tests/unit/B0SystemCopy.test.tsx（保留5项；同步新标题及已删除 onGoExport prop）

原始日志：
- .tmp_B1/d-export-tsc.log
- .tmp_B1/d-export-tests.log
- .tmp_B1/d-export-initial.log（早期相关自测；最终以 d-export-tests 为准）

## 实测证据

在 frontend 使用安装的 TypeScript/Vitest CLI（经 Node execFile 运行；不依赖失效的 exec_command 环境）：

```text
node node_modules/typescript/bin/tsc --noEmit
exit 0
（无错误输出）

node node_modules/vitest/vitest.mjs run tests/unit/B1ExportFlow.test.tsx tests/unit/B1ExportDrawer.test.tsx tests/unit/B0SystemCopy.test.tsx tests/unit/ExportDiagnosticsDebug.test.tsx
exit 0
Test Files  4 passed (4)
Tests       24 passed (24)
```

行为证据：
1. StrictMode 全局 A=1，辅助 B=2；辅助只读、无 DOCX/导出提交，点预览一次只调用一次。回程第一次 getPaper 的所有调用均为2；抽屉为2；目标清空；消费字段消失。650ms 后 source=preview、paper_id=2、keyword=浮力、debug重复值及 marker 仍在。关闭后同URL replace不再次打开；切清单视图仍只有一个主导出按钮。
2. 非法意图 0/-2/2.5/字符串“2”/null：不开抽屉、不改变当前卷，清意图；650ms 后其它state marker保持。不存在999：所有getPaper均为999、当前卷保持999并有“指定试卷加载失败/试卷不存在”。
3. 抽屉锁定无图/已解锁/旧图/失败/内容阻断/请求中/环境失败七种状态：预览动作恰1、导出提交按钮恰1；可操作状态单点预览调用恰1。
4. 真实诊断 readOnly：结论/来源仍显示，button/dialog不挂载，fetch调用0；默认模式仍有候选入口。

补充反证：最初只捕获/消费意图、未启用 preserveLocation 时，延迟330ms验证其它state得到 **5 failed / 19 passed**，marker变undefined。已通知A重新冻结最小选项，D主改hook、D辅接入后扩到650ms并全部通过。初始瞬时通过不等于稳定保持。

## 验收标准（给独立 T/V）

- 自行重构A=全局卷、B=辅助指定卷，真实副本后端记录首次GET/预览请求必须为B；辅助页 export/revisions请求为0；回程query/state在650ms后仍在，清意图后刷新/关闭不重复打开。
- 真实挂载工作台排版/清单空态，点击同一试卷管理入口只出现一个全局管理dialog；原管理能力由 D 主独立迁移验证。
- 七种抽屉状态重新构造并实数可见动作；内容阻断、迟到票据和降级仍按现有hook判定。换卷不得保留前卷局部结果。
- 复核 readOnly 的DOM及网络，而非仅依据 prop名。默认工作台/抽屉仍可创建修订卷。
- 合并后全量 npm test、build、后端测试、对比度、冷首屏及浏览器视觉统一由D主/主控执行；本子任务不并行覆盖static。

## 我没做/做不到的

- 未改API/后端/公式/导出内核/冻结 bank文件，未改交付库，未实施B2–B5。
- 未独立运行build或覆盖static（D主统一持有构建锁）；未commit/push。
- 此处DOM测试使用请求边界替身；不宣称已做真实Word/WPS、NVDA、浏览器截图或副本导出网络验证。真实浏览器及全批门禁需合并验收。

## 遗留风险

- preserveLocation只在捕获回程意图的本次挂载锁存；reload后未知query仍按普通B0边界清理，known筛选/debug保留且不重复开抽屉。
- data router测试中jsdom AbortSignal与Node Request为不同realm；本测试去掉Request输入signal，仅用于无loader导航，不验证abort语义。最终无unhandled错误。
- 不声称辅助页可读取抽屉本次结果；useExportGate仍为组件局部作业状态。
