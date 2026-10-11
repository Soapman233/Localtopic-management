# 交接：导出P0核心中间阶段 / D

日期2026-10-10。此为分段独立检测入口，**非最终D交接，G2未通过**。P/A固定契约为依据；未声明全量回归或Office/UI验收通过。

## 我做了什么

1. 新增`bank/export_content.py`与`pipeline/answer_regions.py`：只读源SHA/scan坐标/FID身份/全部媒体核验，按XML token位置恢复分支与普通图实例；无qid特判。统一答案区识别供segment与审计。
2. `bank/paper.py`接入新选题前预检、只读模式投影和显式修订事务；原始snapshot_json复制到新卷，原卷不变。修订尚待故障注入全面验证。
3. Web固定端点/错误映射/同步与后台缓存守卫首版接入；CLI导出内容错误退出3；新布局消费有序块，图用可信extent限尺寸，局部keep/间距已调整。TAB仍待桥接PoC和OOXML停靠点最终补证。
4. 真实源审计paper3精确命中item113–120共8条/7qid，qid64和12重复组独立warning；seq13/22源标题warning。副本修订15条候选blocker为0；q7942三模式新导出学生1图、仅答案2图、教师2图，教师含1个OMML，均无桥接错误。

## 产出物

- `outputs/export-upgrade-20261010/development/old-controls.json`及四份`old-*.docx`：本轮旧路径新导出反证。旧q7942学生2图，paper3旧学生23题/11图。
- `new-controls.json`、`new-*-payload.json`与四份`new-*.docx`：首轮当前实现控制件。
- 可执行D控制脚本`.qa_export_upgrade_20261010/D/{old_exports,new_exports}.py`。**不要重跑new_exports：UI正在使用其副本，重跑会覆盖演示副本。**
- 隔离服务`http://127.0.0.1:8731`由`serve_copy.py`启动，所有写入到`.qa_export_upgrade_20261010/D/new-controls.db`；正式8720不改。T应使用自己的副本独立服务/端口。

## 验收标准（给T）

1. 独立从源与只读SQL验证paper3诊断、q7942三模式块/资源/实例；测试所有A冻结反例，不复用D源分支推理。
2. 自行副本验证revision原卷字节/各字段保护、排除列表错误、digest过期、异常事务回滚；不调用add_questions替代快照复制。
3. 独立验证Web同步/后台/旧cache/PNG/CLI守卫、源同mtime篡改、缺源/媒体改动/锁定内容改变和最新版差异。
4. 当前代码仍在推进，发现问题报主控与D；最终必须等待完整D交接与G2后重测。

## 我没做/做不到的

前端仍由D子角色实现，双端Office渲染正在执行；未完成全反例、缓存下载hash、最终元数据。中段回归318项出现35错误/1失败，主要旧单测假来源`p/sha1`被新准入正确拒绝，TAB预期也需同步；正在用真实临时源完善fixtures，不能把此回归称通过。

## 遗留风险

缓存并发变化、复杂源图/混合标记、fixture源真实性、TAB和长块实际视觉仍待验证。交付库SHA保持`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`；所有写入验收仅副本。
