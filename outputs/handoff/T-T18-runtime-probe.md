# 交接：独立测试 / T / T18 runtime probe

## 我做了什么
- 只读 AGENTS.md、outputs/handoff/D-T18-runtime-probe.md 和代码，未读取开发对话；从 git archive HEAD `ebee609d73e72c9ac15a9da6aa3b6c52eeb323b8` 独立重建 `.qa_t18_t/head/frontend`，先执行原脚本，再仅叠加本任务两个脚本。不是重用D的验收日志。
- 验证 frontend/scripts/gate-runtime.mjs:17、24–27、40–41 的参数、内存反证、原22配对判定：普通JSON完全一致，浅色探针7项违规，深色11项逐字段不变、fill逐项不变、阈值全为4.5、failures严格等于pairs中ratio<threshold的子集。
- 独立改临时settings主色为 `#16A34A`；另构造只破坏MuiLink覆写、浅/深链接前景等于各自paper的坏主题，无probe也实际被判出两项ratio=1。临时移除原failure收集语句使probe返回exit0，证实exit1来源是既有判定结果而非硬编码。
- 独立执行后端基线、前端全量、构建、aggregate、参数和无服务边界；浏览器8963产物与T自己的当前新构建15个首屏JS逐个SHA256一致，不用历史产物判断预算。
- 开始和结束核对交付库/settings SHA256；T未改任何生产源码、页面、主题、交付设置/库，未提交，未停止任何服务。所有T试验文件在 `.qa_t18_t/`。

## 产出物
- 本文：outputs/handoff/T-T18-runtime-probe.md。
- 独立基线与原脚本证据：.qa_t18_t/backend-baseline.json、head.json、archive.json、old-clean.json、old-bare.json。
- 反证与边界：.qa_t18_t/current-clean.json、current-bare.json、after-probe-clean.json、cases-summary.json、contract-evidence.json、empty-probe.json、collector-mutation.json，以及各案例同名JSON（记录完整命令、cwd、退出码、耗时、stdout/stderr）。
- 独立副本：.qa_t18_t/green-settings.json、bad-settings.json、invalid-settings.json、t-independent-bad-theme.ts、t-no-export.ts；收集器突变保存在 .qa_t18_t/head/frontend/scripts/t-runtime-no-collector.mjs，仅供反证，未进入生产。
- 回归：.qa_t18_t/frontend-test.json、build.json、gate-all.json、duplicate-valued-probe.json、dark-valued-probe.json、late-valued-probe.json、other-*-bare.json、colors-bare.json。
- 环境/预算：.qa_t18_t/no-service-duplicate.json、no-service-all.json、runtime-no-service.json、url-precedence.json、firstscreen.json、firstscreen-hash.json、bundle.json、protected-hashes.json、scripts-diff.json。

## 实测结果与验收标准（给主控）
默认cwd为 `.qa_t18_t/head/frontend`。npm命令经PowerShell执行 `$env:HTTPS_PROXY='http://127.0.0.1:7897'; npm.cmd ...; exit $LASTEXITCODE`，保存真实退出码。

| 操作 | 实测结果 |
|---|---|
| 项目根Python专用venv `-m unittest discover -s tests` | exit0；Ran 436 tests in 44.460s；OK (skipped=1) |
| HEAD原 `node scripts/gate-runtime.mjs` | exit0，checked=22，failures=[] |
| HEAD原 `node scripts/gate-runtime.mjs --probe` | exit2，status=无法判定，reason=无效参数: --probe；修复前缺少可执行裸探针确证 |
| 当前普通runtime及probe后再次普通运行 | 均exit0，22对；解析后与旧HEAD普通JSON逐字段完全相同 |
| 当前runtime `--probe` / `--probe runtime` | 均exit1，22对/7项浅色真实违规；正文主色#FFFFFF/#FFFFFF ratio=1 threshold=4.5；页面主色ratio=1.0813594232749741 |
| `--settings ../../green-settings.json` 普通 | exit0，22对/0失败 |
| 绿色settings，probe放首/尾 | 均exit1，22对/7项真实违规，位置不改变结果 |
| 独立坏链接主题，无probe，`--theme-source ../../t-independent-bad-theme.ts` | exit1，22对/2失败，仅light、dark链接ratio=1 |
| QA副本移除原 `if (ratio < 4.5) failures.push(item)` 后probe | exit0，22对/0 failures，但首对ratio仍1；原判定被破坏会真实失去拦截 |
| `--probe false`、`--probe Runtime`、`--probe=runtime`、`--xxprobe`、空probe值 | 均exit2，无法判定；空值触发无效参数，不会默默通过 |
| probe + 非hex6主色、损坏JSON、缺失settings、缺buildTheme源码 | 均exit2，明确无法判定原因，无伪造PASS/FAIL |
| `GATE_URL=http://127.0.0.1:8963 npm.cmd run gate:all` | exit0，colors/runtime/duplicate/dark/late全通过；late 3 tests/18 checks |
| duplicate/dark/late的裸probe；colors裸probe | 均exit2，既有参数语义未被runtime的裸flag放宽 |
| `--probe duplicate` / `--probe dark` / late `--probe late --probe-target export` | 均exit1，分别检测真实重复槽、白对白ratio1、移除请求守卫后的2个失败测试；其他探针仍工作 |
| 8962无服务duplicate | exit2，page.goto net::ERR_CONNECTION_REFUSED |
| `GATE_URL=8962` 的gate:all | exit2，在duplicate阶段连接拒绝；之前离线runtime通过 |
| env8963但duplicate显式 `--url http://127.0.0.1:8962` | exit2，请求8962；显式URL覆盖环境变量 |
| `GATE_URL=8962 npm.cmd run gate:runtime` | exit0，22对/0 failures；runtime保持既有离线只读settings/theme语义 |
| `npm.cmd test` | exit0；26 node:test + 369 Vitest（46文件）全部通过 |
| `npm.cmd run build` | exit0；tsc、84组contrast、Vite与prune通过；本轮新构建95文件 |
| T新构建入口 | assets/index-BAlhZEOM.js，21832B，达到≤21832B预算 |
| 8963 builder首屏，1366×768、currentPaperId=1 | 15个JS响应，总1056156B；两次独立采集同值，各响应与T新构建SHA256全相同 |
| bundle检查 | 新manifest无scripts键；33个JS无gate-runtime、gate-common、G-b/runtime和探针说明标记 |

可复验普通、probe、绿色settings、坏链接主题、各服务型门禁。不得把collector突变作为交付脚本，它只在T副本中证明判定器的因果关系。

G3结论：**通过**。T自行重建HEAD基线、另选主色、另造槽位违规、对原failure收集做反向突变，并以真实运行结果验证；没有仅凭“结构覆盖”或D日志认定通过。本任务两个脚本的目标行为满足要求，未发现阻断缺陷。

收尾时共享HEAD已由并行线推进为 `4b5d18197fd4f928db8c9094ebb3d5e6ec75bb01`（closure-head.json）；T隔离验收基线仍为上述ebee609，未把并行页面带入本任务结论。主控应以两个scripts的最终差异为提交范围核验依据。

## 我没做/做不到的
- 不声称“runtime无服务exit2”：它在HEAD及当前都不访问服务；实测当前设置GATE_URL指向无服务端口仍exit0。给runtime新增服务依赖会改变普通语义。本轮可实证的无服务exit2是duplicate及gate:all；主控最终报告必须保留这一区别。
- 未验收共享工作区并行pages改动，也不把它们归为T18；本报告前端通过范围为独立HEAD+本任务两个脚本。后端基线是在当前项目根执行。
- 未做CSS所有叠层/所有主题的全覆盖；runtime范围仍为原22配对。本轮没有业务UI/导出排版改动，不宣称公式编辑或Word/WPS新验证。
- 独立HTTP服务由D启动，T未重启它；但T通过响应SHA256与自行新构建逐项比对，确认验收所用15个JS就是对应产物。T未提交或推送。

## 遗留风险
- gate-common.mjs:29 的GATE_URL会为服务型门禁提供环境默认来源；已实测aggregate、无服务与显式覆盖，未扩大验证代理/认证部署形态。
- 浏览器门禁真实数据仍由8963隔离库服务提供；本轮浏览器写请求依原门禁被截获，没有调用交付库写接口。
- 交付库前后SHA256：`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`；交付settings前后SHA256：`614261f5e8e4048c70c422051263b6dca443c339b9b70b0ca840c41ec6bc68b3`。均未变。
