# P阶段证据

本阶段只写需求交接，不写业务实现；正式需求为`outputs/handoff/P-导出P0需求与验收.md`。工作流R→P→A→D→T→V，P输出供A独立读取冻结契约。

## 实际测试环境与限制

- 首次沙箱运行日志`baseline-tests.log`：临时目录权限/SQLite unable to open database file与清理WinError5，不能作为代码失败或通过结论。
- 将TMP/TEMP指向工作区的沙箱重试`baseline-tests-workspace-temp.log`：仅输出real location warning后挂起，已只终止P自己的session69810，没有终止其他任务进程。
- 原生重跑使用`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`，`PYTHONUTF8=1`，TMP/TEMP为`.qa_20261010/tmp`；`baseline-tests-native.log`为318项、317通过、1skip、36.730秒、exit0。
- `closure-tests.log`为阶段末独立再跑输出；具体数值见需求交接收尾记录。

## 数据保护

`db-before.json`与`db-after.json`均为只读SHA256/字节记录：64815104字节，SHA256均为`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`。该值与上一轮正式R/A/V交接一致；AGENTS历史值不用于回滚当前库。

P未修改业务实现、输入DOCX、preprocess_final或交付库，未进行本轮导出修复、渲染、公式编辑测试，需求中验收项均为后续工作而非已完成事实。测试通过只证明P文档阶段基线保持，不证明P0实现达标。
