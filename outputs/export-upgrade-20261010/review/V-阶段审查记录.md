# V 独立阶段审查记录（未到最终门禁）

本记录不是最终通过报告。正式D/G2及正式T交接尚未到齐；最终结论写入 `outputs/handoff/V-导出P0独立审查.md`。仅审查P/A已授权P0，不添加P1强制项。V未改生产实现、正式题库、原始DOCX或preprocess。

## 可复现缺陷及处置

1. **媒体缓存能把答案图冒充题干图（已独立复测修复）**：真实q7942源核验通过、学生投影仅image123；V独立缓存中预置image124字节到stemSHA前16位文件名，原`resolve_media`返回reason=None及答案图字节。D改为核对缓存完整SHA后，原探针返回正确stemSHA。修复前 `V-independent-probe-before-fixes.json`，复测 `V-independent-probe.json`。
2. **编号阅读材料被识别整卷答案，吞后续真题（已独立复测修复）**：V临时DOCX明确第1题阅读某同学答案节选，独立参考答案标题后是编号实验步骤，然后真第2题。旧源码保留第2题，修复前新源码截断至引言。D修后真实scan→segment重新保留第2题。旧切题另拆步骤为条目的既有问题未本次扩大修复。
3. **物理数值单位答案无诊断地再次成题（已独立复测v3修复）**：两题→参考答案→1．20N→2．10N，修复前4题、无answer_regions且答案片段ready；v3后2题，完整答案区报告，片段被blocker阻断。反证 `V-independent-probe-before-numeric-fix.json`。
4. **纯文字答案结构不确定缺少待复核报告（已独立复测修复）**：两道压强题→参考答案→1．增大→2．增大，修复前真实scan产4题、answer_regions=[]，匹配源的答案片段issues=[]/ready。最新版本保留原4条扫描切分，但产完整uncertain区报告，答案片段准入阻断；未猜文字必属答案或强行截断。证据 `V-independent-probe.json::plain_answer_uncertainty`，前态 `V-independent-probe-before-v4.json`。
5. **锁定范围跨答案标题仍ready（已独立复测修复）**：从当前真实源ZIP独立遍历XML，qid5541范围119–170含scan125整卷答案标题；qid56范围63–64含scan64标题。修复前两题issues=[]/ready，最新均source_structure_unsupported/blocked；它们是混合范围，不能默认排除整题丢掉真题内容。证据 `V-cross-boundary-probe.json`及`V-cross-boundary-probe-before-fix.json`。**这两个qid均不是当前paper3清单，不能由范围推断映射paper3条目。**
6. **阅读豁免误放真实卷尾答案（已独立复测修复）**：最后真题含“阅读材料”，后面真正参考答案及A/B、20N/10N、增大/减小三类答案，曾全部ready。最新A/B及数值单位confirmed/block，纯文字uncertain/block；原编号阅读资料后续真题仍保留且无疑点区。证据 `V-reading-tail-probe.json`、`V-reading-tail-probe-before-fix.json`，三组与原probe同批边界源码SHA `73c83986c661ed9a0d0895288b287c1e3ce9e0381714177a7c57724e462fdd87`，guard v5/layout v3。

## 已独立验证的边界

- paper3精确阻断113–120，重复qid64与12分别显示；未将8条说成8qid。
- 新鲜连接revision不提交，caller.rollback使三张组卷表完整恢复；复制保留原始snapshot_json字符串及score/qid/version、全section和空section、连续seq；原卷完整行不变。末次诊断注入失败、全删/重复/外卷/stale均零残留。
- blocked+缺Office/SDK两入口仍40904；提交后同模式仅改score，preview/export执行均40905；旧PNG依据变化40905。
- 真旧泄漏DOCX配自洽hash/完整PNG/meta放在当前key目录，旧v1缓存仍is_cached=false、PNG路由40905，render走重新生成（V哨兵证明，不占用Office）。
- 手写源XML同段marker前后、同资源跨stem/answer及同branch重复实例，三模式期望1/3/4图均一致，实例ID独立；浮动图被阻断。
- 锁定LaTeX哨兵原样保留，不被源转换值覆盖；删/改锁定text、media、source都被阻断。
- 原库只读SQL已重新留存paper3真实清单：seq3=item112/qid4、seq4=item108/qid7944，无qid5541；默认8排除后的15候选仍0 blocker。主控与V曾短暂转述的“跨界qid5541映射原卷/item112/14候选”推断已撤回，没有以此改造控制件或当验收事实。
- TestClient(False)与实际TCP HTTP独立对照：preview/export=HTTP409+code40904，stale修订=HTTP409+40905，非法全删修订=HTTP400+40007，全部一致；短时隔离服务已关闭。说明客户端设置未把错误JSON或状态掩盖，证据 `V-http-error-probe.json/log`。
- 原145源码清单中当前30处修改均属A授权模块/测试；冻结db/importer/query/labels未改。最终资产头与manifest尚待D收尾后复核。

## 实测与限制

V阶段初后端318项，317通过、1skip，41.485秒；`.qa_export_upgrade_20261010/V-baseline-tests-native.log`。沙箱解释器定位失败日志不计通过。所有V探针正式库SHA均为 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`。

V未运行本轮Office/UI，也未把D/T截图或计数当作V实测；双端页图、公式内部编辑持久化、浏览器真实闭环及最后全量回归须在D/T正式交接后审查证据并与当前源码revision对齐。旧v1缓存试验使用真实旧DOCX，PNG是哨兵，仅证明入口失效，不证明视觉正确。

可重跑V独立探针位于 `.qa_export_upgrade_20261010/V/{independent_probe,revision_cache_probe,instance_probe,cross_boundary_probe,reading_tail_probe,http_error_probe}.py`。只写V隔离目录、review证据或内存/副本库。
