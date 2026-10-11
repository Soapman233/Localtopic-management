# R-可编程导入调查报告

> 角色：研究员（R） · 只读调查 + 探针验证
> 目标：验证「`pipeline` 阶段的单文件处理函数能否被**服务进程干净地调用**」，为新增
> `POST /api/import/docx` 提供事实依据。
> 结论先行：**能干净地调用**。`process_file` 与 `import_file` 都不依赖 editor_sdk / COM /
> cwd / 环境变量，异常全部内部捕获，事务单文件原子，可重入。唯一需要盯住的是
> **MathType 路径的 `spawn` 多进程**（部署形态风险，见 §七）。
> 日期：2026-10-11 · 环境：Python 3.13.14（venv `kb`），Windows 11

---

## 一、端到端导入链路

「自己建库」当前只能靠命令行完成，**最小链路 = 2 步**，完整链路 = 6 步：

| 步骤 | CLI 命令 | 编程入口 | 输入 | 输出 |
|---|---|---|---|---|
| 1 | `python -m pipeline.stage1 <docx> --out <dir>` | `pipeline.stage1.process_file(path, out_dir, timeout, verbose)` | 单个 `.docx` | 返回 `record: dict`；落盘 `<stem>.scan.json` + `<stem>.questions.json` |
| 2 | `python -m bank.cli init` | `bank.db.connect(db_path, create=True)` | 库路径 | 建表建索引的连接 |
| 3 | `python -m bank.cli import <dir>` | `bank.importer.import_path(conn, path)` / `import_file(conn, qjson)` | 目录或单个 `*.questions.json` | 返回 `ImportStats` / `record: dict`，写入 SQLite |
| 4 | `python -m bank.cli enrich` | `bank.enrich.enrich(conn, dry_run=False)` | 库连接 | 补全 学段/年级/教材/章节/知识点 + provenance 留痕 |
| 5 | `python -m bank.cli normalize` | `bank.latexnorm.migrate_latex(conn, ...)` | 库连接 | 规范化历史 LaTeX（新导入已在写入时规范化，见 §三） |
| 6 | `python -m bank.cli answers extract` | `bank.answers.extract(conn, dry_run=False)` | 库连接 | 抽取答案/解析（内联拆分 + 配对文件） |

**最小可建库路径 = 步骤 1 + 3**（stage1 产出 JSON → importer 入库）。
步骤 4/5/6 是**可选增强**，都是纯 DB 操作，不碰外部资源：
* 步骤 5 对新导入**可省**——`importer._write_children` 在写库时已调用
  `latexnorm.normalize_latex`（`bank/importer.py:209`）。
* 步骤 4（enrich）与步骤 6（answers）建议作为导入作业的**收尾子步骤**保留，代价低、纯 SQL。

### 步骤 1 内部拆解（process_file 的真实调用序列）

```
process_file(path, out_dir, timeout, verbose)
├─ docx_scan.scan(path, timeout=timeout)      # 纯 zipfile+ET+olefile，见 §三
│    └─ 若有 MathType：mtef_conv.convert_many(streams, per_chunk_timeout=timeout*4)  # spawn 多进程
├─ segment.segment(doc)                        # 纯正则切分
├─ docx_scan.dump(doc, out_dir/<stem>.scan.json)
└─ (out_dir/<stem>.questions.json).write_text(json.dumps(segment.to_dict(seg, doc)))
```
返回 `record` 关键字段：`status`、`scan`(stats)、`questions`(stats)、`review_count`、
`outputs`([scan.json, questions.json])、`seconds`；失败时为 `status="ERROR"` + `error` + `traceback`。

---

## 二、关键函数签名（原样抄写）

```python
# pipeline/stage1.py:38  —— 单文件处理入口（本次核心）
def process_file(path: Path, out_dir: Path, timeout: float, verbose: bool):
    """返回 record: dict（永不抛异常；失败 -> status="ERROR"）"""

# pipeline/docx_scan.py:237
def scan(path, timeout=10.0, progress=None) -> ScannedDoc:

# pipeline/segment.py:163
def segment(doc: ScannedDoc) -> SegmentResult:

# pipeline/segment.py:226
def to_dict(result: SegmentResult, doc: ScannedDoc | None = None) -> dict:

# bank/importer.py:245  —— 单文件入库
def import_file(conn, qjson_path: str | Path, *, skip_numeric_junk: bool = True,
                verbose: bool = False) -> dict:
    """返回 record: dict（永不抛异常；失败 -> status="ERROR" 且已 rollback）"""

# bank/importer.py:392  —— 目录/批次入库（路径不存在时抛 FileNotFoundError）
def import_path(conn, path: str | Path, *, skip_numeric_junk: bool = True,
                verbose: bool = True) -> ImportStats:

# bank/db.py:244
def connect(db_path: str | Path = DEFAULT_DB_PATH, *, create: bool = True) -> sqlite3.Connection:

# bank/enrich.py:652
def enrich(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:

# bank/answers.py:582
def extract(conn: sqlite3.Connection, *, dry_run: bool = False) -> dict:

# webui/jobs.py:51
def submit(self, kind: str, fn: Callable[..., Any], **kwargs: Any) -> str:

# webui/db.py:56
def write_txn(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:  # @contextmanager
```

**返回值结构**（`process_file` / `import_file` 都是普通 dict，非异常传递）：

```
process_file -> {file, name, status, scan{paragraphs,formulas,omml,mathtype,ok,
                 needs_review,images_referenced,media_files,convert_seconds},
                 questions{questions,with_formulas,with_images,total_formula_refs,...},
                 review_count, review, outputs, seconds}     # ERROR 时: error, traceback
import_file  -> {file, status, source_id, sha256, meta{stage,grade,subject,textbook,chapter},
                 new, updated, skipped, junk, formulas, images, review, questions_in_file}
```

---

## 三、外部依赖检查

| 依赖项 | 结论 | 证据 |
|---|---|---|
| **editor_sdk** | **不依赖** | `import pipeline.stage1, bank.importer` 后 `sys.modules` 中无任何 editor_sdk 模块（实测）；`editor_sdk` 仅出现在 `bank/export.py`（导出路径） |
| **COM / Office（win32com/comtypes/pythoncom）** | **不依赖** | 同上实测为「无」；`win32com`/`pythoncom` 仅出现在 `bank/export.py:1863+`（PDF 导出） |
| **全局可变状态 / 单例** | **仅 1 个，且默认安全** | `pipeline/segment.py:80 FILTER_TABLE_NUMERIC = False` 是模块级开关，只有 `stage1.main()` 会改它（`:97`）。服务里直接调 `process_file` 不会改它，实测保持 `False`。`mtef_conv` 每次调用新建 worker 进程，无跨调用残留 |
| **cwd / 相对路径** | **不依赖** | `process_file` 的 `out_dir` 由调用方传入（绝对路径即可）；`docx_scan`/`importer` 全部用传入的 Path；探针在项目根之外运行也正常（探针把 ROOT 插入 `sys.path`） |
| **环境变量** | **核心链路不依赖** | `pipeline.*` 与 `bank.importer` 不读环境变量。仅 `bank/export.py` 读 `editor_sdk_*`/`BANK_BRIDGE_*`（导出用，不在导入链路）；`webui.config.get_db_path` 读 `QB_DB_PATH`（Web 层，可选） |
| **多进程** | **MathType 路径依赖 `spawn`** | `mtef_conv.convert_many` 用 `multiprocessing.get_context("spawn")` 起 worker 进程做超时隔离（`pipeline/mtef_conv.py:196`）。**OMML 公式不触发此路径**（`pending` 为空则直接返回） |
| **数据库写入** | SQLite，单写者 | `import_file` 内部 `conn.commit()`（成功）/ `conn.rollback()`（失败），单文件原子 |

> 注：`mtef_conv` 在模块导入时把 `pipeline/vendor` 插入 `sys.path`（`:34-36`），是**幂等的无害副作用**。

---

## 四、探针实测结果

探针文件：`spike/programmatic_import/probe_import.py`
原始输出：`spike/programmatic_import/probe_raw_output.txt`（本次运行完整落盘）
副本库：`spike/programmatic_import/tmp_bank.db`（**空库新建**，交付库不存在也未触碰）
样例：`spike/a4-preview/.evidence/real/paper1_student_A4.docx`（真实 DOCX，24 个 OMML 公式、8 张图，706 KB）

### 原始命令

```bash
"C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe" \
    spike/programmatic_import/probe_import.py
```

### 探针 1 · 同进程 process_file → import_file（原始输出节选）

```
[process_file 返回结构] keys = ['file','name','outputs','questions','review',
                                'review_count','scan','seconds','status']
  status: "OK"
  scan: {"paragraphs":42,"formulas":24,"omml":24,"mathtype":0,"ok":24,
         "needs_review":0,"images_referenced":8,"media_files":8,"convert_seconds":0.0}
  questions: {"questions":10,"with_formulas":5,"with_images":8,
              "total_formula_refs":24,...}
  seconds: 0.01
产出 questions.json 存在 = True

[import_file 返回结构]
  status:"OK" source_id:1 sha256:"d190f2dbc5d6"
  meta: {"stage":"初中","grade":"八年级","subject":"物理","textbook":null,"chapter":null}
  new:10 updated:0 skipped:0 junk:0 formulas:24 images:8 review:0
[再次 import_file（幂等验证）] new=0 updated=0 skipped=10
[副本库计数] source_files=1 questions=10 formulas=24
```

**结论**：`process_file` 在同进程内干净跑通并返回结构化结果；产物 JSON 被 `import_file`
正确入库（10 题 / 24 公式 / 8 图）；重复导入**幂等**（全部 skipped）。

### 探针 2 · 坏输入（原始输出）

```
[空文件]        status=ERROR  error='File is not a zip file'
[非 DOCX(文本)] status=ERROR  error='File is not a zip file'
[损坏 ZIP]      status=ERROR  error='File is not a zip file'
[文件不存在]    status=ERROR  error="[Errno 2] No such file or directory: ..."

[事务污染验证] 好文件 -> 坏文件 -> 好文件
  好文件 : OK new=10
  坏文件 : ERROR error="formula_ids 必须是字符串列表，收到 str：'F1'（题目 number='1'）"
  连接仍可用 : True
  再导入 : OK skipped=10
  坏文件未写入题目 : questions=10
```

**结论**：`process_file` 对坏输入**一律内部捕获、返回 ERROR，不抛异常**；
`import_file` 对非法数据**抛→内部 rollback→返回 ERROR**，**不污染已打开的事务**，
后续好文件照常提交。

### 探针 3 · 耗时（原始输出）

```
第1次: status=OK seconds(内部)=0.01 wall=0.01s
第2次: status=OK seconds(内部)=0.00 wall=0.00s
第3次: status=OK seconds(内部)=0.00 wall=0.00s
```

**结论**：该文件（24 个 OMML 公式，无 MathType）**约 0.01 秒/文件**。
OMML 路径是纯 Python 解析，无多进程开销，量级为**毫秒级**。

### 探针 4 · 可重入（原始输出）

```
A status=OK questions=10
B status=OK questions=10
A 再跑一次结果一致 : True
segment.FILTER_TABLE_NUMERIC = False
```

**结论**：连续处理 2 个文件互不影响；同一文件重复处理结果**逐字段一致**；
模块级开关未被污染。

### 探针 5 · spawn 多进程（MathType 隔离路径，原始输出）

```
convert_many 返回 : [{'index':0,'status':'EMPTY','latex':None},
                     {'index':1,'status':'EMPTY','latex':None}]
elapsed           : 0.54s
spawn 多进程路径   : 可用（无异常）
multiprocessing start method = None   # Windows 默认 spawn
```

**结论**：`mtef_conv.convert_many` 在「被导入调用」的进程里**可以正常启停 worker 进程**。
（无真实 MathType 样例，此处用 dummy stream 只验证**进程机制本身**；结果为 EMPTY 属预期。）
**注意**：单次 spawn 约 **0.5s** 固定开销——含 MathType 公式的文件会比纯 OMML 文件明显慢。

---

## 五、异常与超时行为

**异常行为**
* `process_file`：`try/except` 包住全部逻辑（`stage1.py:41-75`），**任何异常都不外抛**，
  返回 `{"status":"ERROR","error":str(e),"traceback":...}`。非 DOCX / 空文件 / 损坏 ZIP /
  文件不存在 → 统一落到这里。
* `import_file`：`try/except` 包住全部逻辑（`importer.py:253-386`），异常时先
  `conn.rollback()` 再返回 `{"status":"ERROR","error":...}`（`importer.py:376-385`）。
  **单文件原子**：文件内任何异常都回滚，不把半截数据留给下一个文件。
* `import_path`：唯一会**向外抛**的是 `FileNotFoundError`（路径不存在，`importer.py:402-403`），
  这是刻意设计（避免「静默 0 文件 0 错误」被误当成功）。**服务层需单独捕获它**。

**超时行为**
* `process_file` 的 `timeout` 参数**不是整文件墙钟超时**，而是传给
  `docx_scan.scan` 的「MathType 分块解析超时」，最终成为
  `mtef_conv.convert_many(per_chunk_timeout=timeout*4)`（`docx_scan.py:292`）。
* 单个 MathType 公式卡死 → 记为 `TIMEOUT` 并**重启 worker 从下一题继续**（`mtef_conv.py:213-218`），
  不级联、不拖垮整文件。最坏耗时 ≈ `每公式超时 × 公式数`（默认 `per_equation_timeout=4s`）。
* **OMML 路径无超时概念**（纯解析），也就不存在挂死风险。
* 服务层若需**总时长上限**，需自己在 `process_file` 外层加 deadline（当前无此机制）——
  见 §七风险。

**事务边界**：一次 `import_file` = 一个 SQLite 事务（成功 `commit`，失败 `rollback`），
以源文件 `sha256` 与 `(source_id, content_hash)` 为幂等锚点。

---

## 六、接入 `webui/jobs.py` 的建议（不改代码，只给建议）

现有范式（`webui/jobs.py`）：**单后台线程 + 队列**，`submit(kind, fn, **kwargs) -> job_id`，
状态 `pending → running → done | error`；该设计原本是为串行保护 editor_sdk/COM。

导入**不需要** editor_sdk/COM，但**仍建议复用同一 JobManager**，理由：
1. 导入写 SQLite，天然需要**单写者**；单线程队列顺带保证不会与其它写作业并发。
2. 复用现成的 `submit/get` + `/api/jobs/{id}` 轮询协议，前端零改造。
3. 与 `export_svc.py` 的 `preview_request/export_request → run_*_job` 分层保持一致。

建议的落法（**与 `export_svc` 对称**）：

1. **同步部分** `import_request(...)`：做**轻量校验**（扩展名 `.docx`、文件存在、大小上限、
   是否重复 sha256），把上传文件**落到独立临时目录**（如
   `outputs/webui/import_work/<job_id>/in.docx`），然后
   `get_manager().submit("import", run_import_job, docx_path=..., job_id=...)` 返回 `job_id`。
2. **作业体** `run_import_job(docx_path, job_id)`：在**后台线程内**：
   * `work = <job临时目录>`；`rec = pipeline.stage1.process_file(Path(docx_path), work, timeout=10.0, verbose=False)`；
   * 若 `rec["status"] != "OK"` → 抛 `errors` 里的自定义异常（让 JobManager 映射错误码），
     或返回 `{"status":"ERROR", ...}` 由前端展示；
   * `qjson = work / (stem + ".questions.json")`；
   * `with webui.db.write_txn() as conn: stats = bank.importer.import_file(conn, qjson)`；
   * 可选收尾：同一 `conn` 内 `bank.enrich.enrich(conn)`、`bank.answers.extract(conn)`；
   * 清理临时目录，返回 `{file, new, updated, skipped, formulas, images, review, source_id}`。
3. **DB 连接**：作业体内**自建**连接（`db.write_txn()`），**不要把 FastAPI 依赖注入的
   `conn` 跨线程传入**（SQLite 连接不跨线程共享，见 `webui/db.py:7-9` 约定）。
4. **路由**：`POST /api/import/docx`（multipart）→ 同步部分返回 `{job_id}`；
   复用现成 `GET /api/jobs/{job_id}` 轮询。
5. **异常映射**：`import_path` 的 `FileNotFoundError` 建议在同步部分就拦掉（文件已在手，
   其实不会触发）；作业体内的失败统一抛异常交给 `jobs._worker` 的 `to_api_error`。
6. **并发/幂等**：重复上传同一文件由 `sha256` 去重（`files_skipped`），个人客户端友好。

---

## 七、风险与未验证项

**已识别风险**
1. **`spawn` 多进程 + 打包形态（最高优先）**：`mtef_conv` 用 `spawn`。服务由
   `python -m uvicorn` 启动时 `__main__` 有 guard，可正常工作；但**便携客户端若用
   PyInstaller 等冻结打包，必须调用 `multiprocessing.freeze_support()`**，否则含 MathType
   公式的文件会崩。**含 MathType 的真实样例在仓库中不存在**（所有样例 DOCX 均为 OMML，
   `embeddings/` 计数为 0），该路径**未做端到端实测**。
2. **MathType 文件耗时不可预测**：每个 MathType 公式最坏 `per_equation_timeout`（默认 4s），
   叠加 `spawn` 的 ~0.5s 启动开销。大文件（数百公式）可能到分钟级。需在作业层加**总时长上限**
   或进度反馈。
3. **临时文件与磁盘**：`process_file` 会落盘 `scan.json` + `questions.json`（每文件 2 个），
   服务层必须用**独立临时目录**并**作业后清理**，否则 `outputs/` 会堆积中间产物。
4. **`import_path` 的 `FileNotFoundError`** 会外抛，与 `process_file`/`import_file` 的
   「静默返回 ERROR」语义不一致，接入时需显式处理。
5. **`webui/db.py` 未启用 WAL**（刻意，为保住「只读导出不改库」保证）：导入是重写操作，
   与并发读作业交错时依赖 `busy_timeout=5000`；单机个人客户端场景下可接受，但**长导入作业
   会占用写锁**，期间其它写请求排队。
6. **`timeout` 语义易误用**：它是「每分块解析超时」而非「整文件超时」，不要当作墙钟上限。

**未验证项（建议后续补）**
* 真实 **MathType/OLE** DOCX 的端到端（需构造一个带 `word/embeddings/*.bin` 的样例）。
* 冻结打包（PyInstaller）形态下的 `spawn` 行为。
* 大文件（>5 MB、数百题）的**内存与耗时**曲线。
* 多文件批量导入（`import_path` 目录模式）在作业线程中的表现。
* 上传文件编码/文件名含中文/空格时的落盘与匹配（`_scan_path_for` 依赖同名规则）。
* `enrich` / `answers` 作为导入收尾步骤的**耗时与幂等**（本次未跑）。

---

## 附：产物清单
* 探针代码：`spike/programmatic_import/probe_import.py`
* 探针原始输出：`spike/programmatic_import/probe_raw_output.txt`
* 副本库（空库新建）：`spike/programmatic_import/tmp_bank.db`
* 探针工作目录（中间产物）：`spike/programmatic_import/work/`
* 本报告：`outputs/handoff/R-可编程导入调查报告.md`

> 全程未写入交付库或任何业务文件；未发现 `outputs/bank.db`（交付库在本次工作树中不存在）。
