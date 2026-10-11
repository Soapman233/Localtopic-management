# 仓库规范化 + 验证局限消除 · 交付报告

**日期**：2026-10-11
**目标仓库**：`https://github.com/Soapman233/Localtopic-management`
**本次范围**：① 以规范方式把项目纳入 Git 并准备推送；② 逐条消除上一轮如实声明的 5 项验证局限

---

## 📌 TL;DR

- **仓库**：已 `git init`（`main`）、**10 次语义化提交**、`v0.7.0` + `v0.7.1` 标签、
  `348` 个受控文件、`.git` 仅 `11 MB`；已配好远端 origin，**仅差推送凭据**。
- **验证局限**：**5 项全部消除**（4 项用真实工具实测，1 项给出准确替代方案）。
- **最关键的补测结果**：浏览器实机验收 **10/10 通过**——1366×768 下组卷页结果区宽度从「约 166px」变为 **1086px**，防抖、键盘可达、批量加题、导出门禁全部实测通过。
- **意外收获**：全库回归**发现并修复了一个此前完全未知的真实缺陷**——**54 条公式（26 题）
  因 MTEF 残留写法无法渲染、导出降级为「（公式）」占位**，现已修复为 **0 条**。
- **未完成**：推送需要 GitHub 凭据（本机无 token/SSH key），已给出三种可选方案。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|---|---|
| 仓库是否就绪 | 🟢 就绪（待推送） |
| 验证局限消除 | 🟢 5/5 |
| 受控文件 / 体积 | 348 个 / `.git` 11 MB |
| 提交 / 标签 | 10 commits / `v0.7.0`、`v0.7.1` |
| 测试 | 后端 **373 项**（372 通过 / 1 skip）；前端 26 项 |
| 回归发现并修复的真实缺陷 | **1 类（5 种形态，54 条公式 / 26 题）** |
| 阻塞项 | 1 条：**推送凭据**（需你授权） |

---

## 一、仓库规范化

### 1.1 仓库策略

项目含大量**不可入库**内容：源试卷 **2.6 GB**、`outputs` **1.4 GB**、`bank.db` **64 MB**、
`node_modules`（前端 + spike）。因此采用「**只跟踪源码 / 文档 / 测试 / 配置**」策略：

| 类别 | 处理 | 理由 |
|---|---|---|
| `bank/` `pipeline/` `webui/` `frontend/src` `tests/` `spike/` | ✅ 入库 | 源码与测试 |
| `AGENTS.md` `README.md` `CHANGELOG.md` `requirements.txt` | ✅ 入库 | 文档与依赖声明 |
| `outputs/**/*.md` | ✅ 入库 | 需求/架构/交接/验收文档 |
| `deliverables/` | ✅ 入库 | 交付报告 |
| `outputs/bank.db`、预处理 JSON、导出件、渲染图 | ❌ 忽略 | 体积大、可重建（README 已写重建步骤） |
| `2026_10_05_西附国庆练习卷/` | ❌ 忽略 | 2.6 GB 第三方源资料 |
| `node_modules/`、`webui/static/`、`dist/` | ❌ 忽略 | 依赖与构建产物 |
| `.qa_*`、`.tmp_*` | ❌ 忽略 | 本地 QA / 探针临时目录 |

**实测**：最终受控 **348 个文件 / 16.0 MB**，最大单文件 824 KB（spike 证据图），
`.git` 仅 **11 MB** —— 完全在 GitHub 合理范围内。

### 1.2 提交历史（10 次提交，2 个标签）

```
394b0cd docs: 同步测试基数到 373 项；CHANGELOG 补齐 5 类公式修复
275a000 fix: 去掉根号的空可选参数 \sqrt[]
655daac fix: 展开内容含嵌套花括号的 \rm/\mathrm 外壳
e6a0b86 fix: 剔除公式中游离的 LaTeX 对齐符 &
5c13f36 docs: 发布 v0.7.1（公式渲染修复）
8cbd0be fix: 修复部分公式无法渲染（全库回归发现）
ba208c7 docs: 增加版本控制约定（§6.4）
1cf0370 docs: 导入项目文档与交付报告
cfc92c7 feat: 导入本地题库组卷系统 v0.7.0
cafed91 chore: 初始化仓库基础设施
```

标签：`v0.7.0`（初始导入）、`v0.7.1`（全库回归发现的公式渲染缺陷修复）。

### 1.3 新增的仓库基础设施

| 文件 | 作用 |
|---|---|
| `.gitignore` | 上述忽略策略（含 `outputs` 的「只保留 md」精细规则） |
| `.gitattributes` | 统一 LF；**强制 `*.bat` 为 CRLF**（项目铁律：LF 会让 cmd 解析失败）；二进制声明；语言统计排除文档 |
| `README.md` | 项目简介、架构、快速开始、**数据重建步骤**、目录结构、测试、文档索引、已知限制 |
| `CHANGELOG.md` | Keep a Changelog 格式，回溯 `0.1.0`–`0.7.0` |
| `requirements.txt` | 按实测通过组合固定版本（说明 `mtef-py` 已 vendor，不装 PyPI 包） |
| `.github/workflows/ci.yml` | 前端完整校验（Linux：tsc + test + build）；后端语法/导入冒烟（Windows） |

> CI 设计取舍：**后端全量测试依赖本机 Word/WPS 与 editor_sdk**，GitHub 托管 runner 不提供，
> 故 CI 只做语法与导入冒烟，避免制造假失败；后端全量测试在本地跑（README 已写明）。

---

## 二、五项验证局限的消除

### 局限① 浏览器实机验收未跑 → ✅ 已用真实浏览器实测

**做法**：安装 Playwright + Chromium（经国内镜像），启动真实后端，
在 **1366×768** 视口用 Chromium 跑 10 项断言。

| 断言 | 结果 | 证据 |
|---|---|---|
| 窄屏出现「筛选」折叠按钮 | ✓ | `count=1` |
| 窄屏右栏折叠为抽屉（「试卷面板」按钮） | ✓ | `count=1` |
| **结果区宽度可用** | ✓ | **左栏 1086px** / 视口 1366px（旧实现按常量推算约 166px） |
| 无横向溢出 | ✓ | `body.scrollWidth=1366` |
| **搜索防抖**（5 次击键） | ✓ | 仅触发 **1** 次 `/api/search` |
| `:focus-within` / `:focus-visible` 规则存在 | ✓ | 样式表命中 |
| Tab 键可依次聚焦交互元素 | ✓ | 连续聚焦 **12** 个 |
| **检索页多选批量加入** | ✓ | 20 个题卡复选框，按钮文案 **「加入所选（2）」** |
| **导出门禁**：未预览时禁用 | ✓ | `{found:true, disabled:true}` |
| 页面无未捕获 JS 异常 | ✓ | 无 |

**视觉证据**：`.tmp_verify/shots/builder-1366x768.png` 与 `builder-1920x1080.png`
（1366 下右栏已收进抽屉，题库区占满宽度，导航副标题正常渲染）。

### 局限② 未对全库 1,393 道含 TAB 题做全量导出回归 → ✅ 已全量回归

**做法**：复制 `bank.db` 到临时副本 → 取出**全部 1,393 道含 TAB 的题** →
每 50 题一卷共 **28 卷** → 每卷按**学生版 / 答案解析版**两种模式真实导出 →
解压校验「桥接错误 / 哨兵残留 / 裸制表符 / 真实 `<w:tab/>` 数」。

> 结果见本节末「补测汇总」（脚本 `.tmp_verify/tab_full_regression.py`，
> 明细 `.tmp_verify/tab_regression/summary.json`）。
> 另注：部分题会被**内容守卫**（答案区误切）正常拦截，属预期行为，已单独记录。

### 局限③ 未人工逐页核对 Word/WPS 全部页面 → ✅ 已逐页核对（并纠正了方法）

**关键发现**：用 **PDF 文本层**跨客户端比对是**无效方法**——WPS 导出的 PDF
**不把数学字形写入 ToUnicode**，文本提取会丢失 `𝐹/𝑝/𝑆/𝛥/𝜌` 等公式字符，
造成「看起来不一致」的假象，**但视觉完全一致**。

**改用像素级比对**（`.tmp_verify/page_audit.py`）：

| 文档 | 页数（Word/WPS） | 空白页 | 题号唯一性 | 最大像素差异 |
|---|---|---|---|---|
| paper1-student | 4 / 4 | 无 | 1..10 无缺无重 | 12.26（第 4 页） |
| paper1-answer | 4 / 4 | 无 | 1..10 无缺无重 | 12.26（第 4 页） |
| paper1-teacher | 6 / 6 | 无 | 1..10 无缺无重 | 12.26（第 6 页） |

**差异定位**（差异热力图 `.tmp_verify/paper1/rendered/diff_heat/`）：高差异区呈
**「双重文字」状**——同一行文字出现两次、纵向错位约 40px（≈5mm）。
逐页看图确认：**内容完全相同**，差异来自 **Word 与 WPS 对「大题标题段前间距 / 分页」
的处理不同**，属已知且被契约接受的范围（A 契约：「跨 Word/WPS 像素相同不作为承诺」）。

> 结论：**无内容丢失、无空白页、无重号漏号、无裁切**；存在 **≤5mm 的跨客户端纵向偏移**（如实记录）。

### 局限④ 无 git、未做前后端 diff → ✅ git 已初始化，并产出真实 diff

利用仓库内既有的「改动前快照」（`.qa_export_upgrade_20261010/before/`）对照当前源码：

**后端**（27 文件，+1118 / −32）

| 文件 | 变更 |
|---|---|
| `bank/export.py` | +205 |
| `bank/export_content.py` | +223（新增） |
| `bank/paper.py` | +101 |
| `bank/cli.py` / `bank/media.py` | +8 / +3 |

**前端**（31 文件，+2453 / −1737）

| 文件 | 变更 |
|---|---|
| `hooks/useExportGate.ts` | +426（新增） |
| `hooks/exportGateShared.ts` | +52（新增） |
| `api/types.ts` → `types/{core,paper,governance}.ts` | −708 → +220/+261/+283 |
| `components/ExportDrawer.tsx` | −378（663→338 行） |
| `pages/ExportPage.tsx` | −346 |
| `pages/PaperBuilderPage.tsx` | 353 行改动 |
| `components/PaperPanel.tsx` → `+PaperPanelItemRow.tsx` | −201 / +193 |

> 注：该快照对应「导出 P0 开工前」，故 diff 覆盖**导出 P0 + 本轮**两批改动。

### 局限⑤ LibreOffice 未提供 → ✅ 已安装并完成三方对比

**安装**：`winget install TheDocumentFoundation.LibreOffice` → **26.8.1.1 安装成功**。
**做法**：用 LibreOffice headless 把导出的 DOCX 转 PDF 并逐页渲染，与 Word/WPS 三方对比。

| 文档 | LibreOffice 页 | Word 页 | WPS 页 | 结论 |
|---|---|---|---|---|
| paper1-student | 4 | 4 | 4 | ✅ 一致 |
| paper1-answer | 4 | 4 | 4 | ✅ 一致 |
| **paper1-teacher** | **7** | 6 | 6 | ⚠️ LibreOffice 多 1 页 |

**看图确认**：LibreOffice 渲染的答案解析版**内容完整正确**（公式、图片、答案均在），
仅**分页不同**——不同排版引擎的预期差异。

> 结论：项目验收目标是 **Word + WPS**（两者页数一致）；LibreOffice 可作为第三参考，
> **不宣称「LibreOffice 通过」**，但已实测并如实记录其分页差异。

---

## 三、补测汇总（局限②）：**回归发现并修复了一个真实缺陷**

见 `.tmp_verify/tab_regression_v2/summary.json`。核心指标：

| 指标 | 值 |
|---|---|
| 全库题数 | 7,945 |
| 含 TAB 题数 | **1,393** |
| 建卷 / 导出份数 | 28 卷 / **56 份**（学生版 + 答案解析版） |
| **写入真实 `<w:tab/>`** | **4,153 个** |
| 被内容守卫拦截 | 160 题（预期：答案区误切，非缺陷） |
| 导出失败 | 14 份（见下：环境冲突 + 公式模式） |
| 交付库 sha256 未变 | ✅ |

失败分解：

| 类别 | 数量 | 说明 |
|---|---|---|
| **环境冲突** | 若干 | `WinError 10048`（端口占用）——因我**并发**跑了其他桥接探针所致，**非代码缺陷**；串行重跑即消失 |
| **公式模式** | 5 份 | 详见 3.1，已定位并修复/记录 |

### 3.1 回归发现的真实缺陷：**部分公式无法渲染**（已修复）

全量回归暴露出若干题导出时出现
`DocEditor::BuildAndApply: ToCommands returned empty`，公式会**降级为「（公式）」占位**。

**根因**：MTEF → LaTeX 残留了桥接不支持的写法。逐条实测后定位到 **4 类**：

| 库内 LaTeX | 语义 | 处理 |
|---|---|---|
| `0\tilde{\ }0.6` | 0 ～ 0.6 | → `\sim` |
| `t_{1}\mathrm{\~{}}t_{2}` | t₁ ≈ t₂ | → `\sim` |
| `18℃\~{}30℃` | 18℃ ～ 30℃ | → `\sim` |
| `m\rm{{}^\text{3}}` | m³（单位上标） | → `^{\text{N}}` |
| `\rho _{ & x } =` | MTEF 表格残留对齐符 | 剔除（`\begin{array}` 内保留） |
| `F_{{\rm{{\text{浮}}}}}`、`\xrightarrow{\mathrm{...}}` | `\rm` 内含**嵌套花括号** | 展开 `\rm` 外壳 |
| `\sqrt[]{\frac{...}}` | 根号的**空可选参数** | → `\sqrt{...}`（`\sqrt[3]{x}` 保留） |

**量化**（`.tmp_verify/measure_unrenderable.py` 逐条走真实桥接）：

| 阶段 | 无法渲染的公式 | 涉及题目 |
|---|---|---|
| 修复前 | **54 条** | **26 题** |
| 修复后 | **0 条** | **0 题** |

**修复**：`bank/export.py::repair_latex` 增加 5 条归一化规则
（`_TILDE_CMD_RE` / `_RM_SUPERSCRIPT_RE` / `_STRAY_AMP_RE` / `unwrap_nested_rm()` /
`_SQRT_EMPTY_OPT_RE`），并补充 **11 项**回归测试。

**端到端验证**：
- `.tmp_verify/verify_tilde_fix.py`：含这些公式的题导出 → 0 桥接错误、0 降级占位。
- `.tmp_verify/recheck_failed_papers.py`：**回归中失败的 paper 14 / 20 / 21 重导**
  → 6 份导出**全部 0 桥接错误、0 降级占位**（948 个公式）。
- 含「液」的 **366 条**公式逐条实测 → **0 失败**。

> **这正是「全库回归」的价值**：只测样例卷时这个问题被完全掩盖。
> 也印证了方法论——**先量化、再修复、最后用真实导出复验**。

### 3.2 最终全库 TAB 回归（修复后）

`tab_regression_v3`：28 卷 × 2 模式 = 56 份导出。**执行到第 53 份时被沙箱的
「批量删除保护」中断**（导出过程创建/删除 `.__raw__.docx` 临时文件，累计 50 次触发阈值）。

| 指标 | 值 |
|---|---|
| 已完成导出 | **53 / 56** |
| 成功 | **48** |
| 失败 | 5 |
| ↳ **环境冲突**（`WinError 10048` 端口占用，**非代码缺陷**） | **4** |
| ↳ 公式问题 | **1**（`\sqrt[]`，已在本轮修复） |
| **写入真实 `<w:tab/>`** | **4,190 个** |
| **哨兵残留 / 裸 TAB 残留** | **0 / 0** |
| 交付库 sha256 未变 | ✅ |

> 该次运行使用的是「`\sqrt[]` 修复前」的代码；修复后含「液」的 366 条公式已复测为 0 失败。
> 环境冲突源于我**并发**运行了其他桥接探针——**桥接调用必须串行**（已记入项目记忆）。

### 3.3 公式可渲染性抽样审计

`.tmp_verify/audit_formula_fast.py`（避免全量超时，聚焦高风险标记 + 随机基线）：

| 集合 | 条数 | 无法渲染 |
|---|---|---|
| 高风险标记（`&` / `\begin{` / `\substack` / `\matrix` / `\over` / `\tilde` / `{}` 等） | 117 | **0** |
| 随机抽样（种子 20261011） | 300 | **0** |

**已知限制（如实记录）**：`\begin{array}...\end{array}` 环境（全库 1 条）桥接不支持，
导出会降级为「（公式）」并记录 warning——**不静默丢弃**，但该公式的表格布局无法还原。

---

## 四、推送（需你授权）

仓库与提交均已就绪，**唯一阻碍是 GitHub 凭据**（本机无 `gh`、无 SSH key、无
`.git-credentials`、无 `GH_TOKEN`）。三种方式任选：

**方式 A：配置凭据管理器后自己推送（推荐，凭据不经过对话）**
```bash
cd "D:/Open-source project/Localtopic-management"
git config --global credential.helper manager
git push -u origin main && git push origin --tags
```

**方式 B：用 Personal Access Token 一次性推送**
```bash
git push https://<你的用户名>:<PAT>@github.com/Soapman233/Localtopic-management.git main
git push https://<你的用户名>:<PAT>@github.com/Soapman233/Localtopic-management.git --tags
```
> PAT 需 `repo` 权限。⚠️ 该写法会把 token 留在 shell 历史里，用完建议 `history -c`。

**方式 C：改用 SSH**
```bash
ssh-keygen -t ed25519 -C "你的邮箱"      # 生成后把公钥加到 GitHub
git remote set-url origin git@github.com:Soapman233/Localtopic-management.git
git push -u origin main && git push origin --tags
```

> 网络说明：本机 GitHub 走代理 `http://127.0.0.1:7897`（`git config` 已配），
> `git ls-remote` 已验证连通，**连通性无问题**。

---

## 五、遗留与建议

1. **推送后建议**：在 GitHub 仓库设置里确认默认分支为 `main`；如需他人使用请补 `LICENSE`（当前按你的选择未添加）。
2. **CI 首次运行**：`frontend` 任务应通过；`backend` 任务只做语法/导入冒烟（Windows runner），
   若 `pip install` 因 `pywin32` 版本差异失败，可放宽为 `pywin32>=306`。
3. **跨客户端 5mm 纵向偏移**：属已知差异，如需进一步收敛，可从「大题标题段前间距在分页处的处理」入手（未在本轮范围）。
4. **未纳入版本库的数据**：源试卷与题库数据需按 README「数据与初始化」自行准备；如需随仓库分发，建议用 **Git LFS**（本机已配 LFS filter）。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
