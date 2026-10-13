# 交接：T12主题令牌与关联色 / D子角色

## 我做了什么
- frontend/src/theme.ts:87、208–235 增加G1冻结的space/motion，spacing直接消费space[1]；完整MUI duration/easing映射；MuiCssBaseline根变量桥接。AnimatedList.tsx:54直接消费fast/easeOut；app/routeTransitions.css:4–5消费主题注入变量，保留reduce完全关闭。
- SessionControls.tsx:30–31、PaperSwitcher.tsx:42–44改为palette.common.white + alpha；QuestionCard.tsx:92只迁移hover shadow；LivePreviewPanel.tsx:384迁移画布色。StatusBadges.tsx:68按主控协调授权仅迁移未标注描边，不覆盖P1。
- PreviewViewer.tsx:92–93在真实非空深色组件状态证实白字/白底ratio1:1后，改为common.black的60%文字/白色75%叠层，白位图上ratio约5.74:1；保留外层唯一A4例外#EDEFF2。
- 按A后续精确裁决，theme.ts:265仅深色outlinedPrimary:hover改正文色；livePreview.css:106、250两条手柄色消费--qb-paper-handle=tokens.neutral，白紙从3.35:1提高为4.97:1。不是完整视觉零差异承诺。
- 构建当前产物，采六图和路由reduce实测；另在.tmp_t12t13/d-control保留当前P1全部页面、只撤回本角色T12色/动画改动，独立构建并代理同一个8911副本API以隔离P1。

## 产出物
代码：上述10文件；QuestionCard/StatusBadges属于共用文件，仅本角色明确单点色迁移及tokens导入。vite主题分组由主控处理，本角色没有改config/pages/tests/package。
证据：
- .tmp_t12t13/d-tokens/build-1.log、build-2.log：npm.cmd run build均exit0，tsc及84 contrast均通过；后续hover/handle最终build由主控执行。
- .tmp_t12t13/d-tokens/preview.cjs、preview-before.json/png、preview-after.json/png：真实生产PreviewViewer通过拦截preview响应返回白色SVG位图造出非空状态，不向库提交预览；旧前景rgba(255,255,255,.7)、背景rgba(255,255,255,.75)，新版前景rgba(0,0,0,.6)，人工看新版第1页可读。此fixture用于组件反证，不是导出真实性证明。
- .tmp_t12t13/d-tokens/motion.json：normal duration0.12s/easing ease/animation qb-route-out，reduced duration0s/animation none；根fast120ms、routeEase ease。
- .tmp_t12t13/d-tokens/screens/capture.json和6张1366浅/深PNG（均本轮新产物）；已逐图人工查看。
- .tmp_t12t13/d-control/build.log、cold-builder.json、p1-pages-manifest.json、screens/：控制副本当前全部pages逐字节匹配P1；控制首屏15JS/1,060,930B，入口23,907B。控制服务8912，代理8911 API。
- .tmp_t12t13/d-tokens/visual-vs-p1-control.json：search/settings/builder × light/dark六对mean_diff=0、pct_gt32=0。矩阵未悬停/未显示页码浮层，所以不覆盖三项明确纠错状态。
- 主控最终构建预算证据.tmp_t12t13/d-gates/cold-builder-v2.json：15JS/1,061,820B、入口22,009B。总B超硬限2,078B，仍是FAIL。

## 验收标准（给主控/独立T）
1. npx.cmd tsc --noEmit、npm.cmd test、npm.cmd run build；在新的builder context/currentPaperId=1/networkidle+2.5s测响应体原始B，必须15JS且<=1,059,742B，入口<=23,907B。当前总B不满足，不能签G2通过。
2. 令牌回归测试全space/motion值、spacing的半值/负值/字符串/多参数兼容性、全部duration/easing映射、CSS变量接线及AnimatedList真实插件参数（由主控持有tests）。
3. 浏览器深色造非空PreviewViewer及真实outlinedPrimary:hover、纸面手柄/invalidscore状态，准确contrast>=4.5，不将组件整体豁免；独立T应选择不同图案背景或不同hover按钮，不复用本fixture作为唯一证据。
4. 复制R采集同状态图，对固定P1控制逐像素算mean_diff/pct_gt32；区别静态零差异与明确纠错状态变化。
5. 主控比对完整bank.db/settings哈希；本角色无任何DB/settings写入。

## 我没做/做不到的
- 未提交、未push、未改pages或vendor分包；未跑后端全量测试，主控持有基线与最终测试。
- 未独立签T/V，不把主控G-d通过当本角色独立T。
- 无法在本角色theme/颜色最小改动内等价精简2,078B：控制P1本身已比原预算多1,188B，新增令牌/桥接/可读性修复约890B；theme整个运行模块约2.6kB，完整冻结契约必须保留，移除功能或将数据藏入其他块不是等价精简。可小幅整理数十字节，但不足以达门禁，故未进行风险更高的预算重构。

## 遗留风险
总首屏预算未通过，是实测阻断；需要主控/A就更广的等价精简确定范围，不能以入口下降或15请求代替总B门禁。P1与主控仍并行修改，提交前须重测最终产物、核对每个hunk归属。本角色六图人工可读不代替九页DOM contrast或无障碍验收。

## 后续压缩探针（未实施生产变更）
主控另要求探针Terser与默认esbuild。只读require.resolve检查frontend当前环境exit2 MODULE_NOT_FOUND；环境共享node/workspace与.codex候选也无Terser。证据.tmp_t12t13/d-tokens/terser-probe.json。未安装新依赖，未改config/lock；需要A裁决后才能继续该工具探针。
