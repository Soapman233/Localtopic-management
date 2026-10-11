"""构建交付物元数据清单：``outputs/metadata/asset_manifest.json`` + ``.md``。

清单覆盖交付文档、阶段1/阶段2 代码、测试、构建/验证脚本与数据产物。每条含：
``id, path, title, description, keywords[], author, created, modified, version,
category[], size_bytes, stage``。

* ``author`` 统一 ``待补充``（用户明确要求）。
* ``created`` / ``modified`` 取文件系统时间（ISO 8601，带时区）；相同则如实写相同值。
* ``version`` 首次交付统一 ``0.1.0``；版本策略为「阶段制，暂用 0.x」。

可直接运行：``python .workbuddy-ai/build_asset_manifest.py``。
``embed_metadata.py`` 复用本模块的 :data:`ASSETS`。
"""
# ---------------------------------------------------------------------------
# title: 资产清单构建脚本
# description: 生成交付资产清单，覆盖R/A/D/T交接、复核页及当前静态入口引用，按实际文件同步尺寸和时间。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------





from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "outputs" / "metadata"

AUTHOR_DEFAULT = "待补充"
VERSION_DEFAULT = "0.1.0"
VERSION_POLICY = "阶段制，暂用 0.x（首次交付 0.1.0）"

# 分类取值域
CAT_DELIVERABLE = "交付报告"
CAT_STAGE1 = "阶段1-预处理"
CAT_STAGE2 = "阶段2-题库"
CAT_STAGE3 = "阶段3-组卷"
CAT_STAGE4 = "阶段4-导出"
CAT_TEST = "测试"
CAT_TOOL = "工具脚本"
CAT_DATA = "数据产物"
CAT_DOC = "文档"
CAT_WEBUI = "Web界面"

# --------------------------------------------------------------------------- #
# 资产清单（相对项目根目录）
# --------------------------------------------------------------------------- #
ASSETS: list[dict] = [
    {'path': 'outputs/handoff/R-复核公式分类.md', 'title': 'R复核公式分类交接', 'description': '145条当前源只读分类、13条件候选与人工路径证据。', 'keywords': ['公式', '交接'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'outputs/handoff/A-复核公式契约冻结.md', 'title': 'A复核公式契约冻结交接', 'description': 'G1冻结允许范围、准入、接口与数据安全契约。', 'keywords': ['公式', '交接'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'outputs/handoff/T-复核公式验证.md', 'title': 'T复核公式独立验证交接', 'description': '13条G3独立验收、源图及双端编辑、完整数据审计与非阻塞限制。', 'keywords': ['公式', '交接'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'frontend/src/pages/FormulaReviewPage.tsx', 'title': '复核公式队列页', 'description': '复核队列、真实转换状态提示与PNG保真限制说明。', 'keywords': ['复核', '界面'], 'category': ['Web界面'], 'stage': 'Web界面'},
    {'path': 'tests/test_mtef_strict_records.py', 'title': '严格v5记录兼容测试', 'description': '严格字段边界、缺损反例及普通路径不启用兼容。', 'keywords': ['公式', '验证'], 'category': ['测试'], 'stage': '测试'},
    {'path': 'outputs/handoff/D-复核公式修复.md', 'title': 'D复核公式修复交接', 'description': '13条公式准入、双端编辑、事务备份与剩余人工路径。', 'keywords': ['公式', '交接'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'outputs/formula-rdt-20261010/README.md', 'title': '复核公式分类与修复索引', 'description': '本轮研究、修复及验证证据索引与当前真实数量。', 'keywords': ['公式', '验证'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'pipeline/vendor/mtef_py/mtef.py', 'title': 'MTEF v5 解析器', 'description': '上游解析器及本地兼容修正；尊重 chars 表中 EF01 和零宽字符的空字符串映射。', 'keywords': ['公式', '验证'], 'category': ['阶段1-预处理'], 'stage': '阶段1-预处理'},
    {'path': 'tests/test_private_glyphs.py', 'title': '私有字形清洗测试', 'description': '真实空映射、未知字形警告、中文及无图页脚命名空间回归。', 'keywords': ['公式', '验证'], 'category': ['测试'], 'stage': '测试'},
    {'path': 'outputs/backlog-20261010/T3-私有字形修复与验证.md', 'title': 'T3 私有字形修复与验证', 'description': '全库私有字形诊断、EF01 根因修复、未知字符降级与新导出双端验证。', 'keywords': ['公式', '验证'], 'category': ['交付报告'], 'stage': '交付报告'},

    {'path': 'bank/formula_repair.py', 'title': '已核对公式修复', 'description': '乐观校验、整批事务、按题留版和幂等写回，不自动批准候选。', 'keywords': ['复核', '验证'], 'category': ['阶段2-题库'], 'stage': '阶段2-题库'},
    {'path': 'tests/test_formula_repair.py', 'title': '公式修复事务测试', 'description': '验证留版、幂等、冲突与更新后故障整批回滚。', 'keywords': ['复核', '验证'], 'category': ['测试'], 'stage': '测试'},
    {'path': 'tests/test_mtef_legacy_v5.py', 'title': '旧公式 v5 转换测试', 'description': '真实流版本核验及候选仍保留复核。', 'keywords': ['复核', '验证'], 'category': ['测试'], 'stage': '测试'},
    {'path': 'outputs/backlog-20261010/T1-元数据诊断与筛选风险.md', 'title': 'T1 元数据诊断与筛选风险', 'description': '逐来源诊断与筛选漏题风险提示验证。', 'keywords': ['复核', '验证'], 'category': ['交付报告'], 'stage': '交付报告'},
    {'path': 'outputs/backlog-20261010/T2-公式复核与修复.md', 'title': 'T2 公式复核与修复', 'description': '196 条分类、51 条修复、源图及双端编辑验证、备份和余项。', 'keywords': ['复核', '验证'], 'category': ['交付报告'], 'stage': '交付报告'},

    # --- 交付文档 -----------------------------------------------------------
    {
        "path": "outputs/公式可编辑验证报告-30题.md",
        "title": "公式可编辑验证报告（30题三路径）",
        "description": "记录 30 道真实物理题在 OMML / MathType / PDF 三条路径下的公式可编辑性"
                       "实测结果，含 WPS 与 Microsoft Word 双客户端验证。",
        "keywords": ["公式可编辑", "OMML", "MathType", "MTEF", "WPS", "双客户端验证"],
        "category": [CAT_DELIVERABLE], "stage": "交付",
    },
    {
        "path": "outputs/阶段1-2验证报告.md",
        "title": "阶段1 / 阶段2 实现验证报告",
        "description": "记录阶段1 预处理管线与阶段2 题库数据模型的验证方法、步骤与实测结果。",
        "keywords": ["验证报告", "阶段1", "阶段2", "预处理", "题库"],
        "category": [CAT_DELIVERABLE], "stage": "交付",
    },
    {
        "path": "outputs/physics_material_diagnostics.html",
        "title": "物理素材结构诊断（HTML）",
        "description": "对约 750 份真实物理素材的只读结构诊断，统计 DOCX 公式结构分布、PDF 文本层"
                       "与异地访问候选方案。",
        "keywords": ["素材诊断", "DOCX", "PDF", "公式结构", "HTML报告"],
        "category": [CAT_DELIVERABLE, CAT_DOC], "stage": "交付",
    },
    # --- 阶段1 代码 ---------------------------------------------------------
    {
        "path": "pipeline/__init__.py",
        "title": "pipeline 包入口",
        "description": "阶段1 预处理管线的包入口模块。",
        "keywords": ["阶段1", "预处理", "包入口"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/docx_scan.py",
        "title": "DOCX 结构扫描",
        "description": "扫描 DOCX 公式与图片；旧 ProgID 按真实流版本分流，v5 转换候选仍待人工对照源图。",
        "keywords": ["DOCX", "扫描", "OMML", "MathType", "公式统计"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/omml.py",
        "title": "OMML 解析与转换",
        "description": "解析 Word 原生公式 OMML，转换为 LaTeX 与可复用的公式表示。",
        "keywords": ["OMML", "公式", "LaTeX", "解析"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/mtef_conv.py",
        "title": "MTEF / MathType 转换",
        "description": "MTEF 转换与进程超时隔离；旧 ProgID 的 v5 严格校验流头、长度、解析日志，不回退错误偏移。",
        "keywords": ["MathType", "MTEF", "公式转换", "待复核"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/segment.py",
        "title": "题目切分",
        "description": "按题号把文档切分为结构化题目，识别章节号伪题与表格数据块。",
        "keywords": ["切分", "题号", "分段", "结构化"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/stage1.py",
        "title": "阶段1 主管线",
        "description": "串联扫描、公式转换与切分，把真实试卷 DOCX 批量转成结构化 JSON。",
        "keywords": ["阶段1", "主管线", "DOCX", "结构化JSON"],
        "category": [CAT_STAGE1], "stage": "阶段1",
    },
    {
        "path": "pipeline/README.md",
        "title": "pipeline 模块说明",
        "description": "阶段1 预处理管线的模块划分、用法与设计说明。",
        "keywords": ["阶段1", "预处理", "说明文档"],
        "category": [CAT_STAGE1, CAT_DOC], "stage": "阶段1",
    },
    # --- 阶段2 代码 ---------------------------------------------------------
    {
        "path": "bank/__init__.py",
        "title": "bank 包入口",
        "description": "阶段2 题库包的入口与模块划分说明。",
        "keywords": ["阶段2", "题库", "包入口"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/db.py",
        "title": "SQLite 数据模型",
        "description": "定义题库 schema（含 papers / paper_sections / paper_questions 组卷表）、"
                       "建库、连接、外键约束与 schema 版本管理。",
        "keywords": ["SQLite", "schema", "数据模型", "建库", "试卷表"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/importer.py",
        "title": "JSON 导入器",
        "description": "把阶段1 的结构化 JSON 幂等导入 SQLite，含版本管理与待复核入队。",
        "keywords": ["导入", "幂等", "版本管理", "待复核"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/latexnorm.py",
        "title": "LaTeX 表示规范化",
        "description": "把库内 LaTeX 的 [U+XXXX] 转义还原为真字符并统一去掉 $ 定界符；含幂等迁移。",
        "keywords": ["LaTeX", "规范化", "U+转义", "定界符", "幂等迁移"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/metadata.py",
        "title": "元数据提取",
        "description": "从文件名 / 标题 / 路径提取学段、年级、教材、章节、学科与题型。",
        "keywords": ["元数据", "年级", "教材", "章节", "题型"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/enrich.py",
        "title": "元数据补全",
        "description": "保守推断 grade / textbook / chapter / 知识点并记录 provenance；含幂等迁移与备份校验；"
                       "覆盖率统计统一为**题目级**口径（grade/textbook 与其它维度一致，"
                       "修正早期文件级分母导致的覆盖率虚高）。",
        "keywords": ["元数据补全", "provenance", "知识点", "幂等迁移", "覆盖率口径"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/labels.py",
        "title": "知识点复核工作流",
        "description": "question_labels.review_status 幂等迁移、按标签汇总、确认/否决、复核 CSV 导出导入。",
        "keywords": ["知识点复核", "review_status", "确认否决", "CSV导出导入"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/query.py",
        "title": "查询接口",
        "description": "题目的筛选、中文关键词检索、分页、单题详情、待复核与统计；"
                       "FTS join 经查询计划优化（questions 走主键点查，裸关键词 8–15s → <30ms）；"
                       "新增 search_full（has_answer/has_analysis 内容过滤与结果标志 + "
                       "*_missing「待补充」缺失过滤）与 question_labels（含复核状态）；"
                       "LIKE 兜底分支转义 %/_ 并按字面匹配（ESCAPE '\\'）。",
        "keywords": ["检索", "中文分词", "筛选", "统计", "查询计划", "FTS", "has_answer", "LIKE转义"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/answers.py",
        "title": "答案 / 解析抽取",
        "description": "从题干内联标记拆分（路径 A）、从配对解析版按内容对齐（路径 B）、"
                       "从答案版按题号对齐（路径 C，须题干文本佐证）抽取答案与解析；"
                       "含幂等迁移、provenance、保守对齐（不确定即跳过）与可疑答案复核。",
        "keywords": ["答案抽取", "解析抽取", "内联拆分", "配对对齐", "题号佐证", "可疑复核", "provenance"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/textutil.py",
        "title": "文本工具",
        "description": "占位符剥离、内容哈希、中文双字切分与 LIKE 通配符转义（escape_like，"
                       "把 % / _ / \\ 按字面匹配）等文本处理工具。",
        "keywords": ["文本工具", "哈希", "中文分词", "双字切分", "LIKE转义"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/cli.py",
        "title": "命令行入口",
        "description": "题库的命令行入口：建库、导入、检索、统计、元数据补全、组卷（paper）"
                       "与导出（export，DOCX/PDF + 双客户端验证）等子命令。",
        "keywords": ["CLI", "命令行", "子命令", "组卷", "导出", "图片空段合并"],
        "category": [CAT_STAGE2], "stage": "阶段2",
    },
    {
        "path": "bank/paper.py",
        "title": "组卷",
        "description": "试卷/大题/条目数据模型、组卷操作（增删改排、设分、大题分组）与导出数据准备；"
                       "含幂等迁移、题目版本锁定与内容快照。",
        "keywords": ["组卷", "试卷", "大题分组", "题序", "分值", "快照锁定", "导出数据"],
        "category": [CAT_STAGE3], "stage": "阶段3",
    },
    {
        "path": "bank/export.py",
        "title": "试卷导出",
        "description": "把组卷 payload 渲染为 DOCX（公式一律为可编辑的 OMML 原生公式）与 PDF；"
                       "含模板规格（考试/测验/作业）、占位符按 fid 映射与降级、"
                       "源 DOCX 包内图片按 sha256 解析，以及 Word/WPS 双客户端可编辑性验证；"
                       "桥接经进程内 HTTP 直连复用（导出 82–165s → <5s）。"
                       "v0.2：桥接调用对瞬时错误（-32603 document not open）自动重试修「样式时有时无」，"
                       "改用 page_style 一次设好页边距，版式改为 1.5 倍行距 + 段间距 + 页脚「第 X 页 共 Y 页」。"
                       "v0.3：图片按宽高比 + 可用宽度自适应尺寸（宽幅≤0.82W/常规≤0.68W/方高≤0.55W，"
                       "高≤7cm、不放大），并合并桥接多出的空段使图片段继承居中/间距/keepNext，"
                       "修「图片不居中」与「图片与题干拆页」。"
                       "v0.4：放大题间距与图片留白（每题段后 8→16pt、图片前后 6→10pt、"
                       "大题标题段前 12→16pt/段后 6→10pt），修「题与题间隔不合理」；"
                       "选择题与计算题统一、同题小问不加间距；同卷页数不变。"
                       "v0.5：新增 bridge_safe_text 把 TAB 换哨兵、其余控制字符剔除"
                       "（桥接 doc_insert_text 拒绝控制字符 code=9/11，曾致整卷导出失败），"
                       "再由 _set_explicit_tab_stops 还原为真实 <w:tab/> 并补制表位停靠点；"
                       "新增 is_option_label_segments 用「可见文本」判定选项标签"
                       "（含行内公式也生效），修「选项标签与配图拆页」。",
        "keywords": ["导出", "DOCX", "PDF", "OMML", "公式可编辑", "模板", "双客户端验证", "WPS", "Word", "进程内HTTP",
                     "瞬时错误重试", "页边距", "行距", "页码页脚",
                     "图片自适应尺寸", "宽高比", "keepNext", "图片不居中", "图片不分页", "空段合并",
                     "题间距", "段后间距", "图片留白", "间距常量",
                     "控制字符", "制表符", "TAB", "哨兵", "bridge_safe_text", "w:tab", "制表位停靠点",
                     "选项标签", "is_option_label_segments", "选项与配图同页"],
        "category": [CAT_STAGE4], "stage": "阶段4",
    },
    {
        "path": "bank/README.md",
        "title": "bank 模块说明",
        "description": "阶段2 题库的表结构、关键设计与元数据补全（含教材章节映射表）说明，"
                       "并含阶段3 组卷（数据模型 / 操作 / 导出数据 / 已知限制）。",
        "keywords": ["阶段2", "题库", "说明文档", "元数据补全", "组卷"],
        "category": [CAT_STAGE2, CAT_DOC], "stage": "阶段2",
    },
    # --- Web 界面：领域层（bank/ 新增） --------------------------------------
    {
        "path": "bank/edit.py",
        "title": "题目编辑与留版",
        "description": "在线编辑的领域逻辑：question_versions 快照列幂等迁移、save_question"
                       "（留版/冲突/FTS 同事务/公式复核状态/标签 diff）、文件级元数据、"
                       "难度三档标注与版本查询。",
        "keywords": ["在线编辑", "留版", "版本快照", "content_hash 冲突", "FTS", "难度标注"],
        "category": [CAT_WEBUI, CAT_STAGE2], "stage": "Web界面",
    },
    {
        "path": "bank/review.py",
        "title": "待复核公式队列",
        "description": "review_queue 的 resolve（标记已处理/恢复）与 summary（按状态计数）。",
        "keywords": ["待复核", "review_queue", "公式", "标记已处理"],
        "category": [CAT_WEBUI, CAT_STAGE2], "stage": "Web界面",
    },
    # --- Web 界面：后端（webui/ 新增） --------------------------------------
    {
        "path": "webui/__init__.py",
        "title": "webui 包入口",
        "description": "题库 Web 界面后端的包入口与模块划分说明（FastAPI，纯本地单机）。",
        "keywords": ["Web界面", "FastAPI", "包入口"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/config.py",
        "title": "webui 配置与环境自检",
        "description": "路径常量、settings.json 读写与校验、editor_sdk/Office 环境检测与降级说明（M3）。",
        "keywords": ["配置", "设置", "环境自检", "editor_sdk", "Office", "降级"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/db.py",
        "title": "webui 连接工厂",
        "description": "读/写连接工厂（busy_timeout=5000）与应用级写锁；write_txn 单事务上下文。",
        "keywords": ["连接工厂", "写锁", "busy_timeout", "SQLite"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/errors.py",
        "title": "webui 统一错误处理",
        "description": "ApiError 体系与异常处理器；错误码常量（40001-6/40401-8/40901-3/50001）与"
                       "ValueError 关键词映射，统一产出 {code,data,message}。",
        "keywords": ["错误处理", "统一响应", "异常处理器", "错误码"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/schemas.py",
        "title": "webui 请求/响应模型",
        "description": "搜索、编辑、难度、试卷、预览/导出、复核、来源元数据、设置等接口的 Pydantic v1 模型。",
        "keywords": ["Pydantic", "请求模型", "响应模型", "契约"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/jobs.py",
        "title": "webui 作业管理器",
        "description": "单后台线程 + queue.Queue 串行执行预览/导出作业；submit/get、状态与错误码记录。",
        "keywords": ["作业队列", "单线程", "预览导出", "串行"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/app.py",
        "title": "webui FastAPI 应用工厂",
        "description": "创建 FastAPI 应用，注册异常处理器、47 个域路由与静态资源，暴露 /api/health。",
        "keywords": ["FastAPI", "应用工厂", "静态托管", "健康检查"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/__main__.py",
        "title": "webui 一键启动器",
        "description": "python -m webui：幂等迁移 + 环境自检 + 起 uvicorn + 自动开浏览器。",
        "keywords": ["一键启动", "uvicorn", "幂等迁移", "环境自检"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/__init__.py",
        "title": "webui 路由聚合",
        "description": "路由包入口；聚合 search/questions/papers/export/labels/review/sources/"
                       "stats/settings 九个域路由（共 47 个端点），app 工厂遍历挂载。",
        "keywords": ["路由", "聚合", "包入口", "47端点"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/search.py",
        "title": "webui 检索路由",
        "description": "GET /api/search（含 *_missing「待补充」桶筛选）与 /api/search/facets；"
                       "调用 webui.services.search。",
        "keywords": ["检索路由", "search", "facets", "待补充桶"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/questions.py",
        "title": "webui 单题路由",
        "description": "/api/questions* —— 详情、编辑保存、版本历史、媒体、难度标注。",
        "keywords": ["单题路由", "编辑", "版本", "媒体", "难度"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/papers.py",
        "title": "webui 试卷路由",
        "description": "/api/papers* —— 试卷 CRUD、题目条目、分值、大题、快照刷新与导出数据。",
        "keywords": ["试卷路由", "组卷", "分值", "大题", "快照"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/export.py",
        "title": "webui 预览/导出路由",
        "description": "/api/papers/{id}/preview|export、/api/jobs/{id}、"
                       "/api/preview/{key}/page_{n}.png（key 白名单校验）。",
        "keywords": ["预览路由", "导出路由", "作业轮询", "PNG"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/labels.py",
        "title": "webui 知识点复核路由",
        "description": "/api/labels* —— 按标签汇总、逐条复核、决策预检/确认否决、复核 CSV 导出导入。",
        "keywords": ["知识点路由", "复核", "决策", "CSV"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/review.py",
        "title": "webui 待复核队列路由",
        "description": "/api/review* —— 队列列表、汇总、标记已处理。",
        "keywords": ["待复核路由", "队列", "resolve"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/sources.py",
        "title": "webui 来源文件路由",
        "description": "/api/sources* —— 列表、详情、影响题数预检、文件级元数据编辑。",
        "keywords": ["来源路由", "影响预检", "文件级元数据"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/stats.py",
        "title": "webui 统计路由",
        "description": "GET /api/stats 与 /api/meta/coverage。",
        "keywords": ["统计路由", "覆盖率"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/routers/settings.py",
        "title": "webui 系统设置路由",
        "description": "GET/PUT /api/settings。",
        "keywords": ["设置路由", "settings"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/__init__.py",
        "title": "webui 服务层包入口",
        "description": "服务层包入口；聚合 search/questions/papers/preview/export_svc/"
                       "labels_svc/review_svc/sources_svc/stats_svc/settings_svc。",
        "keywords": ["服务层", "包入口", "编排"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/search.py",
        "title": "webui 检索服务",
        "description": "检索与筛选栏；调用 bank.query.search_full / facets，支持 kp_confirmed_only "
                       "严格模式、*_missing「待补充」桶筛选（哨兵感知），结果 item 附 "
                       "has_answer/has_analysis 内容标志。",
        "keywords": ["检索服务", "筛选栏", "严格模式", "待补充桶", "_missing", "内容标志"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/questions.py",
        "title": "webui 单题服务",
        "description": "单题详情/编辑/版本/媒体/难度；调用 bank.query 与 bank.edit，映射 40001/40401/40901。",
        "keywords": ["单题服务", "编辑保存", "媒体解析", "难度"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/papers.py",
        "title": "webui 试卷服务",
        "description": "试卷 CRUD、组卷、分值、大题、快照刷新与导出数据准备；调用 bank.paper；"
                       "试卷详情 item 附 stale（快照落后）标志。",
        "keywords": ["试卷服务", "组卷", "分值", "快照", "stale"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/preview.py",
        "title": "webui 像素级预览引擎",
        "description": "预览渲染（DOCX→PDF→PNG）+ 内容指纹缓存（sha256 元数据+有序条目）；"
                       "与导出共享渲染产物；DOCX 生成含一次自动重试。",
        "keywords": ["预览引擎", "像素级", "缓存指纹", "pypdfium2", "PNG"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/export_svc.py",
        "title": "webui 预览/导出编排",
        "description": "预览/导出作业提交与执行；环境自检与降级（M3）；复用 preview 缓存产物。",
        "keywords": ["导出编排", "作业", "降级", "缓存复用"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/labels_svc.py",
        "title": "webui 知识点复核服务",
        "description": "按标签汇总/逐条复核/决策预检/确认否决/复核 CSV 导出导入；decision 归一化。",
        "keywords": ["复核服务", "决策", "CSV", "归一化"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/review_svc.py",
        "title": "webui 待复核队列服务",
        "description": "待复核队列列表/汇总/标记已处理；调用 bank.query.list_review 与 bank.review。",
        "keywords": ["待复核服务", "队列", "resolve"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/sources_svc.py",
        "title": "webui 来源文件服务",
        "description": "来源列表/详情/影响题数预检/文件级元数据编辑（二次确认 40903）。",
        "keywords": ["来源服务", "影响预检", "二次确认"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/stats_svc.py",
        "title": "webui 统计服务",
        "description": "题库总览/分布/覆盖率/复核状态；聚合 bank.query/answers/enrich/labels/review。",
        "keywords": ["统计服务", "覆盖率", "分布"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "webui/services/settings_svc.py",
        "title": "webui 系统设置服务",
        "description": "读取/更新 settings.json；非法设置抛 40006。",
        "keywords": ["设置服务", "settings.json"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "启动题库.bat",
        "title": "题库一键启动脚本",
        "description": "双击启动：选择解释器（BANK_PY > kb 环境 > PATH）后调用 python -m webui。",
        "keywords": ["一键启动", "批处理", "双击", "BANK_PY"],
        "category": [CAT_WEBUI], "stage": "Web界面",
    },
    # --- 测试 ---------------------------------------------------------------
    {
        "path": "tests/__init__.py",
        "title": "测试包入口",
        "description": "bank 包测试的包入口。",
        "keywords": ["测试", "包入口", "单元测试"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_bank.py",
        "title": "题库测试",
        "description": "覆盖导入幂等、章节筛选、中文关键词、待复核队列、题目版本与元数据提取；"
                       "含 LIKE 通配符转义回归（%/_ 按字面匹配，不再命中全表）。",
        "keywords": ["单元测试", "幂等", "检索", "版本", "LIKE转义"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_segment_fix.py",
        "title": "切分修复测试",
        "description": "覆盖阶段1 切分修复：章节号伪题与表格数据块的识别。",
        "keywords": ["单元测试", "切分", "伪题"],
        "category": [CAT_TEST], "stage": "阶段1",
    },
    {
        "path": "tests/test_enrich.py",
        "title": "元数据补全测试",
        "description": "覆盖 enrich 的推断规则、迁移幂等、不覆盖、难度不猜与端到端补全；"
                       "含覆盖率题目级口径回归（grade/textbook 分母为题目数）。",
        "keywords": ["单元测试", "元数据补全", "幂等", "难度", "覆盖率口径"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_labels.py",
        "title": "知识点复核测试",
        "description": "覆盖 review_status 迁移、按标签汇总、确认/否决、复核 CSV 导出导入容错与检索过滤。",
        "keywords": ["单元测试", "知识点复核", "review_status", "CSV"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_paper.py",
        "title": "组卷测试",
        "description": "覆盖 schema 迁移幂等、题序连续、快照锁定、分值合计、大题分组、导出数据与级联清理。",
        "keywords": ["单元测试", "组卷", "快照锁定", "题序", "大题分组", "导出数据"],
        "category": [CAT_TEST], "stage": "阶段3",
    },
    {
        "path": "tests/test_answers.py",
        "title": "答案抽取测试",
        "description": "覆盖 answers 的内联拆分、配对对齐、题号路径内容佐证、可疑答案复核、"
                       "幂等迁移、不覆盖已有值与保守跳过。",
        "keywords": ["单元测试", "答案抽取", "内联拆分", "配对对齐", "题号佐证", "可疑复核", "幂等"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_export.py",
        "title": "导出测试",
        "description": "覆盖导出纯逻辑：LaTeX 清洗与修复、占位符按 fid 映射与降级、"
                       "题号连续编号、模板差异、答案按模式门控与图片按 sha256 解析；"
                       "并覆盖 v0.2 新增的瞬时错误识别与重试、页脚「第 X 页 共 Y 页」注入、"
                       "大题标题常见写法与行距常量；以及 v0.3 的图片尺寸自适应与"
                       "「空段 + 图片段」合并（恢复居中/分页控制）。",
        "keywords": ["单元测试", "导出", "LaTeX", "OMML", "占位符", "模板", "图片解析",
                     "瞬时错误重试", "页脚页码", "图片自适应尺寸", "空段合并"],
        "category": [CAT_TEST], "stage": "阶段4",
    },
    {
        "path": "tests/test_hardening.py",
        "title": "加固回归测试",
        "description": "覆盖 F1–F6 正确性缺陷修复的回归测试（导入原子性、类型校验、路径报错、"
                       "CLI 异常、分值校验、快照范围）。",
        "keywords": ["单元测试", "加固", "原子性", "类型校验", "分值校验", "快照范围"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_latexnorm.py",
        "title": "LaTeX 规范化测试",
        "description": "覆盖 D1/D2 的 U+ 还原、$ 去除、幂等迁移、导入规范化与导出侧幂等。",
        "keywords": ["单元测试", "LaTeX", "规范化", "U+转义", "幂等迁移"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_perf.py",
        "title": "性能优化回归测试",
        "description": "覆盖 P1 检索查询计划（FTS join 走主键点查、结果集一致、分页不重不漏）"
                       "与 P2 导出桥接进程复用（进程内 HTTP、桥接不可达不误报成功）。",
        "keywords": ["单元测试", "性能", "查询计划", "EXPLAIN QUERY PLAN", "进程内HTTP", "回归"],
        "category": [CAT_TEST], "stage": "阶段2",
    },
    {
        "path": "tests/test_edit.py",
        "title": "题目编辑与留版测试",
        "description": "覆盖版本快照迁移幂等、save_question 留版/冲突/FTS、公式复核状态、"
                       "难度三档、文件级元数据确认与占位符题干编辑回归（B1）。",
        "keywords": ["单元测试", "在线编辑", "留版", "冲突", "FTS", "难度", "占位符"],
        "category": [CAT_TEST, CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "tests/test_review.py",
        "title": "待复核队列与统计查询测试",
        "description": "覆盖 review resolve/summary、query facets/coverage_summary/source_detail "
                       "与 labels 逐条复核。",
        "keywords": ["单元测试", "待复核", "facets", "覆盖率", "来源详情"],
        "category": [CAT_TEST, CAT_WEBUI], "stage": "Web界面",
    },
    {
        "path": "tests/test_webui_api.py",
        "title": "Web 后端 API 测试",
        "description": "TestClient 覆盖 47 端点的成功路径与关键错误码（40001-6/40401-8/40901-3）、"
                       "统一响应结构、检索内容标志与 *_missing 待补充桶、试卷 item stale、"
                       "预览缓存命中与只读导出；真实渲染端到端测试默认跳过。",
        "keywords": ["单元测试", "API", "TestClient", "错误码", "预览缓存", "内容标志", "stale"],
        "category": [CAT_TEST, CAT_WEBUI], "stage": "Web界面",
    },
    # --- 构建 / 验证脚本 ----------------------------------------------------
    {
        "path": ".workbuddy-ai/build_report.py",
        "title": "报告构建脚本",
        "description": "构建公式可编辑验证报告的脚本。",
        "keywords": ["脚本", "报告", "构建"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/build_verification_report.py",
        "title": "验证报告构建脚本",
        "description": "构建阶段1 / 阶段2 实现验证报告的脚本。",
        "keywords": ["脚本", "验证报告", "构建"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/crossclient.py",
        "title": "跨客户端验证脚本",
        "description": "在 WPS 与 Microsoft Word 两个客户端间验证公式可编辑性。",
        "keywords": ["WPS", "Word", "跨客户端", "公式"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/inspect_materials.py",
        "title": "素材检查脚本",
        "description": "只读检查真实物理素材目录的结构与文件分布。",
        "keywords": ["素材", "检查", "只读"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/keep_mathtype_test.py",
        "title": "MathType 保留测试",
        "description": "测试保留 MathType OLE 对象的处理策略。",
        "keywords": ["MathType", "测试", "OLE"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/legacy_probe.py",
        "title": "旧式公式探测脚本",
        "description": "探测旧式（OLE / MathType）公式对象的脚本。",
        "keywords": ["旧式公式", "探测", "OLE"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/mathtype_edit_attempt.py",
        "title": "MathType 编辑尝试脚本",
        "description": "尝试在客户端编辑 MathType 公式对象的脚本。",
        "keywords": ["MathType", "编辑", "尝试"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/mtef_corpus_test.py",
        "title": "MTEF 语料测试",
        "description": "对 MTEF 语料做批量转换测试的脚本。",
        "keywords": ["MTEF", "语料", "测试"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/mtef_roundtrip.py",
        "title": "MTEF 往返测试",
        "description": "MTEF 二进制往返解析 / 生成的测试脚本。",
        "keywords": ["MTEF", "往返", "解析"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/mtef_test.py",
        "title": "MTEF 测试",
        "description": "MTEF 解析的基础测试脚本。",
        "keywords": ["MTEF", "测试", "解析"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/render_diagnostics.py",
        "title": "诊断渲染脚本",
        "description": "把素材诊断结果渲染为 HTML 页面。",
        "keywords": ["诊断", "渲染", "HTML"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/validation30.py",
        "title": "30 题验证脚本",
        "description": "对 30 道真实题执行三路径公式可编辑性验证。",
        "keywords": ["验证", "30题", "公式可编辑"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/verify_stages.py",
        "title": "阶段验证脚本",
        "description": "脚本化逐项验证阶段1 / 阶段2 的实现。",
        "keywords": ["验证", "阶段1", "阶段2"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/wps_validation.py",
        "title": "WPS 验证脚本",
        "description": "在 WPS 中验证公式可编辑性的脚本。",
        "keywords": ["WPS", "验证", "公式"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/xkw_probe.py",
        "title": "学科网探测脚本",
        "description": "探测学科网来源文件结构的脚本。",
        "keywords": ["学科网", "探测", "结构"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/build_asset_manifest.py",
        "title": "资产清单构建脚本",
        "description": "生成本项目交付资产的元数据清单（JSON + Markdown）。",
        "keywords": ["资产清单", "元数据", "构建"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/embed_metadata.py",
        "title": "元数据嵌入脚本",
        "description": "把元数据块嵌入交付物（MD front-matter / HTML 注释 / Python 文件头），并备份校验。",
        "keywords": ["元数据嵌入", "front-matter", "备份", "校验"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    {
        "path": ".workbuddy-ai/docmeta.py",
        "title": "文档元数据块生成",
        "description": "生成脚本自用的元数据块（MD front-matter / HTML 注释），created 沿用已有值。",
        "keywords": ["元数据块", "front-matter", "生成脚本", "created"],
        "category": [CAT_TOOL], "stage": "工具",
    },
    # --- 数据产物 -----------------------------------------------------------
    {
        "path": "outputs/bank.db",
        "title": "题库数据库",
        "description": "SQLite 题库：题目、公式、图片、标签、待复核队列与中文检索索引。",
        "keywords": ["SQLite", "题库", "数据产物"],
        "category": [CAT_DATA], "stage": "数据",
    },
    {
        "path": "outputs/material_diagnostics_20261005.json",
        "title": "素材诊断数据",
        "description": "真实物理素材结构诊断的结构化结果（JSON）。",
        "keywords": ["素材诊断", "JSON", "数据产物"],
        "category": [CAT_DATA], "stage": "数据",
    },
    {
        "path": "outputs/preprocess_final/_summary.json",
        "title": "阶段1 产出汇总",
        "description": "阶段1 预处理最终产出的汇总统计（209 份文件、9738 题）。",
        "keywords": ["阶段1", "汇总", "预处理", "数据产物"],
        "category": [CAT_DATA], "stage": "数据",
    },
]


# 续作交付：媒体能力、前端异步门禁验证与当日验收记录。
ASSETS.extend([
    {"path": "bank/media.py", "title": "题库媒体信息与复核预览",
     "description": "批量读取图片 id/原始尺寸，保留快照指纹语义；源 DOCX 公式预览按内容缓存为 PNG。",
     "keywords": ["媒体", "快照", "WMF", "PNG"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/tests/preview-and-theme.test.cjs", "title": "预览门禁与主题回归测试",
     "description": "验证预览乱序、设置隔离、会话门禁、主题回退及 EF01 空白和未知私有字形显示。",
     "keywords": ["前端测试", "预览门禁", "主题"], "category": [CAT_TEST], "stage": "Web界面"},
    {"path": "outputs/续作验证报告-20261009.md", "title": "续作与验证报告（2026-10-09）",
     "description": "记录本轮基线、待办补齐、导出门禁缺陷修复、真实数据验证与尚未完成的事项。",
     "keywords": ["续作", "验证", "待办"], "category": [CAT_DELIVERABLE], "stage": "Web界面"},
])


# 本轮修复与评估的交付证据。
ASSETS.extend([
    {
        "path": "outputs/backlog-20261010/README.md",
        "title": "本轮交付与余项",
        "description": "T1 至 T5 的交付索引、测试、数据备份及最终审计。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/backlog-20261010/T4-超长单题跨页评估.md",
        "title": "T4 超长单题跨页评估",
        "description": "完整显示、合法断点、页数准确性与成本比较；仅评估。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/backlog-20261010/T5-多人部署方案比较.md",
        "title": "T5 多人部署方案比较",
        "description": "本地副本、集中 API、PostgreSQL、权限审计与迁移路径；仅评估。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "frontend/src/components/formulaDisplay.ts",
        "title": "公式显示字形清洗",
        "description": "EF01 空白清除与未知私有字形识别，保留编辑源值。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "frontend/src/components/KatexFormula.tsx",
        "title": "KaTeX 公式显示",
        "description": "已知字形清洗、未知字形明确提示及保存校验。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "frontend/src/components/CoverageBanner.tsx",
        "title": "覆盖率风险提示",
        "description": "常驻解释元数据覆盖不足造成筛选漏题。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "frontend/src/components/FilterSidebar.tsx",
        "title": "筛选侧栏",
        "description": "各维度展示覆盖率和未标注题量，降低漏题风险。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "outputs/backlog-20261010/t2-approved.json",
        "title": "T2 逐项准入清单",
        "description": "T2 逐项准入清单，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t2-applied.json",
        "title": "T2 正式写入与备份核验",
        "description": "T2 正式写入与备份核验，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t2-copy-validation.json",
        "title": "T2 副本演练",
        "description": "T2 副本演练，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t2-verify.json",
        "title": "T2 双端编辑验证",
        "description": "T2 双端编辑验证，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t3-verify.json",
        "title": "T3 双端编辑验证",
        "description": "T3 双端编辑验证，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t3-export.json",
        "title": "T3 导出及字形扫描",
        "description": "T3 导出及字形扫描，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/t3-katex-validation.json",
        "title": "T3 全库真实 KaTeX 样本验证",
        "description": "T3 全库真实 KaTeX 样本验证，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/final-audit.json",
        "title": "最终只读差异审计",
        "description": "最终只读差异审计，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/formula-probes.json",
        "title": "原始公式流与解析诊断",
        "description": "原始公式流与解析诊断，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/formula-pua.csv",
        "title": "全库私有字形原始清单",
        "description": "全库私有字形原始清单，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/backlog-20261010/metadata-sources.csv",
        "title": "全部来源元数据诊断",
        "description": "全部来源元数据诊断，记录当前实测结果，供复核溯源。",
        "keywords": [
            "续作",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    }
])


# 独立验收后的实现、方案及实测证据。
ASSETS.extend([
    {
        "path": "outputs/acceptance-followup-20261010/README.md",
        "title": "验收后续作交付索引",
        "description": "A/B 实现、C/D 方案、逐项回归与数据安全证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-年级诊断与防误用.md",
        "title": "年级诊断与防误用",
        "description": "来源文件名解析比例、SQL 对照、上下文漏题计数及浏览器验证。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/acceptance-followup-20261010/B-消费方约束与注释.md",
        "title": "消费方约束与注释修正",
        "description": "PUA 消费硬约束、EF01 坑记录、冻结导出文件授权和回归证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/acceptance-followup-20261010/C-超长单题跨页方案.md",
        "title": "超长单题跨页三方案",
        "description": "完整内容、续页标记、工程成本及强制预览门禁交互；仅评估。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "outputs/acceptance-followup-20261010/D-多人部署三档方案.md",
        "title": "多人部署三档方案",
        "description": "本地副本、集中服务、完整多租户及 47 业务端点影响；仅评估。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "交付报告"
        ],
        "stage": "交付报告"
    },
    {
        "path": "tests/test_grade_gap.py",
        "title": "年级筛选漏题提示测试",
        "description": "临时库验证上下文、严格模式、缺失哨兵、分页、原结果及字面关键词。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "测试"
        ],
        "stage": "测试"
    },
    {
        "path": "frontend/src/components/GradeGapNotice.tsx",
        "title": "年级筛选漏题提示",
        "description": "显示当前检索条件下的缺年级题数，点击保留其他条件查看缺失桶。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "frontend/src/pages/SearchPage.tsx",
        "title": "题库检索页",
        "description": "关键词、筛选、分页和当前条件下的年级漏题查看入口。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "frontend/src/api/types.ts",
        "title": "前端 API 类型",
        "description": "接口结果与题目字段类型，包含可选 grade_gap 上下文计数。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "Web界面"
        ],
        "stage": "Web界面"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-逐来源年级诊断.csv",
        "title": "逐来源年级诊断",
        "description": "逐来源年级诊断，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-年级诊断.json",
        "title": "年级解析比例与覆盖率",
        "description": "年级解析比例与覆盖率，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-真实库API验证.json",
        "title": "真实库检索与 SQL 对照",
        "description": "真实库检索与 SQL 对照，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/D-端点清单.json",
        "title": "实际 API 注册端点清单",
        "description": "实际 API 注册端点清单，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/B-文档与注释.diff",
        "title": "任务 B 可审阅变更",
        "description": "任务 B 可审阅变更，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-筛选提示.jpg",
        "title": "年级漏题提示浏览器截图",
        "description": "年级漏题提示浏览器截图，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/A-点击后结果.jpg",
        "title": "点击查看后浏览器截图",
        "description": "点击查看后浏览器截图，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    }
])


# 独立验收后的实现、方案及实测证据。
ASSETS.extend([
    {
        "path": "outputs/acceptance-followup-20261010/A-零结果仍可查看.jpg",
        "title": "零结果仍可查看缺失题截图",
        "description": "零结果仍可查看缺失题截图，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    },
    {
        "path": "outputs/acceptance-followup-20261010/final-audit.json",
        "title": "本轮收尾数据安全审计",
        "description": "本轮收尾数据安全审计，本轮当前代码实测证据。",
        "keywords": [
            "验收",
            "验证"
        ],
        "category": [
            "数据产物"
        ],
        "stage": "数据产物"
    }
])


# 2026-10-11：导出 P0 收尾（控制字符/选项标签）与前端修复重构新增资产。
ASSETS.extend([
    {"path": "frontend/src/hooks/useExportGate.ts", "title": "导出预览门禁共享 hook",
     "description": "把「像素预览 + 强制门禁 + 导出」收敛为唯一实现，抽屉与导出页共用；"
                    "消除两入口约 400 行重复与行为不一致。",
     "keywords": ["门禁", "预览", "导出", "重构", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/hooks/exportGateShared.ts", "title": "导出门禁纯函数",
     "description": "detectEnvFailure（同时识别 editor_sdk 与 Word/WPS）与 extractPages 等纯函数；"
                    "P0-4「导出页漏判 editor_sdk 致 DOCX 永久锁死」的修复落点。",
     "keywords": ["门禁", "环境降级", "editor_sdk", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/components/ExportResultPanel.tsx", "title": "导出结果面板",
     "description": "导出成功后的文件路径/体积/题数/公式数/图片数与告警展示，抽屉与导出页共用。",
     "keywords": ["导出", "结果", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/components/PaperPanelItemRow.tsx", "title": "试卷题目行组件",
     "description": "从 PaperPanel 抽出的单题行（排序、改分、删除、陈旧标记）。",
     "keywords": ["组卷", "排序", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/api/types/core.ts", "title": "前端类型·核心",
     "description": "api/types.ts 拆分后的核心类型（分页、通用响应等）。",
     "keywords": ["类型", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/api/types/paper.ts", "title": "前端类型·试卷",
     "description": "api/types.ts 拆分后的试卷/组卷相关类型。",
     "keywords": ["类型", "组卷", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/api/types/governance.ts", "title": "前端类型·治理",
     "description": "api/types.ts 拆分后的复核/标签/来源/统计相关类型。",
     "keywords": ["类型", "治理", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/api/searchParams.ts", "title": "检索条件 URL 编解码",
     "description": "检索/组卷页共用的筛选条件 ↔ URL query 读写，保证刷新/回退/分享可保留。",
     "keywords": ["检索", "URL", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/api/paperRestore.ts", "title": "试卷副本重建",
     "description": "删除试卷后的撤销入口：按原大题/题序/分值重建同内容副本（后端无恢复接口，"
                    "文案如实标注为「副本（新 id）」）。",
     "keywords": ["组卷", "撤销", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/src/store/settingsStore.ts", "title": "设置镜像 store",
     "description": "把后端设置镜像到前端 store，供 KatexFormula 与建卷默认模板消费，"
                    "修「设置保存成功但行为不变」的假开关。",
     "keywords": ["设置", "KaTeX", "Web界面"], "category": [CAT_WEBUI], "stage": "Web界面"},
    {"path": "frontend/tests/frontend-fixes.test.cjs", "title": "前端修复回归测试",
     "description": "门禁纯函数、设置 store、KaTeX 取设置、删除确认护栏、来源重挂载等 9 项回归。",
     "keywords": ["测试", "前端", "回归"], "category": [CAT_TEST], "stage": "Web界面"},
    {"path": "frontend/scripts/prune-stale-assets.mjs", "title": "构建产物清理脚本",
     "description": "清理 webui/static/assets 下不被 index.html 引用的过期入口包"
                    "（emptyOutDir=false 的代价），只删 index-*.js/css，不动 KaTeX 字体。",
     "keywords": ["构建", "清理", "工具"], "category": [CAT_TOOL], "stage": "Web界面"},
    {"path": "outputs/handoff/D-导出P0最终交接.md", "title": "导出 P0 最终交接（D）",
     "description": "本轮补齐 Codex 中断项：控制字符致整卷导出失败的根因与修复、"
                    "选项标签与配图拆页修复、卷1 三模式导出与双端渲染证据、修订闭环证据。",
     "keywords": ["导出", "交接", "控制字符", "TAB", "修订"], "category": [CAT_DELIVERABLE], "stage": "交付报告"},
    {"path": "outputs/handoff/D-前端修复与重构.md", "title": "前端修复与重构交接（D）",
     "description": "前端 4 项 P0、6 项 P1 与 3 项重构的改前/改后/证据，含未做项与遗留风险。",
     "keywords": ["前端", "交接", "重构", "易用性"], "category": [CAT_DELIVERABLE], "stage": "交付报告"},
    {"path": "outputs/handoff/T-本轮独立验收.md", "title": "本轮独立验收（T）",
     "description": "G3 独立验证：导出 5 项 + 前端 6 项断言逐条结论、自建反例与证据。",
     "keywords": ["验收", "独立", "反证"], "category": [CAT_DELIVERABLE], "stage": "交付报告"},
    {"path": "outputs/export-upgrade-20261010/README.md", "title": "导出 P0 阶段收口索引",
     "description": "R/P/A/D/T/V 阶段文档索引、本轮补齐项、关键证据位置与当前状态。",
     "keywords": ["导出", "索引", "阶段"], "category": [CAT_DELIVERABLE], "stage": "交付报告"},
])


# 登记当前构建入口及其真实直接引用，不固定Vite内容散列文件名。
ASSETS.append({'path': 'webui/static/index.html', 'title': '前端生产入口',
               'description': '当前生产构建入口，引用实际JS/CSS产物。',
               'keywords': ['前端', '构建'], 'category': [CAT_DATA], 'stage': CAT_WEBUI})
_static_index = ROOT / 'webui/static/index.html'
if _static_index.is_file():
    for _static_ref in sorted(set(re.findall(
            r'''(?:src|href)=["'](/assets/[^"']+\.(?:js|css))["']''',
            _static_index.read_text(encoding='utf-8')))):
        ASSETS.append({'path': 'webui/static' + _static_ref,
                       'title': '前端生产资源 ' + Path(_static_ref).name,
                       'description': '当前入口直接引用的构建资源，尺寸和时间取实际文件。',
                       'keywords': ['前端', '构建'], 'category': [CAT_DATA], 'stage': CAT_WEBUI})


def make_id(path: str) -> str:
    """由路径生成稳定 id。"""
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", path).strip("-")


def _times(path: Path) -> tuple[str, str]:
    """返回 ``(created, modified)`` 的 ISO 8601 带时区字符串（文件系统时间）。"""
    st = path.stat()
    created = datetime.fromtimestamp(st.st_ctime).astimezone().isoformat()
    modified = datetime.fromtimestamp(st.st_mtime).astimezone().isoformat()
    return created, modified


def collect_assets() -> tuple[list[dict], list[str]]:
    """遍历 :data:`ASSETS`，补齐文件系统字段。返回 ``(entries, missing)``。"""
    entries: list[dict] = []
    missing: list[str] = []
    for item in ASSETS:
        rel = item["path"]
        abs_path = ROOT / rel
        if not abs_path.is_file():
            missing.append(rel)
            continue
        created, modified = _times(abs_path)
        description = item["description"]
        version = VERSION_DEFAULT
        # Python 文件头是当前能力说明的来源，避免清单保留已经失效的描述。
        if abs_path.suffix == ".py":
            header = re.search(r"^# description: (.+)$", abs_path.read_text(encoding="utf-8"), re.MULTILINE)
            if header:
                description = header.group(1)
            declared = re.search(r"^# version: (.+)$", abs_path.read_text(encoding="utf-8"), re.MULTILINE)
            if declared:
                version = declared.group(1)
        entries.append({
            "id": make_id(rel),
            "path": rel,
            "title": item["title"],
            "description": description,
            "keywords": list(item["keywords"]),
            "author": AUTHOR_DEFAULT,
            "created": created,
            "modified": modified,
            "version": version,
            "category": list(item["category"]),
            "size_bytes": abs_path.stat().st_size,
            "stage": item["stage"],
        })
    return entries, missing


def build_manifest() -> dict:
    """构造清单字典。"""
    entries, missing = collect_assets()
    return {
        "generated_at": datetime.now().astimezone().isoformat(),
        "version_policy": VERSION_POLICY,
        "author_default": AUTHOR_DEFAULT,
        "asset_count": len(entries),
        "missing": missing,
        "assets": entries,
    }


def _md_escape(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def render_markdown(manifest: dict) -> str:
    """把清单渲染成可读的 Markdown。"""
    lines = [
        "# 交付资产元数据清单",
        "",
        f"- 生成时间：{manifest['generated_at']}",
        f"- 资产数量：{manifest['asset_count']}",
        f"- 版本策略：**{manifest['version_policy']}**",
        f"- `author`：统一 `{manifest['author_default']}`（用户明确要求）",
        "- `created` / `modified`：文件系统时间（ISO 8601，带时区），相同则如实写相同值。",
        "",
    ]
    if manifest["missing"]:
        lines += [f"- ⚠️ 缺失文件（{len(manifest['missing'])}）：" +
                  ", ".join(f"`{m}`" for m in manifest["missing"]), ""]
    lines += [
        "| id | path | title | category | stage | version | size | created | modified | keywords |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for a in manifest["assets"]:
        lines.append(
            "| {id} | `{path}` | {title} | {cat} | {stage} | {ver} | {size} | {created} |"
            " {modified} | {kw} |".format(
                id=_md_escape(a["id"]), path=_md_escape(a["path"]),
                title=_md_escape(a["title"]), cat=_md_escape("/".join(a["category"])),
                stage=_md_escape(a["stage"]), ver=a["version"], size=a["size_bytes"],
                created=a["created"], modified=a["modified"],
                kw=_md_escape("、".join(a["keywords"]))))
    lines += ["", "## 逐条说明", ""]
    for a in manifest["assets"]:
        lines.append(f"### {a['title']} (`{a['path']}`)")
        lines.append("")
        lines.append(f"- **id**：`{a['id']}`")
        lines.append(f"- **description**：{a['description']}")
        lines.append(f"- **keywords**：{'、'.join(a['keywords'])}")
        lines.append(f"- **category**：{'、'.join(a['category'])}　**stage**：{a['stage']}")
        lines.append(f"- **author**：{a['author']}　**version**：{a['version']}")
        lines.append(f"- **created**：{a['created']}　**modified**：{a['modified']}")
        lines.append(f"- **size_bytes**：{a['size_bytes']}")
        lines.append("")
    return "\n".join(lines) + "\n"


def write_manifest() -> dict:
    """写出 JSON 与 Markdown 清单，返回清单字典。"""
    manifest = build_manifest()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "asset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "asset_manifest.md").write_text(
        render_markdown(manifest), encoding="utf-8")
    return manifest


def main() -> int:
    manifest = write_manifest()
    print(f"资产清单已写出：{manifest['asset_count']} 条 -> {OUT_DIR}")
    if manifest["missing"]:
        print(f"缺失 {len(manifest['missing'])} 个文件：{manifest['missing']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
