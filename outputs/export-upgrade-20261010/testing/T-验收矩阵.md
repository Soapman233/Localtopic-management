# T 独立验收矩阵（准备态）

依据正式P/A/R交接构造；未读取D对话、测试或实现解释。此文件不是通过报告。D尚未G2，最终代码与产物验证待主控通知后开始。所有写验证使用先copy并verify_backup(original,copy)的副本；不动交付库、源DOCX或preprocess。

|组|独立构造和可执行断言|证据/当前状态|
|---|---|---|
|T01 真实输入|只读SQL保存paper3全部23条完整行、JSON原始UTF-8 SHA；从源ZIP重新列出普通图所有实例和marker次序，不调用新export_content生成期望值|准备；源事实脚本单独输出|
|T02 诊断|item113–120阻断，8item/7qid；重复64位置11/12、12位置20/21单独warning；源标题残留warning不删正文；全模式diagnostic_digest一致|待D正式交接|
|T03 修订事务|API默认8排除→15条；原卷所有字段/JSON字节不变；新逐item字节/分值/顺序等于保留原条目；保留空section和元数据；事务中途触发器RAISE(ABORT)；全删/外卷/重复列表/confirm false/旧digest均零新卷和零残留|待D正式交接|
|T04 分支和资源|q7942学生image123=1、image124=0且包内无answer专属SHA；教师两图位置正确；仅答案无analysis；临时DOCX同资源stem/answer、同资源同分支两次、同段marker前后、analysis图、OLE预览普通图分离|待D正式交接；期望来自自建源token，不按D识别规则|
|T05 证据失效|源不存在只影响相关item；同名不同SHA；改document.xml内容后恢复原size/mtime；唯一错误锚点；snapshot text/images/公式identity被改；当前questions/version变化不回源覆盖旧快照；删除snapshot source/images不能洗白|待D正式交接|
|T06 新scan切题|真实scan→segment临时DOCX两题+整卷标题+编号答案/表格答案只出2题并留answer_regions；当前真实源2/144临时增量；同号多大题、正文提及/引用参考答案、逐题答案后下一题、合法短题和字母对象均保留|待D正式交接；构造源独立|
|T07 入口/缓存|export-data诊断200且blocked正文空；preview/export/API、CLI exit3、旧PNG均阻断；blocked+无Office40904优先；合格无OfficeDOCX降级；旧revision/伪cache/meta错hash不能命中；队列提交后、渲染中、copy前变更均40905且不发布|待D正式交接；mock用于调度TOCTOU，实际DOCX/Office单列|
|T08 版式/公式|旧备份路径和当前同清单三模式新导出；真实TAB/stops，源小图不放大比例≤1%，长题自然续页编号不重打；Word/WPS逐页PNG检查无裁切/新增孤立标签/尾空页；bank.cli export verify及内部字符编辑保存重开|待主控Office串行许可；不能用节点计数替代|
|T09 浏览器闭环|隔离服务副本，实际点诊断→查看候选→确认创建新卷→切卷锁预览→重新预览→导出；复制诊断可读；模式/模板切换和迟到响应不解锁；长块完整可读|待D正式交接及隔离服务；只静态JS不算|
|T10 回归/保护|最终后端全测、前端npm test/tsc/build；交付库/全部来源/preprocess初末hash；副本逐表差异和Python头/manifest；不以旧AGENTS库SHA回退|最终D稳定后执行|

未覆盖项：当前尚未运行实现断言、Office、浏览器或最终全测；不出通过结论。LibreOffice当前环境未提供，拟用原生Word/WPS导PDF并PNG逐页核验，说明替代，不宣称LibreOffice通过。
