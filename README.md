# 本地题库管理与组卷系统（初中物理）

> 把真实试卷 DOCX 变成**可检索、可组卷、可导出**的私有题库：从 Word 里抽题建库 → 检索筛选 → 组卷 → 导出**公式可编辑**的成品试卷 → 本地 Web 界面操作。
>
> **核心难点**：源试卷里的数学公式是**旧式 MathType OLE 对象**，必须转换成**原生 OMML**，才能保证导出的 DOCX 在 **Microsoft Word 与 WPS 双端都可编辑**。

面向约 10 名中学教师设计，首个学科为**初中物理**。

项目按运行形态分为**两个版本**（**共享同一套内核**，业务代码零分叉）：

| 版本 | 定位 | 入口 |
|---|---|---|
| **本地运行版** | 一名老师在自己电脑上用；仅监听 `127.0.0.1`，无账号 | [`editions/local/`](editions/local/README.md) |
| **线上部署版** | 局域网 / 服务器上多人共用；`0.0.0.0` + nginx 访问控制 | [`editions/online/`](editions/online/README.md) |

> 分类总览与切换方式见 [`editions/README.md`](editions/README.md)。

---

## 目录

- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [数据与初始化](#数据与初始化)
- [目录结构](#目录结构)
- [测试](#测试)
- [文档索引](#文档索引)
- [已知限制](#已知限制)
- [开发约定](#开发约定)

---

## 功能特性

| 模块 | 能力 |
|---|---|
| **阶段1 预处理** | 扫描试卷 DOCX，定位 OLE/OMML 公式与图片；**MathType MTEF → LaTeX** 精确解码（非 OCR）；题目切分与整卷答案区识别 |
| **阶段2 题库** | SQLite（11 张业务表 + FTS5）；幂等导入；**中文 bigram + FTS5 + bm25** 检索（毫秒级）；题目版本留档；待复核队列 |
| **阶段3 组卷** | 试卷 CRUD、加题、重排、分值、大题分组；**快照锁定**（出卷后改题不影响已出卷） |
| **阶段4 导出** | 学生版 / 答案解析版 / 仅答案 × DOCX/PDF × 考试/测验/作业三种模板；公式为**原生 OMML**；图片尺寸自适应；页脚页码；真实制表位选项对齐 |
| **内容守卫（P0）** | 答案区误切条目**阻断出卷**并给出逐条诊断；提供「查看修订候选 → 创建修订卷」的显式闭环；旧缓存/旧预览不可旁路 |
| **Web 界面** | 9 个页面：检索 / 单题详情 / 组卷工作台 / 导出中心 / 知识点复核 / 待复核公式 / 来源文件 / 题库统计 / 系统设置；**强制先预览后导出**的门禁 |

---

## 技术架构

```
真实试卷 DOCX
    │
    ▼  阶段1  pipeline/          —— DOCX 解析、公式转换（MTEF→LaTeX）、题目切分
结构化 JSON
    │
    ▼  阶段2  bank/              —— SQLite 题库、检索、元数据、答案抽取
bank.db
    │
    ▼  阶段3  bank/paper.py      —— 组卷、快照锁定
    │
    ▼  阶段4  bank/export.py     —— 导出 DOCX/PDF（原生 OMML）
    │
    ▼  Web   webui/ + frontend/  —— FastAPI + React 界面
```

- **依赖方向**：`pipeline` → `bank` ← `webui` ← `frontend`
- **webui 只调用 `bank/` 的函数，不复制业务逻辑。**
- 后端 FastAPI（43 个路径 / 49 个 API 操作），统一返回 `{code, data, message}`。
- 前端 Vite 5 + React 18 + TypeScript + MUI 5 + Tailwind 3 + KaTeX。

---

## 快速开始

### 环境要求

| 项 | 要求 |
|---|---|
| 操作系统 | **Windows**（导出/预览依赖本机 Word 或 WPS 的 COM 自动化） |
| Python | 3.13（实测 3.13.x） |
| Node.js | 20+（实测 22.x），仅前端构建需要 |
| Office | Microsoft Word 或 WPS（导出 PDF / 像素预览需要；缺失时降级为仅导出 DOCX） |
| 其它 | 导出依赖本机 `editor_sdk` 服务（LaTeX → OMML 渲染） |

### 安装

```bash
# 1) Python 依赖
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# 2) 前端依赖与构建（产物写入 webui/static/，由后端托管）
cd frontend
npm install
npm run build
cd ..
```

### 启动

```bash
# 方式一：一键启动（**本地运行版**；Windows，自动做环境自检并打开浏览器）
editions\local\启动题库.bat

# 方式二：手动
python -m webui

# 方式三：**线上部署版**（监听 0.0.0.0；浏览器访问请置于 nginx 之后）
set QB_EDITION=online && set QB_HOST=0.0.0.0 && python -m webui
```

启动后访问 `http://127.0.0.1:8720`（线上版为 `http://<服务器IP>/`）。

> ⚠️ `editions/local/启动题库.bat` **必须保持 CRLF 换行**（LF 会让 cmd 解析失败、脚本一闪即退），
> 仓库已用 `.gitattributes` 锁定。

### 常用命令

```bash
# 全量测试（当前基线 387 项：386 通过 / 1 skip）
python -m unittest discover -s tests

# CLI
python -m bank.cli stats                     # 题库统计
python -m bank.cli search "浮力"             # 检索
python -m bank.cli paper show 1              # 查看试卷
python -m bank.cli export paper 1 --answer-mode 学生版 --out out.docx
python -m bank.cli export verify out.docx    # 验证公式双端可编辑性（Word+WPS）

# 前端
cd frontend && npx tsc --noEmit              # 类型检查
cd frontend && npm test                      # 前端回归（26 node:test + 178 vitest）
cd frontend && npm run build                 # 生产构建
```

---

## 数据与初始化

> **本仓库不包含源试卷、题库数据与中间产物**（体积达 GB 级，且源试卷为第三方资料）。
> 仓库只跟踪**源码、文档、测试与配置**。克隆后需按下述步骤自行准备数据。

```bash
# 1) 建库（建表建索引）
python -m bank.cli init --db outputs/bank.db

# 2) 阶段1：把试卷 DOCX 转成结构化 JSON
python -m pipeline.stage1 <你的试卷目录> --out outputs/preprocess_final

# 3) 阶段2：导入题库（幂等，可重复执行）
python -m bank.cli import outputs/preprocess_final --db outputs/bank.db

# 4) 可选：抽取答案/解析、补全元数据、规范化 LaTeX
python -m bank.cli answers   --db outputs/bank.db
python -m bank.cli enrich    --db outputs/bank.db
python -m bank.cli normalize --db outputs/bank.db
```

**关键路径**

| 路径 | 说明 |
|---|---|
| `outputs/bank.db` | **交付数据**（SQLite 单文件）。导出/预览/检索为**只读**操作 |
| `outputs/preprocess_final/` | 阶段1 产出（结构化 JSON） |
| `outputs/export/` | 导出的试卷产物 |
| `outputs/webui/settings.json` | Web 设置（DB 路径、导出目录、模板、主题） |

> ⚠️ **不要把 `outputs/bank.db` 放在网络共享盘上给多人同时使用**——SQLite 在网络盘上文件锁不可靠，会损坏数据。

---

## 目录结构

```
.
├── bank/                # 阶段2/3/4：题库、检索、组卷、导出、编辑、复核
│   ├── db.py            #   连接与 schema（含只读连接）
│   ├── query.py         #   检索（bigram + FTS5 + bm25）
│   ├── paper.py         #   组卷与快照锁定
│   ├── export.py        #   DOCX/PDF 导出（原生 OMML）
│   ├── export_content.py#   内容守卫、分支实例、诊断与修订
│   ├── edit.py          #   在线编辑与留版
│   └── cli.py           #   命令行入口
├── pipeline/            # 阶段1：DOCX 解析、公式转换、题目切分
│   ├── docx_scan.py     #   扫描公式对象与图片
│   ├── mtef_conv.py     #   MathType MTEF → LaTeX（核心能力）
│   ├── omml.py          #   OMML → LaTeX
│   ├── segment.py       #   题目切分
│   ├── answer_regions.py#   整卷答案区识别
│   └── vendor/mtef_py/  #   vendored MTEF 解析器（Apache-2.0）
├── webui/               # Web 后端（FastAPI）
│   ├── app.py / __main__.py
│   ├── routers/         #   search/questions/papers/export/labels/review/sources/stats/settings
│   └── services/        #   对应业务层（只调用 bank/）
├── frontend/            # Web 前端（Vite + React + TS）
│   ├── src/pages/       #   9 个页面
│   ├── src/components/  #   组件（含 LivePreviewPanel / ExportDrawer 等）
│   ├── src/hooks/       #   含 useExportGate（导出门禁唯一实现）
│   └── tests/           #   前端回归测试
├── tests/               # 后端测试
├── editions/            # **版本分类目录（共享内核，两个版本外壳）**
│   ├── README.md        #   分类总览：对照表 / 如何选择 / 如何切换
│   ├── local/           #   版本一：本地运行版（一键启动 + 使用说明）
│   └── online/          #   版本二：线上部署版（nginx / Docker / 部署指南）
├── outputs/             # 数据与产物（**仅 *.md 文档入库**）
├── deliverables/        # 交付报告
├── spike/               # 独立探针原型（A4 分页等）
├── .workbuddy-ai/       # 项目级 AI 工具与记忆（含资产清单/元数据脚本）
├── AGENTS.md            # **项目全景与开发约定（必读）**
├── requirements.txt
└── .gitignore / .gitattributes
```

---

## 测试

```bash
# 后端（387 项：386 通过 / 1 skip）
python -m unittest discover -s tests

# 前端（26 node:test + 178 vitest）
cd frontend && npm test
```

| 层 | 项数 | 说明 |
|---|---|---|
| 后端 | **387**（386 通过 / 1 skip） | 题库、检索、组卷、导出、内容守卫、版本/鉴权、Web API 等 |
| 前端 | **204** | `node:test` 26（门禁纯函数、主题、公式显示、设置 store、删除确认护栏）+ `vitest` 178（组件行为测试、错误契约与反馈底座、术语映射、导航分组与路由不变量、四态组件、筛选 hook、作业轮询、**页面级集成测试**、**代码分割护栏**、**对比度契约**、**无障碍语义**） |

> 后端测试为 **Windows 专用**（导出相关用例依赖 `pywin32` 与 Office）。
>
> 前端 `vitest` 组件测试基座于**重构阶段 0** 建立（`frontend/tests/unit/`，jsdom + Testing Library），
> 用于替换原先「源码字符串断言」式的脆弱测试。阶段 1 补了术语、导航、筛选三组，阶段 2 补了四态组件，
> 阶段 3 补了筛选 hook、作业轮询、页面级集成测试，阶段 5 补了代码分割、对比度、无障碍。
> **视觉回归**见 `frontend/tests/visual/`（1366×768 像素比对 + 差异热力图）。
> **对比度门禁**已接进 `npm run build`（`npm run contrast`，配置见 `frontend/tests/visual/contrast-pairs.json`）。
> 详见 `deliverables/前端重构阶段0-护栏先行-2026-10-11.md`、
> `deliverables/前端重构阶段1-术语与信息架构-2026-10-11.md`、
> `deliverables/前端重构阶段2-设计系统统一-2026-10-11.md` 与
> `deliverables/前端重构阶段2-设计系统统一-2026-10-11.md`。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| **`AGENTS.md`** | **项目全景**：架构、数据模型、必须遵守的约定、已踩过的坑、当前状态 |
| `editions/README.md` | **版本分类**：本地运行版 vs 线上部署版（对照、选择、切换） |
| `editions/online/README.md` | **线上部署指南**：架构、硬约束、部署步骤、鉴权、已知限制 |
| `outputs/webui/PRD-题库Web界面.md` | 产品需求（9 页面、P0/P1/P2） |
| `outputs/webui/架构设计.md` | 架构与 API 契约 |
| `outputs/webui/流程重构设计.md` | 双层预览与强制门禁设计 |
| `outputs/webui/使用说明.md` | 面向老师的操作说明 |
| `outputs/export-upgrade-20261010/README.md` | 导出 P0（内容守卫 / 分支实例 / 修订卷）阶段收口索引 |
| `outputs/handoff/` | 各阶段 R/P/A/D/T/V 交接文档 |
| `deliverables/` | 独立评估与交付报告 |

---

## 已知限制

**数据侧（源资料本身的情况，界面会如实显示）**

- **年级 / 教材约 82%、章节约 64% 缺失** → **按年级筛选会漏题**，请优先用关键词检索。
- **难度 100% 为空**（源数据无标注，刻意不自动推断），需教研组人工标注。
- **答案覆盖约 50%**；知识点为「**提及**」口径而非「考查」口径，仅作检索线索。
- 少量公式仍在待复核队列中。

**功能侧**

- **纯本地单机**：无账号体系、无异地访问、无并发形态设计（10 人团队共用**未达标**）。
- 导出依赖本机 `editor_sdk` + Word/WPS；缺失时降级为仅导出 DOCX（两个入口都会正确降级）。
- 图片行内位置未还原（统一居中附在题干后）。
- 撤销为「**重建同内容副本**」而非原样恢复（后端无恢复接口）。
- 结构预览的超长单题分页为近似值，定稿请以像素预览为准。

---

## 开发约定

**动手前请先读 `AGENTS.md`**，其中包含：三个硬门禁、交接文档规范、必须遵守的数据安全约定，以及一份**「已踩过的坑」清单**（务必复用，不要重蹈）。

几条最容易踩的：

1. **改任何东西前先跑测试**，确认基线（387 项）。
2. **碰 `outputs/bank.db` 前先备份**；写入类验证请用**副本**。
3. **改排版 / 导出后必须渲染出来看**——单元测试测不出视觉缺陷。
4. **验证「修复类改动」要用反证**：确认修复前确实有问题。
5. **`.bat` 文件必须保持 CRLF 换行。**
6. **前端改动后必须跑** `npx tsc --noEmit` 与 `npm run build`。

---

## 许可证

本项目**暂未附加开源许可证**（默认保留所有权利）。

> `pipeline/vendor/mtef_py/` 为第三方组件，按 **Apache-2.0** 分发，
> 详见 `pipeline/vendor/mtef_py_LICENSE.txt` 与 `mtef_py_NOTICE.txt`。
