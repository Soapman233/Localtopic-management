"""测试专用真实源ZIP：旧CRUD fixtures必须具备可核验的来源证据。"""
from pathlib import Path
import hashlib, io, re, zipfile
import xml.etree.ElementTree as ET
from PIL import Image
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M='http://schemas.openxmlformats.org/officeDocument/2006/math'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'

def materialize_source(conn, sid, *, media_blobs=None):
    """从隔离测试数据建不可执行的XML/普通图源，不mock生产审计。"""
    rows=conn.execute('SELECT * FROM questions WHERE source_id=? ORDER BY id',(sid,)).fetchall()
    path=Path(conn.execute('PRAGMA database_list').fetchone()[2]).parent/f'fixture-source-{sid}.docx'
    document=ET.Element('{'+W+'}document');body=ET.SubElement(document,'{'+W+'}body')
    rels=ET.Element('{'+PKG+'}Relationships');members={};fid_no=0
    for index,row in enumerate(rows):
        conn.execute('UPDATE questions SET start_paragraph=?,end_paragraph=? WHERE id=?',(index,index,row['id']))
        p=ET.SubElement(body,'{'+W+'}p');formulas=conn.execute('SELECT * FROM formulas WHERE question_id=? ORDER BY seq,id',(row['id'],)).fetchall()
        for part in re.split(r'(⟦F\d+⟧)',row['text']):
            if re.fullmatch(r'⟦F\d+⟧',part):
                fid_no+=1;fid=f'F{fid_no}'
                if part!=f'⟦{fid}⟧':raise AssertionError('fixture公式必须使用源全文顺序FID')
                f=formulas.pop(0) if isinstance(formulas,list) else None
                if f is None:raise AssertionError('fixture占位符缺公式')
                conn.execute("UPDATE formulas SET fid=?,kind='omml',progid=NULL,part=NULL WHERE id=?",(fid,f['id']))
                math=ET.SubElement(p,'{'+M+'}oMath');run=ET.SubElement(math,'{'+M+'}r');ET.SubElement(run,'{'+M+'}t').text='x'
            elif part:
                run=ET.SubElement(p,'{'+W+'}r')
                for n,line in enumerate(part.split('\n')):
                    if n:ET.SubElement(run,'{'+W+'}br')
                    ET.SubElement(run,'{'+W+'}t').text=line
        for im in conn.execute('SELECT * FROM images WHERE question_id=? ORDER BY id',(row['id'],)).fetchall():
            target=im['media_path'];blob=(media_blobs or {}).get(target)
            if blob is None:
                buf=io.BytesIO();Image.new('RGB',(96,48),'red').save(buf,format='PNG');blob=buf.getvalue()
            sha=hashlib.sha256(blob).hexdigest();conn.execute('UPDATE images SET sha256=? WHERE id=?',(sha,im['id']))
            rid='rId'+str(len(members)+1);ET.SubElement(rels,'{'+PKG+'}Relationship',{'Id':rid,'Target':target,'Type':R+'/image'});members['word/'+target]=blob
            drawing=ET.SubElement(ET.SubElement(p,'{'+W+'}r'),'{'+W+'}drawing');ET.SubElement(drawing,'{'+A+'}blip',{'{'+R+'}embed':rid})
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('word/document.xml',ET.tostring(document));z.writestr('word/_rels/document.xml.rels',ET.tostring(rels))
        for name,blob in members.items():z.writestr(name,blob)
    conn.execute('UPDATE source_files SET path=?,sha256=? WHERE id=?',(str(path),hashlib.sha256(path.read_bytes()).hexdigest(),sid));conn.commit()
    return path
