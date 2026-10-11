# bank —— 题库（数据模型 + 导入 + 查询）

把阶段1（`pipeline/`）产出的结构化 JSON 落进 **SQLite**，提供导入、检索、筛选、
待复核队列与统计能力，供阶段3（组卷）、阶段4（导出）调用。

核心建库与检索使用标准库（`sqlite3` / `json` / `re` / `pathlib` / `zipfile` / `hashlib`）。
Web 媒体增强使用已在 `webui/requirements.txt` 声明的 Pillow，不引入 ORM 或外部数据库。

## 目录

```
bank/
├── __init__.py
├── db.py         # schema、建库、连接、版本管理
├── textutil.py   # 占位符剥离、内容哈希、中文双字切分
├── metadata.py   # 从文件名/标题/路径提取 学段/年级/教材/章节/学科/题型
├── importer.py   # 阶段1 JSON -> SQLite（幂等、可容错、版本管理、单文件原子）
├── latexnorm.py  # LaTeX 表示规范化（还原 [U+XXXX]、统一去掉 $ 定界符；含幂等迁移）
├── enrich.py     # 元数据补全（保守推断 + provenance；含幂等迁移）
├── labels.py     # 知识点人工复核工作流（review_status 迁移 / 汇总 / 确认否决 / CSV 导出导入）
├── answers.py    # 答案/解析抽取（题干内联拆分 + 配对文件对齐 + 题号路径内容佐证 + 可疑复核）
├── query.py      # 筛选 / 中文检索 / 分页 / 单题详情 / 待复核 / 统计
├── media.py      # Web 图片 id/尺寸增强、按快照指纹匹配、公式源预览转换 PNG
├── paper.py      # 组卷（试卷/大题/条目数据模型、组卷操作、导出数据准备）
└── cli.py        # 命令行入口
```

## 用法

```bash
PY="C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe"

$PY -m bank.cli init                              # 建库（默认 outputs/bank.db）
$PY -m bank.cli import outputs/preprocess_final   # 导入（目录或单文件）
$PY -m bank.cli stats                             # 统计
$PY -m bank.cli search "浮力" --chapter 9.4 --limit 5
$PY -m bank.cli search "密度" --qtype 填空题 --review
$PY -m bank.cli show 89                           # 单题详情（题干/公式/图片/版本）
$PY -m bank.cli review --limit 20                 # 待复核队列
$PY -m bank.cli labels --namespace chapter
$PY -m bank.cli sources --limit 20
$PY -m bank.cli enrich --dry-run                  # 只统计不写库（各字段将新增多少、来源分布）
$PY -m bank.cli enrich                            # 执行补全并输出补全前后覆盖率对比
$PY -m bank.cli normalize --dry-run               # LaTeX 规范化：只统计不写库（[U+XXXX] / $ 各多少）
$PY -m bank.cli normalize                         # 执行规范化（**自动备份 + 校验**，幂等）

# 答案/解析抽取（见下方「答案 / 解析抽取」）
$PY -m bank.cli answers extract --dry-run         # 只统计不写库（路径 A/B/C 各能拆出/对齐多少）
$PY -m bank.cli answers extract --refresh-snapshots --refresh-paper 1   # 抽取并刷新**指定试卷**快照
$PY -m bank.cli answers extract --refresh-snapshots --refresh-all       # 显式刷新**全部试卷**（慎用）

# 知识点人工复核（见下方「知识点人工复核工作流」）
$PY -m bank.cli labels review-list --namespace 知识点 --limit 20   # 按标签汇总待复核项
$PY -m bank.cli labels confirm --label 压强                        # 批量确认该标签的全部待复核关联
$PY -m bank.cli labels reject  --label 太阳系 --question 4         # 只否决「题#4 的太阳系」这一条
$PY -m bank.cli labels export-review --out review.csv             # 导出待复核清单（离线填写）
$PY -m bank.cli labels import-review review.csv                   # 读回老师填写的决定
$PY -m bank.cli search "浮力" --kp-confirmed-only                 # 严格模式：只命中「已确认」知识点

# 组卷（阶段3，见下方「组卷」）
$PY -m bank.cli paper new --title "初二物理周末练习" --subject 物理 --stage 初中 \
    --grade 八年级下册 --template 考试 --answer-mode 学生版
$PY -m bank.cli paper list
$PY -m bank.cli paper add 1 3753 3754 3759 --section "一、选择题" --score 3
$PY -m bank.cli paper add 1 6386 6387 --section "二、计算题" --score 6
$PY -m bank.cli paper move 1 3 1                                  # 把条目 3 移到第 1 位
$PY -m bank.cli paper score 1 1 5                                 # 设分值
$PY -m bank.cli paper section add 1 "三、实验探究题"               # 大题分组
$PY -m bank.cli paper section move 1 2 1                          # 移动大题（题目块随之重排）
$PY -m bank.cli paper show 1                                      # 题序 / 分值 / 总分 / 大题小计
$PY -m bank.cli paper export-data 1 --answer-mode 答案解析版 --out paper.json
$PY -m bank.cli paper delete 1 --force                            # 破坏性操作需 --force
```

## 表结构

| 表 | 作用 | 关键点 |
|---|---|---|
| `meta` | 库元信息 | `schema_version`、`created_at` |
| `source_files` | 来源文件 | `sha256` **唯一**（幂等锚点）；`stage/grade/subject/textbook/chapter` |
| `questions` | 题目（当前版本） | `UNIQUE(source_id, content_hash)`；`version`；`content_hash`；`answer`/`analysis`/`answer_source`（答案/解析，可空） |
| `question_versions` | 题目历史版本（不可变） | `UNIQUE(question_id, version)`，组卷快照据此锁定 |
| `formulas` | 公式 | `kind/status/latex/progid/part/preview`，`needs_review` |
| `images` | 图片 | `media_path` + `sha256` |
| `labels` / `question_labels` | 标签 | 命名空间（`chapter`/`section`/`知识点`/`custom`）+ 名称，多对多；`question_labels.source` 记知识点来源、`review_status` 记人工复核状态 |
| `review_queue` | 待复核队列 | 非 `OK` 公式，`resolved` 标记；随公式级联删除 |
| `papers` | 试卷元数据（阶段3） | `title/subject/stage/grade/template/answer_mode/created_by/status`；`created_by` 默认 `待补充` |
| `paper_sections` | 试卷大题分组（阶段3） | `name/seq/description`；随试卷级联删除 |
| `paper_questions` | 试卷条目（阶段3） | `seq`（题序，全卷连续）、`score`（`NULL`=未设分值）、`question_version` + `snapshot_json`（快照锁定） |
| `question_fts` | 题干检索 | FTS5 虚拟表（双字切分后的倒排） |

索引覆盖：学段 / 学科 / 年级 / 教材 / 章节 / 题型 / 难度 / 公式状态 / 内容哈希 / 版本。
外键约束在每个连接上开启（`PRAGMA foreign_keys = ON`）。

## 三个关键设计

### 1. 中文检索：双字滑窗（bigram）+ FTS5

SQLite 的 FTS5 `unicode61` 分词器把连续汉字当成**一个** token，搜「浮力」命中不了
「阿基米德原理浮力」。因此：

* **建索引**：把题干切成相邻两字组成的词元（`探索更小的微粒` → `探索 索更 更小 小的 微粒`），
  空格连接后写入 `question_fts`；
* **查询**：用同样的方式切分查询串，词元之间是隐式 AND，走 `MATCH`，按 `bm25` 排序；
* **兜底**：单字查询（如「力」）退化为 `LIKE`。

**为什么不用 trigram**：FTS5 的 `trigram` 分词器要求查询串至少 3 个字符，而物理题库里
「浮力」「压强」「密度」都是 2 字词，trigram 直接失效。
**为什么不自己维护倒排表**：双字切分后直接复用 FTS5 的倒排与 BM25，代码更少、更快。

> 注意：这是**连续子串**检索。「测密度」不会命中「测量……密度」（因为 bigram `测密`
> 不存在），但「密度」「测量」会命中——这是双字切分方案的固有特性。

### 2. 幂等导入

* 源文件按 `sha256`（原始 DOCX 的指纹，原文件缺失时退化为 JSON 指纹）唯一；
* 题目按 `(source_id, content_hash)` 唯一，`content_hash` = 归一化题干（去占位符 + 去空白）的 sha256；
* 重复导入同一份 JSON：**新增 0、更新 0、全部跳过**。
* **单文件原子（F1）**：`import_file` 在文件内任何异常时 `rollback()`，保证
  「要么整个文件成功、要么完全不入库」——失败文件**绝不**留下半截数据（含 `source_files` 行）。
* **类型校验（F2）**：`formula_ids` 必须是**字符串列表**（`null` 视同空）；否则视为数据错误、
  按单文件原子回滚，**不**逐字符迭代造出假公式。
* **路径校验（F3）**：`import_path` 传入不存在的路径会抛 `FileNotFoundError`（**不**静默空跑）；
  CLI 会给出友好提示并非零退出。
* **入库即规范化（D1/D2）**：写入 `formulas.latex` 前会还原 `[U+XXXX]` 转义并去掉 `$` 定界符
  （见 :mod:`bank.latexnorm`），幂等无害。

### 3. 版本与组卷快照

* `questions.version` 记录当前版本；`question_versions` 保存每一版原文；
* 同一来源内若「题号 + 大题 + 起始段落」不变但内容变了 → **更新 + version + 1**，
  并在 `question_versions` 追加一条历史；
* `paper_questions(question_id, question_version)` 外键指向 `question_versions`，
  组卷时锁定版本；并额外把题干/公式/图片写入 `paper_questions.snapshot_json`，
  之后改题**不影响已出的卷**（详见「组卷」）。

### 4. LaTeX 表示规范化（`latexnorm.py`，D1 / D2）

阶段1 的两条公式路径产出的 LaTeX **表示不一致**，会给**直接读 `formulas.latex` 的消费方**
（如未来的 Web 渲染）带来麻烦。本模块把库内 LaTeX **规范化**为可直接消费的形式：

| 项 | 问题 | 规范化后 |
|---|---|---|
| **D1** | MTEF（MathType）把中文写成 `[U+XXXX]` 转义，如 `\rho_{{\text{[U+6c34]}}}` | 还原为真字符 `\rho_{{\text{水}}}`（**只在已有 `\text{}` 内替换**，**不**双重包裹 `\text{\text{水}}`） |
| **D2** | MathType 产物带 `$…$` 定界符、OMML 产物不带 | **统一为不带 `$`**（规范 LaTeX 主体） |

**约定（D2 选定「不带 `$`」的理由）**：① 规范 LaTeX 的公式主体本就不含定界符，`$` 只是文本环境
里的行内标记；② 导出侧 `sanitize_latex` 本就会剥离 `$`，故对导出**无影响**；③ 5,908 条 OMML 公式
本就不带 `$`，去掉 MathType 的 `$` 即把两种来源统一到更规范、更少歧义的约定。

**接口**：`restore_uplus` / `strip_dollar` / `normalize_latex`（均幂等）、`migrate_latex(conn, ...)`
（一次性迁移 `formulas.latex`，默认**连同试卷快照**；幂等）。CLI：

```bash
$PY -m bank.cli normalize --dry-run    # 只统计（[U+XXXX] / $ 各多少）
$PY -m bank.cli normalize              # 执行（**自动备份 + verify_backup 校验**，幂等）
```

> **说明**：`migrate_latex` 默认也规范化**试卷快照**里的公式 LaTeX——这是**纯表示规范化**
> （同一公式的渲染结果不变），不改变任何试卷的语义；规范化后导出侧的还原逻辑对快照成为**幂等空操作**。
> 上游 `pipeline/mtef_conv.py` 也同步在产出时规范化，避免**新导入**的数据再带 `[U+XXXX]` / `$`。
> 导出侧 `sanitize_latex` 仍保留还原逻辑（对旧数据/旧快照**幂等无害**），双保险。

## 导入时跳过的假题目

阶段1 的题号正则会误切出假题目，导入时按内容过滤（计入 `忽略(数值垃圾)`）：

1. **表格纯数值行 / 数据块**（`0.30`、`66.7%`、`0.6A×5Ω=3V`、`2.5\n3\n温度/℃\n99…`…）：
   不含汉字且很短，或「以小数开头且汉字≤4个」；
2. **文档标题（章节号）被误切**（题号 `10` + 正文 `10.3探索更小的微粒`…）：位于文档头部
   且题号后紧跟「点号 + 数字」。

阶段1 已同步修复切分逻辑（见 `pipeline/segment.py`），重跑 `pipeline.stage1` 后不会再产出这两类假题目。

## 元数据覆盖率（如实，非“齐全”）

元数据是从**文件名 / 标题 / 源路径**尽力推断的，**并非每项都有值**。以 209 份语料导入后
的 7945 道题为准（SQL 复核）。下表为 `bank.cli enrich` 补全前 / 后的实测覆盖率
（**占位符「待补充 / 未标注 / 未分类」不计入**）：

| 字段 | 口径 | 补全前 | 补全后（enrich） | 说明 |
|---|---|---|---|---|
| `subject` 学科 | 文件级 | **100%** | **100%** | 源路径含 `\物理\`，全部为物理 |
| `stage` 学段 | 文件级 | **100%** | **100%** | 源路径含 `\初中\`，全部为初中 |
| `grade` 年级 | **文件级** | 14.4% | **21.1%**（44/209） | 文件名/源路径直接含年级，或教材已知时按章节号区间映射 |
| `grade` 年级 | **题目级** | — | **17.6%**（1,396/7,945） | 同上，改按题统计（每题继承其来源文件的年级） |
| `textbook` 教材 | **文件级** | 12.0% | **18.7%**（39/209） | 文件名或源路径含教材版本关键词 |
| `textbook` 教材 | **题目级** | — | **17.5%**（1,392/7,945） | 同上，改按题统计 |
| `chapter` 章节 | **题目级** | 20.9% | **35.4%**（2,810/7,945） | 文件名/标题带 `10.3`、`第7章`、`课时10.1` 等编号的才有 |
| `qtype` 题型 | 题目级 | 70.0% | 70.0% | 由大题标题推断，缺标题的为“未分类”（enrich 不改） |
| `difficulty` 难度 | 题目级 | **0%** | **0%** | 源数据无难度标注，**系统不做自动推断**，需教研组人工标注（见下） |
| `知识点`（**提及口径**） | 题目级 | 0% | **97.2%**⚠️ | 题干**提及**已识别知识词即打标，**非考查范围**；需人工复核（见下） |

> ⚠️ **口径必须分清，否则会误导**：`grade` / `textbook` 是**文件级**（分母 = 209 份文件），
> `chapter` 是**题目级**（分母 = 7,945 道题）。把「年级 21.1%」与「章节 35.4%」放进同一张表，
> 会让人误以为同一个分母——前者数的是**文件**，后者数的是**题**。
> 本表已逐行标注口径。**统一按题目级口径**的真实值为：
> **章节 35.4%、年级 17.6%、教材 17.5%**（文件级口径下年级 21.1%、教材 18.7%）。

> ⚠️ **知识点的 97.2% 是「提及」口径，不是「考查范围」**：`enrich._match_dictionary` 的
> 逻辑是「知识词是否出现在题干里」（`term in text`），标的是**这道题提到过该词**，
> **不代表**这道题在**考查**该知识点。实测（7945 题）：平均 **4.26 个标签/题**、
> 最多 **33 个/题**（题 id=4813，见「已知限制」）；泛词命中量很大——`压强` 2,378 题、
> `重力` 1,849 题、`质量` 1,480 题。它**适合作为检索辅助**（“这道题提到过压强”），
> **不适合直接当作“考查范围”筛选**，除非人工复核。反例：题 id=4 是“原子结构”题，
> 仅因选项出现“就像太阳系……行星绕太阳”就被打上「太阳系」标签。

> 复核 SQL 示例：
> ```sql
> SELECT COUNT(*) FROM questions q JOIN source_files s ON s.id=q.source_id
> WHERE s.grade IS NULL;        -- 补全前 7074 -> 年级缺失
> ```

## 元数据补全（`enrich.py`）

`bank.cli enrich` 在**不编造、不覆盖**的前提下，从文件名、源路径、章节号与题干里
保守地补全 `grade / textbook / chapter / 知识点`，并为每个值记录来源（provenance）。

### 核心原则

1. **绝不编造**：没有依据的字段写 `待补充`。**难度（difficulty）尤其不猜**——
   源数据完全无标注，本模块一律保持 `未标注`，覆盖率恒为 0%。
2. **记录来源**：每个推断值都写进 provenance 列。
3. **不覆盖**：已经是非空的字段不动（只补记来源）。
4. **改库前先备份**：`enrich.backup_db()` 复制到 `outputs/bank.backup-<时间戳>.db`，
   `enrich.verify_backup()` 判定备份是否为**合格回滚点**（**永远返回 dict，不抛异常**）。
   `ok` 需**同时**满足三条件：`structure_ok`（表集合一致）、`integrity_ok`
   （`PRAGMA integrity_check` 通过）、`core_nonempty`（核心表 `source_files` /
   `questions` / `formulas` / `images` 行数均 **> 0**）。`rowcounts_equal`（逐表行数相同）
   是**独立参考指标、不参与 `ok`**：备份是**迁移前**状态，enrich 之后主库新增标签，
   `labels`（150 vs 333）、`question_labels`（5652 vs 38588）行数不同属**预期**；
   但**核心表被清空**（如 `DELETE FROM images`）**绝不**算预期——会 `ok=False`，verdict
   明确写「核心表 X 为空，无法用于回滚」。文件不存在 / 损坏 / 非数据库时 `ok=False`
   且带 `error` 字段（契约一致）。

### 新增列（幂等迁移 `ensure_provenance_columns`）

| 表 | 新增列 | 归属 |
|---|---|---|
| `source_files` | `grade_source`, `textbook_source` | 年级/教材是**文件级** |
| `questions` | `chapter_source` | 章节是**题目级** |
| `question_labels` | `source` | 知识点来源是**题目×标签级** |

迁移用 `PRAGMA table_info` 判断后 `ALTER TABLE ADD COLUMN`，重复执行不报错、不重复加列；
不触碰 FTS5 与外键。以 provenance 列是否已填写作为幂等锚点，**第二次执行新增数恒为 0**。

### provenance 取值

| 字段 | 取值 |
|---|---|
| grade | `filename`（文件名/路径直接含年级）/ `chapter_map`（按章节号区间映射）/ `unresolved` / `importer`（阶段2 导入器既有值） |
| textbook | `filename` / `path` / `unresolved` / `importer` |
| chapter | `filename` / `section` / `text` / `unresolved` / `importer` |
| 知识点 | `chapter_title`（来自章节标题词）/ `dictionary`（物理词典命中） |

### 推断规则

* **textbook**：文件名优先、源路径次之，匹配教材版本关键词。`江苏专用` 等只是**地区**，不算教材。
* **grade**：文件名/路径直接含年级（`八年级下册`、`高一`、`必修第一册`…）→ 归一化；
  否则**仅当教材已知**时按章节号区间映射；都推不出 → `待补充`。
* **chapter**：文件名里的 `9.4`、`第7章`、`课时10.1` → 章节号；`专题13`/`专项05`/`压轴05`
  **不是**教材章节；其次从 `section` 或题干首个标题行提取。
* **知识点**：由章节标题词 + 一份物理词典（**只收 ≥2 字概念词**，单字如「力」「功」不收）
  匹配提取。注意这是**「提及」口径**——只要题干里出现该知识词就打标，**不代表考查范围**，
  可能过度打标（平均 4.26 标签/题），**需人工复核**；详见上方覆盖率表后的说明。

### 教材章节映射表（**需人工确认**）

仅当**教材已知**时才使用；教材未知时**不用**，避免张冠李戴。映射表在 `enrich.py` 中是可读常量
`RENJIAO_GRADE_RANGES` / `SUKE_GRADE_RANGES`：

**人教版初中物理**：第 1–6 章 → 八年级上册；第 7–12 章 → 八年级下册；第 13–22 章 → 九年级全一册。

**苏科版初中物理**：第 1–5 章 → 八年级上册；第 6–10 章 → 八年级下册；
第 11–14 章 → 九年级上册；第 15–18 章 → 九年级下册。

> ⚠️ **这两张映射表由人工整理，需教研组人工确认后再用于生产。**
> 本语料中该映射**实际触发 0 次**：凡「教材已知」的文件，其 `grade` 均可由文件名/源路径
> 直接解析，**不存在**「教材已知 + grade 为空 + 有章号」的候选；而教材未知的 `课时X.Y`
> 文件又按规则**不用**映射。故该映射表当前是**未触发的保留逻辑**（备而未用，不是违规）。

## 知识点人工复核工作流（`labels.py`）

知识点标签是**「提及」口径**（`term in text`）：只要题干出现词典里的知识词就打标，
**不代表这道题在考查该知识点**（详见覆盖率表后的说明）。因此**知识点标签必须交由人工复核确认**。
`bank/labels.py` 提供复核工作流：

### 复核状态（`question_labels.review_status`）

| 取值 | 含义 |
|---|---|
| `待复核` | **默认**；历史 32,936 条关联迁移后**全部**为待复核 |
| `已确认` | 老师确认该题确实涉及该知识点 |
| `已否决` | 老师认为该题与该知识点无关 |

* **幂等迁移**：`labels.ensure_review_status_column()` 用 `PRAGMA table_info` 判断后
  `ALTER TABLE ADD COLUMN ... DEFAULT '待复核'`，**既有行一并回填为待复核**；重复执行返回 `[]`、不报错。
* **默认全部待复核**，未复核的标签**仍可用于检索**（否则功能不可用）；
  仅严格模式（`label_review='已确认'` / CLI `--kp-confirmed-only`）才只命中已确认标签。
* **绝不覆盖已确认的关联**：批量与导入默认只处理 `待复核` 行；确需改动用 `--force`。

### CLI

```bash
# 按「标签」汇总待复核项（183 个标签远比 32,936 条关联可复核）
$PY -m bank.cli labels review-list --namespace 知识点 --limit 20
#   label_id  标签      命中   待复核  已确认  已否决
#      5918   压强      2378   2378     0      0
#      5903   重力      1849   1849     0      0
#      5715   质量      1480   1480     0      0

# 确认 / 否决：不传 --question 批量作用于该标签全部待复核关联；传了只作用于该题该标签
$PY -m bank.cli labels confirm --label 压强                 # -> 更新 2378 条
$PY -m bank.cli labels reject  --label 太阳系 --question 4  # -> 更新 1 条

# 导出待复核清单（列：label_id,label_name,question_id,source,snippet），供老师离线填写
$PY -m bank.cli labels export-review --out review.csv
# 读回决定：CSV 需含 label_id,question_id,decision（decision 取 确认/否决）
$PY -m bank.cli labels import-review review.csv
```

* `import-review` **容错**：空行、未知 `label_id`、未知关联、非法 `decision`、非数字 id
  一律**跳过并计数**（打印原因），不影响其余行。
* **检索过滤**：`query.search(label_review='已确认', label_namespace='知识点')`
  只命中已确认的知识点标签；CLI 开关为 `search --kp-confirmed-only`。
  **默认（不加开关）未复核标签照常参与检索**——这是有意为之，否则复核完成前检索不可用。

## 组卷（`paper.py`）

把题库里的题挑出来组成一份**试卷**（含大题分组、题序、分值），并为阶段4（导出 DOCX/PDF）
准备**结构化数据**。本模块**不生成** DOCX/PDF。

### 数据模型

* `papers`：试卷元数据。`title, subject, stage, grade, template, answer_mode, created_by,
  status, created_at, updated_at, meta`。
  * `template`：`考试` / `测验` / `作业`（对应学科网三种模板思路，取值受约束）；
  * `answer_mode`：`学生版` / `答案解析版` / `仅答案`（供阶段4 决定是否渲染答案/解析）；
  * `created_by`：**默认 `待补充`**（作者类字段按要求留待补充）；
  * `status`：`草稿` / `定稿` / `已导出`。
* `paper_sections`：大题分组（`name, seq, description`），如「一、选择题」。
* `paper_questions`：题目条目。`seq`（**全卷题序**，1..n 连续）、`score`（`REAL`，`NULL`=未设分值）、
  `question_version`（组卷时锁定的题目版本）+ `snapshot_json`（内容快照）、`section_id`（归属大题）。

> 迁移 `ensure_paper_schema(conn)` **幂等**：补 `papers` 列、建 `paper_sections`、
> 必要时**重建** `paper_questions`（旧结构用 `position` 列，重建时数据保留、`position` -> `seq`）、
> 并确保 `questions` 具备 `answer`/`analysis`/`answer_source` 列，
> 最后把 `meta.schema_version` 更新为当前版本（现为 `3`）。重复执行返回 `[]`。

### 组卷操作（Python 接口）

`create_paper / list_papers / get_paper / delete_paper`；
`add_questions(paper_id, question_ids, section_id=None, section=None, position=None, score=None,
keep_material_together=False)`；`remove_question / move_question / set_score / set_scores`；
`add_section / rename_section / move_section / delete_section`；`paper_summary`；
`build_export_payload(paper_id, answer_mode=...)`。

### 关键决策

1. **快照锁定版本**：加题时记录 `question_version`，并把该题的**题干 / 公式 / 图片 / 来源定位 /
   答案 / 解析**写入 `snapshot_json`。**之后题库里该题被修改（版本升级、公式图片替换、答案变更），
   已建试卷的内容不变**——导出只读快照。`build_export_payload` 完全基于快照。
   对**旧试卷**（答案列尚不存在的年代建的），可用 `refresh_snapshots(conn, paper_id)` 在**题目版本未变**时
   把新抽取的答案补进快照（`version` 已前进的题默认跳过，以保持锁定）。
   **影响范围（重要）**：`refresh_snapshots` **按试卷刷新**——必须传 `paper_id=<id>`；
   若要**全库刷新**必须**显式**传 `all_papers=True`（`paper_id=None`），否则抛 `ValueError`。
   **不存在「默认全库」的隐式行为**，以免误刷所有试卷、破坏「出卷后锁定」。
2. **允许题目重复**：同一道题在同一份试卷里**可出现多次**（如不同大题各用一次），
   因此 `paper_questions` 对 `(paper_id, question_id)` **不加唯一约束**。
3. **题序连续**：`seq` 全卷 1..n 连续无空洞；删除 / 移动 / 插入后自动重排。
4. **分值合计**：总分 = 各题分值之和（`SUM(score)` 天然忽略 `NULL`）；
   **未设分值的题单独统计**（`unscored_count`），**不当作 0**；`score_complete` 表示是否已全部设分。
   **分值的合法范围与语义（校验）**：`set_score` / `add_questions(score=...)` / `set_scores`
   均经校验，合法范围 **`[0, 1000]`**（常量 `paper.MIN_SCORE` / `paper.MAX_SCORE`）：
   * **允许 `0`**：可作为「占位」（与「未设分值 `NULL`」不同——`0` 参与合计，`NULL` 不计入）；
   * **允许小数**：中国考试 **0.5 分**很常见，故 `REAL` 存储、**支持小数**（如 `0.5`、`2.5`）；
   * **拒绝负数**：负分无意义（否则可产出「负总分」试卷）；
   * **拒绝超大值**（`> 1000`）：明显是手滑；
   * **拒绝非数字 / `NaN` / `inf`**。
   非法值一律抛 `ValueError`（**明确报错，不静默 clamp、不忽略**）。
5. **跨题共用材料（部分实现）**：以 `(来源文件, 大题 section)` 为「材料/大题」组，
   `add_questions(..., keep_material_together=True)`（CLI `paper add --group`）会把同组题目
   **整体加入且保持相邻**。**注意**：阶段1 产出**没有段落级「共用材料」标识**，
   故这里只能聚合到「整个大题」粒度——**真正的段落级材料识别未实现**（见「已知限制」）。

### CLI

```bash
paper new --title "..." [--subject 物理] [--stage 初中] [--grade 八年级下册] \
          [--template 考试] [--answer-mode 学生版] [--status 草稿]
paper list [--status ...] [--subject ...]
paper show <paper_id>                         # 题目列表 / 题序 / 分值 / 总分 / 大题小计 / 题型分布
paper add <paper_id> <question_id...> [--section 名称或id] [--position N] [--score S] [--group]
paper remove <paper_id> <item_id>
paper move <paper_id> <item_id> <new_position>
paper score <paper_id> <item_id> <score>
paper section add|rename|move|delete ...      # 大题分组管理
paper delete <paper_id> [--force]             # 破坏性：试卷非空时需 --force
paper export-data <paper_id> [--answer-mode ...] [--out out.json]
```

* `item_id` 指试卷里的**条目**（`paper_questions.id`），与题库里的 `question_id` 不同：
  同一 `question_id` 在试卷里可有多个 `item_id`。
* `--section` 传**名称**（不存在时自动创建）或**大题 id**。
* `paper delete` / `paper section delete` 在**非空**时需 `--force` 确认。

### 导出数据（`build_export_payload`）

产出 JSON（阶段4 消费），结构：`{paper, answer_mode, generated_at, summary, sections[]}`，
每个大题 `{name, seq, item_count, subtotal, questions[]}`，每题：

| 字段 | 含义 |
|---|---|
| `text` | 题干，**含 `⟦Fn⟧` 占位符**（阶段4 用公式列表重建） |
| `plain_text` | 去占位符的纯文本 |
| `latex_list` | 公式的 **LaTeX 列表（按顺序）** |
| `image_paths` | 图片路径列表 |
| `score` | 分值（可为 `null`） |
| `question_version` / `item_id` / `seq` | 快照版本与定位 |
| `answer` / `analysis` | 答案 / 解析，**取自快照**；是否输出由 `answer_mode` 决定（`学生版` 一律 `null`，`仅答案` 只含答案，`答案解析版` 含答案与解析） |
| `answer_source` | 答案来源 provenance：`inline` / `paired_file` / `null` |
| `show_answer` / `show_analysis` | 布尔标志，供阶段4 决定版式（与上面内容置空**双保险**） |
| `source` | 来源文件 / 学段 / 学科 / 年级 / 教材 / 章节 / 段落范围 |

### 已知限制

* **答案 / 解析覆盖不完整**：抽取自题干内联标记与配对的答案/解析版文件，**能拆出/对齐的才写**，
  其余保持 `null`（**绝不编造**）。当前 7,945 题中有答案 **3,973** 条、有解析 **4,639** 条。
* **跨题共用材料仅到「大题」粒度**：见上文「关键决策 5」。段落级材料识别未实现。
* **快照与公式/图片版本**：`question_versions` 只快照题干文本，公式/图片在题库里**不按版本存**；
  本模块通过在**加题时**把公式/图片一并写入 `snapshot_json` 来实现锁定，
  故**加题之后**对题目公式/图片的修改不会影响试卷（已验证）。

## 答案 / 解析抽取（`answers.py`）

阶段1/阶段2 入库时**题干与答案/解析混在同一段文本**（`…题干…【答案】B【解析】因为…`），
导出 payload 的 `answer`/`analysis` 原为 `null`。本模块把答案/解析抽出来，写回
`questions.answer` / `questions.analysis` / `questions.answer_source`。

### 三条路径

* **路径 A（内联拆分）**：`:func:`split_inline`` 把题干按标记拆成 `stem` / `answer` / `analysis`。
  实测主流标记：`【答案】` 2,419 条、`【详解】` 2,146 条、`【解析】` 506 条、`【解答】` 487 条、
  `【分析】` 271 条、`【点评】` 64 条。**只改文本，不动公式与图片**——`stem` 保留原有 `⟦Fn⟧`。
  裸 `参考答案` / `答案：` **不作为**逐题答案标记（它们在语料里多为**整卷答案表**，会错配）。
* **路径 B（解析版按内容对齐）**：按「去掉版本后缀后的共同前缀」配对（`原卷版` ↔ `解析版`/
  `答案版`/`参考答案及评分细则`）。解析版题干与原卷版**逐字一致**，故**按题干内容对齐**
  （前缀兼容判定）。**对齐不确定的一律跳过并记录**——错配答案比没有答案更糟。
* **路径 C（答案版按题号对齐，须内容佐证）**：`答案版`/`评分细则` 是「题号 + 答案」简表，
  **仅当条目除「题号 + 答案」外还带原题题干文本（前缀佐证）时才按题号写入**；纯「编号 + 答案」
  **无法佐证即跳过**。原因：实测本语料的**答案版编号与原卷版并不一致**（如《走进分子世界》
  原卷版题型01 有 3 题、答案版只有 2 条），纯题号对齐会**静默错配**——**宁可少写答案，也不能写错答案**。
  实测该路径在本语料**写入 0 条**（答案版条目无题干文本，全部因无佐证而跳过）。

### 可疑答案复核

`find_suspicious_answers(conn)` 只读扫描已写入答案，返回明显矛盾者（如「填空题却得到单个**大写**
字母答案」——复刻 id=2919 场景）。刻意只认大写字母：`选填“a”“b”“c”` 这类填空题的答案本就是
小写字母，不算可疑。当前全库复核结果为 **0 条**。

### 数据与幂等

* 迁移 `ensure_answer_columns(conn)` **幂等**（新库 DDL 已含列，旧库 `ALTER TABLE` 补齐）；
* **不覆盖**已有非空值；以 `answer_source` 是否为 `NULL` 作为幂等锚点，重复执行新增数为 0；
* 写入前**重新读取目标题的当前值**（而非批次开始时抓取的旧行），并用 `assigned` 集合记录本轮
  已写过的题，避免同一轮内「解析版先写、答案版又写」的重复写入 / 覆盖判定失准（历史缺陷）。
* 改库前先备份并校验（`enrich.backup_db` / `verify_backup`）。

### CLI

```bash
answers extract [--dry-run] [--refresh-snapshots] [--db PATH]
```

* `--dry-run`：只统计不写库（路径 A 能拆出多少、路径 B/C 有多少组配对 / 对齐成功多少题 / 按来源分布）；
* `--refresh-snapshots`：抽取后刷新已建试卷快照，使旧卷也能带上答案。

> **实测结果**（7,945 题）：有答案 **3,973** 条、有解析 **4,639** 条；来源分布
> `inline` 3,090 / `paired_file` 1,739 / `NULL` 3,116。未拆出的题**保持 `null`**（绝不编造）。
> 其中 `paired_file` 含 **1** 条历史遗留（题 id=3864，由早期较宽松的**内容匹配**规则写入、答案正确，
> 现行更严的前缀规则不再复现）——全库与「从零重建」仅此 1 行之差，其余完全一致。

## 难度字段：暂时留空，系统不做自动推断

用户明确要求：**难度字段暂时留空、暂不填写**。

* 实测 `difficulty` 分布：**7,945/7,945 = 100% 为 `未标注`**，无任何其他取值。
* **没有任何代码路径会自动填它**：导入器写入 `metadata.DEFAULT_DIFFICULTY`（`未标注`）；
  `enrich` 把难度计入 `difficulty_untouched` 而**不写**；DDL 默认值亦为 `未标注`。
* **回归测试锁住**：`tests/test_enrich.py::TestDifficultyProtected` 断言导入 / enrich
  不产生非 `未标注` 值，且全库难度取值集合 ⊆ `{未标注, NULL, ''}`。
* **原因**：源数据**完全无难度标注**，凭空编造难度会**误导教师**选题与组卷。
  **难度需教研组人工标注**后再回填，系统只负责留空。

## 已知限制

* **年级 / 教材 / 章节**覆盖率仍然偏低（见上表）：这些信息在原始文件名/路径里大多不存在，
  `enrich` 已尽力推断并留痕，剩余缺口需教研组**人工标注**回填。
* **难度恒为 0%，且系统不做自动推断**：源数据**完全无难度标注**（7,945/7,945 均为
  `未标注`），`enrich` 与导入流程都**不猜、不写**。**难度需教研组人工标注**——编造难度
  会误导教师选题与组卷（例如把基础题标成难题），因此系统宁可留空也不自动填充。
  代码层面已加回归测试锁住该约定（`tests/test_enrich.py::TestDifficultyProtected`）。
* **知识点为「提及」口径、可能过度打标**：平均 4.26 标签/题、最多 33 个/题，泛词
  （`压强` 2,378、`重力` 1,849、`质量` 1,480 题）命中量大，且存在误标（题 id=4 因选项含
  “太阳系”被打「太阳系」标签）。**仅作检索辅助，作“考查范围”筛选前须人工复核。**
* **极值案例（切分缺陷的连带影响）**：题 **id=4813** 共 **33 个知识标签**、题干去占位符后约
  **7,213 字**（`char_length=6,918`），来源 `压轴05 电学实验（压轴题专练）（江苏专用）（解析版）.docx`。
  它是 `pipeline/segment.py` 把整段“电学实验核心表格”**粘连成一题**的产物（见下方
  「切分算法固有缺陷」），并非真实单题——属切分算法缺陷的连带影响，待后续改进切分时一并解决。
* **题型**约 30% 为“未分类”：部分资料的大题标题不规范或缺失。
* 少量**答案/解析区块**里以「题号 + 符号/字母答案」开头的行（无汉字，如 `18． √ √ × ×`）
  仍会被切成条目——它们不是“纯数值表格数据”，未纳入自动过滤，属题号正则的固有噪声。

### 「章节号形状」伪题与「小数开头」内容（重要：勿一概当垃圾）

切分器对**中段**文本**不启用**「章节号形状」剔除——这是**有意为之**：为了保住
`27.2018年5月13日…`、`16．1910年…` 这类「题号 + 年份正文」的真题（`.数字` 的**年份形状**
与章节号 `10.3` 必须区别对待，否则会误删约 1900 条真题）。代价是**答案区/考点区**的章节
标题可能作为伪题残留。

以「章节号形状」（正则 `^\s*\d{1,3}\.\d{1,2}(?:\.\d{1,2})?(?!\d)`，即「数字.数字[.数字]」
且其后非数字）开头的条目，全库实测 **318 条**，分类如下：

| 类别 | 条数 | 处理 |
|---|---|---|
| **表格数据块 / 含真实内容的子题**（如 `0.6 升高的温度ΔT/℃`、`1.2 液体的密度（g·cm-3）`、`0.32 较亮 (4)分析表格…`） | **316** | **不可删**——删除会丢内容 |
| **纯标题伪题**（如 `10.3探索更小的微粒 参考答案`、`0.1 考点五 …`） | **2** | 低危噪声（占全库 0.025%），暂记为已知限制 |

> **结论：`小数开头` 不能一概当垃圾**，否则会误删 316 条真实内容；仅 2 条是纯标题伪题。
> 本轮不改切分逻辑，避免误伤。

复核方法（SQLite 无正则，用 Python 复核）：

```python
import sqlite3, re
c = sqlite3.connect("outputs/bank.db")
pat = re.compile(r"^\s*\d{1,3}\.\d{1,2}(?:\.\d{1,2})?(?!\d)")
rows = c.execute("SELECT plain_text FROM questions").fetchall()
hit = [t for (t,) in rows if pat.match((t or "").strip())]
print(len(hit))  # -> 318
```

### 切分算法固有缺陷（待后续改进，勿在本轮处理）

约 **316 条**「表格数据行 + 紧随其后的真实题干/小问」被切分算法**粘连成单条**
（例如表格数值 `2.5 … 水的温度/℃ 25 27 …` 与其后的「分析表中数据，发现__」并成一条）。
根因是 `pipeline/segment.py` 以「题号」为**唯一**切分锚点：表格行不构成题号时，便并入下一条。
这属切分算法的固有缺陷，需后续改进（如引入「表格块识别」或按版面/段落类型切分），
**本轮不动**。

---

## 导出（阶段4，`bank/export.py`）

把阶段3 的 `build_export_payload` 产出渲染成**可直接发给学生的文件**：DOCX（**公式为可编辑的
原生 OMML**，非图片）与 PDF（供打印对照），并在 **WPS 与 Microsoft Word** 双客户端实测公式可编辑。

```bash
$PY -m bank.cli export paper <paper_id> --answer-mode 学生版 --out 试卷.docx [--pdf] [--template 考试]
$PY -m bank.cli export paper <paper_id> --answer-mode 答案解析版 --out 试卷_解析.docx --pdf
$PY -m bank.cli export verify 试卷.docx --out 验证报告.json     # Word/WPS 双客户端可编辑性验证
```

### 关键设计

* **公式 = 原生 OMML**：payload 的 `latex_list` 经本地 editor_sdk 桥接（`doc_insert_math`）
  以 LaTeX→OMML 写入；`⟦Fn⟧` 占位符**按 `fid` 精确映射**到对应公式（不按出现顺序），
  题干与解析里的占位符共用同一映射表，**不会串位**。找不到公式时**明确降级**
  （保留占位符字面文本并记 `warning`），绝不静默丢弃。
* **中文公式**：`\text{[U+XXXX]}` / 裸 `[U+XXXX]` 统一转 `\text{汉字}`（**在已有 `\text{}` 内替换**，
  不重复套一层）；MTEF 解码失败产生的替换字符降级为 `□`。个别解析器不接受的
  `数字+多字母单位+上下标`（如 `4cm^{3}`）自动**保守修复**为 `4{cm}^{3}` 后重试。
* **公式符号还原**：桥接对 `\Delta` / `\Omega` / `\pm` / `\leq` 等一批命令会输出 **HTML 实体名**
  （`&Delta;`），被 Word/WPS 当**字面文本**显示。导出先把 `\rm{}` 包装展开（否则 `\rm{ \Delta }`
  会退化成字面 `\Deltap`），再对 `<m:t>` 文本做实体名 → Unicode 还原（`&Delta;`→`Δ`）。
  还原后仍是 **OMML 文本**（非图片），公式保持原生可编辑。
* **题号**：导出按全卷**连续重新编号**；题干行首的**原卷题号**（`7．`）会被剥离，
  避免叠成 `1．（3 分）7．…` 的双重题号（仅当行首数字与快照题号一致时才剥离，防止误删正文数字）。
* **题干与答案分离**：阶段1 题干常内联答案（`…【答案】C【详解】…`），导出前用
  `answers.split_inline` 拆出 `stem`，**学生版只渲染 stem**，不泄露答案。
* **图片**：payload 只给包内相对路径 `media/imageN.png`，实际文件**从源 DOCX 包内**
  按 `word/<media_path>` 取出并校验 `sha256`，缓存到 `outputs/export/_media_cache/`；
  取不到的**明确列入 `warnings`**（不静默跳过）。图片居中附在题干之后（payload 无行内位置信息）。
* **模板差异**（`TEMPLATE_SPECS`）：

  | 模板 | 标题字号 | 页边距 | 装订线 | 题号标分 | 大题分页 | 卷头信息 |
  |---|---|---|---|---|---|---|
  | 考试 | 小二(18pt) | 2.54/2.6/2.0cm | 1cm | 是 | 是 | 班级/姓名/学号/成绩 |
  | 测验 | 三号(16pt) | 2.0cm | 无 | 是 | 是 | 班级/姓名 |
  | 作业 | 四号(14pt) | 1.5cm | 无 | **否** | **否** | 姓名/班级 |

* **答案版式**：`答案解析版` 对**已收录答案/解析的题**在题后附 `【答案】…` 与 `【解析】…`
  （解析可多段，公式同样为 OMML）；**库中没有答案/解析数据的题不会硬造**——本演示卷 10 道题中
  6 道（选择题）有答案与解析、4 道计算题在库中尚无答案，解析版对这 4 道**只显示题干**。
  `学生版` 不含答案；`仅答案` 只附 `【答案】`。是否渲染由 payload 的 `show_answer` /
  `show_analysis` 门控（与内容置空**双保险**）。
* **双客户端验证**：`verify_cross_client` 在 Word 与 WPS 中分别打开导出的 DOCX，统计
  `OMaths.Count`，并**逐个公式改一个内部字符 → 保存 → 关闭 → 重开 → 比对**，
  以证明公式可编辑（而非「有 OMML 节点」的间接证据）。

### 已知限制

* 图片**行内位置**未还原（payload 未提供），统一居中附在题干之后。
* 大题标题中的分值说明由题目分值**推导**（各题同分则写「每题 X 分，共 Y 分」，否则只写「共 Y 分」）。
* 装订线以 Word 的 **gutter**（页边距装订线）实现，非可见的「装订线」竖排文字。
* **上标撇号显示为 `□`**（**阶段1 源数据**的既有问题，非导出引入）：阶段1 从 MTEF 解码时，
  个别上标撇号（`\prime` 变体）解码失败成替换字符 `U+FFFD`，导出侧**保守降级为 `□`**
  （如本演示卷第 9 题选项中的 `p甲^□`，共 4 个公式）。导出**不猜测还原**该字符，以免制造错误符号。
* **只读导出**：导出走只读连接（`bank.db.connect_readonly`），**不触发 schema 迁移、不改动 `bank.db`**
  （已用 hash + mtime 前后对比验证）；若库尚未迁移到阶段3 schema，请先 `init` / `import` 再导出。
