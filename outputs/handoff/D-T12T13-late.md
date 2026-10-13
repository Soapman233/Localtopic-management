# 交接：T12/T13 G-e / D子角色

## 我做了什么
- 新增 frontend/scripts/gate-late.mjs：独立CLI固定按脚本位置解析frontend，通过exit0、行为违规exit1、输入/依赖/加载异常exit2；打印G-e、18项核心检查、阈值、生产模块位置与实际请求目标。
- 新增 frontend/tests/design-gates/late.test.tsx：加载真实KnowledgeReviewPage与useExportGate，不mock业务函数或门禁状态；用fetch传输边界截获全部API。A预检挂起→切B→完成B→释放A→确认，检查弹窗目标、影响数量和实际POST；真实Hook按钮交互分别切卷与切答案模式，先确认迟到旧请求未解锁/显示旧图，再完成当前预览并核实最终export URL/body。
- 新增 late.config.ts：测试专用loader从临时生产模块副本取源码，保留原生产模块id与相对导入。--probe late只移除KnowledgeReviewPage第一处请求代次守卫；可选--probe-target export只移除useExportGate预览onSuccess的身份守卫。实际替换1处并输出前后代码，finally删除临时副本；生产pages/hooks从未修改。
- 新增 late-browser.cjs、late-browser-export.cjs，在8911副本真实KnowledgeReview与真实ExportDrawer走查。真实summary/export-data读请求继续，所有非GET写请求浏览器route截获。未修改库、settings、package.json/common或生产src。

## 产出物
- frontend/scripts/gate-late.mjs
- frontend/tests/design-gates/late.config.ts
- frontend/tests/design-gates/late.test.tsx
- frontend/tests/design-gates/late-browser.cjs
- frontend/tests/design-gates/late-browser-export.cjs
- .tmp_t12t13/d-late/{positive,probe-knowledge,restore-knowledge,probe-export,restore-export,invalid,browser,browser-export}.log（本地证据，不提交）
- outputs/handoff/D-T12T13-late.md

## G2实测证据
所有命令在frontend执行；入口无需build，测试复制生产源码并经Vitest加载。

| 命令 | exit | 实际结果 |
| --- | --- | --- |
| node scripts/gate-late.mjs | 0 | 3条真实交互全过；弹窗音调7条，POST音调/确认/confirm=true；切卷最终POST /api/papers/2/export、学生版；切模式最终POST /api/papers/1/export、答案解析版；formats=[docx]、template=考试 |
| node scripts/gate-late.mjs --probe late | 1 | 单点移除seq守卫；A迟到覆盖B弹窗成太阳能13条，并真正发出POST label_name=太阳能/确认/confirm=true（被fetch截获）；同一断言失败 |
| node scripts/gate-late.mjs（撤回） | 0 | 恢复音调7条与音调实际写目标，3条全过 |
| node scripts/gate-late.mjs --probe late --probe-target export | 1 | 单点移除Hook onSuccess接受守卫；切卷与切模式均错误显示旧 /api/preview/1-学生版/page_1.png，同一真实状态断言失败 |
| node scripts/gate-late.mjs（撤回） | 0 | 切卷/模式迟到后unlocked=false、pages=[]、真实按钮disabled；完成当前预览后写当前目标 |
| node scripts/gate-late.mjs --invalid | 2 | 输入不合法，明确打印用法与无法运行理由 |
| node tests/design-gates/late-browser.cjs | 0 | 8911真实标签重力，弹窗1,849条；最终POST /api/labels/decision label_name=重力、decision=确认、confirm=true；2预检+1写全部截获 |
| node tests/design-gates/late-browser-export.cjs | 0 | 8911真实抽屉学生版挂起→切答案解析版→释放学生版，当前导出disabled=true、图片0；完成当前答案解析版预览后最终POST /api/papers/1/export body.answer_mode=答案解析版/template=考试/formats=[docx]；2预览+1导出全部截获 |
| node node_modules/typescript/bin/tsc --noEmit | 0 | 无类型错误 |

导出反证如实限制：仅移除Hook守卫不足以突破uiStore第二层revision/digest检查，因此没有错误解锁；观测到的是旧图被错误接纳。该反证确实失败，不能描述为“已证明错误export会发出”。知识点反证已捕获真实错误写目标。

实测末尾交付库完整SHA：6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6，与冻结基线一致。

## 验收标准（给主D与独立T）
1. 主D在package.json把gate:late连接为node scripts/gate-late.mjs，再以npm.cmd run gate:late及npm.cmd run gate:late -- --probe late复跑，确保npm继承0/1/2。
2. T只读本报告+源码，独立构造另一延迟顺序（如A→B→A）、不同标签/不同模式，不复用D的内部解释；真实API写请求必须全部截获或使用副本。
3. 比对输出中的实际dialog、POST body与预检数量；不能只断言store布尔。导出最终URL/body必须是当前paper_id/answer_mode，迟到不得显示旧图或解锁新目标。
4. 真实8911页面可重复执行两条late-browser命令；依赖已安装Playwright绝对路径，浏览器不向交付服务写入。生产模块副本每次退出自动移除，不引入bundle。
5. 总体全量前后端测试、build、预算与git commit由主D/主控执行，本子角色不提交。

## 我没做/做不到的
- 本角色是开发自测，不是独立T，不宣称G3通过。
- 未接package.json、未跑总体npm test/build/后端；父D负责统一集成。未测试真实editor_sdk或导出文件品质，export请求与预览回包均在传输边界截获。
- 浏览器已走查真实知识点与真实抽屉答案模式；切卷迟到通过真实Hook组件DOM交互验证，未另走浏览器切卷。

## 遗留风险
- 生产身份守卫将来改形状时，反证CLI会找不到needle并exit2，须更新可审阅的单点变换；不能静默略过。
- 浏览器副本试卷内容若出现阻断，export-data.export_allowed断言失败，不能把未生成预览算通过。
- supplementary browser脚本不是统一gate主体；统一0/1/2契约由gate-late.mjs承担。
