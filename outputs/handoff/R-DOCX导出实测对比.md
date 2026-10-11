# 交接：DOCX导出实测对比 / R

本轮只读研究两份用户指定DOCX，未改业务实现、交付数据库或输入DOCX。结论：当前差距首先是题目内容与图文结构，再是字号与间距。系统样本存在答案区记录被当题选入、学生版答案图泄漏、选项配图失去关联、残留源卷大题标题；仅调整模板不足以解决。对照卷也有题干/配图/选项跨页，不能照搬其所有分页表现。

## 我做了什么

1. 全读根AGENTS.md、documents/read_review及pdf技能；执行基线318测试，317通过、1 skip，30.801秒。
2. 对两份DOCX的ZIP/XML全量审计：段落、样式、页尺寸边距、字段、表格、图引用、公式、OLE预览、上下标、分页控制；原始证据位于`outputs/docx-compare-20261010/local/*-audit.json`与`supplement.json`。
3. 使用独立`Word.Application`只读打开两份输入并导出PDF，使用bundle Poppler渲染全部27页，查看全页概览及单页原图。Word16.0统计系统7页；参考20页，其中题卷10页、答案10页。
4. 用SQLite `mode=ro`追到paper3的23条锁定快照，并追查4个当前源DOCX及既有预处理JSON，全部源SHA与库来源记录一致；验证答案碎片与答案图片的来源，未重跑预处理。
5. 只读定位`pipeline/docx_scan.py:110`、`pipeline/segment.py:161`、`bank/answers.py:152`、`bank/export.py:499`、`:673`、`:1230`、`bank/paper.py:414`的结构损耗与导出行为。

## 输入与可比性

| 项 | 系统样本 | 用户标作组卷网的参考样本 |
|---|---|---|
| 路径 | `D:/Open-source project/Localtopic-management/outputs/export/未命名试卷_学生版_053d517a.docx` | `C:/Users/SOAP/Downloads/2026年9月17日初中物理作业.docx` |
| SHA256 | `abefa9fdb4fd505dd7f0d35804dd69ec38bcda8cf4efa759a0fa65ff6b237087` | `bb15d2c287bbb7d9f9e3213019e44242a250afeba79dd3ac22a153d48f64a939` |
| 内容 | 23个连续编号，原子结构/电磁实验/浮力/电阻实验混合，含8条答案片段 | 30道光学题，随后有独立参考答案表与详解 |
| 模式 | 学生版，无正常答案解析区，但实际含泄漏答案图 | 题卷+答案解析合卷 |
| Word实际页数 | 7 | 20=题卷10+答案10 |
| 同题性 | 两份并非同一内容；23题与参考30题没有可作逐题保真对照的同题 | 可以比较版式组织与结构能力，不能比较总页数、文件大小以判优劣 |

系统来源可逐项对应当前paper3快照；这不证明该DOCX生成时与当前代码、当前库一切状态完全相同。未用历史文件作修复前后实验，也未新导出声称性能或修复效果。

## 比较矩阵与关键量化

| 维度 | 系统DOCX事实 | 参考DOCX事实 | 判断 |
|---|---|---|---|
| 纸张/方向/栏 | A4竖向，11906×16838 twips；1节，未声明多栏 | 同为A4竖向；2节，均`cols num=1` | 两者均单栏，参考不是双栏模板 |
| 页边距 | 上下左右1134 twips≈20.00mm；无装订线 | 上下964≈17.00mm，左右1134≈20.00mm；gutter=0，header340≈6mm，footer567≈10mm | 参考上下多6mm正文高度，不能解释全部视觉差异 |
| 正文 | 宋体12pt；西文也设置宋体 | 中文宋体10.5pt，西文Times New Roman10.5pt；少量Calibri/黑体/斜体 | 正文12→10.5pt能改变密度，但不能修数据与锚点 |
| 标题 | 黑体16pt粗体，居中；“未命名试卷” | 宋体15pt非粗体，居中；明确日期/学科/作业标题 | 模板和用户标题设置均影响观感 |
| 卷头 | 班级、姓名 | 学校、姓名、班级、考号 | 两份均未见密封线、总分或考试时长 |
| 行距 | docDefaults `spacing line=360 lineRule=auto`即1.5倍 | 正文段落主要同为`line=360 auto`；另有docGrid312twips | 不能将差距归结为系统1.5而参考单倍 |
| 段距 | 题末after320=16pt；图前before200=10pt，图后10或16pt；大题前16后10pt | 多数正文spacing仅line360，没有单独题末16pt；紧凑连续 | 系统统一大留白，而参考按图文段连续排 |
| 段落/表格 | 正文62个`w:p`，0表 | 正文366个`w:p`（含表格格内段落），2表、8行、56格 | 表格能力不能用段落数量比较；系统样本本身无表格题 |
| 大题结构 | 只有生成的“未分组”，23条均section_id=NULL；原文残留“四、实验题”“三、综合题” | 六大题：单选1–15；课内填空16；填空17–24；作图25；实验26–29；科普阅读30 | 系统残留标题不是真正当前paper_sections分组 |
| 分值/作答 | 本卷23条score均NULL，因此无分值；沿用原文下划线和图内作图区 | 无题后分值；下划线及作图图面，无统一另加大答题区 | 参考样本不能佐证评分表/密封线/计算题留白产品能力 |
| 题号/选项 | literal文本1–23；`numPr=0`、正文无SEQ；选项TAB变4空格，无选项对象 | literal题号1–30，答案区再次1–30；`numPr=0`、正文无SEQ；60个`w:tab`，有1行4项/2行2项/4行1项 | 自动编号并不是参考美观的必要条件；选项结构与制表位才是主要差异 |
| 分页控制 | 58个keepLines启用；keepNext元素58个，其中启用36、关闭22；无显式pageBreakBefore/br分页 | 正文keepNext/keepLines=0；表格4行cantSplit；题卷/答案分节并重置页码 | 系统试图整题绑定，但超长整题仍必须拆页；不能无限keepNext |
| 图片实例 | 11个DrawingML inline，11个不同PNG；无anchor、VML、裁剪、表格图 | 46个DrawingML inline实例引用41个普通图文件，另1个VML浮动二维码；无DrawingML anchor；无srcRect裁剪；两表无图 | 不能把OLE预览图计为普通题图；“anchor=0”不代表完全无浮动图，二维码是VML |
| 图片角色与位置 | 所有图均为独立居中段追加在题文字后；选项4图纵排，不保留选项中位置 | 题图可在题干与选项之间，图可嵌在A/B同段；作图子问图紧随子问；答案图在答案区 | 需要位置/角色/实例顺序；不能仅保存图片文件集合 |
| 图片大小/清晰度 | 例题2四图6.985×6.191、6.720×5.450、6.985×6.720、6.853×5.874cm；第一题190×202px显示5.027×5.345cm≈96dpi | 例题6选项图宽3.36–4.075cm、题15选项图宽0.873–1.773cm；题3组合图16.996×3.462cm，1756×359px≈262dpi | 图片尺寸应看对象用途和来源布局；系统低像素小图按96dpi显示明显大且较糊，不能跨不同图断言参考所有图更高清 |
| 公式结构 | 0 OMML、0 OLE；选入快照全文共7个公式占位符，全部在被排除的解析；学生版stem公式引用0 | 24个Equation.DSMT4 OLE+1原生OMML（含2个m:sSup）；3个OLE在题卷，其余21个在答案 | 系统样本无公式是内容选择与学生版过滤所致，不能称公式转换失败；也不能拿该样本证明本轮OMML可编辑 |
| OLE预览/媒体 | 无OLE与预览 | 24个OLE均自带VML预览，引用19个不同PNG；无WMF/EMF媒体；另46inline引用41个图，二维码另1PNG；包中61媒体=41普通+19公式预览+1二维码 | 包中58PNG+3JPEG；70个Word InlineShapes=46普通+24OLE，Word Shapes=1二维码；不能把24+46+1当71道题图 |
| 字符/上下标 | 度数/Ω/μm等为文本；没有w:vertAlign或OMML上下标 | 没有w:vertAlign，指数通过OLE/OMML表达；c、AB等有斜体，∠、°等文本保留 | 上下标存在方式不同；XML全文`3×108`线性提取不能当实际指数丢失，渲染显示10的8次方 |
| 页眉/页脚 | 无可见页眉；footer PAGE+NUMPAGES，实际第1页共7页等 | 空页眉；题卷footer PAGE+SECTIONPAGES，实际试卷第1–10页共10页；答案另节页码1–10 | 源XML域缓存是3/2页，Word实际重排是10/10；不得用缓存页数当实测 |
| 答案解析 | 学生版文本过滤了【答案】/【详解】后文字，仍保留答案片段题与答案图片 | p11开始参考答案，4×11答案汇总表覆盖15单选，之后逐30题详解，含图/公式 | 模式须分开比较；用户给的参考具有完整答案出版形态 |

XML定位均以`word/document.xml`为主；样式默认在`word/styles.xml`，页脚为`word/footer*.xml`。完整逐段XPath、direct/effective字体和段落属性、图片extent均在audit JSON。注意初版audit的effective spacing字典未逐属性合并，正文行距结论取docDefaults/样式/直接属性交叉核验，不依赖缺属性=0的推断；sections简表只保留最后同名header/footerReference，完整XML来自源ZIP。

## 必须优先处理的具体发现

### 1 学生版泄漏答案图片

复现：查看系统PDF第7页23题，第一张是实验未接线题干图，下方又有已接好线的完整电路图。只读`SELECT snapshot_json FROM paper_questions WHERE paper_id=3 AND seq=23`，qid7942的images同时含`media/image123.png`与`media/image124.png`。以`source-trace.json`核对来源解析版DOCX：题干图在`/w:document/w:body/w:p[353]`，答案图在`/w:document/w:body/w:p[359]`、该段文字`【答案】(1)`。

实际：系统DOCX `word/media/image11.png`与源`word/media/image124.png`SHA一致=`10229ba2c74cf9879491c30c7d5791befe6106dabbc856e16f219e082ea1e7ce`，位于系统body p62。该已接线图泄漏第(1)问答案。

期望：学生版只出题干/选项/作答所需图；答案图仅在对应答案分支。归属不明时必须如实提示/复核，不能把未知图全部丢掉来掩盖问题。

根因证据：`pipeline/docx_scan.py:181`记录图片来源段号但不写图片占位符；`pipeline/segment.py:195`把题范围内图片汇总成文件列表；`bank/paper.py:443`快照只存media_path/sha；`bank/export.py:673`分离文字，`:1230`却遍历所有q.images追加，没有stem/answer/analysis图片归属。

影响边界：本轮实际证实这1题1张答案图；架构上任何同题图片集合包含答案图而学生版无角色过滤的输入都可能受影响。未统计全库污染规模，不能说全库多少题泄漏。

### 2 答案区碎片被当成独立题目

复现：系统p3末5.C，p4中6.A、7.B、8.正/不显、9.转移/质子、10.分子…、11/12.核式…，共8个编号条目，并不是完整题干。

实际源链：qid5542当前库与锁定快照文本都以`1．C\n【详解】…`开头；源文件SHA与source_files记录一致。既有scan中“参考答案”在index125，答案区1.C在index171，既有questions.json仍生成start171/end176的题。当前学生版只是把【详解】后排除、把1.C重新编号为5.C。qid61同样在源“参考答案”index64之后，把index78–80的14.正/不显独立入库，源、库、快照已是该答案条目，导出并未删除一个原有完整题干。

期望：识别题卷/整卷答案区的边界，并把答案与原题有证据配对，答案条目不能作为新题进入可选题集合。无法可靠配对保留待复核，不能按同号强配。

根因：`pipeline/segment.py:166–199`遍历全部段落并按编号启动新题，没有遇到整卷参考答案后切换分支的状态；current_section沿用题卷最后大题，导致答案条目还被标作计算/实验题。`bank/answers.py`已明示仅逐题【答案】标记可直接拆，并刻意不把裸“参考答案”作逐题标记；因此解决点不能靠在export盲删“C/A/B”或改一个字号。

影响边界：本卷8编号实际证实，其中qid64重复选入两次，计独立qid为7；未对全库重新审计数量。

### 3 图片失去选项锚点导致巨图与超长整题

系统第2题四幅原子模型图被独立大图纵排：p2放前三张，第四张在p3页顶；题1之后p1大片剩余空白。Word在题2总高度超过页时打破keep链，这是本输入已证实的表现，不是“所有题永不跨页”。图2–5源像素仅254–264px宽，显示6.72–6.985cm约96dpi；插图形状明确，边缘较糊。

系统第15题选项用空格连排，B/D中的“分子”被拆到次行行首，选项边界难读；p5与`system-audit.json` p40/41可对照。参考p1单选1的四项用制表位排齐，p2单选6图与A/B同段，图属于选项的位置仍在。这是结构差异，不是图像数量差异。

`bank/export.py:499–514`把TAB换成4空格；`:1229–1234`所有图排到全文题干之后；`fit_image_size`只依像素宽高比按0.82/0.68/0.55正文宽度档、最大高7cm处理，不知道“该图是某选项的小图”。图尺寸与位置应一起解决。

### 4 原卷大题标题残留与清单重复

系统p4第13题文字后“四、实验题”、p6第22题末“三、综合题”都是普通正文，分别来自qid2905/qid15快照的末尾，未成为本卷有效大题标题。本卷所有23条section_id=NULL，唯一生成标题“未分组”；参考六大题则按真实题型组织。

11/12号均来自qid64，20/21号均qid12；这是本卷当前清单选入重复，导出依清单顺序忠实连续编号，没有证据表明编号算法自动重复题目。题号1–23无双重原卷题号；小问(1)(2)(3)保留。要改善应提示清单重复和异常题目、正确分组，不能把本样本重复归结为题号生成错误。

## 参考卷的优势与自身缺陷

优势：正文更紧凑；中西文字体分工；多种选项布局与制表位；图在题干/选项/小问对应位置；真实表格（p9第29题4×3实验表）；单独答案区与4×11单选汇总表；题卷/答案分节单独页码；数学内容实际可见。

缺陷：p1第6题题干与p2配图/选项分开；p2第9题只有A，B–D在p3；p3第12题题干与p4配图分开；p4第15题与p5选项图分开；p6第25题(1)指令与p7图分开；p9第30题阅读长文跨到p10；答案最后p20只余约两行。不能以参考没有keepNext为理由把系统分页保护全删；适当短题绑定、长题合法小问边界续排比整题死绑或完全不绑定更合适。

## 渲染与截图索引

packaged `render_docx.py`实际执行失败：`FileNotFoundError: LibreOffice soffice.exe was not found on PATH`，清理沙箱临时目录还出现WinError5。bundle依赖工具未提供LibreOffice；未调用用户桌面LibreOffice。bundle Python探针确认`win32com=False`、`pythoncom=False`（`pypdfium2=True`、`pdfplumber=True`）；Windows fallback只在native COM步骤使用项目Python。`DispatchEx('Word.Application')`独立实例，ReadOnly=True、AddToRecentFiles=False、Visible=False、AutomationSecurity=3，不激活OLE；ExportAsFixedFormat(17)后Close(SaveChanges=0)，仅退出自身新建实例。XML审计/PIL图像元数据/SQLite均用bundle Python，PDF栅格化用bundle Poppler。源SHA前后一致，记录在`native-render.json`。

PDF使用bundle Poppler `pdftoppm -scale-to 1600 -png`，每页1132×1600px；全27页已生成，系统7/7页、参考20/20页均已逐页以original图像查看，并另看全页概览。全27页查看覆盖完成；没有以OCR或纯文本提取替代渲染。关键编号/图归属/公式指数均与XML或源包证据交叉核实。

| 索引 | 证据用途 |
|---|---|
| `local/system.pdf`，`local/reference.pdf` | 最新对输入的Word只读渲染；非历史导出文件 |
| `local/system-page-1.png` | 标题/字号/卷头、题1大图、页底大空白 |
| `local/system-page-2.png`与`-3.png` | 原子模型四图纵排跨页、5.C答案片段 |
| `local/system-page-4.png` | 答案片段6–12、重复内容、残留“四、实验题” |
| `local/system-page-5.png` | 题15选项断开，“分子”被拆行 |
| `local/system-page-6.png` | 20/21重复、残留“三、综合题” |
| `local/system-page-7.png` | 23题答案图泄漏，与源图SHA对应 |
| `local/reference-page-01.png`与`-02.png` | 4选项制表位、图文同段A/B、题图分离边界 |
| `local/reference-page-03.png`至`-08.png` | 图选项/子问图、长题续排与缺陷 |
| `local/reference-page-09.png` | 4×3真实实验表，六大题结构 |
| `local/reference-page-11.png` | 独立答案首页、二维码、4×11单选答案汇总表 |
| `local/reference-page-15.png` | OLE与OMML指数的实际视觉显示 |
| `local/reference-page-20.png` | 答案末页仅两行，不应称参考排版完美 |
| `local/source-q7942-image123.png`与`source-q7942-image124.png` | 原题未接线图与答案已接线图的包内原始像素 |

## 产出物

- 本交接：`outputs/handoff/R-DOCX导出实测对比.md`。
- `outputs/docx-compare-20261010/local/system-audit.json`、`reference-audit.json`、`*-paragraphs.txt`：全量ZIP/XML及样式证据。
- `local/supplement.json`：图实例、OLE结构、页脚域、媒体分类。
- `local/native-render.json`：Word版本、页数、逐段页号、SHA前后。
- `local/db-readonly-paper-snapshots.json`：只读当前清单与锁定快照。
- `local/source-trace.json`：原源文件SHA、既有scan/questions边界、答案图位置和stem公式引用。
- `local/*.pdf`、`*-page-*.png`、`*-overview-*.png`：27页渲染及概览。
- 探针：`.qa_docx_compare_20261010/R-local/audit.py`、`supplement.py`、`render_native.py`、`source_trace.py`。

## 验收标准（给下一个角色）

1. 读取交接与证据JSON，核实系统公式0、参考24OLE/1OMML、普通图与预览分开计数；不要改写成系统公式转换失败或OLE天然不可编辑。
2. 打开最新两PDF并按以上页码核对所有视觉例子；比较题卷结构时只比较系统题卷与参考前10页，不能以20/7页判密度优劣。
3. 只读SQL/快照复核8条答案片段及重复qid来源；从source-trace核对qid5542/61答案区误切链条。
4. 从source-trace核对qid7942源p359的image124与系统image11 SHA一致，在系统p7可见，明确这是真实学生版答案图泄漏。
5. 后续架构方案须先覆盖内容边界、媒体角色与位置，再讨论模板、选项布局、合法续页；不得把未知图静默剔除当修复。
6. 真正实现后用副本数据库、当前新导出的同内容学生/教师卷分别验题/公式/图/答案分支，再渲染Word/WPS；若声称可编辑，必须内部改字符→保存→重开，不以OMML/OLE节点数代替。

## 我没做/做不到的

未改代码/DB/源DOCX；未新导出当前试卷作前后修复实验；未重跑preprocess；未解析v3 MTEF；未进行任何公式内部编辑保存验证，因而不声称这两份输入的Word/WPS双端可编辑性。参考OLE结构和保真渲染能证明对象与视觉存在，不能证明安装条件下MathType编辑是否可用。系统学生版没有公式，本样本无法提供OMML编辑代表。未使用WPS重新渲染，当前页码与分页结论限定Word16.0环境。

## 遗留风险

1. 全库答案区误入、答案图片混入的规模未估计；本卷实证优先，不能扩推具体数量。
2. 历史快照中媒体角色已丢失，不能仅凭图片文件名/唯一候选强行恢复；需要回源段落证据与人工复核路径。
3. 参考文件只是用户提供的一种导出配置，不能据此宣称组卷网所有模板均这样排版。
4. 高分辨率图表/公式核对需原图及XML交叉，不依概览小图读细字符；本轮没有内容语义逐题校对整个参考卷。

## 数据安全与阶段测试

只读前后bank.db SHA256均为`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`；两输入DOCX初末SHA也分别保持本文输入表值。基线318项、317通过1skip、30.801秒；阶段末独立再次执行`python -m unittest discover -s tests`：318项、317通过1skip、30.360秒，OK，原始日志`outputs/docx-compare-20261010/local/R-closure-tests.log`。本轮未改生产代码，所以未触发前端tsc/build或公式导出编辑回归要求；没有用基线代替末测。
