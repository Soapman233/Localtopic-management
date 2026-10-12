# 交接：B3 调研 / R

## 我做了什么
- 完整读取 AGENTS.md 与 deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md，范围限定 B3；不改源码。
- 读 PaperBuilderPage.tsx:181-188、351-445、594-618：1366 双栏已存在，筛选首次仍展开；常驻 Alert 394 存在；统一试卷管理已接好；1199/1200 断点已正确。
- 读 ExportPage.tsx:46-52、137-144、166、203、306：B1 已保留指定卷与回程 state，readOnly 已接入，预览动作已唯一；底部实现说明仍在。
- 读 ExportDrawer.tsx:232-241、319-335：当前仅一个 regen-button，空态无 action。重复预览动作经核实不成立，无需人为重做去重。
- 用新浏览器上下文 + 8799 副本服务完成改前截图、尺寸、真实 A=1/B=3 回程；重建当前源码后确认入口未变。

## 产出物
- .tmp_verify/b3-before/probe.json、probe-pre-return.json、export-only.json（机器量值）
- .tmp_verify/b3-before/builder-1366-before.png、export-1366-before.png、drawer-before.png
- .tmp_verify/b3-before/probe.mjs、export-only.mjs、server.py、server.log、build.log
- outputs/handoff/R-B3.md

## 实测事实与反证
- 主控基线：Ran 436 tests in 57.085s / OK (skipped=1)；原库 sha256 6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。
- 服务 8799，PID 50252，health.db 指向 .tmp_verify/b3-before/bank.db；本地与服务入口都 assets/index-CRapoS36.js；tSC exit=0，当前源码 Vite build exit=0（9.80s）后入口相同。
- Alert 改前 boundingRect：x=877.5625、y=314.03125、width=464.4375、height=61.5；确实占位。
- 1366 左题卡宽 337.5625；手动收筛选后 601.5625；右排版切换 x=877.5625，可见；scrollWidth=clientWidth=1366；.lp-measure transform=none。
- 1199：试卷面板按钮 1，内联排版按钮 0；打开 Drawer role=dialog 1，关闭后 0。1200：试卷面板按钮 0，内联排版按钮 1。
- 当前卷 A=1 访问 export?paper_id=3；返回 builder.paperId=3、exportOpen=true、itemCount=23，标题“导出 · 未命名试卷”；请求仅 papers/3 和其 export-data，无 papers/1。错选全局卷的反证经核实不成立，B1 已修复。
- 独立 export-only 新上下文：可访问按钮“回到组卷工作台”“生成预览”；PreviewIcon=1；底部实现说明=1；回程抽屉预览动作=1。导出页和抽屉“两动作”均经核实不成立。
- 首屏只统计默认 /builder 脚本响应 body 字节，已复制冻结数组避免后续导航污染：15 请求 / 1,066,203 bytes，入口 30,790 bytes。当前 fresh 构建实测比用户参考 1,064,929 多 1,274 bytes，不能报告成参考值；D 应达到用户上限。

## 验收标准（给 A/D/T）
- 保留现有 API 路径、字段和错误码；readOnly 真正不暴露 revision mutation；useExportGate 唯一共享门禁。
- 当前构建独立端口比对入口后：1366 双栏、scrollWidth<=clientWidth，紧凑首次筛选收起且手动切换题卡宽有真实差；1199 Drawer 可开关、1200 内联。
- 检查通过紧凑状态；阻断“需处理 N 项”按钮展开原诊断；.lp-measure 所有祖先无 scale/动画；纸面 overflow 支持滚动。
- 副本制造 stale，更新到最新可触达；逐项组卷写操作确认导出重锁；键盘排序提交同大题，跨大题不提交。
- 新上下文 A=1 → export?paper_id=3 → 回程卷=3，抽屉title/request一致；正常预览动作 1、空态互斥、一次点击一次请求。
- 跑 tsc、npm test、npm run build、后端全量；65/65 对比度、h1 9/9、入口<=30790、首屏<=1064929/15请求。

## 我没做/做不到的
- 未改源码、未提交、未执行写入验证；未运行像素预览生成或历史产物对照。
- 未完成改后验收、stale、逐写操作门禁、键盘排序及9页标题检查，交 D/T 独立执行。
- 当前调研 build 直接执行 tsc 和 Vite；完整 npm run build（含contrast/prune）仍需 D 执行。

## 大题能力补充调查
- PaperPanel.tsx groupItems:88 过滤空大题，刚新增的大题未必立即可见；约284节标题仅有改名/删除；源码无 actions.moveSection 的调用入口。属于本轮保留大题操作的真实缺口，建议使用已有 moveSection API 补上下移入口并保留空大题，不改API。

## 遗留风险
- 用户参考首屏总量与当前 fresh 构建不一致，禁止隐瞒。默认 builder 未含 ExportPage 请求，完整15项在 probe.json。
- 初始综合探针横跨1199 Drawer后导航造成可访问按钮读数异常，故Export预览按钮判定只用 export-only.json 新上下文；综合的回程请求与尺寸仍有效。
