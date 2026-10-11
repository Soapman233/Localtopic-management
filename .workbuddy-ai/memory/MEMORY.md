# 项目目标与约束

- 用户希望参照学科网，为约10名不同学科教育工作者建设题目管理、组卷与随时导出的应用；需求背景为本地教育知识库，尤其关注DOCX内容与排版保真。
- 当前仍在真实资料诊断与可行性验证阶段，未授权正式应用开发、开通后端或部署。用户明确要求异地访问、导出公式必须可编辑；公式图片不能作为达标回退。
- **验收环境已明确：统一使用 WPS（版本不一定一致），且需同时兼容 Microsoft Word**。本机 WPS 12.1.0.28505 与 Word 16.0.20326 均已实测。团队共享授权与部署选择仍待确认。
- 首批真实素材仅物理，来源为 `C:\Users\SOAP\Desktop\物理\初中\2026学科网教案` 与 `D:\Open-source project\Localtopic-management\2026_10_05_西附国庆练习卷`。初盘589个文件，后续读取时增至748个（567 DOCX、14 PDF）；源目录在变化，统计需标注时间与范围。未展开ZIP、未去重，不等于题目数。源文件只读保留，未授权上传。先以物理验证，不能据此宣称其他学科已兼容。
- 参考对话：https://chat.deepseek.com/share/bmwbcfzgsrs2aau0d7 。
- **30题三路径验证已完成（2026-10-06）**：A 原生 OMML 10/10 通过；B 旧式 OLE **0/10 通过**（通用另存不转换，`OMaths.Add` 只生成空公式占位，本机未装 MathType）；C 扫描 PDF 重建 9/10（视觉识别+人工校准，非全自动 OCR）。约 80% 的 DOCX 含旧式公式对象，是首要阻塞项。交付物见 `outputs/公式可编辑验证报告-30题.md`。
- **两条已实测的硬规则**：① 公式中的中文必须写成 `\text{额}` 形式，否则渲染为乱码；② 判定“公式可编辑”必须实际改公式内部字符→保存→重开→比对，不能用“有 OMML 节点”或“能打印”代替。
- **跨客户端结论（2026-10-06）**：原生公式 OMML 在 Microsoft Word 与 WPS 上均 10/10 可编辑；MathType 对象（`Equation.DSMT4`）在两端均不可编辑（本机未装 MathType）。**OMML 是唯一不依赖第三方软件、双端可编辑的格式。**
- **学科网技术路线考证**：直接检查用户下载文件确认学科网 Word 导出**压倒性使用 MathType**（学科网目录 `Equation.DSMT4` 11,845 个，99/209 份文件无原生公式）。建议**复现其架构（文本存储 + 导出时渲染）但不复现其输出格式**——渲染目标用 OMML，避免商业授权依赖并满足双端兼容。
- **保持 MathType 对象可行且无损（2026-10-06 实测）**：980 个对象往返后嵌入数据逐字节一致、预览图全保留、显示正常、零转换成本；代价是**编辑必须装 MathType**（本机未装，Word/WPS 中均不可编辑；模拟双击时客户端挂起）。**推荐架构：原件原样归档 + 题库存 LaTeX 文本 + 导出时按需渲染成 MathType 或 OMML**（即学科网架构）。「MathType → LaTeX」这一步无论哪条路线都绕不开。
- **旧式公式阻塞已解除（2026-10-06 关键突破）**：用户确认**无 MathType 授权**。实测用开源 **mtef-py**（Apache-2.0，零依赖）解析 OLE 内 `Equation Native` 流（MTEF 二进制）→ LaTeX，**精确解码非 OCR，成功率 99.69%**（977/980，耗时 0.21 秒）；再 LaTeX → OMML 后 **Word 与 WPS 中均渲染为原生可编辑公式（8/8）**。**不需要购买 MathType。** 唯一仍需人工介入的只剩扫描 PDF。
- **转换踩坑（必记）**：MTEF 输出中文为 `{\text{[U+6d6e]}}`，替换**必须在已有 `\text{}` 内部**；套成 `\text{\text{浮}}` 会导致渲染器报 `ToCommands returned empty`。另需去掉公式开头的 `~` 占位符。另：必须先取出 OLE 容器内的 `Equation Native` 流再解析——直接传整个 .bin 会**静默返回空**而非报错。
- **阶段1 预处理管线已实现并全量验证（2026-10-06）**：项目 `pipeline/` 包（omml/mtef_conv/docx_scan/segment/stage1 + vendor/mtef_py）。**全量 209 份文件：209/209 成功、9,765 题、18,131 公式、转换率 98.91%、65 秒**。**格式覆盖率关键修正**：旧式对象至少三种互不兼容格式，`Equation.DSMT4`(MathType) 占 98.48% 且实测转换率 99.93%；`Equation.KSEE3`(WPS公式3.0) 0.90% 与 `Equation.3`(微软旧公式编辑器) 0.16% **不支持**，`DSEquations` 0.45% 未验证 → 约 1.06% 需人工处理。
- **管线三个必记陷阱**：① 必须先取出 OLE 容器内的 `Equation Native` 流再解析，直接传整个 .bin 会**静默返回空**；② `Equation.KSEE3` 会让解析器**死循环**（不是报错），必须按 ProgID 预判跳过；③ 进程 spawn 约 0.43 秒/次，务必用**流式单进程 + 逐条回报**（卡住即重启续跑），不要分块新建进程池。
- **阶段2 题库数据模型已完成并通过两轮独立验证（2026-10-06）**：`bank/` 包（SQLite 11 表 + FTS5）、幂等导入、中文检索、题目版本与组卷快照、待复核队列、CLI；`tests/` 35 项通过。最终库：**题目 7945、公式 17771（OK 17575）、图片 7102、待复核 196**。中文检索用 **bigram + FTS5 + bm25**（不用 trigram，两字词会失效）。
- **元数据真实覆盖率（补全前，保留作对照）**：subject/stage 100%（源自路径）、chapter 20.9%、grade 11.0%、textbook 10.9%、qtype 已分类 70.0%、difficulty 0%（源数据无标注）。
- **元数据补全已完成（2026-10-06）**：题库侧新增 `bank/enrich.py` + `cli enrich`，迁移加 provenance 列；覆盖率 grade 21.1%、textbook 18.7%、chapter 35.4%、**difficulty 0%（源数据无标注，刻意不编造）**、知识点 97.2%。交付物侧 `outputs/metadata/asset_manifest.json/md`（43 条）+ 38 个文件内嵌元数据块（author 全「待补充」、version 0.1.0）。备份 `outputs/bank.backup-20261006-191013.db`（迁移前，合格回滚点）。
- **两条必须记住的指标口径**：① **知识点是「提及」口径不是「考查」**——`term in text` 匹配，平均 4.26 标签/题、泛词命中量大（压强 2378/重力 1849/质量 1480 题），只能作检索辅助，**不能当考查范围筛选**；② **难度字段全空**，需教研组人工标注，任何自动推断都会误导。
- **`verify_backup(original, backup)` 参数顺序是「原库在前、备份在后」**，传反会得出错误结论（我踩过）。判定为三条件：`structure_ok` + `integrity_ok` + `core_nonempty`（核心表 source_files/questions/formulas/images 行数 > 0）；核心表被清空必须判不合格。
- **多轮 QA 抓到的真实教训（务必复用）**：① 版头判定 `looks_like_header` 若对全篇生效会**误删含「学校」的真题**（如「清华大学校园内」），必须收窄作用域到首个真题之前；② **交付产物可能早于代码修改时间**，DB 会从旧数据导入——必须比对时间戳并重生成；③ 指标容易被汇报成「齐全/高覆盖」，**必须用 SQL 或 trace 核实真实含义**（如知识点「提及」被当成「考查」）；④ 放宽判定条件修一个方向时，**必须同时构造反方向的反例**（verify_backup 从「误判好备份」修好后，又出现「误判空壳备份为合格」）；⑤ **「唯一候选才写」防得住"多候选"，防不住"唯一但错误"**——守卫的前提是"候选本身可靠"（答案抽取的题号路径：编号看似唯一但语义不可靠）；⑥ **单元测试测不出视觉缺陷**——「题号连续 1-10」通过了，但导出件里同时出现试卷题号和原卷题号（双重题号），必须**渲染出来看**才能发现。
- **阶段3 组卷已完成（2026-10-06）**：`bank/paper.py`（试卷 CRUD、加题、重排、分值、大题分组、导出 payload）。**快照锁定靠 `snapshot_json`**（加题时把 text+formulas+images+source 全量拷入），改题 v1→v2 后已出卷仍取 v1 的原公式原图，**公式与图片也被锁定**。
- **答案/解析抽取已完成（2026-10-06）**：`bank/answers.py`。有答案 3,973、有解析 4,639（inline 3,090 / paired_file 1,739）。**刻意排除裸「参考答案」标记**——实测它们是整卷答案表，逐题用会错配。曾出现 1 处答案错配（id=2919）已修：根因是「题号路径盲信答案版编号」+「幂等守卫失效（同轮内读到旧行重复写入）」，修复为题号路径必须前缀佐证。
- **阶段4 导出已完成（2026-10-07，经两轮 QA 验证）**：`bank/export.py`。**三条硬性要求达标**：公式为原生 OMML（`word/embeddings=0`，非图片冒充）、**Word 与 WPS 双端可编辑**（改字符→保存→重开保留）、支持学生版/答案解析版。测试 130→**172 项**。
  - **关键兼容性坑**：桥接 `doc_insert_image` 生成的 `<a:graphicData>` **缺 `uri` 属性**，**WPS 容忍但 Word 报错打不开**——只在 WPS 里测会漏掉这个致命问题。
  - **`\Delta` 显示成 `&Delta;` 是系统性根因**：桥接对一批符号命令输出 HTML 实体名（78 个命令扫描确认），需对 `<m:t>` 做实体还原。
  - **导出已改为真正只读**（`db.connect_readonly()` + `schema_ready`），完整导出后 `bank.db` hash/mtime 未变。
  - **题号剥离保险**：行首数字必须等于快照原题号才剥离，避免误删 `3．14` 这类正文数字。

## 导出控制字符（2026-10-11，🔴 级，务必记住）
- **桥接两个插入工具对 TAB 的容忍度不同**：`doc_insert_text` **在段首/段中/段尾任意位置都拒绝** TAB（`code=9`）、垂直制表 `code=11`；而 `doc_insert_paragraph_with_text` **接受**。只测一条路径会漏掉致命问题。
- 真实故障：`A．⟦F66⟧，⟦F67⟧\tB．` 这类「占位符后紧跟 TAB」切段后产生**以 TAB 开头的文本段**，直送 `doc_insert_text` 即失败，**整卷导出中断**。波及：文本含 TAB **1,393 题**、必失败 **89 题**、交付样例卷 #1 命中 2 题。
- 修复：`bank/export.py::bridge_safe_text()` 把 `\t` 换哨兵 `BRIDGE_TAB_SENTINEL`（`U+E000`，实测桥接可接受且原样落盘）、剔除其余控制字符；`_set_explicit_tab_stops()` 在 OOXML 层还原为**真正的 `<w:tab/>`** 并补制表位停靠点。**哨兵残留必须为 0**（漏做后处理会显示豆腐块）。
- **`text_to_lines` 的 docstring 曾谎称「`\t` 转 4 空格」**——不要相信 docstring，要看代码。
- 选项标签判定（`is_option_label_segments`）**不能用「整段全是纯文本」**：真实选项行含行内公式，须用「可见文本」判定。
- **构建漂移**：实现者构建后若源码又改动，其报告里的产物 hash 即失效，**以当前源码重建为准**。
- `embed_metadata.py::insert_html` 曾按大写 `<!DOCTYPE html>` 查找，Vite 产物是小写 → 已改大小写不敏感，并**跳过 `webui/static/` 构建产物**。
- `webui/static/assets` 因 `emptyOutDir:false` 堆积旧 hash 入口包 → `frontend/scripts/prune-stale-assets.mjs` 已接入 `npm run build`。

## 本轮基线（2026-10-11）
- 后端 **360 项（359 通过 / 1 skip）**；前端 **26 项**；tsc exit 0；build 成功。
- `outputs/bank.db` sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（64,815,104B）。
- API：**43 路径 / 49 操作**。资产清单 **164 条**。
- 导出门禁 revision：`export-content-p0-v5`；布局 revision：`export-layout-p0-v4`。
- 测试必须用 venv：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`（裸 `python` 会跑成 215 项 / 20 errors）。
- 测试基数：后端 **373 项（372 通过 / 1 skip）**、前端 **26 项**（截至 2026-10-11）。

### 上线就绪度（2026-10-11 评估，勿重复踩）
- **两种口径结论不同**：单人本地基本就绪（差 Git 凭据、`启动题库.bat` 硬编码 venv 路径不可移植、首启需手动 init+导入且 `bank.db` 62MB 不分发）；**10 人团队口径远未就绪**——缺权限体系（`webui/` 零认证代码）、缺局域网/异地（只绑 `127.0.0.1`，`webui/config.py:53`）、桥接**必须串行**（并发 `WinError 10048`）、数据分发未定义。
- ⚠️ **元数据「100%」是占位符假象**：`difficulty` 全为「未标注」（有效 0%）；`grade` 有效 44/209=21%、`textbook` 39/209=19%、`chapter` 53/209=25%；答案 50%、解析 58%。**统计覆盖率必须排除「未标注/待补充」取值**，否则会误判为「齐全」。
- 其余：前端单 chunk 1058kB 无分割、无错误监控、无备份 SOP、`\begin{array}` 1 条公式桥接不支持（降级+告警）。
- 评估文档：`deliverables/上线就绪度评估-2026-10-11.md`。

### 版本拆分（editions，2026-10-11）
- **架构：一个内核 + 两个版本外壳**。`bank/` `pipeline/` `webui/` `frontend/` 共享，业务代码零分叉；
  差异全部收敛到 `webui/edition.py`（`QB_EDITION` / `QB_HOST` / `QB_PORT` / `QB_AUTH_TOKEN`）。
- `QB_AUTH_TOKEN` **不设置 = 不启用鉴权**，与历史行为完全一致（既有测试零改动通过）。
- **线上版硬约束**：导出依赖 editor_sdk+Office（Windows 专有）→ 线上版必须 Windows 宿主；
  桥接单实例 → 并发导出 `WinError 10048`；鉴权仅访问控制级，无用户/角色。
- 启动器：`editions/local/启动题库.bat`（可移植，`BANK_PY` > `.venv` > `PATH`）；根目录旧脚本已删。
- 测试基数：后端 **387 项（386 通过 / 1 skip）**、前端 26 项。资产清单 168 条。

### 前端重构准备（2026-10-11）
- **技能市场工具 `search_and_install_skills` 返回 404 不可用**；改用 SkillHub API
  （`https://lightmake.site/api/v1/search?q=...`，见 `find-skills` 技能）检索下载。
  已装（用户级）：`ui-design`、`web-accessibility`、`ux-usability-auditor`、`ui-ux-pro-max`。
- **npm 素材库踩坑**：`vitest` 必须用 **2.x**（5.x 要求 vite≥6，与本项目 vite 5 冲突 ERESOLVE）。
- 前端分析结论（`deliverables/前端完整分析与重构方案-2026-10-11.md`）：
  **Tailwind 是挂名依赖（0 工具类使用，建议移除）**；**测试基座是最大风险**
  （26 项为源码字符串断言，重构即失效，须先建 vitest 组件测试）；5 项 P0 可用性问题。
  重构分 6 阶段（护栏先行 → 术语/IA → 设计系统 → 主流程 → 两版适配 → 性能/a11y），**不推倒技术栈**。

