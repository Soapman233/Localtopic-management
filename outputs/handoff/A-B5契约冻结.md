# 交接：B5 契约冻结 / A

## 我做了什么

1. 读取 AGENTS.md、实施计划与 R-B5调查.md；以 R 重新构建的事实为起点，冻结用户最新硬预算，覆盖计划第67行的历史30800B门槛。
2. 核对 frontend/src/router.tsx:28-37、:39-49、:60-73、:94-118 的 lazy 页面、正式/兼容路由、查询串/state传递与Hash DataRouter；核对 App.tsx:158、:163、:320-322 和 DataMaintenancePage.tsx:21 的导航接入点。
3. 核对 SearchPage.tsx:193-195、:250-252、:362-404 的查询状态、列表与批量条；冻结首载/查询替换禁动与少量变更条件。
4. 核对 LivePreviewPanel.tsx:367 的 .lp-measure 与 :397 的纸面缩放、vite.config.ts:41/:65-99 的显式分包、main.tsx:17/:49 的路由同步入口；制定真正推迟下载的预算路径，不把新增业务搬入预加载vendor。
5. 冻结以下 G1；未修改生产实现、依赖、测试或交付数据。新增模块名称属于允许实施方案，行为、禁区、预算属于强制契约。

## 产出物

- outputs/handoff/A-B5契约冻结.md（本交接，G1）
- 输入事实：outputs/handoff/R-B5调查.md:6-9、:23-31、:42-45；R证据在 .tmp_verify/redesign-B5-R/。

## G1 冻结

### 1. 范围与现有契约

- 本批仅做 B5：找题页AutoAnimate试点、统一增强导航、减少动效、合法体积收尾、视觉/无障碍及B0-B4回归。暂不扩展试卷抽屉或知识点列表AutoAnimate，先交付试点证据。
- 现有API路径、方法、字段、统一响应及错误码不改；现有查询、防抖、分页、权限、导出门禁、快照、提交、回程状态不改。无需后端变更、库迁移、公式或导出内核修改。
- router.tsx:39-49 的PAGES全集、:52 的默认 /builder、:60-65 旧路径兼容、:68 ROUTE_PATHS、:71-73 的search/state/replace语义保留。
- App.tsx:59-72 的四项导航与 app/routeMetadata.ts:2-19 的标题/归属不改；维护父h1/当前子页h2/分区h3及唯一试卷管理/唯一导出提交入口不改。
- 保持React Router安装版本6.30.6。只新增 @formkit/auto-animate 依赖及对应锁文件；不新增其他动画/图表库。

### 2. AutoAnimate只在找题页按需下载

- 为 SearchPage.tsx:392-404 题卡创建稳定列表容器，直接题卡子项保持 item.id 的身份/key。批量条（:362-390）使用独立稳定容器，只动画工具条的显隐，不把题卡正文/结果页共同放进该动效父节点。
- 可新增 useLazyAutoAnimate 一类hook；动态import @formkit/auto-animate，运行时模块单独命名分包。manualChunks中匹配必须位于vendor-misc兜底之前；保留 onlyExplicitManualChunks:true。
- 模块只能在找题页实际挂载且偏好允许时请求。默认 /builder 冷首屏没有该模块请求/静态预加载。初始化时只记录当前DOM基线，不把已经渲染的首批题卡当作新增项播放。
- 列表动画资格：前一次与本次均为成功稳定结果；完整查询身份一致（包含页码、关键词、全部筛选、严格模式与分页参数）；非loading/fetching/error/placeholder；前后至少保留一个共同ID；共同ID相对顺序一致；新增+移除ID数合计 <=4 且 <=较大列表项数的25%。超过任一条件按整体替换处理，不动画。
- 首次加载、翻页、关键词/筛选/严格模式变化、placeholder旧结果、失败/重试恢复、全部替换、整表重排、偏好reduce均禁用。不能只比较数量或ID交集来判定查询身份。
- 批量条只在稳定查询中由用户勾选/清空引发显隐时启用；首次挂载及查询切换禁用。选择/提交/权限/preview失效不得等待动画完成；连续点击不增加请求次数。
- 禁用必须先于插件处理该次DOM变更，不能先播放再靠普通effect纠正。重启/重启用只能以当前DOM建立基线，不得补播禁用期间变更。插件迟到加载、组件卸载、偏好变化均有取消/清理路径。
- AutoAnimate节点及其祖先不得包含 .lp-measure、PageView/纸面缩放层、DnD控制transform的节点、公式/题干段落；不加入列表外的整页transform。

### 3. useReducedMotion行为

- 提供轻量hook，初始同步读取 matchMedia('(prefers-reduced-motion: reduce)').matches，实时订阅change。
- 支持现代 addEventListener/removeEventListener；缺失现代API时配对使用旧 addListener/removeListener。卸载清理所用分支；StrictMode重复挂卸不得遗留监听器。matchMedia缺失时按无新增动画的保守路径运行。
- reduce时不初始化/不重新启用AutoAnimate，已有控制器显式disable并取消本批仍在运行/排队的动画；导航调用不传viewTransition:true，路由容器的view-transition-name为none。
- index.css:43 的reduce块改为完全关闭动画/过渡（animation:none、transition:none、scroll-behavior:auto），并显式覆盖所有View Transition伪元素。不能以0.001ms作为“完全关闭”的证据。MUI抽屉/Collapse等业务仍可正常显隐，不能依赖transitionend才完成业务。
- 从no-preference动态切到reduce：当下停止新增动效，不等下一次导航/重新加载；切回时从当前DOM基线恢复。

### 4. useAppNavigate与路由安全边界

- 返回兼容NavigateFunction的helper：To字符串/对象与number历史返回语义不变；保留search/state/replace/relative/preventScrollReset等原选项。number、相对路径、query-only更新、重定向与认证导航直接普通navigate，不自行重写React Router的解析语义。
- 增强只通过Router navigate(to, { ...options, viewTransition:true })，禁止手写 document.startViewTransition 包装navigate，禁止强行flushSync或给Outlet随机key来促成动画。
- 只有显式绝对页面跳转，出发页与目标页均位于安全白名单、两页模块已经成功加载、偏好允许、浏览器支持document.startViewTransition、增强模块已就绪，才能传true。调用者显式viewTransition:false始终有效。任何一个条件未满足立即普通navigate，不等待模块下载、不二次导航。
- 安全白名单：/search、/question/:id、/manage/knowledge、/manage/formula-review、/manage/sources、/manage/stats、/settings。/manage默认重定向、旧兼容地址、/login、未知地址及 /builder、/export 均不增强。白名单按路由分段匹配，不能让 /search-other 或未知manage子路由误入。
- 重点：builder/export任一方向涉及测量页均禁VT，即builder→search与search→builder都普通navigate。不能只检查目标页，也不能声称“没有CSS transform”就允许测量页被VT祖先快照包住。
- 在App.tsx:320-322 的Outlet区域保留稳定页面容器，唯一名 route-content 仅在当前路由安全且非reduce时出现；builder/export/登录/重定向/未知页以及reduce均明确name:none。root、AppBar、侧栏、全局Drawer不命名/不做整壳过渡。
- route-content只约120ms opacity淡入淡出；关闭group默认几何/transform动画，root group及old/new关闭动画。没有新CSS transform作用于页面容器或测量祖先。
- lazy加载完成记录来自成功模块加载，不得把“导航发出”“渲染过fallback”当作已加载。首次访问未知lazy模块普通navigate；延迟模块下载失败保持普通导航，错误边界可恢复，不能阻断业务。
- 接入全局导航/试卷切换、维护Tabs、明确的找题/详情/统计等页面跳转；已有自动redirect、认证返回、URL筛选replace按原语义普通导航即可，不为动画扩大契约。

### 5. 硬预算与允许减重路径

| 指标 | 最新用户硬上限 | R当前新构建事实 |
|---|---:|---:|
| index.html所指入口JS原始字节 | 23569 B | 23566 B |
| fresh默认builder冷首屏JS总原始字节 | 1058746 B | 1058506 B（仅manifest闭包） |
| 同一冷首屏JS请求数 | 15 | 15（仅manifest闭包） |

- “不回退”按上表用户指定硬上限验收，仍报告相对R实值的前后增量。原始/raw字节为硬门槛；gzip另报告，不能以gzip或舍入KB替代。R尚无浏览器网络基线，D必须补真正冷网络实测后才能过G2。
- 优先采用真实延迟：builder保持现有直接lazy入口；将其他安全/低频页面的实际import映射、加载登记与导航增强集中到仅对应页面访问/明确导航后动态import的路由导航模块。正式路由仍全部注册，PAGES等导出兼容；真正模块尚未下载时立即普通navigate。
- VT增强与其专用CSS可一同延至首次安全页面/明确导航下载；AutoAnimate始终找题独立lazy。首屏只保留必要的偏好订阅、安全容器默认none与薄导航委托。不得因减少入口大小而自动预取这些模块。
- 也允许D通过删除重复路由preload映射、等价收敛代码等真正减重满足预算。完整lazy AppRouter不是自动过门禁：它仍会在冷启动被请求，新增请求/字节必须计入；若采用需实测证明三门槛均通过且加载/错误语义完整。
- 保留现有vendor职责。禁止把新增业务/动效搬进任何已预加载vendor、app-common或其他冷首屏块来伪装入口减小；只改chunk名字、只算入口、隐藏运行期请求都不合格。允许聚合冷首屏原本已经必要的业务块减少重复包装/请求，但必须保持其他路由不被迫下载builder/preview业务。
- 不允许改预算、删页面/能力、删必要无障碍/错误恢复、改加载标签为“完成”来过门禁。合法方案仍超限时回到A重新讨论，D不得自行放宽。

## 验收标准（给下一个角色）

### G2 开发必须给出

1. frontend下执行 npx tsc --noEmit、npm test、npm run build；保留退出码与完整日志。不得减少基线26 node:test +330 vitest、42文件及77/77对比度配对；新增测试应检查可观察行为，不能只用源码字符串宣称动画已关闭。
2. 用最新 webui/static/.vite/manifest.json 的 index.html.file 读取实际stat字节；列全新chunk raw/gzip、依赖闭包，证明独立AutoAnimate与增强模块不在默认builder预加载闭包。再用fresh browser context、serviceWorkers:block、禁cache、空localStorage、1366x768加载默认builder；等待工作台实际标题/内容就绪、networkidle，收集每个.js response.body().length和请求次数，冻结首屏清单后才做导航。需 <=23569/1058746/15；不能将manifest相加当作冷网络通过。
3. 服务与health先证明指向副本库；写入fixture/API拦截或副本验证，不触碰交付库。沿用R .qa_B1_R/cold-js.mjs:3-8 的方法或自建等价探针，报告脚本与日志路径、实际服务入口及数据源。
4. 行为fixture：首载20条无动画；同查询删1项有动画；翻页到相似ID集合仍无动画；查询改变但同数量/部分重合仍无动画；整体替换和逆序无动画；placeholder→新结果无补播；勾选/清空只改变批量条；reduce初始及动态切换、legacy监听卸载均通过。用真实element.getAnimations()/可观测插件调用与DOM结果交叉证明，不能只看enabled布尔值。
5. 导航fixture/浏览器：冷safe页普通navigate；重复访问safe↔safe调用Router的viewTransition:true；no API、reduce、builder/export两个方向、相对/number/query-only均普通navigate；search/state/replace不丢，不重复导航/提交。VT期间root/外壳没有动画，group没有默认几何动画；动态reduce立即关闭本批效果。
6. 在builder与export实际出现 .lp-measure 后，逐级读取测量节点及祖先的computedStyle：新增wrapper name:none、无新增transform/animation，并确认两个方向导航startViewTransition调用为0；AutoAnimate父节点不存在于该祖先链。不要把纸面原有独立scale误判成测量层污染。
7. 最新构建下1366x768/light和dark及窄屏看找题勾选/清空、safe页切换、维护Tab、试卷抽屉/导出抽屉、详情和设置。观察动画过程中Tab焦点、取消/关闭焦点恢复、连点只发一次写请求；焦点不能因动效临时节点跳到body，必要的隐藏动作应恢复到稳定可达控件。
8. 按 frontend/tests/visual/capture.mjs、compare.py 与 README实际截图比较，等待目标内容、字体、图片就绪，不接受加载态。保留自比0及mean_diff/pct_gt32实值；预期差异逐原图/新图/热力图检查后才更新manifest，PNG不提交。补详情、线上登录、维护Tab、抽屉、展开及四态证据。
9. 本批无公式/导出排版逻辑修改，不宣称新增Word/WPS可编辑性验收；若D发现必须触及该域，先退回A且执行项目要求的新导出/渲染/双端改字符验证。
10. 专用Python执行 -X utf8 -m unittest discover -s tests，至少保留436项/1skip（R第6行）；最终交付库64815104 bytes，完整SHA256保持6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6。提交范围排除outputs/client等原有非B5未跟踪内容、构建产物/PNG/临时QA/数据。

### G3 独立T/V

- T/V只读本交接、R事实、D交接及代码，独立构造query/page/延迟import/偏好/API缺失/连点fixture，自己跑新构建、预算与浏览器样式取证。开发测试成功不替代独立结果。
- 必须复验B0-B4既有关键行为：9页h1与维护层级、冷login边界、唯一管理/导出入口、preview迟到响应/stale/内容阻断/环境失败、指定B回程与查询/state、快照媒体/公式锁定、高级设置真实切Tab后的默认只读与分离PUT、统计展开/来源确认/知识点预检。
- 修复类断言保留可执行反证：使旧短时reduce规则/错误目标单端导航/缺失查询身份产生可观测违规，再证明新行为；不只说“结构覆盖”。存在明确环境限制如无法NVDA实际朗读，单独列出，不能扩大为已验收。

## 我没做/做不到的

- 未写实现、测试，也未代写R/T/V；未修改交付库、启动服务、做浏览器网络或视觉验收。
- 未承诺任何分包方案必然省下多少字节；上述延迟/收敛是合法实现边界，能否达23569/1058746/15由D当前构建和冷网络证据判定。
- R仅做manifest静态闭包，D/T仍需真实首屏网络证据；真实NVDA/跨浏览器体验不可由DOM单测替代。

## 遗留风险

- 入口只剩3B、首屏总量240B余量，轻hook/CSS也可能超限；需要真实推迟低频路由导航模块或等价缩减，不是单独分包就解决。
- useEffect禁用AutoAnimate可能晚于DOM观察；迟到import/重新启用也可能误播历史变更，需针对时序实测。
- 名字设在App的稳定wrapper但忘了builder/export或只查目标会把测量页纳入快照；必须双端禁用并实测祖先computedStyle。
- CSS全关后MUI组件必须仍完成显隐；快照/临时退出节点可能影响焦点或连点，需浏览器验证。
- B4此前无正式独立T交接；本轮不得仅引用记忆数字代替B0-B4复验。

G1状态：已冻结。需要变更上述路由/业务、动效资格、安全边界或预算，必须回到A重新冻结并通知依赖角色。
