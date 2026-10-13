# 交接：B5 调查 / R

## 我做了什么

1. 完整读取 AGENTS.md（546行）和 deliverables/gstack/impl-plan-ui-redesign-2026-10-12.md（858行），并核对 .tmp_verify/CODEX_batch_spec.md:38、:51、:83 的本轮验收基准、动效硬约束和独立复核要求。未编辑生产源码。
2. 基线实测：HEAD f9ae867，B4 提交 d0357ea 已在历史；开始工作区干净。Python 专用 venv + -X utf8 跑后端 **436项，55.808秒，1 skip，OK**；前端 tsc exit0，npm test **26 node:test +330 vitest /42文件**，build exit0（Vite 8.90秒），对比度 **77/77**。旧 AGENTS 387、方案251、本轮规格316、65对比度都属于历史值，不替代本次实测。日志见产出清单。
3. Router 安装版本 **react-router-dom 6.30.6**（frontend/node_modules/react-router-dom/package.json）；源码 frontend/src/router.tsx:94 使用 createHashRouter，:117 RouterProvider。安装类型 react-router-dom/dist/index.d.ts:102/:193、@remix-run/router/dist/router.d.ts:360 支持 viewTransition:true；不需升级。frontend/package.json:29 只是 ^6.26.0 范围，不是安装版本。
4. 核实接入点：App.tsx:158/:163 普通导航，:320-322 是唯一外壳 Outlet/Suspense；DataMaintenancePage.tsx:21 Tab导航保留 search/state。SearchPage.tsx:362-390 条件批量条，:392-404 题卡直接以 item.id 为key。LivePreviewPanel.tsx:367 .lp-measure 与 :397 缩放容器分离；禁止在其自身或祖先加入 transform/AutoAnimate。index.css:43 现有reduce只缩短时长，不能替代本轮要求完全关闭新增动效。
5. B4正式报告实际在 .workbuddy-ai/memory/2026-10-11.md:677-694：26+330、77配对、入口23566、首屏15/1058506；其“高级字段缺失”误报原因是探针停在外观Tab，需先显式切到高级。当前重新build产物入口 **assets/index-CCo5P2b4.js /23566 raw bytes**，manifest递归闭包（入口+builder imports）**15 JS /1058506 raw bytes**，与B4记忆一致；后者是静态闭包核对，**本R未做浏览器网络实测**。

## 产出物

- outputs/handoff/R-B5调查.md（本交接）
- .tmp_verify/redesign-B5-R/backend-baseline.log
- .tmp_verify/redesign-B5-R/tsc-baseline.log
- .tmp_verify/redesign-B5-R/test-baseline.log
- .tmp_verify/redesign-B5-R/build-baseline.log
- .tmp_verify/redesign-B5-R/assets-baseline.json（各chunk实际raw/gzip）
- .tmp_verify/redesign-B5-R/summary.json（HEAD、退出码、库哈希、入口与manifest闭包）

## 验收标准（给下一个角色）

1. A冻结新增边界后D方可编辑。本轮规格基准入口23569、首屏1058746/15；R现值23566、1058506/15更低，请A明确“不得回退”按哪组约束，禁止自行退回旧30790/1064929。77配对保留原65+新增12。
2. AutoAnimate依赖尚未存在（package.json:15-30）；只新增 @formkit/auto-animate、独立非vendor分包。vite.config.ts:41 onlyExplicitManualChunks、:65 manualChunks；入口静态imports只含react/misc/data/mui/app-common，新增动效不得因App/helper静态依赖而进builder冷首屏。实际raw/gzip不能引用方案2.5KB估值。
3. 找题列表必须有稳定外层和直接子项稳定id；当前没有单独容器。首载、翻页、查询/筛选大替换禁用；同页少量增删才能启用。批量工具条显隐可单独处理，不动画整个正文。无纸面、公式段落、DnD节点动效。试点成功后再决定是否扩到抽屉/知识点少量删除。
4. useReducedMotion实时监听matchMedia，含addEventListener/removeEventListener及旧addListener/removeListener回退，卸载清理；reduce时显式禁用AutoAnimate和VT，VT伪元素animation:none（不能仅0.001ms）。不支持startViewTransition普通navigate；不手写startViewTransition包装React导航。
5. 统一helper保留NavigateOptions（search/state/replace等）和number历史返回语义；冷lazy可普通导航，已加载路由再增强。App页内容使用唯一route-content名，root过渡关闭；不对外壳/Drawer/测量层加transform，不给Outlet随机key。动画完成不控制业务提交/失效/导出门禁。
6. 冷网络预算工具：.qa_B1_R/cold-js.mjs:3-8 为历史可参考探针，fresh context、serviceWorkers:block、CDP禁cache、收集实际.js response.body().length、networkidle+heading ready，冻结结果再做后续导航。不能只相加manifest当网络通过。先核服务入口名、health数据库路径与副本大小，再测；指定当前空localStorage默认builder与1366x768，报告全部文件/raw bytes/count并确认AutoAnimate未请求。
7. 视觉机制 frontend/tests/visual/capture.mjs、compare.py、README.md:150-160：必须逐图/热力图检查再接受新基线。README:168-175只有8页，:194固定3.5秒；方案:838要求补详情/线上登录、Tab/Drawer/展开/四态和内容/字体/图片就绪，不能把加载态收成基线。比较mean_diff<1、pct_gt32<0.5%、自比0；PNG不提交，manifest可更新但必须有实际看图证据。
8. T/V仅读交接+代码重新构造：reduce动态切换/API不支持/动画期间连点不重复提交/焦点恢复，B0-B4验收矩阵与反证（迟到响应、stale、内容阻断、环境失败、指定B回程、快照原图/公式锁定、9页h1与维护h2/h3）。不将实现单测直接当独立验收。
9. 阶段收尾复跑专用Python -X utf8 -m unittest discover -s tests；frontend tsc/npm test/build，至少当前436/1skip、26+330、77对比度；库保持64815104 bytes及全SHA6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。

## 我没做/做不到的

- 未实现B5、未冻结A契约、未代写T/V、未浏览器复验B0-B4，不把记忆报告数字当本R浏览器实测。
- 未启动任何服务、未写真实设置或交付库；只运行现有测试、重建gitignored静态产物和写本交接/临时日志。
- exec_command所有调用此前setup失败；本R使用Node child_process绝对路径。一次spawn py因PATH无py ENOENT重置共享kernel，已通知主控；后续监听error并使用绝对Python，不再reset。
- 未做真实NVDA朗读、GPU/移动端/跨浏览器/Word/WPS；本轮当前尚未触及公式/导出核心。

## 遗留风险

- 当前入口仅3B低于B4原值；导航hook进入App可能很容易增加冷首屏，A需冻结真正延迟加载/收敛方案，不能把代码搬进vendor游戏数字。
- 方案旧行号与当前源码变化大，以上均用本次真实行号；“匹配首次加载”必须识别当前query/page，不能只看items数量，placeholder/延迟响应会带旧题卡。
- App route容器虽包builder，但只应VT快照淡入淡出，无CSS transform/AutoAnimate祖先污染测量。
- B4报告目前仅记忆和PNG，没有独立正式T-B4交接；仍需全量复核当前新构建，先切目标状态再断言元素。

## R 补充：B4 冷首屏浏览器对照（2026-10-13）

- 实际网络已测：独立副本服务8814，服务入口与冻结static-B4/index.html均为 **assets/index-CCo5P2b4.js**。静态文件在D开工前复制，后续build不影响此对照。
- GET /api/health真实db为 **D:/Open-source project/Localtopic-management/.tmp_verify/redesign-B5-R/bank-B4.db**；只读SQL核对 **64815104 bytes、7945题、2卷**，不是只凭db_exists判定。
- fresh1366×768 context、空localStorage未选当前卷、serviceWorkers:block、CDP禁cache；等待networkidle、实际h1、document.fonts.ready及图片complete后，统计实际.js response.body().length。结果 **15 JS请求 /1058506 raw bytes**，入口23566B，全部响应200、pageerror0；证据 **.tmp_verify/redesign-B5-R/cold-B4.json**含逐文件清单、口径和时间，不再只有manifest。无CSS/字体/API字节混入。
- cold-builder-B4-light.png已采集；选卷1的浅色6页基线PNG位于screenshots-B4-light/（builder/search/question/export/knowledge/formula-review）。前5页h1各1，字体loaded、图片complete、document scrollWidth=clientWidth=1366已观察；公式页PNG已落盘，但其状态数组未归档。尚未完成来源/统计/设置及深色截图，不将这组不完整截图视为接受的新视觉基线；交由T独立完整采集和看图。
- 第二组截图尝试在图片ready等待超30秒导致NodeREPL工具timeout/kernel reset，副本服务已随kernel终止；本阶段未运行任何写请求、未触碰真实设置/库。主控要求停止R追加截图后已停止，不遗留R服务。
- 结束库全SHA仍为 **6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6**。
- 本轮新增未跟踪docs/class-diagram.mermaid、docs/sequence-diagram.mermaid（02:39:16Z）及outputs/client/三份客户端方案（02:36:09Z—02:41:14Z）与R直接命令/产出无关；现有后端tests检索未发现这两个输出路径，暂不能确定其他会话/工具来源。未删除、未提交陌生文件；R只提交交接，D应显式路径提交。
