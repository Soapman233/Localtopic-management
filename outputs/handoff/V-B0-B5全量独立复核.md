# B0–B5 独立复核（V）

**TL;DR：🔴 不通过。** 前三项：批量写错标签、DOCX降级被锁、reduce残留工具条。前两项既有，第三项B5新增。

路径前缀 frontend/src/；前三项为**实测复现**。

| 文件:行号 | 严重度 | 问题 | 复现方式 | 建议 |
|---|---|---|---|---|
| pages/KnowledgeReviewPage.tsx:519 | 🔴 | 确认写错标签 | 延迟太阳能预检后切音调；弹窗太阳能2条，SQL实改音调4条 | 绑定目标、拒绝迟到 |
| hooks/useExportGate.ts:307 | 🔴 | Office失败无降级入口 | 卷1作业done、pages空、WPS警告；DOCX已生成但无结构确认 | 识别无页环境失败 |
| components/AnimatedList.tsx:17 | 🟠 | 取消动画未清移除节点 | 勾选→清空→立即reduce；0勾选仍显示1，再选叠条 | 取消时完成移除清理 |
| components/AnimatedList.tsx:42 | 🟡 | 卸载只disable | 找题↔设置3轮，未断开观察器2→4→6；内存风险为**代码推断** | 卸载时destroy |

实测通过：9页单h1、维护h1/h2/h3、地标与可访问语义、Tab隔离、收诊断仍阻断、加题重锁、97题文件预检/取消零写、默认批量不覆盖决定。难度动态变50%，占位值覆盖0；旧卷原公式/图SHA不变，stale可更新；A→辅助B→回程B。reduce冷启动无动画。

**未推翻旧否定。** 历史三状态中文/非解析数组/Top12/路径仅详情/登录非必错；32936为关联数。错卷/重复预览/高级缺失/误删导入仍不成立。

**基线**：后端436（435通过/1 skip）；前端26 node:test+340 vitest；对比度77；tsc/build通过。入口23388B；首屏15个JS/1058331B，AutoAnimate未进首屏。库SHA前后均 6905955734953c6cdffa4c65…。

**环境**：8861；index-yr-YHVrm.js，HTML与新构建一致；库 D:/Open-source project/Localtopic-management/.tmp_review_B0_B5/review.db，初始64815104B。

**未验证**：像素成功闭环、Word/WPS双端编辑、NVDA、线上真实登录。登录延迟/拒绝加载已实测。

**文件改动**：业务源码0；仅报告及忽略的QA/构建产物；未提交或推送。证据见 .tmp_review_B0_B5/independent-evidence.json。
