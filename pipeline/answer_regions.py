"""整卷答案区的保守结构识别；不按题目长度或答案字母判题。"""
import re

_TITLE = re.compile(r'^(?:参考答案(?:及评分(?:细则|标准))?|答案及解析|答案与解析|(?:《[^》]+》|.+(?:试卷|测试|练习|检测|考试|题))\s*参考答案(?:及评分(?:细则|标准))?)$')
_NUMBER = re.compile(r'^\s*\d{1,3}\s*[．.、,，]')
_PHYSICAL_VALUE = r'[-+]?\d+(?:\.\d+)?\s*(?:k?N|m?J|k?W|[kM]?Pa|kg|g|[kcmμ]?m|m?s|min|h|[mμ]?A|k?V|[kM]?Ω|℃|°C|Hz|C|mol)(?:[²³23]|[/·](?:[kcmμ]?m|s)(?:[²³23])?)?'
_ANSWER_ENTRY = re.compile(r'^\s*(\d{1,3})\s*[．.、,，]\s*(?:[A-Da-d](?:[\s、,，/]+[A-Da-d])*[。.]?|[√×]|'+_PHYSICAL_VALUE+r'[。.]?|(?:【答案】|【解析】|【详解】).+)$')

def is_confirmed_region(region: dict) -> bool:
    """疑点报告沿用reason字段，但不得当作已确认的截断依据。"""
    return not region.get('reason','').startswith('uncertain:')

def find_answer_regions(paragraphs: list) -> list[dict]:
    """独立标题后须有编号序列或题号答案表佐证，保留原坐标和文本。"""
    rows=[{'index':p.get('index',i),'text':p.get('text',''),'is_table_cell':p.get('is_table_cell',False)} if isinstance(p,dict) else {'index':p.index,'text':p.text,'is_table_cell':getattr(p,'is_table_cell',False)} for i,p in enumerate(paragraphs)]
    for pos,row in enumerate(rows):
        title=row['text'].strip()
        if not _TITLE.fullmatch(title):
            continue
        previous=next((r['text'].strip() for r in reversed(rows[:pos]) if r['text'].strip()),'')
        # 只看标题紧前的明确引出语，不能因全卷曾出现“阅读”就豁免末尾答案区。
        reading_context=bool(re.search(r'答案节选|实验步骤|阅读.*(?:材料|资料)|本题.*答案|下列.*(?:材料|资料)',previous))
        tail=rows[pos+1:]
        nonempty=[r['text'].strip() for r in tail if r['text'].strip()]
        table=any('题号'==t for t in nonempty) and any(t in ('答案','参考答案') for t in nonempty)
        # 标题和答案序列须相邻。阅读材料中的同名小标题后有解释正文时，
        # 后续正常题号不能反向把整段材料证明为答案区。
        content=[t for t in nonempty if not re.match(r'^[一二三四五六七八九十]+[、.]',t)]
        first=content[0] if content else ''
        # 编号本身不能证明答案区：阅读材料和实验步骤也会使用1/2编号。
        # 只接受相邻、连续编号且具明确答案格式的序列；纯文字答案不猜测归属。
        entries=[_ANSWER_ENTRY.fullmatch(t) for t in content[:2]]
        adjacent_numbered=(len(entries)==2 and all(entries) and int(entries[1].group(1))==int(entries[0].group(1))+1)
        adjacent_table=first=='题号' and table
        # 阅读词不证明后面的标题属于材料。编号材料还须出现编号重新开始的
        # 后续正文边界；末题含“阅读材料”而卷尾列1/2答案时没有这个结构。
        numbered=[(i,re.match(r'^\s*(\d{1,3})\s*[．.、,，]',t)) for i,t in enumerate(content)]
        numbered=[(i,int(m.group(1))) for i,m in numbered if m]
        nested_material=(len(numbered)>=3 and numbered[0][0]==0 and numbered[1][0]==1
                         and numbered[1][1]==numbered[0][1]+1
                         and any(n<=numbered[1][1] for _,n in numbered[2:]))
        if reading_context and nested_material and not adjacent_numbered and not adjacent_table:
            continue
        if adjacent_numbered or adjacent_table or _NUMBER.match(first):
            reason='独立整卷答案标题，后续编号答案序列或题号答案表佐证' if adjacent_numbered or adjacent_table else 'uncertain:独立答案标题后有编号内容，但格式不足以证明是整卷答案；保留原文并人工核对。'
            return [{'start_scan_index':row['index'],'end_scan_index':rows[-1]['index'],'title':title,'reason':reason,'paragraphs':[{'index':r['index'],'text':r['text']} for r in rows[pos:]]}]
    return []
