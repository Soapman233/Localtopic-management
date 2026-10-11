---
title: "复核公式分类与修复索引"
description: "本轮研究、修复及验证证据索引与当前真实数量。"
keywords: ["公式", "验证"]
author: "待补充"
created: "2026-10-10T16:35:19.012677+08:00"
modified: "2026-10-10T17:03:28.854785+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# 复核公式分类与修复 · 2026-10-10

本轮实质修复13条公式、9题各新增1版，已通过T独立G3验收；历史51条加本轮13条，共64条已处理，剩132条仍待人工。验收结论只覆盖本轮13条，不能扩大到任意v5或全部132条内容。

|阶段|交接与证据|状态|
|---|---|---|
|R|[分类交接](../handoff/R-复核公式分类.md)、[145条清单](inventory.json)、[13条件候选](candidates.json)|完成；候选不是写库批准|
|A/G1|[冻结交接](../handoff/A-复核公式契约冻结.md)|接口/schema不变|
|D/G2|[修复交接](../handoff/D-复核公式修复.md)、[逐条准入](D/admission.md)|13条通过实测并已单事务写入|
|T/G3|[独立验证交接](../handoff/T-复核公式验证.md)|完成：本轮13条/9题通过，132条保持待处理|

- [当前新导出DOCX](D/candidate-export.docx) / [PDF](D/candidate-export.pdf)，[逐条语义核查](D/semantic-check.json)、[Word/WPS逐式内部编辑保存重开](D/office-edit.json)、[KaTeX严格渲染](D/katex.json)。
- [首轮被拒绝的上下标错序反例](D/rejected-script-order.pdf)：可编辑不等于内容正确；第二轮用相同语义的嵌套上下标分组解决，未改冻结导出代码。
- [正式备份验证](D/backup.json)、[副本幂等/回滚](D/rehearsal.json)、[正式全表差异审计](D/final-data-audit.json)、[硬超时与127条v3安全预判](D/safety.json)。
- [132条人工项路径索引](D/manual-source-index.md) / [Word保真对照册](D/manual-source-previews.docx) / [PDF](D/manual-source-previews.pdf)。原始WMF逐条保留当前源字节，源hash见[清单](D/manual-source-manifest.json)。现有网页PNG可能字距失真，不可仅凭PNG确认内容；对照册只抽看代表页，未逐字验收全部132条。
- T独立证据：[重新抽取的当前源](T/sources.json)、[源WMF保真册](T/T-source.pdf)、[独立新导出](T/T-new-export.docx) / [PDF](T/T-new-export.pdf)、[逐式双端内部编辑保存重开](T/T-office-edits.json)、[CLI双端验证](T/cli-verify.json)、[KaTeX严格渲染](T/T-katex.json)。
- T独立反证与数据：[48项边界](T/boundaries.json)、[关闭兼容的反证](T/counterfactual.json)、[缺END及追加边界探针](T/extra.json)、[20表完整行审计及9题新旧快照SQL核对](T/audit.json)、[132人工项原始WMF/关联](T/manual.json)。T独立全量结束318项（317通过、1跳过），30.804秒；前端11项、tsc、build（6.77秒）通过。

交付库SHA256：`3e69ee68bae81c4d4a4dd30a1eaddcd69f87be4df80661e19e6e9ee3f945553c`。正式备份：`outputs/bank.backup-20261010-162607-rdt.db`，其SHA256为写前基线 `2d1b3694aadae3355256bc7849f5b634ff1a7e78e873e5509d2536e250259601`，`verify_backup(original,backup)` 合格。

剩余132条：真实v3 127条、OLE/源图冲突3条（rq74/75/76）、未确认标记1条（rq90）、源空对象1条（rq85）。状态口径为UNSUPPORTED130、EMPTY2、FAIL0，不能以状态替代原因诊断。未自动resolve这些项目；未移植v3解析器，未改API/schema或冻结文件，未刷新历史试卷快照。

D最终回归：正式apply后318项（317通过、1 skip）/28.948秒/OK；前端11项通过，tsc及生产build成功。人工保真对照册第25页为尾部空白，代表内容证据为第1/24页；不将空白页作为可读证据。

T确认的非阻塞限制：完整Native头长/声明长度正确但LINE缺结束END的最小v5，普通和strict均仍可返回OK/x；strict OK不能代替流完整性或逐项语义准入，本轮13条真实源验证不受影响。现有PNG仍可能严重字距失真，须用Word对照当前源。T隔离卷新导出13式均在第一页，第二页仅页脚；此9题隔离输入的尾空页作为排版观察保留，不推成所有试卷缺陷，也未改冻结导出器。具体hex、命令与影响边界见[T正式交接](../handoff/T-复核公式验证.md)。

T审计另明确：9新版本之外，8条旧版本只补原NULL snapshot_json及NULL change_source=import；旧非空快照不覆盖，旧文本/散列/时间等字段原样，9题全部新旧快照经独立SQL逐字段核对通过。

最终文档/元数据收尾回归：318项（317通过、1跳过）/29.773秒/OK，见[收尾日志](closure-tests.log)。最终资产清单148项、无缺失或重复，当前静态入口及其实际JS/CSS的尺寸与mtime同步；见[收尾审计](closure-audit.json)。T阶段清单141项为当时事实，T交接保持原文。
