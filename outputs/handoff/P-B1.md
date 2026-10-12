# 交接：B1 需求冻结 / P

## 我做了什么

- 完整读取 AGENTS.md，核对门禁（46 行）、独立性交接（59 行）、数据安全（336 行）、版本控制（360 行）。
- 完整读取 deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md，核对顺序（18 行）、信息架构（75、122、190 行）、导出入口（224 行）、试卷管理（260 行）、#3/#15（682 行起）、回滚（784 行起）。
- 以用户 B1-1 至 B1-7 为范围依据：方案原 B3 的导出辅助页只读化和动作去重，已被用户 B1-6 明确纳入本轮，必须完成；B2–B5 布局/业务/动效改版仍不做。
- 当前验收基准由本轮用户指定：B0=a72d196、入口 31,130 bytes、首屏 1,068,908 bytes / 16 JS 请求、前端 26 node:test + 261 vitest、后端 436。方案 30,800/225 与 AGENTS 历史 387 不替代当前基准；结果仍以实测输出为准。

## 产出物

- outputs/handoff/P-B1.md：A 的需求冻结与可执行验收依据。本角色不写代码，不声称任何门禁已通过。

## 验收标准（给下一个角色）

### 范围与完成定义

1. 先路由/导航解耦，再缩减 NAV_ITEMS。逻辑导航四项：组卷工作台、找题、数据维护、设置；日常两项、低频维护默认关闭 MUI Collapse、底部设置。维护路径自动展开。触发器有 aria-expanded/aria-controls；描述不常驻链接第二行。
2. 保留 createHashRouter、RequireAuth、默认 /builder、页面 lazy、独立 /login 加载/错误边界。路由集合包含 builder、search、question/:id、export、settings、manage；manage 父页 index 替换至 knowledge，四子页 knowledge、formula-review、sources、stats。四旧路径分别替换到 /manage 对应路径；通配到 /builder。
3. /builder、/export → 组卷工作台；/search、真实 /question/:id → 找题；/manage、分段 /manage/* → 数据维护；/settings → 设置。aria-current 同步；/search-other 不误选找题。
4. DataMaintenancePage h1=数据维护；四个 Tab=知识点复核/公式复核/来源文件/题库统计。状态由 pathname 派生；只挂载活动 Outlet。Tab/panel id、aria-controls、aria-labelledby 成对；公式内部状态 Tab 使用不同可访问名称。父 h1→子 h2→内部章节 h3，包括加载/错误/空态。独立路由标题表保留维护子页具体 document.title。
5. PaperLibraryDrawer 打开时按需加载，完整迁移两处切换/新建/删除/取消/重建副本能力；唯一全局入口名“试卷管理”，工作台及 PaperPanel 空态调用同一入口，原工作台管理 Drawer 删除。使用 paperStore/qk.papers()；删除前整卷读取、权限检查、真实影响题数确认。删除当前卷清 currentPaperId/targetSectionId；“重建副本”产生新 ID，并锁定新卷导出。
6. 工作台一个主导出入口，抽屉一个预览动作/一个导出动作。复用现有共享门禁，保留模式/模板/格式/诊断/stale/降级确认、结果和 key={paperId}。/export?paper_id=X 为全屏预览辅助页，只读诊断，取消导出提交及创建修订卷；不承诺持久历史或抽屉本次结果。返回工作台使用一次性 state { openExportForPaperId: X }；选 X、清目标、开 X 抽屉，再 replace 清已消费 state，保留原查询参数；不得 export=1。
7. API 路径、请求字段、错误码和数据业务不改；不触碰冻结 bank 文件。中文注释延续详实风格。列数、间距、卡片、维护内部业务、设置和动效留给 B2–B5。

### 必须留存的实测证据

- frontend：npx tsc --noEmit、npm test、npm run build；根目录指定 Python 以 PYTHONUTF8=1 运行 -m unittest discover -s tests。真实输出留存，前端不少于 26 node:test+261 vitest、后端不少于 436，保留 skip 语义。
- 对比度原 65/65，新增组合追加配对表，不删旧配对。冷加载默认 /builder，按 B0 相同 raw bytes 口径报告入口 JS、全部首屏 JS bytes/count，对比 31,130 和 1,068,908/16；不允许转移到预加载 vendor 伪装。按需抽屉不静态引入工作台/DnD/公式预览/导出模块。
- 实际访问四旧 hash URL，均附 ?debug=1：断言目标、查询串、必要 state 保留、replace，确认新页 debug 可用；既有 /manage 子 URL 直接可达。
- 六类路径 DOM 断言 aria-current 对应，/search-other 不误选，维护自动展开，document.title 具体正确。四 Tab 逐个验证只出现当前 panel，并以 DOM 标志或请求数证明其他三页没挂载。
- 标题门禁涵盖原九业务页及新增维护父页，报告实际分母与路径列表；不能沿用 9/9 掩盖新增父页。skip-link、main/nav、Drawer role=dialog 保留；Tab 键盘切换及 Drawer 焦点恢复实测。
- 副本验证切换、新建、删除取消零写请求、权限不足零删除、确认题数、删除当前卷清目标、重建新 ID及锁门禁。QB_DB_PATH 指副本，前后交付 outputs/bank.db 完整 SHA256 一致。
- 当前卷 A，访问 /export?paper_id=B，返回后选卷、标题及预览请求都是 B。消费 state 后刷新/返回不重复开，搜索查询不丢。辅助页无导出/修订写请求；预览点击一次请求一次；换卷不保留 A 局部结果。
- 两项反证先用 B0 当前代码或隔离同等旧逻辑产生失败：删 NAV_ITEMS 会丢 export/维护路由；旧 Navigate 丢 location.search。新实现同用例保留路由/查询串。纯代码推理不算验证通过。
- 浏览器看维护父页和管理 Drawer 浅/深色，标题和关闭可见。未做的视觉/读屏验收明确列出，不能宣传全部无障碍通过。

### 提交与汇报

- A 先冻结 G1；D 必须用真实证据过 G2；独立 T/V 根据交接和代码自行构造验证，满足 G3。
- 一个 B1 Conventional Commit，中文正文说明改动/实测/反证/未做事项，不 push；不提交构建产物、数据、PNG、.tmp/.qa。
- 最终用户正文 1000 字以内，覆盖逐项文件行号/前后/证据、不成立项、真实门禁输出和首屏总量、反证、commit hash、未做与风险；详细原始输出可附链接。

## 我没做/做不到的

- 未写源码，未跑测试/构建，未实测 UI/网络/反证；这些交给 R/D/T，不能用本文件代替证据。
- 未变更用户需求，未做 B2–B5，未触碰交付库或提交。

## 遗留风险

- 新导航/抽屉增加代码但要求首屏不回退；必须网络实测，不能仅入口 chunk。
- 新维护父页可能漏出原标题检查覆盖；必须明确分母。
- state 消费与 URL 同步、删除中切卷、跨卷导出局部状态需对抗验证。
