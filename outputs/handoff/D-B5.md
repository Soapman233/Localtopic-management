# 交接：B5部分实现与环境阻碍 / D

**G1已通过；G2未通过。源码未提交，B5构建不可用。阶段一提交、阶段二独立QA和阶段三收尾均未完成。**

## 我做了什么

1. frontend/src/hooks/useReducedMotion.ts:4 同步读取系统偏好，实时change监听及旧Safari addListener成对清理；API缺失保守关闭。frontend/src/index.css:43 改为animation:none/transition:none，并覆盖VT伪元素，不再0.001ms。
2. frontend/src/components/AnimatedList.tsx:9 为找题页新增稳定父容器，:36动态import真实AutoAnimate；layout阶段在MutationObserver前按资格启停，禁用取消直接子项WAAPI，迟到import、reduce及卸载设取消路径。frontend/src/lib/listMotion.ts:3 核对完整query身份、前后稳定状态、共同ID顺序、<=4且<=25%双门槛。插件真实语义尚未核实，不作为通过证据。
3. frontend/src/pages/SearchPage.tsx:371/:404 将批量条、题卡分成独立容器，题卡保持item.id直接子项key，scope为完整queryParams；:195清空前将批量条内焦点交给稳定题卡复选框。不改变选择/提交/权限/preview失效语义，未扩展Drawer或知识点动效。
4. frontend/src/hooks/useAppNavigate.ts:7 仅委托Router的viewTransition选项；frontend/src/app/routeTransitions.ts:7 只成功加载后登记warm，双端白名单与系统偏好/API/绝对路径检查；App.tsx:325稳定wrapper在安全非reduce路由命名。维护Tab与找题/详情/知识点/公式复核/来源/统计明确跳转接入，builder/export/认证/URL更新继续普通导航。
5. router.tsx:8延迟其他页面import映射到routePages，builder仍直接lazy；增强CSS延迟，vite.config.ts:85独立auto-animate分包。B5Motion.test.tsx:22/:47/:72新增10项偏好/列表反例/Router选项行为测试；CodeSplitting保留原case并扩展二层动态import断言。

## 产出物

明确B5编辑清单（不要git add -A）：
- frontend/src/App.tsx、frontend/src/index.css、frontend/src/router.tsx
- frontend/src/hooks/useReducedMotion.ts、frontend/src/hooks/useAppNavigate.ts
- frontend/src/components/AnimatedList.tsx、frontend/src/lib/listMotion.ts
- frontend/src/app/routePages.ts、frontend/src/app/routeTransitions.ts、frontend/src/app/routeTransitions.css
- frontend/src/pages/SearchPage.tsx、DataMaintenancePage.tsx、FormulaReviewPage.tsx、KnowledgeReviewPage.tsx、QuestionDetailPage.tsx、SourcesPage.tsx、StatsPage.tsx（均在frontend/src/pages）
- frontend/vite.config.ts
- frontend/tests/unit/B5Motion.test.tsx、frontend/tests/unit/CodeSplitting.test.tsx
- outputs/handoff/D-B5.md

package.json与package-lock.json未改变。官方包尚未取得，未捏造依赖锁/完整性值/替代实现。拟安装唯一依赖@formkit/auto-animate@0.9.0。Router未升级。

## 实测证据

全部日志与.exit文件位于 `.tmp_verify/B5开发/`，不提交。下列为最终源码执行结果：

| 命令 | 退出码 | 结果 |
|---|---:|---|
| 专用Python -X utf8 -m unittest discover -s tests | 0 | 436项，43.429s，OK/1skip；backend.log |
| npx tsc --noEmit | 2 | AnimatedList.tsx:36 TS2307缺@formkit/auto-animate；tsc.log |
| npm test | 1 | node26通过；vitest41文件324项通过，B0SystemCopy与B2Redesign两套因缺插件导入失败；test.log |
| npm run build | 2 | tsc缺插件即停，没有Vite新构建；build.log |
| npm run contrast | 0 | 原有77/77配对全通过，未删配对；contrast.log |
| npx vitest run tests/unit/B5Motion.test.tsx | 0 | 新增10/10通过；B5Motion.log |

最终focused检查（B5Motion+CodeSplitting）退出码0、2文件17/17通过，2.23s；见focused.log/focused.exit。10项仅证明真实MediaQuery订阅行为、纯列表资格反例与mock Router选项，未证明真实插件/浏览器动画。原有330 vitest未删case；缺插件两套16项未运行，所以既有314+新增10=324通过，整体失败。

安装阻碍：普通npm registry安装EACCES；改项目cache/fetch-retries=0仍EACCES；一次普通权限npmmirror安装connect EACCES 140.249.145.114:443。Node普通fetch同样失败；全局npm缓存只读EPERM，共享工具node_modules无@formkit。日志npm-install.log/npm-install-local.log/npm-mirror.log。已停止网络重试，没有提升权限/绕过限制。

### 数据与服务

- 交付库只读复制至 `.tmp_verify/B5开发/bank.db`，SQL实测7945题/2卷，64815104B。
- 8815由create_app启动；config.get_db_path真实支持QB_DB_PATH优先，health确认db为该副本绝对路径、schema3/local。SETTINGS_PATH、PREVIEW_CACHE_DIR、EXPORT_DIR均隔离至本临时目录，未写真实设置。
- 启动命令（根目录）：专用Python -X utf8 .tmp_verify/B5开发/serve.py。脚本已插入项目根sys.path。静态目录仍webui/static，**服务旧构建，不作为B5浏览器证据**。
- 本人服务cmd父PID108520。仅taskkill /PID 108520 /T /F尝试终止，返回拒绝访问；随后8815 health仍存活。未扩大终止范围或误杀其他会话，此残留已告知总控。
- 交付库最终64815104B、完整SHA256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`，与开始一致。

## 验收标准（给下一个角色）

1. 提供可合法读取的官方包/完整cache或恢复普通网络后，frontend执行 `npm install @formkit/auto-animate@0.9.0 --save-exact --no-audit --no-fund --cache .tmp_npm_cache`。真实生成package/lock，核版本/来源/完整性；不把临时tgz路径作为最终分发依赖，不捏造lock。读真实插件源码核实disable、enable、卸载语义后修正并补测试。
2. 重跑npx tsc --noEmit、npm test、npm run build。保留26node+330既有vitest并加本批10（至少340），77配对不减。
3. 当前新构建stat入口<=23569B；fresh browser默认builder真实JS response body总量<=1058746B、<=15请求。列chunk raw/gzip、依赖闭包，证明AutoAnimate/增强块不进入builder冷首屏。**当前无B5预算通过证据。**
4. 新副本/新端口，核health实际db路径、大小、SQL题数及服务index新构建hash。真实getAnimations验证首载20、同query删1、相似ID翻页/条件切换、placeholder、整体替换/逆序、动态reduce；交叉查DOM结果、焦点和连点请求。
5. 冷safe普通、warm safe双端VT；no API、reduce、relative、number、query-only、builder/export双向普通。实际出现.lp-measure时逐祖先查name/transform/animation，不能把原有独立纸面scale误判新增污染。
6. 新构建1366浅深/窄屏渲染，补详情、线上登录、维护Tab、管理/导出抽屉、展开和四态。按capture/compare保留像素指标/自比0，人工看原图/新图/热力图后才更新基线。旧static不能替代B5。
7. D补齐G2再交总控；T根据交接+代码独立G3及B0-B4回归，通过后才按总控指令提交一个中文Conventional Commit。

## 我没做/做不到的

官方AutoAnimate缺失，无法编译/打包新构建；未测插件raw/gzip、冷网络预算、真实动画/VT/测量祖先、焦点与连点、B0-B4全浏览器、像素比较。未生成B5截图、未更新baseline-manifest、未宣称NVDA/Word/WPS验收。未修改交付库/真实设置、API/错误码、冻结bank文件、Python交付资产、公式/导出内核、.bat、配色或权限业务。未commit/push。

## 遗留风险

- disable是否在DOM观察前阻止bulk、恢复是否重建当前基线、临时退出节点真实focus需官方插件浏览器实测，局部单测不足。
- 分包合法但硬预算紧，真实新构建可能超限；应回A，不搬业务进首屏vendor或放宽预算。
- reduce全关后MUI Drawer/Collapse仍需显隐验证；实际VT取消、query/state历史保持尚未浏览器验收。
- workspace外部改动：.workbuddy-ai/memory/2026-10-06.md、memory/2026-10-13.md、deliverables/UI设计评审与优化方案-2026-10-13.md、docs/、outputs/client/。未编辑/覆盖/删除/纳入B5。R/A/T交接由各角色产出，不代写。
