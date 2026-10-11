# 组卷网公开资料检索记录

读取时间：2026-10-10。研究范围：公开页面；未登录、未调用私有接口、未下载题库内容。检索结果摘要仅作发现线索，正文读取成功才用于肯定结论。下表“官方技术”证明的是可实施能力，不证明学科网采用这些库。

|编号|页面与URL|可用性/日期|支持的论点|不能支持的事项|
|---|---|---|---|---|
|P1|[组卷网首页](https://zujuan.xkw.com/)|web正文仅两个Input；隐藏浏览器首次30秒超时|仅确认访问入口|无法由该读取结果确认下载弹窗、字号、公式格式等具体功能|
|P2|[组卷网help](https://zujuan.xkw.com/help)|不可访问；help/亦失败|记录访问限制|不据猜测路径断言帮助不存在|
|P3|[学科网资源内容介绍](https://zxxkstatic.zxxk.com/service/file/%E5%AD%A6%E7%A7%91%E7%BD%91%E8%B5%84%E6%BA%90%E5%86%85%E5%AE%B9%E4%BB%8B%E7%BB%8D.pdf)|22页PDF正文可读；无明确发布日期；内容包含截至2020年6月的历史统计|第10页（零基P9）描述资源生产、校审、分类打标、内容优化及CMS主数据；组卷网是资源应用之一|不披露DOCX渲染引擎、服务端语言、库或当前规模|
|P4|[官方产品manual](https://script.zxxk.com/zxxkvideo/resource/product/manual.pdf)|403|记录限制|未读全文，不据搜索摘要断言导出功能|
|P5|[组卷隐私政策](https://zjappserver.xkw.com/app-h5/html/privacy-agreement.html)|官方搜索正文完整可读；更新/生效2025-12-08|运营主体为学科网；存在拍照识别与下载到手机本地的功能|不提供DOCX格式设置或具体识别、导出算法|
|T1|[Open and add text](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-open-and-add-text-to-a-word-processing-document)|官方正文可读|WordprocessingML文档/段落/run/text结构|不说明学科网是否采用Open XML SDK|
|T2|[Working with Text](https://python-docx.readthedocs.io/en/latest/user/text.html)|官方1.2.0正文可读|样式、run属性、缩进、tab、段间距、行距和四类分页属性|不承诺自动分页引擎或Word/WPS逐像素相同|
|T3|[Understanding pictures and other shapes](https://python-docx.readthedocs.io/en/latest/user/shapes.html)|官方1.2.0正文可读|inline图片随文本流；高级API只支持inline图片|浮动图需其他XML/工具；不能据add_picture默认行为判断全部OOXML能力|
|T4|[Section objects](https://python-docx.readthedocs.io/en/latest/api/section.html)|官方1.2.0正文可读|页尺寸、方向、页边距、页眉页脚及节设置|不证明模板预设适合本项目|
|T5|[WordprocessingML tables](https://learn.microsoft.com/en-us/office/open-xml/word/working-with-wordprocessingml-tables)|官方正文可读|表格grid/行/单元格及样式宽度|不能推出组卷网选择题一定使用表格|
|T6|[SdtBlock](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sdtblock?view=openxml-3.0.1)|官方正文可读|w:sdt可包段落/表格，含属性与内容|不保证任意模板占位替换不损坏关系|
|T7|[Microsoft 365 Math](https://learn.microsoft.com/en-us/office/math/)|官方正文可读|Office数学在文档里保存为OMML；支持MathML/LaTeX互操作|不保证未知私有字形语义、OLE转换或WPS编辑正确|
|T8|[MathML Support](https://learn.microsoft.com/en-us/office/math/mathml)|官方正文可读|MathML与Office Math导入导出及映射/限制|不保证任意LaTeX都可无损转换|
|T9|[oMath Word实现说明](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/ab7a0345-712e-4eef-9bcc-80c37e68d9bb)|官方正文可读；2023-03-08|Word对oMath父子结构有限制，不合法结构可导致拒绝打开|通过schema不等于Word/WPS编辑持久化通过|
|T10|[Anchor](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.wordprocessing.anchor?view=openxml-3.0.1)|官方正文可读|DrawingML有inline与浮动anchor两类位置行为|不证明本地样本全部图形可编辑|
|T11|[OleObject](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.vml.office.oleobject?view=openxml-3.0.1)|官方正文可读|OOXML可表述OLE对象与其属性/关系|不保证用户电脑存在激活该对象所需编辑器|
|T12|[Repaginate](https://learn.microsoft.com/en-us/office/vba/api/word.document.repaginate)|官方正文可读|Word可重新分页整个文档|不承诺与WPS分页相同|
|T13|[ExportAsFixedFormat](https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat)|官方正文可读|Word导出PDF/XPS，并可设范围及打印优化等参数|不是DOCX组装API；不证明组卷网使用Word COM|
|T14|[Aspose.Words Rendering](https://docs.aspose.com/words/python-net/rendering/)|官方正文可读|产品有自身流式文档分页引擎，可渲染PDF/页面图片，不调用Word|厂商“近似Word”表述不等于本项目双端已通过，更不证明学科网采用Aspose|
|T15|[Columns](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.columns?view=openxml-3.0.1)|官方正文可读|w:cols为节的分栏表达|不能证明组卷网双栏具体实现|

## 有界补充检索与排除

- [小学资源网/中考资源网操作指南](https://www.xj5u.com/xyt/pdf/%E5%B0%8F%E5%AD%A6%E8%B5%84%E6%BA%90%E7%BD%91%E5%9C%A8%E7%BA%BF%E7%BB%84%E5%8D%B7%E5%B9%B3%E5%8F%B0%E6%93%8D%E4%BD%9C%E6%95%99%E7%A8%8B.pdf)：24页正文可读，第20–23页含主副标题、结构、分值、题序与下载模板/答案位置/格式流程；但封面仅署这两个产品，本轮未核实其当前运营主体与学科网关系；不能归为学科网组卷网当前功能证据。PDF截图工具cache miss，未把搜索摘要所述弹窗具体枚举当作截图验证。
- [棠外2012通知](https://www.tangwai.com/SiteHtml/WebHtm/0000/125784.asp)：正文可读，学校一手使用记录，提到Word形式与旧V2.0图解附件；正文工具未暴露该附件可点链接。年代过旧且zujuan.com当前搜索结果另指迁站，不能用来证明2026学科网设置枚举。未使用页面公开的旧账号。
- [福州金山中学2020使用指南](https://www.fzjszx.net/szzy/2505.jhtml)：搜索发现，正文超时，未用于肯定结论。
- [西北大学镜像智慧教学方案](https://sneits.nwu.edu.cn/__local/3/71/19/AC9CACCCE61BC2D612D2C20BB0A_E1919DCB_173D4B.pdf?e=.pdf)：搜索发现，正文不可访问，未用于肯定结论。
- [威海2022合同](https://zfcgcms.ggzyjy.weihai.cn/u/cms/www/202209/%E5%90%88%E5%90%8C%E5%85%AC%E5%91%8A%28156%29.pdf)：搜索摘要有详细组卷参数，但正文超时，供应商/完整上下文未核验，不用于学科网功能结论。
- CN113326675B《一种用于教育资源库的公式处理方法及系统》：检索命中，Google Patents元数据指向江西风向标公司，非学科网；排除为学科网内部实现证据，未进一步采纳。
- 二一组卷（21cnjy）、出卷网/铅笔头组卷（zujuan.com当前迁站提示）、园丁邦与学科网域名不同，不混同产品。第三方SEO教程、油猴脚本、招聘信息均未作为实现事实来源。

## 短摘与复查

仅保留必要的极短原文：P3“分类打标”“内容优化”；T3“only supports inline pictures”；T12“Repaginates the entire document.”。其余均为研究者转述；没有复制整页或长文。所有可用性是本轮工具读取结果，受限不等于页面不存在或用户浏览器无法访问。
