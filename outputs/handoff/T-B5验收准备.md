# 交接：B5 独立验收准备 / T

## 我做了什么

1. 完整读取 AGENTS.md、deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md，逐页范围以方案:283–680、十八项与结论修正:682–721、动效和视觉要求:723–840为准；读取 R-B5调查.md 与 A-B5契约冻结.md。
2. 在 .tmp_verify/redesign-B5-T/independent-plan.md:1 建立独立矩阵，覆盖阶段一B5、阶段二B0–B5；没有借用D测试结果当独立证据。
3. 在 .tmp_verify/redesign-B5-T/serve.py:1 准备8816副本服务；固定副本数据库/导出目录与独立static快照，尚未启动。
4. 在 .tmp_verify/redesign-B5-T/cold.mjs:1 准备fresh1366×768、空storage、blockSW、CDP禁cache的真实JS响应raw字节探针；先比服务index指纹与health副本路径，再按23569/1058746/15验收，尚未运行。
5. 在 .tmp_verify/redesign-B5-T/search-harness.tsx:1 准备挂载真实SearchPage与独立QueryClient的harness；通过同查询稳定结果变更重构动画反例，尚未编译/运行。计划以原生Element.animate记录、getAnimations与DOM结果交叉验证。

## 产出物

- outputs/handoff/T-B5验收准备.md（本文；仅准备，非G3结论）
- .tmp_verify/redesign-B5-T/independent-plan.md
- .tmp_verify/redesign-B5-T/serve.py
- .tmp_verify/redesign-B5-T/cold.mjs
- .tmp_verify/redesign-B5-T/search-harness.tsx

## 验收标准（给下一阶段）

- 仅主控明确G2通过后启动正式验收；新构建与static快照确保不会把旧产物当现行结果。服务先核数据库绝对副本路径、文件大小、SQL题数，再进行写入类验证。
- 阶段一产出 T-B5.md：冷网络预算，首载/翻页/同数量重合查询替换禁动、小增删/批量条实动画，reduce初始/动态/legacy/无API，导航双端测量禁区/语义/焦点/连点，真实祖先computedStyle与视觉证据。
- 阶段二产出 T-B0-B5全量复核.md：方案§3/§4逐条矩阵，独立反证迟到/stale/内容阻断/envfail、14项重锁、A访问B回程、快照图/公式锁定、标题、真实高级Tab分离PUT、来源AB预检取消副本影响、知识点pending排序/确认及统计完整rows分母。
- 实测、代码推断、未能验证分别记录；问题标真实行号、严重度、复现与建议。历史报告数字、通过的实现单测均不替代本T证据。

## 我没做/做不到的

- 主控尚未宣布G2通过，因此没有启动服务、重建产物、浏览器正式验收或阶段二全量复核；没有G3通过/不通过结论。
- 主控2026-10-13通知AutoAnimate依赖下载遇网络/权限阻断，并等待已有官方包路径。此事实仅来自主控消息，T未独立重试依赖获取，也未扩大为其他环境故障。
- 未改生产实现、库、设置、长期测试、视觉基线、陌生工作区文件；未commit/push。
- 未做NVDA、跨浏览器、物理设备、Word/WPS内部公式编辑；当前计划没有触及导出内核。

## 遗留风险

- 阶段一与阶段二仍未验收，准备脚本也没有实跑，不能宣称其已经可复现通过。
- 共享Node kernel曾被工具timeout回收；后续长job应使用child脚本后台写日志、短poll，变量t_前缀且每次稳健恢复，不reset共享kernel。
- B4历史视觉截图不完整；正式T需要自己等待内容/字体/图片就绪采集并逐图与热力图核对，不能直接接受旧基线。
