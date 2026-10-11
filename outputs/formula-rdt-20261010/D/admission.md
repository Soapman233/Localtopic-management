# D逐条修复准入证据

本轮准入13条：rq57、62、64、68、73、86、87、91、92、93、94、143、161，共9题。2026-10-10主控已复核G2并允许此子集正式写库。

- 当前源DOCX、Equation Native与WMF指纹逐13核对，与研究指纹相同；实际修复LaTeX逐条见 `parsed-candidates.json`。
- `katex.json`：13条均使用前端同版本KaTeX，`throwOnError:true,strict:error`，无降级。
- `candidate-export.docx/pdf`及两页PNG为本轮副本组卷的新产物。逐式顺序与下表一致。D已与当前源WMF经Word保真展示的 `../word-source-previews.pdf` 逐字及上下标对照。
- `semantic-check.json`：逐13文本与上下标归属，含U主体/L或R下标/2上标；prime归属U、F、V、m、p；rq143/161只有左括号，未补右括号。
- `office-edit.json`（16:24第二轮）：Word、WPS各13条内部字符均EDITED，另存、重开后13条均持久化，双端PASS。每条math index如下。
- 首轮上标先行写法可编辑但桥接语义错误，拒绝准入。保留 `rejected-script-order.docx/pdf` 与 `rejected-script-order-edit.json`；第二轮使用数学等价的嵌套分组 `{U_L}^{2}` / `{V_水}^{\prime}`，既有冻结导出代码未改。

|rq|formula_id|question_id|math index|源保真PDF页|结果|
|---|---|---|---|---|---|
|57|332|463|1|1|PASS|
|62|337|463|2|1|PASS|
|64|339|463|3|1|PASS|
|68|343|463|4|1|PASS|
|73|561|564|5|1|PASS|
|86|1397|2164|6|2|PASS|
|87|4464|2625|7|2|PASS|
|91|6439|3662|8|3|PASS|
|92|6440|3662|9|3|PASS|
|93|6901|3691|10|3|PASS|
|94|7492|3778|11|3|PASS|
|143|9864|4272|12|4|PASS|
|161|10039|4326|13|4|PASS|

副本演练 `rehearsal.json`：首次13公式/9题，重复0/0且零写入；前置状态冲突与中途新版本插入故障均整批回滚；原OK17626行全部字段相同，原试卷全部条目及锁定快照相同。`backup.json`：新备份 `verify_backup(original,backup)` 合格，完整SHA与基线相同。

本证据只准入13条；剩132条保持未处理。Pillow/GDI PNG可能字距或重叠失真，不能凭PNG存在判断内容。原始WMF保留无损源信息；老师须在Word打开来源DOCX或使用本轮WMF保真对照后人工定稿，不能猜公式或为清零标记resolved。
