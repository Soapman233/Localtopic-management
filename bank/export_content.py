"""只读导出内容审计与模式投影；源只证明锚点，正文始终取锁定快照。"""
from __future__ import annotations
import copy, hashlib, json, re, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from pipeline.answer_regions import find_answer_regions
from pipeline.answer_regions import is_confirmed_region
from pipeline import docx_scan as scan
from . import answers

CONTENT_GUARD_REVISION='export-content-p0-v5'
LAYOUT_REVISION='export-layout-p0-v4'
MODES=('学生版','仅答案','答案解析版')
_MARKERS=re.compile('('+'|'.join(re.escape(x) for x in sorted(answers.ANS_MARKERS+answers.ANA_MARKERS,key=len,reverse=True))+')')
_FID=re.compile(r'⟦(F\d+)⟧')

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8')).hexdigest()

class ExportContentError(RuntimeError):
    def __init__(self,diagnostics):
        self.diagnostics=diagnostics
        super().__init__('导出内容待核对：请查看逐题诊断并创建修订卷。')

class ExportEvidenceStale(RuntimeError):
    def __init__(self,diagnostics):
        self.diagnostics=diagnostics
        super().__init__('内容或来源证据已变化，请重新检查并预览。')

def _source_document(path):
    """复现扫描段序/FID，但绝不读取或转换OLE流；另保留普通图实例。"""
    pars=[]; formulas={}; images={}
    with zipfile.ZipFile(path) as z:
        rels=scan._rels(z)
        body=ET.fromstring(z.read('word/document.xml')).find(scan.W+'body')
        body_numbers={id(p):i+1 for i,p in enumerate(body.findall(scan.W+'p'))}
        def paragraph(p,in_cell):
            index=len(pars); start=len(formulas)
            text=scan._collect_runs(p,rels,{},formulas,images,index,in_cell)
            tokens=[]; local_fid=start; image_no=0; unsupported=False
            def walk(el):
                nonlocal local_fid,image_no,unsupported
                if el.tag in (scan.M+'oMath',scan.M+'oMathPara',scan.W+'object'):
                    local_fid+=1;tokens.append(('text',f'⟦F{local_fid}⟧'));return
                if el.tag in (scan.W+'drawing',scan.W+'pict'):
                    if el.find('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}anchor') is not None: unsupported=True
                    rid=None
                    blip=el.find('.//'+scan.A+'blip')
                    if blip is not None: rid=blip.get(scan.R+'embed')
                    if rid is None:
                        im=el.find('.//'+scan.V+'imagedata')
                        if im is not None:rid=im.get(scan.R+'id')
                    if rid in rels:
                        media=rels[rid]['target'];part='word/'+media
                        extent=el.find('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}extent')
                        entry={'media_path':media,'sha256':hashlib.sha256(z.read(part)).hexdigest(),'scan_index':index,'body_paragraph_number':body_numbers.get(id(p)),'source_width_emu':int(extent.get('cx')) if extent is not None else None,'source_height_emu':int(extent.get('cy')) if extent is not None else None,'occurrence':image_no}
                        tokens.append(('image',entry));image_no+=1
                    else: unsupported=True
                    return
                if el.tag==scan.W+'t': tokens.append(('text',el.text or ''));return
                if el.tag==scan.W+'tab':tokens.append(('text','\t'));return
                if el.tag in (scan.W+'br',scan.W+'cr'):tokens.append(('text','\n'));return
                if el.tag==scan.W+'fldSimple':tokens.append(('text',el.get(scan.W+'instr','')))
                for child in el:walk(child)
            walk(p)
            # 合并相邻文本token，确保跨run的逐题标记也被精确识别。
            merged=[]
            for kind,value in tokens:
                if kind=='text' and merged and merged[-1][0]=='text':merged[-1]=('text',merged[-1][1]+value)
                else:merged.append((kind,value))
            pars.append({'index':index,'text':text,'is_table_cell':in_cell,'body_paragraph_number':body_numbers.get(id(p)),'tokens':merged,'unsupported':unsupported})
        def walk_block(el,in_cell=False):
            if el.tag==scan.W+'p':paragraph(el,in_cell);return
            if el.tag==scan.W+'tbl':
                for tr in el.findall(scan.W+'tr'):
                    for tc in tr.findall(scan.W+'tc'):
                        for child in tc:walk_block(child,True)
                return
            for child in el:walk_block(child,in_cell)
        walk_block(body)
    return {'paragraphs':pars,'formulas':formulas,'regions':find_answer_regions(pars)}

def _text_blocks(snapshot):
    stem,inline_ans,inline_ana=answers.split_inline(snapshot.get('text') or '')
    branches={'stem':stem,'answer':snapshot.get('answer') if snapshot.get('answer') is not None else inline_ans,'analysis':snapshot.get('analysis') if snapshot.get('analysis') is not None else inline_ana}
    return [{'kind':'paragraph','branch':branch,'text':line} for branch,text in branches.items() for line in str(text or '').splitlines() if line.strip()]

def inspect_snapshot(conn,snapshot:dict,*,paper_id:int|None=None,item_id:int|None=None,seq:int|None=None)->dict:
    return _inspect_snapshot(conn,snapshot,paper_id=paper_id,item_id=item_id,seq=seq)

def _inspect_snapshot(conn,snapshot:dict,*,paper_id=None,item_id=None,seq=None,_source_cache=None)->dict:
    snap=copy.deepcopy(snapshot);src=snap.get('source') or {};qid=snap.get('question_id');version=int(snap.get('version') or 1)
    source={'source_id':src.get('source_id'),'file_name':src.get('file_name'),'expected_sha256':None,'actual_sha256':None,'start_scan_index':src.get('start_paragraph'),'end_scan_index':src.get('end_paragraph'),'answer_region_start_scan_index':None,'body_paragraph_number':None}
    issues=[];blocks=_text_blocks(snap);snapshot_digest=digest(snap)
    def issue(kind,message,severity='blocker',instance_id=None):
        issues.append({'kind':kind,'severity':severity,'blocked_modes':list(MODES) if severity=='blocker' else [],'paper_id':paper_id,'item_id':item_id,'seq':seq,'question_id':qid,'question_version':version,'summary':(snap.get('text') or '')[:100],'message':message,'suggested_action':'在修订候选中明确移除此条目，或核对来源后实际修正并留新版本。' if severity=='blocker' else '核对原始来源；有意重复可保留。','source':copy.deepcopy(source),'instance_id':instance_id})
    current=conn.execute('SELECT source_id,version FROM questions WHERE id=?',(qid,)).fetchone()
    if current and current['source_id']!=src.get('source_id'):
        issue('snapshot_source_mismatch','锁定来源与题目身份不一致，不能删除来源字段绕过核验。')
    if current and int(current['version'])!=version:issue('current_version_differs','当前题库版本与锁定版本不同，继续使用锁定内容。','warning')
    receipt=conn.execute('SELECT * FROM source_files WHERE id=?',(src.get('source_id'),)).fetchone() if src.get('source_id') else None
    document=None;actual=None
    if receipt:
        source['expected_sha256']=receipt['sha256'];source['file_name']=receipt['file_name']
        try:
            path=Path(receipt['path']);actual=hashlib.sha256(path.read_bytes()).hexdigest();source['actual_sha256']=actual
            if actual!=receipt['sha256'] or (src.get('sha256') and actual!=src['sha256']):issue('source_changed','源DOCX SHA与导入凭据或锁定来源不一致。')
            else:
                cache=_source_cache if _source_cache is not None else {}
                key=(str(path),actual)
                if key not in cache:cache[key]=_source_document(path)
                document=cache[key]
        except (OSError,ValueError,zipfile.BadZipFile,ET.ParseError,KeyError) as exc:issue('source_unavailable',f'源DOCX无法核验：{exc}')
    elif src.get('source_id') or snap.get('images'):issue('source_unavailable','来源记录缺失，不能证明题目区和媒体分支。')
    if document:
        start,end=src.get('start_paragraph'),src.get('end_paragraph')
        if not isinstance(start,int) or not isinstance(end,int) or start<0 or end<start or end>=len(document['paragraphs']):issue('snapshot_source_mismatch','锁定scan范围无效。')
        else:
            pars=document['paragraphs'][start:end+1];source['body_paragraph_number']=pars[0]['body_paragraph_number']
            region=next((r for r in document['regions'] if r['start_scan_index']<=end and start<=r['end_scan_index']),None)
            if region:
                source['answer_region_start_scan_index']=region['start_scan_index']
                if not is_confirmed_region(region):
                    issue('source_structure_unsupported','锁定范围与不确定答案区相交；标题后编号内容尚不能证明归属，须人工核对。')
                elif start<region['start_scan_index']:
                    issue('source_structure_unsupported','锁定范围跨越整卷答案边界，混有题干和答案内容；不能默认整题删除或直接出卷。')
                else:
                    issue('answer_region_item','该锁定条目位于有结构佐证的整卷答案区，不能作为独立题出卷。')
            if any(p['unsupported'] for p in pars):issue('source_structure_unsupported','源包含浮动或无法定位的普通图；本轮不能可靠恢复。')
            full='\n'.join(p['text'] for p in pars if p['text'].strip()).replace('\r\n','\n')
            text_ok=full==(snap.get('text') or '').replace('\r\n','\n')
            source_images=[v for p in pars for k,v in p['tokens'] if k=='image']
            saved_images={(im.get('media_path'),im.get('sha256')) for im in snap.get('images') or []}
            media_ok={(im['media_path'],im['sha256']) for im in source_images}==saved_images
            fids=_FID.findall(full);saved_f={f.get('fid'):f for f in snap.get('formulas') or []}
            formula_ok=set(fids)==set(saved_f)
            for fid in fids:
                original=document['formulas'].get(fid);locked=saved_f.get(fid,{})
                if original is None or any(locked.get(k) is not None and locked.get(k)!=getattr(original,k) for k in ('kind','progid','part')):formula_ok=False
            if not media_ok or not formula_ok or (not text_ok and (source_images or saved_images or region)):
                issue('snapshot_source_mismatch','锁定正文、公式身份或全部媒体指纹与源范围不精确匹配，源分支投影失效。')
            elif not text_ok:
                issue('current_version_differs','锁定纯文本已编辑；确认范围在题目区，保留锁定文本，不回填源正文。','warning')
            else:
                branch='stem';candidate=[]
                for p in pars:
                    for kind,value in p['tokens']:
                        if kind=='image':
                            im={k:v for k,v in value.items() if k!='occurrence'}
                            im.update(kind='image',branch=branch,instance_id=f'{actual[:16]}:p{p["index"]}:i{value["occurrence"]}',id=None,url=None,width=None,height=None)
                            candidate.append(im)
                        else:
                            for part in _MARKERS.split(value):
                                if part in answers.ANS_MARKERS:branch='answer'
                                elif part in answers.ANA_MARKERS:branch='analysis'
                                elif part.strip():
                                    if candidate and candidate[-1]['kind']=='paragraph' and candidate[-1]['branch']==branch and candidate[-1].get('_paragraph')==p['index']:candidate[-1]['text']+=part
                                    else:candidate.append({'kind':'paragraph','branch':branch,'text':part,'_paragraph':p['index']})
                for b in candidate:b.pop('_paragraph',None)
                # 独立锁定答案优先；仅该分支末尾挂图，不以源字串覆盖编辑字段。
                for branch in ('answer','analysis'):
                    locked=snap.get(branch)
                    if locked is not None:
                        source_text='\n'.join(b['text'] for b in candidate if b['kind']=='paragraph' and b['branch']==branch).strip()
                        if source_text!=str(locked).strip():
                            imgs=[b for b in candidate if b['kind']=='image' and b['branch']==branch]
                            candidate=[b for b in candidate if b['branch']!=branch]+[{'kind':'paragraph','branch':branch,'text':line} for line in str(locked).splitlines() if line.strip()]+imgs
                blocks=candidate
            if any(re.match(r'^\s*[一二三四五六七八九十]+[、.]',p['text']) for p in pars[1:]):issue('source_heading_residue','题目末尾可能含源大题标题，保留原文请人工核对。','warning')
    # 诊断的来源字段以最终核验坐标统一更新。
    for i in issues:i['source']=copy.deepcopy(source)
    evidence={'revision':CONTENT_GUARD_REVISION,'snapshot_digest':snapshot_digest,'source':source,'blocks':blocks,'issues':issues}
    return {'snapshot_digest':snapshot_digest,'evidence_digest':digest(evidence),'issues':issues,'blocks':blocks,'source':source}

def project_question(snapshot:dict,inspection:dict,answer_mode:str)->dict:
    allowed={'stem'}|({'answer'} if answer_mode!='学生版' else set())|({'analysis'} if answer_mode=='答案解析版' else set())
    blocked=any(i['severity']=='blocker' and answer_mode in i['blocked_modes'] for i in inspection['issues'])
    blocks=[] if blocked else [copy.deepcopy(b) for b in inspection['blocks'] if b['branch'] in allowed]
    texts={branch:'\n'.join(b['text'] for b in blocks if b['kind']=='paragraph' and b['branch']==branch) for branch in ('stem','answer','analysis')}
    refs={fid for b in blocks if b['kind']=='paragraph' for fid in _FID.findall(b['text'])}
    fs=[copy.deepcopy(f) for f in snapshot.get('formulas') or [] if f.get('fid') in refs]
    imgs=[copy.deepcopy(b) for b in blocks if b['kind']=='image']
    return {'content_status':'blocked' if blocked else 'ready','snapshot_digest':inspection['snapshot_digest'],'evidence_digest':inspection['evidence_digest'],'issues':inspection['issues'],'content_blocks':blocks,'text':texts['stem'],'plain_text':_FID.sub('',texts['stem']),'answer':texts['answer'] or None,'analysis':texts['analysis'] or None,'images':imgs,'image_paths':[b['media_path'] for b in imgs],'formulas':fs,'latex_list':[f.get('latex') for f in fs]}

def _diagnostics(issues,items,context):
    groups={}
    for it in items:groups.setdefault(it['question_id'],[]).append(it)
    duplicates=[]
    for qid,group in groups.items():
        if len(group)>1:
            duplicates.append({'question_id':qid,'item_ids':[i['id'] for i in group],'seqs':[i['seq'] for i in group]})
            for it in group:
                base=copy.deepcopy(next((x for x in issues if x['item_id']==it['id']),{}))
                snap=it['snapshot'];source=snap.get('source') or {}
                base.update(kind='duplicate_question',severity='warning',blocked_modes=[],paper_id=context.get('paper_id'),item_id=it['id'],seq=it['seq'],question_id=qid,question_version=it['question_version'],summary=(snap.get('text') or '')[:100],message=f'同题出现在序号{[x["seq"] for x in group]}，有意重复可保留。',suggested_action='查看修订候选，显式决定保留或移除。',instance_id=None)
                base.setdefault('source',{'source_id':source.get('source_id'),'file_name':source.get('file_name'),'expected_sha256':None,'actual_sha256':None,'start_scan_index':source.get('start_paragraph'),'end_scan_index':source.get('end_paragraph'),'answer_region_start_scan_index':None,'body_paragraph_number':None})
                issues.append(base)
    exclude=sorted({i['item_id'] for i in issues if i['kind']=='answer_region_item' and i['item_id'] is not None})
    unresolved=sorted({i['item_id'] for i in issues if i['severity']=='blocker' and i['item_id'] not in exclude and i['item_id'] is not None})
    blockers={i['item_id'] for i in issues if i['severity']=='blocker'}
    result={'export_allowed':not blockers,'blocker_count':len(blockers),'warning_count':sum(i['severity']=='warning' for i in issues),'issues':issues,'duplicate_groups':duplicates,'revision_proposal':{'exclude_item_ids':exclude,'keep_item_ids':[i['id'] for i in items if i['id'] not in exclude],'unresolved_item_ids':unresolved,'message':'仅建议移除有源结构证据的答案区条目，其余仍需逐题核验。'}}
    result['diagnostic_digest']=digest({'context':context,'diagnostics':result})
    return result

def inspect_paper(conn,paper_id:int)->dict:
    from . import paper
    row=conn.execute('SELECT * FROM papers WHERE id=?',(paper_id,)).fetchone()
    if row is None:raise ValueError(f'试卷不存在：{paper_id}')
    items=paper.list_items(conn,paper_id);cache={};inspections={};issues=[]
    for it in items:
        ins=_inspect_snapshot(conn,it['snapshot'],paper_id=paper_id,item_id=it['id'],seq=it['seq'],_source_cache=cache)
        if it['snapshot'].get('question_id')!=it['question_id'] or int(it['snapshot'].get('version') or 0)!=it['question_version']:
            ins['issues'].append({'kind':'snapshot_source_mismatch','severity':'blocker','blocked_modes':list(MODES),'paper_id':paper_id,'item_id':it['id'],'seq':it['seq'],'question_id':it['question_id'],'question_version':it['question_version'],'summary':(it['snapshot'].get('text') or '')[:100],'message':'锁定快照题目/版本身份与试卷条目不一致。','suggested_action':'核对并创建修订卷，不能篡改快照身份获得准入。','source':ins['source'],'instance_id':None})
            ins['evidence_digest']=digest({'evidence_digest':ins['evidence_digest'],'identity_issue':ins['issues'][-1]})
        inspections[it['id']]=ins;issues.extend(ins['issues'])
    context={'paper_id':paper_id,'paper':{k:row[k] for k in row.keys() if k not in ('created_at','updated_at','template','answer_mode')},'sections':[{k:r[k] for k in r.keys() if k not in ('created_at','updated_at')} for r in conn.execute('SELECT * FROM paper_sections WHERE paper_id=? ORDER BY seq,id',(paper_id,))],'items':[{'id':it['id'],'seq':it['seq'],'score':it['score'],'section_id':it['section_id'],'snapshot_sha256':hashlib.sha256(it['snapshot_json'].encode('utf8')).hexdigest() if 'snapshot_json' in it else digest(it['snapshot']),'evidence_digest':inspections[it['id']]['evidence_digest']} for it in items]}
    # list_items的公开结构不含原JSON时直接读取，保证token覆盖原始字节。
    raw={r['id']:r['snapshot_json'] for r in conn.execute('SELECT id,snapshot_json FROM paper_questions WHERE paper_id=?',(paper_id,))}
    for it in context['items']:it['snapshot_sha256']=hashlib.sha256(raw[it['id']].encode('utf8')).hexdigest()
    return {'diagnostics':_diagnostics(issues,items,context),'inspections':inspections}

def require_export_allowed(diagnostics:dict,answer_mode:str)->None:
    if any(i['severity']=='blocker' and answer_mode in i['blocked_modes'] for i in diagnostics['issues']):raise ExportContentError(diagnostics)
