# 交接：DOCX对比分析复核 / V

## 结论

**通过本轮分析方案交付审查，无阻塞性事实错误或夸大。** 两份R交接、A方案及《对比分析与实现路线》将样本事实、官方披露、实现推断和待实施方案分开。路线具备工程可实施性，但尚未PoC，不能称已经达到参考成品效果；本轮通过不构成冻结文件解冻、开发授权或双端编辑验收。

本轮为R→A→V分析流程，G1保持现有契约不变；未进入D实现，因此G2开发证据门槛不适用。V从正式文档与原始ZIP、只读SQL、源DOCX/既有预处理记录重新验证，未用R探针生成结论，满足本轮G3独立性要求。

## 我做了什么

1. 阅读AGENTS、两份R交接、A交接和用户报告；按documents/read_review及pdf技能检查结构证据与关键页。本次收尾基线测试318项，317通过、1 skip，30.486秒。
2. 自查并重跑V独立探针 `outputs/docx-compare-20261010/verification/v_independent_probe.py`：直接用标准库ZIP/XML、SQLite URI `mode=ro`，读取两份原DOCX、当前paper3锁定快照、8个相关qid的原源DOCX和既有scan/questions.json；未导入R实现、未重跑预处理。
3. 原尺寸查看当前Word渲染的系统p4/p7、参考p2/p11/p20，检查答案片段、接线答案图、选项图定位、独立答案首页及尾页留白；直接读取PDF确认7/20页。本次为关键页复查，未声称重新目视全27页。
4. 重读 `pipeline/segment.py:166` 起的切题循环、`bank/paper.py:443` 的媒体快照及 `bank/export.py:1226` 起的题干→全部图→答案→解析顺序，与发现相符；复查三份官方正文，见下文。
5. 比对 `.qa_docx_compare_20261010/baseline-files.json` 的8项库/输入/冻结源码hash，全部一致；阶段末再次全量测试318项，317通过、1 skip，28.426秒，exit 0。

## 独立实测与通过项

|事项|V独立结果与判定|
|---|---|
|可比性|系统23个连续编号、7页；参考题卷30题、合卷20页，p11为答案第1页、p20为答案第10页。内容与模式不同，不可按20/7页或文件体积直接判密度/质量。报告已限定。|
|公式|系统ZIP 0 OMML/0 OLE；23快照stem公式引用0、全文7处引用均在被过滤部分。参考24个Equation.DSMT4 OLE和1个OMML，题卷3 OLE。系统无公式不能称转换失败；本样本也不能证明OMML内部可编辑。|
|媒体口径|参考普通DrawingML inline 46实例、41资源；OLE预览24实例、19资源；另有二维码，包内媒体61。普通题图与公式预览不混计。系统11普通图实例；探针媒体总数12包含其他包内资产，不等于12道题图。|
|答案片段|seq5–12共8条、7个独立qid；qid5542/5543/5544 start=171/177/180，均在源scan参考答案index125后；qid61/62/63/64 start=78/82/83/84，均在参考答案index64后。既有切题与当前库/快照已是答案条目，不能归咎导出器删掉完整题干。|
|学生版答案图|qid7942源body p353为image123，p359文字为【答案】(1)、含image124。源image124与系统image11 SHA同为 `10229ba2c74cf9879491c30c7d5791befe6106dabbc856e16f219e082ea1e7ce`；系统p7第二图确为已接线答案，泄漏成立。仅证实该样本一题一图。|
|重复与编号|SQL清单qid64和qid12各两次；seq连续1..23，所有条目section_id为NULL。重复来自清单，未见自动编号复制题目的证据。系统p4的“四、实验题”为题干残留，与卷有效分组不同。|
|参考缺陷|参考p2第9题仅A选项留在页底，后项未同页；p20答案正文仅约两行。参考优势不能扩大为其分页完美，A已保留短题保护与长题合法续排。|

完整重跑证据为 `verification/V-independent-zip-sql.json`、`V-resumed-independent-probe.log`。所读源DOCX实际SHA与库来源SHA一致；没有将scan index与body XPath段号混作一种坐标。

## 公开证据与方案审查

本次重新读取[学科网官方历史PDF](https://zxxkstatic.zxxk.com/service/file/%E5%AD%A6%E7%A7%91%E7%BD%91%E8%B5%84%E6%BA%90%E5%86%85%E5%AE%B9%E4%BB%8B%E7%BB%8D.pdf)第10页，可支持校审、分类打标、内容优化、CMS主数据流程；不能推出当前下载枚举或后台生成栈。[python-docx官方图片说明](https://python-docx.readthedocs.io/en/latest/user/shapes.html)支持高级API inline图片能力边界；[Microsoft Math](https://learn.microsoft.com/en-us/office/math/)支持OMML为Office文档数学格式。它们支持本项目候选路线，不证明学科网采用这些库。R/A与用户报告没有把Aspose、服务端语言或下载弹窗枚举写成已确认事实。

A优先修内容边界和答案媒体隔离，再恢复有序富文本、图实例/分支/尺寸、表格、选项及模板，最后评价引擎替换，顺序合理。旧图片集合缺锚点，必须回源并保留人工复核；无法靠字号或导出正则可靠补齐。方案对历史快照、已修正公式、源SHA、增量旁路、模板revision及缓存指纹均设边界；旧renderer回退不得把已知答案泄漏当安全通过，且保留新版本资料，回退原则可接受。

**保留条件**：概念IR仍待冻结字段/错误/确认流程，尺寸阈值仍为拟议目标，选项实际测量与复杂表格/浮动图兼容仍需隔离PoC。这里判断的是方案可实施，不是证明所有节点或双端分页已达标。

## 产出物

- `outputs/handoff/V-DOCX对比分析复核.md`：本正式交接。
- `outputs/docx-compare-20261010/verification/V-resumed-baseline-tests.log`、`V-closure-tests.log`：本次基线与末测。
- `outputs/docx-compare-20261010/verification/V-independent-zip-sql.json`、`V-resumed-independent-probe.log`：直接ZIP/SQL/源链重跑结果。
- `outputs/docx-compare-20261010/verification/V-resumed-protected-files.json`：8项基线文件hash一致。

交付库当前SHA仍为 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`；两输入仍为系统 `abefa9fdb4fd505dd7f0d35804dd69ec38bcda8cf4efa759a0fa65ff6b237087`、参考 `bb15d2c287bbb7d9f9e3213019e44242a250afeba79dd3ac22a153d48f64a939`。没有按AGENTS历史SHA回滚用户本轮使用状态。

## 验收标准（给主控与后续角色）

1. 本轮可交付用户报告；对外保留“两卷不同内容/模式”“样本一题泄漏”“无公式不是转换失败”“路线未实施”“内部栈未确认”限定。
2. 可用bundle Python直接运行V探针复核，要求23条、重复qid64/12、stem引用0/full7、参考24 OLE/1 OMML、普通46实例/41资源及答案图SHA链一致；全量测试日志须为318项、1 skip、OK。
3. 后续具体实施先取得冻结文件具体授权并由A冻结新增契约；副本上用当前代码新导出同内容基准，独立T/V重新造反例，按A验收逐项验证。未做内部改字符→保存→重开，不得宣布双端可编辑通过。

## 我没做/做不到的

未实施、未修原样本、未新导出修复产物，未改生产代码/契约/原DOCX/交付库，未重跑preprocess。未重新Word渲染或WPS渲染两样本、未做公式编辑保存验证、未重新全页目视；本次使用已记录只读Word16.0渲染并抽查关键页。未登录组卷网或确认受限下载设置，未估计全库答案误切/图片泄漏规模。

## 遗留风险

当前样本内容与媒体隔离问题仍存在，回归通过只证明研究没有破坏既有基线。历史结构修复依赖源文件及坐标对齐，唯一候选也可能错；未知归属不能静默归stem或丢弃。Word/WPS真实分页、复杂公式与已修正版保持、迁移原子性及缓存失效，需要后续实测，文档方案不能代替。
