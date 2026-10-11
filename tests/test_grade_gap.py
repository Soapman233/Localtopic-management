"""年级筛选漏题提示的真实 API 与上下文一致性回归；全部使用临时库。"""
# ---------------------------------------------------------------------------
# title: 年级筛选漏题提示测试
# description: 验证计数保留关键词/内容/严格模式/其他筛选、缺失哨兵、分页隔离及原结果不变。
# author: 待补充
# version: 0.1.0
# category: 测试
# ---------------------------------------------------------------------------



from tests.test_webui_api import ApiTestBase
from bank import query, textutil


class TestGradeGap(ApiTestBase):
    def setUp(self):
        super().setUp()
        c = self.conn
        for sid, grade, subject in [(3,'','物理'),(4,'待补充','物理'),(5,'九年级','物理'),(6,None,'化学'),(7,None,'物理')]:
            c.execute('INSERT INTO source_files(id,path,sha256,file_name,grade,stage,subject) VALUES (?,?,?,?,?,?,?)', (sid,f'p{sid}',f'sha{sid}',f'{sid}.docx',grade,'初中',subject))
        for qid,sid,text,answer,chapter in [(4,2,'浮力隐藏题 50%','A','9.4'),(5,3,'浮力空串年级题',None,'9.4'),(6,4,'压强待补充年级题','A','9.4'),(7,5,'浮力其他年级题','A','9.4'),(8,6,'浮力其他学科题','A','9.4'),(9,7,'浮力另一章节题','A','10.1')]:
            c.execute("INSERT INTO questions(id,source_id,number,text,plain_text,content_hash,char_length,chapter,qtype,difficulty,section,answer,analysis) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (qid,sid,str(qid),text,text,textutil.content_hash(text),len(text),chapter,'选择题','易','一、选择题',answer,'解析'))
            c.execute('INSERT INTO question_fts(tokens,question_id) VALUES (?,?)',(textutil.tokenized_text(text),str(qid)))
        c.execute("INSERT INTO formulas(question_id,source_id,fid,seq,kind,status,needs_review) VALUES (4,2,'F1',1,'omml','FAIL',1)")
        c.execute("INSERT INTO question_labels(question_id,label_id,source,review_status) VALUES (4,1,'manual','已确认')")
        c.commit()

    def search(self, **params):
        return self._assert_envelope(self.client.get('/api/search', params=params))['data']

    def test_original_results_unchanged_and_other_known_grade_excluded(self):
        before=query.search_full(self.conn,grade='八年级下册',limit=1,offset=1)
        after=self.search(grade='八年级下册',limit=1,offset=1)
        for key in ['total','limit','offset']:
            self.assertEqual(after[key],before[key])
        self.assertEqual([i['id'] for i in after['items']],[i['id'] for i in before['items']])
        self.assertEqual(after['grade_gap'],{'selected_grade':'八年级下册','count':5})

    def test_all_context_and_strict_filters_preserved(self):
        filters=dict(keyword='浮力',stage='初中',subject='物理',chapter='9.4',qtype='选择题',difficulty='易',section='一、选择题',has_answer=True,has_analysis=True,needs_review=True,kp_confirmed_only=True)
        data=self.search(**filters,grade='八年级下册',limit=1,offset=100)
        self.assertEqual(data['total'],0)
        self.assertEqual(data['items'],[])
        self.assertEqual(data['grade_gap']['count'],1)
        alternative=self.search(**filters,grade_missing=True)
        self.assertEqual([i['id'] for i in alternative['items']],[4])
        self.assertIsNone(alternative['grade_gap'])

    def test_missing_sentinels_and_no_false_grade_assignment(self):
        data=self.search(grade_missing=True,subject='物理')
        self.assertEqual([i['id'] for i in data['items']],[4,5,6,9])
        self.assertNotIn(7,[i['id'] for i in data['items']])
        gap=self.search(grade='不存在的年级',subject='物理')
        self.assertEqual(gap['total'],0)
        self.assertEqual(gap['grade_gap']['count'],4)

    def test_no_grade_or_missing_bucket_has_no_gap(self):
        self.assertIsNone(self.search()['grade_gap'])
        self.assertIsNone(self.search(grade_missing=True)['grade_gap'])
        self.assertIsNone(self.search(grade='待补充')['grade_gap'])
        self.assertIsNone(self.search(grade='八年级下册',grade_missing=True)['grade_gap'])

    def test_literal_percent_keyword_is_preserved(self):
        data=self.search(grade='八年级下册',keyword='%')
        self.assertEqual(data['total'],0)
        self.assertEqual(data['grade_gap']['count'],1)
        self.assertEqual([i['id'] for i in self.search(grade_missing=True,keyword='%')['items']],[4])
