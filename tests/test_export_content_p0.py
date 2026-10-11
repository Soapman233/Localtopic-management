"""导出P0安全边界回归：独立标题、锁定修订事务、媒体实例及过期缓存。"""
from __future__ import annotations
import hashlib, io, json, os, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock
import xml.etree.ElementTree as ET
from PIL import Image
from bank import db, paper, export, export_content as content
from pipeline import segment
from tests.test_paper import _seed
from tests.test_segment_fix import make_doc
from webui import config
from webui.services import preview, export_svc
from fastapi.testclient import TestClient
from webui.app import app

class TestAnswerBoundaryP0(unittest.TestCase):
    def test_reading_material_heading_does_not_swallow_later_questions(self):
        texts=['1．阅读下列材料','参考答案','这里是材料解释，不是整卷答案。','2．水','3．1N']
        result=segment.segment(make_doc(texts))
        self.assertEqual([q.number for q in result.questions],['1','2','3'])
        self.assertIn('参考答案',result.questions[0].text)
        self.assertEqual(result.answer_regions,[])

    def test_confirmed_answer_region_is_reported_and_last_stem_ends_before_title(self):
        result=segment.segment(make_doc(['1．水','2．1N','参考答案','1．A','2．B']))
        self.assertEqual([q.text for q in result.questions],['1．水','2．1N'])
        self.assertEqual(result.questions[-1].end_paragraph,1)
        self.assertEqual(result.answer_regions[0]['start_scan_index'],2)
        self.assertEqual(result.answer_regions[0]['paragraphs'][-1],{'index':4,'text':'2．B'})

    def test_inline_answers_and_reference_phrase_keep_next_question(self):
        result=segment.segment(make_doc(['1．小明对照参考答案后判断。','【答案】A','2．B','3．水']))
        self.assertEqual([q.number for q in result.questions],['1','2','3'])
        self.assertEqual(result.answer_regions,[])

    def test_numbered_experiment_material_is_not_an_answer_sequence(self):
        texts=['1．下面是某同学给本题写的答案节选，请指出第二步的错误：','参考答案',
               '1．把电流表串联接入电路，观察示数。','2．改变电阻，比较两次示数，说明理由。',
               '以上是同学拟定的实验步骤，请指出不妥之处。','2．电流单位是____。']
        result=segment.segment(make_doc(texts))
        self.assertEqual(result.answer_regions,[])
        self.assertEqual(result.questions[-1].text,'2．电流单位是____。')

    def test_physical_value_answers_after_confirmed_heading_are_not_selectable(self):
        result=segment.segment(make_doc(['1．求物体受到的拉力。','2．求另一物体受到的拉力。','参考答案','1．20N','2．10N']))
        self.assertEqual([q.number for q in result.questions],['1','2'])
        self.assertEqual(result.answer_regions[0]['start_scan_index'],2)
        self.assertEqual(result.answer_regions[0]['paragraphs'][-1]['text'],'2．10N')

    def test_plain_or_unitless_answers_remain_traceable_uncertain_regions(self):
        for values in (('20','10'),('增大','增大'),('⟦F1⟧','⟦F2⟧')):
            result=segment.segment(make_doc(['1．题干','2．另一题','参考答案','1．'+values[0],'2．'+values[1]]))
            self.assertEqual(len(result.questions),4)
            self.assertTrue(result.answer_regions[0]['reason'].startswith('uncertain:'))

    def test_numbered_reading_information_keeps_later_real_questions_without_uncertainty(self):
        texts=['1．阅读下列资料并回答问题','参考答案','1．第一种方案测量电流前检查量程',
               '2．第二种方案测量电压前检查接线','2．请比较这两种方案','3．请设计检验方案']
        result=segment.segment(make_doc(texts))
        self.assertEqual(result.answer_regions,[])
        self.assertEqual(result.questions[-2].text,'2．请比较这两种方案')
        self.assertEqual(result.questions[-1].text,'3．请设计检验方案')

    def test_reading_earlier_in_paper_does_not_exempt_real_answer_heading(self):
        result=segment.segment(make_doc(['1．阅读下列资料并回答问题','资料正文','2．另一题','参考答案','1．增大','2．减小']))
        self.assertTrue(result.answer_regions[0]['reason'].startswith('uncertain:'))

    def test_explicit_answer_sequence_overrides_last_reading_question_context(self):
        result=segment.segment(make_doc(['1．电流单位？','2．阅读下列材料并判断电路设计','参考答案','1．A','2．B']))
        self.assertEqual([q.number for q in result.questions],['1','2'])
        self.assertFalse(result.answer_regions[0]['reason'].startswith('uncertain:'))

    def test_last_reading_question_does_not_exempt_plain_answer_tail(self):
        result=segment.segment(make_doc(['1．液体压强随深度增加而如何变化？',
            '2．阅读下列材料并回答：改变受力面积，比较压强大小。','参考答案','1．增大','2．减小']))
        self.assertEqual(len(result.questions),4)
        self.assertTrue(result.answer_regions[0]['reason'].startswith('uncertain:'))

class TestExportContentP0(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'test.db';self.conn=db.connect(self.path);self.addCleanup(self.conn.close)
        seed=_seed(self.conn,[{'text':'1．甲'},{'text':'2．乙'}]);self.sid=seed['sid'];self.qids=seed['qids']
        self.pid=paper.create_paper(self.conn,'隔离验证')['id'];paper.add_questions(self.conn,self.pid,self.qids)
        self.conn.commit()
        for patch in (mock.patch.object(config,'get_db_path',return_value=self.path),mock.patch.object(preview,'CACHE_ROOT',Path(self.tmp.name)/'cache')):
            patch.start();self.addCleanup(patch.stop)

    def diagnosis(self):return content.inspect_paper(self.conn,self.pid)['diagnostics']
    def state(self):return {t:[tuple(r) for r in self.conn.execute(f'SELECT * FROM {t} ORDER BY id')] for t in ('papers','paper_sections','paper_questions')}
    def test_revision_fresh_connection_does_not_commit(self):
        token=self.diagnosis()['diagnostic_digest'];before=self.state();self.assertFalse(self.conn.in_transaction)
        paper.create_revision(self.conn,self.pid,title=None,exclude_item_ids=[],diagnostic_digest=token)
        self.assertTrue(self.conn.in_transaction);self.conn.rollback();self.assertEqual(before,self.state())

    def test_revision_preserves_raw_snapshot_and_original_rows(self):
        old=[tuple(r) for r in self.conn.execute('SELECT * FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(self.pid,))]
        result=paper.create_revision(self.conn,self.pid,title=None,exclude_item_ids=[],diagnostic_digest=self.diagnosis()['diagnostic_digest'])
        new=self.conn.execute('SELECT * FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(result['paper_id'],)).fetchall()
        self.assertEqual([r['snapshot_json'] for r in new],[r[7] for r in old])
        self.assertEqual(old,[tuple(r) for r in self.conn.execute('SELECT * FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(self.pid,))])

    def test_revision_midpoint_failure_leaves_no_partial_paper(self):
        self.conn.execute("CREATE TEMP TRIGGER abort_revision BEFORE INSERT ON paper_questions WHEN NEW.paper_id != 1 AND NEW.seq=2 BEGIN SELECT RAISE(ABORT,'injected'); END")
        before=self.state()
        with self.assertRaises(Exception):paper.create_revision(self.conn,self.pid,title=None,exclude_item_ids=[],diagnostic_digest=self.diagnosis()['diagnostic_digest'])
        self.assertEqual(before,self.state())

    def test_digest_ignores_only_generation_timestamps(self):
        one=paper.build_export_payload(self.conn,self.pid)
        self.conn.execute("UPDATE papers SET created_at='2099-01-01',updated_at='2099-02-01' WHERE id=?",(self.pid,));self.conn.commit()
        two=paper.build_export_payload(self.conn,self.pid)
        self.assertEqual(one['content_digest'],two['content_digest'])
        self.assertEqual(one['diagnostics']['diagnostic_digest'],two['diagnostics']['diagnostic_digest'])
        self.conn.execute('UPDATE paper_questions SET score=9 WHERE paper_id=?',(self.pid,));self.conn.commit()
        self.assertNotEqual(one['content_digest'],paper.build_export_payload(self.conn,self.pid)['content_digest'])

    def test_background_snapshot_change_is_stale_before_content_error(self):
        one=paper.build_export_payload(self.conn,self.pid)
        row=self.conn.execute('SELECT id,snapshot_json FROM paper_questions WHERE paper_id=? LIMIT 1',(self.pid,)).fetchone()
        snap=json.loads(row['snapshot_json']);snap['source']['start_paragraph']=999
        self.conn.execute('UPDATE paper_questions SET snapshot_json=? WHERE id=?',(json.dumps(snap,ensure_ascii=False),row['id']));self.conn.commit()
        with self.assertRaises(content.ExportEvidenceStale):preview.current_payload(self.pid,'学生版','考试',expected_content_digest=one['content_digest'])
        with self.assertRaises(content.ExportContentError):preview.current_payload(self.pid,'学生版','考试')

    def test_source_content_change_same_size_and_mtime_invalidates_old_key(self):
        one=paper.build_export_payload(self.conn,self.pid);key=preview.payload_key(one)
        source=Path(self.conn.execute('SELECT path FROM source_files WHERE id=?',(self.sid,)).fetchone()[0]);stat=source.stat()
        with zipfile.ZipFile(source) as z:members={n:z.read(n) for n in z.namelist()}
        self.assertIn(b'30002',members['word/document.xml']);members['word/document.xml']=members['word/document.xml'].replace(b'30002',b'19993')
        with zipfile.ZipFile(source,'w') as z:
            for n,b in members.items():z.writestr(n,b)
        os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns))
        self.assertEqual(stat.st_size,source.stat().st_size);self.assertEqual(stat.st_mtime_ns,source.stat().st_mtime_ns)
        with self.assertRaises(content.ExportEvidenceStale):preview.current_payload(self.pid,'学生版','考试',key=key,expected_content_digest=one['content_digest'])

    def test_legacy_cache_revision_rejected_before_reuse(self):
        with self.assertRaises(content.ExportEvidenceStale):preview.validate_meta('0'*64,{'paper_id':self.pid})

    def test_prior_p0_v1_cache_is_expired_even_with_matching_file_hash(self):
        payload=paper.build_export_payload(self.conn,self.pid);old=dict(payload,content_guard_revision='export-content-p0-v1',layout_revision='export-layout-p0-v1')
        key=content.digest({k:old[k] for k in ('content_digest','content_guard_revision','layout_revision')})
        preview.cache_dir(key).mkdir(parents=True);preview.docx_path(key).write_bytes(b'old-validly-hashed-docx');preview.page_path(key,1).write_bytes(b'png')
        meta={'paper_id':self.pid,'key':key,**{k:old[k] for k in ('content_digest','content_guard_revision','layout_revision')},'docx_sha256':hashlib.sha256(b'old-validly-hashed-docx').hexdigest(),'pages':[{'file':'page_1.png'}]}
        preview.meta_path(key).write_text(json.dumps(meta),encoding='utf8')
        self.assertFalse(preview.is_cached(key))
        with self.assertRaises(content.ExportEvidenceStale):preview.validate_meta(key,meta)
        self.assertEqual(TestClient(app,raise_server_exceptions=False).get(f'/api/preview/{key}/page_1.png').json()['code'],40905)

    def test_revision_api_rejects_invalid_choices_without_writes(self):
        ids=[r['id'] for r in self.conn.execute('SELECT id FROM paper_questions WHERE paper_id=?',(self.pid,))]
        body={'exclude_item_ids':[],'diagnostic_digest':self.diagnosis()['diagnostic_digest'],'confirm':True};client=TestClient(app,raise_server_exceptions=False)
        for change,code in (({'confirm':False},40903),({'exclude_item_ids':ids},40007),({'exclude_item_ids':[ids[0],ids[0]]},40007),({'exclude_item_ids':[999]},40007),({'diagnostic_digest':'0'*64},40905),({'title':''},40007)):
            before=self.state();response=client.post(f'/api/papers/{self.pid}/revisions',json=dict(body,**change))
            self.assertEqual(response.json()['code'],code,response.text);self.assertEqual(before,self.state())

    def test_revision_api_clones_and_keeps_source_locked_bytes(self):
        before=self.state();response=TestClient(app,raise_server_exceptions=False).post(f'/api/papers/{self.pid}/revisions',json={'exclude_item_ids':[],'diagnostic_digest':self.diagnosis()['diagnostic_digest'],'confirm':True})
        self.assertEqual(response.json()['code'],0,response.text);result=response.json()['data']
        self.assertNotEqual(result['paper_id'],self.pid);self.assertEqual(result['diagnostics']['blocker_count'],0)
        new=self.conn.execute('SELECT snapshot_json FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(result['paper_id'],)).fetchall()
        original=self.conn.execute('SELECT snapshot_json FROM paper_questions WHERE paper_id=? ORDER BY seq,id',(self.pid,)).fetchall()
        self.assertEqual([r[0] for r in new],[r[0] for r in original])

    def test_api_blocker_40904_precedes_office_environment_failure(self):
        Path(self.conn.execute('SELECT path FROM source_files WHERE id=?',(self.sid,)).fetchone()[0]).unlink()
        with mock.patch.object(export_svc,'_ensure_editor_sdk',side_effect=AssertionError('不应先查SDK')):
            client=TestClient(app,raise_server_exceptions=False)
            for endpoint in ('preview','export'):
                response=client.post(f'/api/papers/{self.pid}/{endpoint}',json={})
                self.assertEqual(response.status_code,409);self.assertEqual(response.json()['code'],40904)

    def test_cache_docx_hash_mismatch_is_not_a_hit(self):
        payload=paper.build_export_payload(self.conn,self.pid);key=preview.payload_key(payload);preview.cache_dir(key).mkdir(parents=True)
        preview.docx_path(key).write_bytes(b'correct');preview.page_path(key,1).write_bytes(b'png')
        meta={'paper_id':self.pid,'key':key,**preview.content_fields(payload),'docx_sha256':hashlib.sha256(b'correct').hexdigest(),'pages':[{'file':'page_1.png'}]}
        preview.meta_path(key).write_text(json.dumps(meta),encoding='utf8');self.assertTrue(preview.is_cached(key))
        preview.docx_path(key).write_bytes(b'tampered');self.assertFalse(preview.is_cached(key))

    def test_blocker_is_reported_before_missing_office(self):
        source=Path(self.conn.execute('SELECT path FROM source_files WHERE id=?',(self.sid,)).fetchone()[0]);source.unlink()
        with mock.patch.object(export_svc,'_ensure_editor_sdk',side_effect=AssertionError('环境不应覆盖内容错误')):
            with self.assertRaises(content.ExportContentError):export_svc.preview_request(self.conn,self.pid)
            with self.assertRaises(content.ExportContentError):export_svc.export_request(self.conn,self.pid,formats=['docx','pdf'])

    def test_shared_image_resource_preserves_branch_instances(self):
        # 同一普通图资源在三个分支各出现一次，scan首次出现字典不能代替实例。
        seed=_seed(self.conn,[{'text':'1．题干\n【答案】答案\n【详解】解析','images':['media/shared.png']}]);qid=seed['qids'][0];sid=seed['sid']
        source=Path(self.conn.execute('SELECT path FROM source_files WHERE id=?',(sid,)).fetchone()[0])
        with zipfile.ZipFile(source) as z:members={n:z.read(n) for n in z.namelist()}
        w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';a='http://schemas.openxmlformats.org/drawingml/2006/main';r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        document=ET.Element('{'+w+'}document');body=ET.SubElement(document,'{'+w+'}body')
        for text in ('1．题干','【答案】答案','【详解】解析'):
            p=ET.SubElement(body,'{'+w+'}p');ET.SubElement(ET.SubElement(p,'{'+w+'}r'),'{'+w+'}t').text=text
            drawing=ET.SubElement(ET.SubElement(p,'{'+w+'}r'),'{'+w+'}drawing');ET.SubElement(drawing,'{'+a+'}blip',{'{'+r+'}embed':'rId1'})
        members['word/document.xml']=ET.tostring(document)
        with zipfile.ZipFile(source,'w') as z:
            for n,b in members.items():z.writestr(n,b)
        self.conn.execute('UPDATE source_files SET sha256=? WHERE id=?',(hashlib.sha256(source.read_bytes()).hexdigest(),sid));self.conn.execute('UPDATE questions SET start_paragraph=0,end_paragraph=2 WHERE id=?',(qid,));self.conn.commit()
        pid=paper.create_paper(self.conn,'共享图')['id'];paper.add_questions(self.conn,pid,[qid])
        expected={'学生版':['stem'],'仅答案':['stem','answer'],'答案解析版':['stem','answer','analysis']}
        for mode,branches in expected.items():
            payload=paper.build_export_payload(self.conn,pid,answer_mode=mode);q=payload['sections'][0]['questions'][0];images=q['images']
            self.assertTrue(payload['diagnostics']['export_allowed']);self.assertEqual([im['branch'] for im in images],branches)
            self.assertEqual(len({im['instance_id'] for im in images}),len(branches))
            plan=export.build_document_plan(payload,media_resolver=lambda *args:(source,None))
            self.assertEqual([b[2] for b in plan['sections'][0]['questions'][0]['render_blocks'] if b[0]=='image'],branches)

    def test_cached_answer_bytes_cannot_impersonate_requested_stem_image(self):
        seed=_seed(self.conn,[{'text':'1．题干','images':['media/stem.png']}]);sid=seed['sid']
        im=self.conn.execute('SELECT * FROM images WHERE source_id=?',(sid,)).fetchone()
        cache=Path(self.tmp.name)/'media';cache.mkdir();poison=cache/(im['sha256'][:16]+'.png')
        poison.write_bytes(b'answer-image-in-the-stem-cache-slot')
        path,reason=export.resolve_media(self.conn,sid,im['media_path'],im['sha256'],cache_dir=cache)
        self.assertIsNone(reason);self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),im['sha256'])

    def test_cli_render_time_content_change_prevents_final_publication(self):
        target=Path(self.tmp.name)/'export.docx'
        def changed_during_render(bridge,plan,raw):
            self.conn.execute('UPDATE paper_questions SET score=25 WHERE paper_id=?',(self.pid,));self.conn.commit()
            Path(raw).write_bytes(b'raw-rendered-file')
            return {'formulas_written':0,'images_written':0}
        with mock.patch.object(export,'render_plan_to_docx',side_effect=changed_during_render):
            with self.assertRaises(content.ExportEvidenceStale):export.export_paper_docx(self.conn,self.pid,target)
        self.assertFalse(target.exists())

    def test_stem_crossing_confirmed_answer_boundary_blocks_without_default_delete(self):
        seed=_seed(self.conn,[{'text':'1．真题正文'},{'text':'参考答案'},{'text':'1．A'},{'text':'2．B'}])
        snap=paper._snapshot_question(self.conn,seed['qids'][0],readonly=True)
        snap['text']='1．真题正文\n参考答案\n1．A\n2．B';snap['source']['end_paragraph']=3
        inspected=content.inspect_snapshot(self.conn,snap,item_id=1)
        self.assertIn('source_structure_unsupported',[i['kind'] for i in inspected['issues']])
        self.assertNotIn('answer_region_item',[i['kind'] for i in inspected['issues']])
        self.assertEqual(content.project_question(snap,inspected,'学生版')['content_status'],'blocked')

    def test_plain_unitless_and_omml_uncertain_answers_are_blocked_for_new_selection(self):
        for values in (('20','10'),('增大','增大'),('⟦F1⟧','⟦F2⟧')):
            specs=[{'text':'1．正常题干'},{'text':'参考答案'},{'text':'1．'+values[0]},{'text':'2．'+values[1]}]
            if '⟦' in values[0]:specs[2]['formulas']=['x'];specs[3]['formulas']=['y']
            seed=_seed(self.conn,specs);pid=paper.create_paper(self.conn,'疑点不得直接选入')['id']
            before=self.conn.execute('SELECT COUNT(*) FROM paper_questions WHERE paper_id=?',(pid,)).fetchone()[0]
            with self.assertRaises(content.ExportContentError):paper.add_questions(self.conn,pid,[seed['qids'][2]],section='不得提前创建')
            self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM paper_questions WHERE paper_id=?',(pid,)).fetchone()[0],before)
            self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM paper_sections WHERE paper_id=?',(pid,)).fetchone()[0],0)

if __name__=='__main__':unittest.main()
