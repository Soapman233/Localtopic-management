# 交接：开发 / D

## 我做了什么
- frontend/scripts/gate-runtime.mjs:17 接受裸 --probe 和 --probe runtime，未知值沿共享错误通道退出2。
- frontend/scripts/gate-runtime.mjs:24–27 仅修改 buildTheme 的内存结果：浅色 primary.main 等于 paper；后续原22组对比度判断真实捕获违规，没有新增失败硬编码、没有放宽4.5阈值。
- frontend/scripts/gate-runtime.mjs:41 探针报告带 probe=runtime；普通输出与 HEAD 原脚本解析后逐字段完全一致。
- frontend/scripts/gate-common.mjs:7–18 仅 runtime 开启裸flag，其他门禁键值语法保持；xxprobe 仍 exit2。:29 为 gate:all 增加 GATE_URL，显式 --url 优先，未指定保留8911。

## 产出物
- 两个上述源码文件，未改package.json、业务主题/页面、交付库、交付设置。未提交。
- .qa_t18/scripts.diff；.qa_t18/runtime-clean.log、runtime-probe.log、runtime-valued-probe.log、runtime-invalid.log。
- .qa_t18/runtime-before-probe.log、runtime-before-clean.log（HEAD原脚本独立临时副本，路径解析仅重定位到原frontend）。
- .qa_t18/frontend-test-isolated.log、build-isolated.log、gate-all-isolated-final.log、gate-all-no-service.log、firstscreen-isolated.log、bundle-evidence.json、protected-hashes.json。
- 隔离验证树 .qa_t18/baseline/frontend：git archive HEAD frontend 后只叠加当前两个scripts，node_modules junction 指向已有依赖；不包含并行页面变更。
- .qa_t18/serve-isolated.py；8963 HTTP副本服务 PID108252，静态目录 .qa_t18/baseline/webui/static。服务健康响应 db=.qa_t18/bank.db。

## 验收标准（给下一个角色）
在frontend以 HTTPS_PROXY=http://127.0.0.1:7897 运行；Windows用 npm.cmd 并通过 exit $LASTEXITCODE 保留真实退出码。
1. npm.cmd run gate:runtime：exit0，实测 checked=22、failures=[]。普通输出与旧HEAD输出逐字段相同。
2. npm.cmd run gate:runtime -- --probe：exit1，实测 checked=22、probe=runtime、7个failures；正文主色 foreground=#FFFFFF background=#FFFFFF ratio=1 threshold=4.5；页面正文ratio=1.0813594232749741。--probe runtime同样exit1。旧HEAD裸probe exit2且 status=无法判定 reason=无效参数: --probe，证明旧脚本无法执行该反证。
3. 独立重构不同主题或设置副本，确认判定真实捕获配对违规；不得只复用开发探针思路。
4. 设置 GATE_URL=http://127.0.0.1:8963，在隔离树运行 npm.cmd run gate:all：五门禁实测全部通过exit0（final日志）。显式URL覆盖环境变量，url-precedence.log 实测 env8963/explicit8962。
5. 8962无监听服务时，npm.cmd run gate:duplicate -- --url http://127.0.0.1:8962：exit2，实际输出 status=无法判定 reason=page.goto: net::ERR_CONNECTION_REFUSED。GATE_URL=8962 的 gate:all 在duplicate阶段同样exit2，不能认作FAIL或PASS。
6. runtime本来离线只读settings+theme，无服务仍exit0；为保持无probe行为不变，未添加服务依赖。
7. 隔离树 npm.cmd test：26 node:test +369 vitest全部通过；npm.cmd run build包含tsc通过、84组contrast通过、Vite构建成功。后端436基线由主控实测，D未重复。
8. 8963最新隔离产物首屏builder：index-BAlhZEOM.js=21832B；15个JS响应/1056156B，符合任务预算。HEAD=ebee609d73e72c9ac15a9da6aa3b6c52eeb323b8。运行环境1366×768，预置currentPaperId=1。
9. 新构建 .vite/manifest.json 没有scripts/键；所有产物JS未检出 gate-runtime、gate-common、G-b/runtime 及探针说明，bundle-evidence.json记录。
10. 交付库SHA256=6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6；交付settings SHA256=614261f5e8e4048c70c422051263b6dca443c339b9b70b0ca840c41ec6bc68b3，均保持主控起始值。

## 我没做/做不到的
- 没有改业务代码，没有把runtime变成服务门禁；任务“runtime无服务exit2”与原离线语义冲突，实际无服务exit2由浏览器门禁和gate:all证明。
- 没有独立QA结论；主控应启动T，只读本报告+代码后重新构造验证。没有提交或推送。
- 当前共享前端是并行页面中间态，tsc曾报 KnowledgeReviewPage.tsx 缺 LabelStatusBadge，npm test为26+365/4fail；共享 gate:all 的late阶段也失败。日志分别typecheck.log/build.log/frontend-test.log/gate-all-shared.log，未修改或掩盖。上面的通过结论仅HEAD+本任务脚本隔离树。
- 共享static首屏后来为index-CHoQ45r8.js、15请求/1056221B，多65B，为并行构建；不用它判本任务。自己的共享build尝试因上述tsc失败停止，没有覆盖共享产物。

## 遗留风险
- 原8961副本服务PID109256仍在：尝试停止该自建进程被系统拒绝，未绕过；8963最终隔离服务保留供T。曾尝试第二个8961进程PID60572因端口占用正常exit3，不在运行。
- 反证现在覆盖浅色primary.main场景，并不声称该门禁覆盖所有CSS叠层（这是dark门禁范围）；检测覆盖范围保持原22配对。
