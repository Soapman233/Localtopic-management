# 交接：公开资料调查 / R

## 我做了什么

1. 完整读取根AGENTS，按R只读职责检索学科网/组卷网官方页面、公开手册候选与官方DOCX技术文档。检索时间2026-10-10；没有更改代码、交付库或输入试卷。
2. 将证据分为官方披露、待本地样本实测、架构推断与本项目建议；逐项登记正文读取情况、用途和不能支持的论点。
3. 核实学科网官方历史PDF第10页的资源审核/CMS流程；同时如实记录组卷网首页仅返回Input、help/manual受限、隐藏浏览器超时，未将搜索摘要当完整手册。
4. 对可实施路线查阅Microsoft、python-docx与Aspose官方文档：内容结构、模板、数学、图片定位、分页及PDF渲染均有公开能力支撑；未假称其为学科网内部技术。

## 产出物

- `outputs/docx-compare-20261010/public/sources.md`：URL、日期、支持点、排除项与读取可用性。
- `outputs/handoff/R-组卷网公开资料与技术路线.md`：本交接。
- `outputs/docx-compare-20261010/public/r-public-tests.log`：阶段全量回归日志，318项、317通过/1 skip，31.038秒，测试退出码0。

阶段保护核查：交付库阶段末SHA256为`6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`，与主控本轮初见值一致；未回滚用户已产生的使用变更。本角色只新增这两份Markdown和测试日志。首轮日志重定向因public目录尚未创建报路径不存在，不能算通过；目录就绪后已重跑并以上述实际输出为准。

## 研究结论与证据等级

### 官方披露到哪里

[学科网官方历史介绍PDF](https://zxxkstatic.zxxk.com/service/file/%E5%AD%A6%E7%A7%91%E7%BD%91%E8%B5%84%E6%BA%90%E5%86%85%E5%AE%B9%E4%BB%8B%E7%BB%8D.pdf)第10页描述校审、分类打标、内容优化、CMS主数据等资源生产环节，组卷网列于应用端。它说明成品质量有内容加工与人工复核基础；不披露DOCX生成库、排版算法或当前运营指标。文档含2020年历史统计，不能当2026规模数据。[组卷官方隐私政策](https://zjappserver.xkw.com/app-h5/html/privacy-agreement.html)更新于2025-12-08，可证运营主体及拍照识别、本地下载服务存在；不证公式内部格式。

本轮公开读取**没有足够证据确认学科网当前下载弹窗所有枚举**。考试/作业模板、A4/A3/B4/8K/16K、单双栏/横竖、字号行距、MathType/微软公式、学生/教师版、答案解析分离、来源显示、题目编辑与选项自适应等，须由可读官方手册或当前产品界面补证。不得因为其他组卷产品有该功能，就写成学科网官方已证实。样本可证明某次导出的外观与XML，不能证明用户可选范围。

服务端语言、Aspose/POI/docx4j/Open XML SDK采用情况、分页引擎、数据库结构、网页内容到Word的具体转换机制，**公开资料未能确认**。下载样本的Generator/App属性、XML风格最多构成线索；经过编辑器另存后亦可能改变，不能视为源码证据。

### 如何在本项目达到同等级的导出效果（建议，非厂商披露）

**先保内容结构，再调模板，再用真实排版器校准。** 若导入已把段落/题干/图片/答案压成单字符串，导出端无法凭字号与空格重建原位置，换DOCX库也不会自动补回结构。

1. **题目表示保留富文本树。** 对教师自有题，保存题干/选项/答案/解析为独立富文本字段；块节点含段落、表格、列表与作答区，行内节点含文本run、公式与图片，并保留顺序、字体/上下标/着重等语义、媒体引用及源锚点。源DOCX片段可作保真附件，但不能仅存不可搜索的整页图。转换中建立源节点→题目→输出节点的可追踪关系。Microsoft的[WordprocessingML文档结构](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-open-and-add-text-to-a-word-processing-document)与python-docx的[块与行内结构](https://python-docx.readthedocs.io/en/latest/user/text.html)提供表达基础；AST具体字段仍需A冻结。

2. **由可编辑DOCX母版控制卷面。** 在Word中先做经Word/WPS认可的母版：节尺寸/页边距、页眉页脚、标题、姓名栏、密封线、题型标题、题干与答案样式。设置用[节属性](https://python-docx.readthedocs.io/en/latest/api/section.html)和[w:cols](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.columns?view=openxml-3.0.1)表达；元信息和插题位置可用[SDT](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sdtblock?view=openxml-3.0.1)定位。插入片段须重映射样式、编号、图片/OLE关系ID与内容类型，避免ZIP文件名复制后断链。题号只由一个输出层负责；原题号须显式剥离或保存为来源，防双重编号。大题顺序与计分来自结构化卷模型，不能靠正则从成品反推。

3. **选项布局由内容宽度决定。** 短选项可用tab stop对齐，含公式/图片或多行选项用固定列宽无边框表格；在一行四项、两行两项、四行一项之间回退。需要实际排版后的最长项宽度/高度测量与人工override，不能按字符个数推算数学公式宽度。表格是[OOXML标准结构](https://learn.microsoft.com/en-us/office/open-xml/word/working-with-wordprocessingml-tables)，tab/缩进/段距见python-docx正文；“如何选布局”是本项目策略，未证明组卷网采用相同算法。

4. **公式以OMML作为本项目默认交付。** [Microsoft Math](https://learn.microsoft.com/en-us/office/math/)说明Office文档数学采用OMML。源公式保留可核对的原始对象与预览，已知MTEF按严格路径转换；未知私有字形继续暴露，不能靠显示清洗宣称语义正确。MathML/LaTeX互转有[具体限制](https://learn.microsoft.com/en-us/office/math/mathml)，且[Word对oMath结构有额外限制](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/ab7a0345-712e-4eef-9bcc-80c37e68d9bb)。如产品将来提供OLE保留选项，须保持二进制、ProgID、预览图与关系一致，并独立验证所需编辑器；[OLE结构存在](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.vml.office.oleobject?view=openxml-3.0.1)并不等于用户电脑能编辑。当前双端目标仍按内部改字符→保存→重开实测。

5. **图形按源位置与用途输出。** 文字间的小图/行内公式预览用inline，独立插图作段落块；有必要的环绕图用[DrawingML anchor](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.wordprocessing.anchor?view=openxml-3.0.1)，避免统一移到题干末尾。保留原始WMF/EMF与像素图，不盲目统一PNG；格式可用性、尺寸和兼容行为由本地样本核验。重采样须以目标打印尺寸与清晰度验收，不把已有低分辨率位图放大当高清。python-docx官方[图片页](https://python-docx.readthedocs.io/en/latest/user/shapes.html)明确高级API只支持inline；复杂浮动/OLE需OOXML扩展或其他工具，不能承诺换库即完整解决。

6. **答案与解析独立富文本呈现。** 学生卷彻底省去答案块；逐题讲评版在每题后放答案/解析；教师答案册在正文后另起节或独立文件并保留同一题号映射。答案里的公式、图片和表格走同一渲染链；缺失内容显示待补，不将文字化占位符当作已经还原。答案模式、模板与内容版本共同进入预览缓存键和门禁指纹。具体视图模式需P/A确认，不能借竞品名义直接扩契约。

7. **分页交给目标排版器，前端用于结构操作。** 标题与下一段相连、避免孤行、段落适度keep-together；超长题在合法段落/子题处可续页，不把整题强设不可分割而留下大片空白或裁切。[python-docx分页属性](https://python-docx.readthedocs.io/en/latest/user/text.html)是控制输入；实际结果由Word/WPS字体和引擎决定。正式预览应由**同一份待交付DOCX**调用[Word重新分页](https://learn.microsoft.com/en-us/office/vba/api/word.document.repaginate)和[PDF导出](https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat)获得，并独立在WPS打开/分页核验。仅比较网页A4框页数不足以保证成品一致。

### 工具路线的选择边界

|路线|用途|本项目判断|
|---|---|---|
|现有Python流程 + DOCX母版 + OOXML局部增强 + 现有Word/WPS渲染|最小化迁移，先补媒体位置、富文本、样式与分页规则|优先做隔离探针；当前editor_sdk能力需本地核验，不因其存在就假定保真|
|Open XML SDK/.NET等独立文档组装服务|类型化构建/校验OOXML，复杂关系与模板处理|可行替代；不是分页器，更不是已证实的学科网技术栈|
|Aspose.Words for Python via .NET|独立服务器分页与PDF/图片渲染|[官方说明有自有布局引擎](https://docs.aspose.com/words/python-net/rendering/)，可作有成本的候选；需针对本项目复杂公式、中文字体、WMF/EMF、双端编辑做PoC后比较，不能先承诺像素一致或采购|

## 验收标准（给下一个角色）

1. 将样本实测表与本报告分开引用：样本具体页数/字体/图像布局必须来自本地R当前渲染及XML，不从产品营销推断。
2. A若提议AST或导出接口变化，明确字段/回退规则/版本迁移；改冻结文件须另获授权，方案不视为解冻。
3. 新探针至少覆盖：短/长/含公式选项、行内小图与整块大图、原编号、多级子题、跨页长题、答案含图表公式、未知字形、表格与页脚。与当前代码新导出件作同内容对照，逐条核对内容不丢失，再渲染查看。
4. 实际交付前用Word/WPS打开、改内部公式字符、保存重开；页数/页尾裁切/图像清晰度/空白尾页独立检查。结果不以schema通过或“结构覆盖”替代。
5. 复查sources.md中的官方链接；受限项只列为未知。不得写“组卷网用了Aspose/HTML转Word/某语言”或从单一样本推广全部可选功能。

## 我没做/做不到的

- 未获得可完整读取、明确属于当前学科网的导出设置官方手册；上述产品枚举不作已证实事实。
- 未登录用户账户、未试下载、未访问私有接口或绕过限制；未鉴定本地样本（由另一R独立负责）。
- 未修改实现/库，也未为方案做PoC；上述路线为可实现建议，不是已完成开发或工期承诺。

## 遗留风险

- 源导入阶段的结构损失若已不可恢复，需从用户自有原DOCX补录而非在导出端猜测；是否及怎样迁移交由A决策。
- Word/WPS的字体、图形与数学兼容差异须实际验证，官方能力页不能代替本地实测。
- 官网读取限制降低了当前功能证据完整性；应优先使用用户可见下载设置截图/操作，或厂商可核署名手册补证，不能用其他同名组卷平台填空。
