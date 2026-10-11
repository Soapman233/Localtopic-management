"""Web 后端 API 层测试（T03）。

用 ``fastapi.testclient.TestClient`` 打真实 HTTP 契约，数据库用**临时文件**（不污染
``outputs/bank.db``）。覆盖：47 端点的成功路径与关键错误码（40001-6 / 40401-8 / 40901-3），
以及预览缓存命中（零重渲染）。

真实渲染（editor_sdk + Word/WPS）的端到端测试另见 :class:`TestRenderE2E`，默认跳过，
设置环境变量 ``WEBUI_E2E=1`` 后运行。
"""
# ---------------------------------------------------------------------------
# title: Web 后端 API 测试
# description: Web API 回归：读写、错误码、快照、复核上下文/PNG/路径限制、图片尺寸与快照替换隔离、主题校验；所有写入使用临时库。
# author: 待补充
# version: 0.1.0
# category: 测试、Web界面
# ---------------------------------------------------------------------------




from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from bank import answers as b_answers
from bank import db as bdb
from bank import edit as b_edit
from bank import enrich as b_enrich
from bank import labels as b_labels
from bank import paper as b_paper
from bank import textutil as bt
from webui import config
from webui.app import app
from webui.services import preview as pv
from tests.export_source_fixture import materialize_source


class ApiTestBase(unittest.TestCase):
    """准备临时库 + 数据 + 打补丁（DB 路径 / 缓存目录 / 设置文件）。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.db_path = self.dir / "bank.db"
        self.conn = bdb.connect(self.db_path)
        # 幂等迁移：试卷 schema / 标签复核列 / 答案列 / 版本快照列 / provenance 列。
        b_paper.ensure_paper_schema(self.conn)
        b_labels.ensure_review_status_column(self.conn)
        b_answers.ensure_answer_columns(self.conn)
        b_edit.ensure_version_snapshot_columns(self.conn)
        b_enrich.ensure_provenance_columns(self.conn)
        self._seed()

        self._patches = [
            mock.patch.object(config, "get_db_path", return_value=self.db_path),
            mock.patch.object(config, "WEBUI_DIR", self.dir / "webui"),
            mock.patch.object(config, "SETTINGS_PATH", self.dir / "webui" / "settings.json"),
            mock.patch.object(pv, "CACHE_ROOT", self.dir / "preview_cache"),
        ]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)

        self.client = TestClient(app)

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    # -- 数据 ------------------------------------------------------------- #
    def _seed(self):
        c = self.conn
        c.execute("INSERT INTO source_files(id, path, sha256, file_name, stage, subject,"
                  " grade, textbook, chapter, questions_count, formulas_count)"
                  " VALUES (1, 'p1', 'sha1', 'a.docx', '初中', '物理', '八年级下册',"
                  " '苏科版', '9.4', 3, 1)")
        c.execute("INSERT INTO source_files(id, path, sha256, file_name, stage, subject)"
                  " VALUES (2, 'p2', 'sha2', 'b.docx', '初中', '物理')")
        for qid, num, text, ans, ana, diff in (
            (1, "1", "浮力的大小与排开液体的重力有关⟦F1⟧", "B", "由阿基米德原理可得", "易"),
            (2, "2", "压强的计算公式是什么", None, None, "未标注"),
            (3, "3", "密度的定义", "C", None, "难"),
        ):
            c.execute(
                "INSERT INTO questions(id, source_id, number, text, plain_text, section,"
                " chapter, qtype, difficulty, char_length, content_hash, version, answer,"
                " analysis) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
                (qid, 1, num, text, bt.strip_placeholders(text),
                 "一、选择题", "9.4", "选择题", diff, len(bt.normalize_text(text)),
                 bt.content_hash(text), ans, ana))
            # 版本 v1 行（供 /versions 查询）+ FTS 索引（供关键词检索）。
            c.execute(
                "INSERT INTO question_versions(question_id, version, content_hash, text,"
                " plain_text, char_length, created_at) VALUES (?,1,?,?,?,?, '2026-01-01T00:00:00')",
                (qid, bt.content_hash(text), text, bt.strip_placeholders(text),
                 len(bt.normalize_text(text))))
            c.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                      (bt.tokenized_text(text), str(qid)))
        c.execute("INSERT INTO formulas(id, question_id, source_id, fid, seq, kind, status,"
                  " latex, needs_review) VALUES (1, 1, 1, 'F1', 1, 'omml', 'OK', 'F=\\rho gV', 1)")
        c.execute("INSERT INTO review_queue(id, formula_id, question_id, status, kind,"
                  " resolved) VALUES (1, 1, 1, 'FAIL', 'omml', 0)")
        c.execute("INSERT INTO labels(id, namespace, name) VALUES (1, '知识点', '浮力')")
        c.execute("INSERT INTO question_labels(question_id, label_id, source, review_status)"
                  " VALUES (1, 1, 'dictionary', '待复核')")
        c.commit()
        materialize_source(c,1)

    # -- 小工具 ----------------------------------------------------------- #
    def _assert_envelope(self, resp, *, code=0, status=200):
        self.assertEqual(resp.status_code, status, resp.text)
        body = resp.json()
        self.assertEqual(set(body.keys()), {"code", "data", "message"})
        self.assertEqual(body["code"], code, body)
        return body


class TestReadEndpoints(ApiTestBase):
    def test_review_flags_match_filter_and_pagination(self):
        data = self._assert_envelope(self.client.get('/api/search'))['data']
        self.assertEqual([i['needs_review'] for i in data['items']], [True, False, False])
        filtered = self._assert_envelope(self.client.get('/api/search', params={'needs_review': 'true'}))['data']
        self.assertEqual([i['id'] for i in filtered['items']], [1])
        page = self._assert_envelope(self.client.get('/api/search', params={'offset': 1, 'limit': 1}))['data']
        self.assertIs(page['items'][0]['needs_review'], False)
        self.assertEqual(page['total'], 3)

    def test_review_context_and_missing_preview(self):
        item = self._assert_envelope(self.client.get('/api/review'))['data']['items'][0]
        self.assertIn('浮力', item['question_text'])
        self.assertEqual(item['fid'], 'F1')
        self.assertEqual(item['latex'], r'F=\rho gV')
        self.assertIsNone(item['preview_url'])
        self._assert_envelope(self.client.get('/api/review/999/preview'), code=40407, status=404)
        self._assert_envelope(self.client.get('/api/review/1/preview'), code=40404, status=404)

    def _seed_media(self):
        import hashlib
        import io
        import zipfile
        from PIL import Image
        buffer = io.BytesIO()
        Image.new('RGB', (96, 48), 'red').save(buffer, format='PNG')
        blob = buffer.getvalue()
        source = self.dir / 'media.docx'
        with zipfile.ZipFile(source, 'w') as doc:
            doc.writestr('word/media/image1.png', blob)
        self.conn.execute('UPDATE source_files SET path = ? WHERE id = 1', (str(source),))
        self.conn.execute('INSERT INTO images(id, question_id, source_id, media_path, sha256)'
                          ' VALUES (1, 1, 1, ?, ?)', ('media/image1.png', hashlib.sha256(blob).hexdigest()))
        self.conn.execute('UPDATE review_queue SET preview = ? WHERE id = 1', ('media/image1.png',))
        self.conn.commit()
        source=materialize_source(self.conn,1,media_blobs={'media/image1.png':blob})
        return blob, source

    def test_review_preview_real_png_and_bad_member(self):
        blob, source = self._seed_media()
        import io
        from PIL import Image
        response = self.client.get('/api/review/1/preview')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['content-type'], 'image/png')
        self.assertEqual(Image.open(io.BytesIO(response.content)).size, (96, 48))
        # 路径来自库内，但损坏的数据仍不能读取媒体目录以外的成员。
        self.conn.execute('UPDATE review_queue SET preview = ? WHERE id = 1', ('../document.xml',))
        self.conn.commit()
        self._assert_envelope(self.client.get('/api/review/1/preview'), code=40404, status=404)

    def test_export_image_metadata_preserves_locked_snapshot(self):
        blob, source = self._seed_media()
        pid = self._assert_envelope(self.client.post('/api/papers', json={'title': '图片快照'}))['data']['id']
        self._assert_envelope(self.client.post(f'/api/papers/{pid}/questions', json={'question_ids': [1]}))
        data = self._assert_envelope(self.client.get(f'/api/papers/{pid}/export-data'))['data']
        image = data['sections'][0]['questions'][0]['images'][0]
        self.assertEqual((image['id'], image['width'], image['height']), (1, 96, 48))
        self.assertEqual(image['url'], '/api/questions/1/media/1')
        snapshot_sha = image['sha256']
        # 当前库图片发生替换时，旧试卷不能悄悄指向新图，哪怕媒体文件名相同。
        self.conn.execute("UPDATE images SET sha256 = 'new-image' WHERE id = 1")
        self.conn.commit()
        data = self._assert_envelope(self.client.get(f'/api/papers/{pid}/export-data'))['data']
        image = data['sections'][0]['questions'][0]['images'][0]
        self.assertEqual(image['sha256'], snapshot_sha)
        self.assertIsNone(image['url'])
        self.assertIsNone(image['id'])

    def test_invalid_theme_is_rejected_without_saving(self):
        for theme in ({'primary': 'invalid'}, {'primary': 123}, {'dark': 'false'}):
            self._assert_envelope(self.client.put('/api/settings', json={'theme': theme}),
                                  code=40006, status=400)
        data = self._assert_envelope(self.client.put('/api/settings', json={
            'theme': {'primary': '#123abc', 'dark': True}}))['data']
        self.assertEqual(data['theme'], {'primary': '#123abc', 'dark': True})

    def test_health(self):
        body = self._assert_envelope(self.client.get("/api/health"))
        self.assertTrue(body["data"]["ok"])
        self.assertTrue(body["data"]["db_exists"])

    def test_search_and_facets(self):
        body = self._assert_envelope(self.client.get("/api/search", params={"keyword": "浮力"}))
        self.assertGreaterEqual(body["data"]["total"], 1)
        self.assertEqual(set(body["data"]) , {"total", "items", "limit", "offset", "grade_gap"})
        self.assertIsNone(body["data"]["grade_gap"])

        # has_answer 过滤：只有题 1、3 有答案。
        body = self._assert_envelope(self.client.get("/api/search", params={"has_answer": "true"}))
        self.assertEqual(body["data"]["total"], 2)
        body = self._assert_envelope(self.client.get("/api/search", params={"has_answer": "false"}))
        self.assertEqual(body["data"]["total"], 1)

        fac = self._assert_envelope(self.client.get("/api/search/facets"))
        self.assertIn("dimensions", fac["data"])
        self.assertIn("coverage", fac["data"])
        self.assertIn("difficulty", fac["data"]["dimensions"])

    def test_search_items_have_content_flags(self):
        """B2：检索结果 item 必须带 has_answer / has_analysis（JSON 布尔）。"""
        b = self._assert_envelope(self.client.get("/api/search", params={"limit": "200"}))
        items = {it["id"]: it for it in b["data"]["items"]}
        # 题 1：有答案 + 有解析。
        self.assertIs(items[1]["has_answer"], True)
        self.assertIs(items[1]["has_analysis"], True)
        # 题 2：无答案、无解析。
        self.assertIs(items[2]["has_answer"], False)
        self.assertIs(items[2]["has_analysis"], False)
        # 题 3：有答案、无解析。
        self.assertIs(items[3]["has_answer"], True)
        self.assertIs(items[3]["has_analysis"], False)
        # 选择：列表**不下发**答案/解析原文（保持载荷精简，原文见详情接口）。
        self.assertNotIn("answer", items[1])
        self.assertNotIn("analysis", items[1])
        # 布尔标志可直接参与过滤，口径一致（有答案 = 2 题）。
        b = self._assert_envelope(self.client.get("/api/search", params={"has_answer": "true"}))
        self.assertEqual(b["data"]["total"], 2)

    def test_question_detail_and_versions(self):
        body = self._assert_envelope(self.client.get("/api/questions/1"))
        self.assertEqual(body["data"]["id"], 1)
        # 标签三态：含 review_status。
        self.assertTrue(any(lbl.get("review_status") for lbl in body["data"]["labels"]))
        self._assert_envelope(self.client.get("/api/questions/1/versions"))
        v = self._assert_envelope(self.client.get("/api/questions/1/versions/1"))
        self.assertEqual(v["data"]["version"], 1)

    def test_question_not_found(self):
        self._assert_envelope(self.client.get("/api/questions/99999"), code=40401, status=404)
        self._assert_envelope(self.client.get("/api/questions/99999/versions"),
                              code=40401, status=404)

    def test_papers_list_and_404(self):
        self._assert_envelope(self.client.get("/api/papers"))
        self._assert_envelope(self.client.get("/api/papers/9999"), code=40402, status=404)

    def test_labels_and_review_reads(self):
        b = self._assert_envelope(self.client.get("/api/labels/review-summary"))
        self.assertIn("counts", b["data"])
        b = self._assert_envelope(self.client.get("/api/labels/review-items",
                                                  params={"label_name": "浮力"}))
        self.assertGreaterEqual(b["data"]["total"], 1)
        self._assert_envelope(self.client.get("/api/labels/review-items",
                                              params={"label_name": "不存在"}), code=40406, status=404)
        self._assert_envelope(self.client.get("/api/review"))
        b = self._assert_envelope(self.client.get("/api/review/summary"))
        self.assertGreaterEqual(b["data"]["open"], 1)

    def test_sources_and_stats(self):
        b = self._assert_envelope(self.client.get("/api/sources"))
        self.assertEqual(len(b["data"]), 2)
        b = self._assert_envelope(self.client.get("/api/sources/1"))
        self.assertEqual(b["data"]["questions_count"], 3)
        self._assert_envelope(self.client.get("/api/sources/999"), code=40408, status=404)
        b = self._assert_envelope(self.client.get("/api/sources/1/impact", params={"field": "grade"}))
        self.assertEqual(b["data"]["affected_questions"], 3)
        self._assert_envelope(self.client.get("/api/meta/coverage"))
        self._assert_envelope(self.client.get("/api/stats"))

    def test_settings(self):
        b = self._assert_envelope(self.client.get("/api/settings"))
        self.assertIn("db_path", b["data"])
        b = self._assert_envelope(self.client.put("/api/settings",
                                                  json={"default_template": "测验"}))
        self.assertEqual(b["data"]["default_template"], "测验")
        self._assert_envelope(self.client.put("/api/settings",
                                              json={"default_template": "不存在"}), code=40006, status=400)


class TestSearchMissingFilters(ApiTestBase):
    """``*_missing`` 契约：哨兵感知的「待补充」桶筛选（P0-13 前置，前端筛选栏依赖）。

    真实库中缺失元数据以**字面串**落库（``待补充`` / ``未分类`` / ``未标注``），本类在
    基础 seed 之上追加一条「来源 3（年级/教材=待补充）+ 两题（章节=待补充、题型=未分类、
    难度=未标注）」，逐项验证筛选、``false``=不过滤、AND 叠加与 facets 桶计数。
    """

    def _seed_sentinels(self):
        """追加哨兵数据：来源 3（待补充/待补充）+ 题 4/5（待补充/未分类/未标注）。"""
        c = self.conn
        c.execute("INSERT INTO source_files(id, path, sha256, file_name, stage, subject,"
                  " grade, textbook) VALUES (3, 'p3', 'sha3', 'c.docx', '初中', '物理',"
                  " '待补充', '待补充')")
        for qid, num, text in ((4, "1", "哨兵题一"), (5, "2", "哨兵题二")):
            c.execute(
                "INSERT INTO questions(id, source_id, number, text, plain_text, section,"
                " chapter, qtype, difficulty, char_length, content_hash, version, answer)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,1,NULL)",
                (qid, 3, num, text, bt.strip_placeholders(text), "二、填空题",
                 "待补充", "未分类", "未标注", len(bt.normalize_text(text)),
                 bt.content_hash(text)))
            c.execute("INSERT INTO question_fts(tokens, question_id) VALUES (?, ?)",
                      (bt.tokenized_text(text), str(qid)))
        c.commit()

    def test_missing_true_filters(self):
        self._seed_sentinels()
        # 年级缺失（grade='待补充'）：仅来源 3 的 2 题。
        b = self._assert_envelope(self.client.get("/api/search", params={"grade_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        self.assertEqual({i["id"] for i in b["data"]["items"]}, {4, 5})
        # 教材缺失：同样 2 题。
        b = self._assert_envelope(self.client.get("/api/search",
                                                  params={"textbook_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        # 章节缺失（chapter='待补充'）：2 题。
        b = self._assert_envelope(self.client.get("/api/search",
                                                  params={"chapter_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        # 题型缺失（qtype='未分类'）：2 题。
        b = self._assert_envelope(self.client.get("/api/search", params={"qtype_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        # 难度缺失（difficulty='未标注'）：基础库题 2 + 哨兵题 4/5 = 3。
        b = self._assert_envelope(self.client.get("/api/search",
                                                  params={"difficulty_missing": "true"}))
        self.assertEqual(b["data"]["total"], 3)

    def test_missing_false_is_no_filter(self):
        self._seed_sentinels()
        # false = 不过滤 → 全量 5 题。
        for param in ("grade_missing", "textbook_missing", "chapter_missing",
                      "qtype_missing", "difficulty_missing"):
            b = self._assert_envelope(self.client.get("/api/search", params={param: "false"}))
            self.assertEqual(b["data"]["total"], 5, param)
        # 缺省同样不过滤。
        b = self._assert_envelope(self.client.get("/api/search"))
        self.assertEqual(b["data"]["total"], 5)

    def test_missing_and_stackable(self):
        self._seed_sentinels()
        # 多维度 AND 叠加：年级缺失 + 题型缺失 → 2 题。
        b = self._assert_envelope(self.client.get("/api/search", params={
            "grade_missing": "true", "qtype_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        # 与关键词 AND 叠加：keyword=哨兵（FTS 命中题 4/5）+ 年级缺失 → 2。
        b = self._assert_envelope(self.client.get("/api/search", params={
            "keyword": "哨兵", "grade_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)
        # 关键词 + 不过滤维度：keyword=哨兵 + grade_missing=false → 仍 2（关键词命中 4/5）。
        b = self._assert_envelope(self.client.get("/api/search", params={
            "keyword": "哨兵", "grade_missing": "false"}))
        self.assertEqual(b["data"]["total"], 2)
        # 关键词 + 无命中维度：keyword=哨兵 + chapter_missing=true → 2（章节缺失题正是 4/5）。
        b = self._assert_envelope(self.client.get("/api/search", params={
            "keyword": "哨兵", "chapter_missing": "true"}))
        self.assertEqual(b["data"]["total"], 2)

    def test_facets_pending_bucket(self):
        self._seed_sentinels()
        dims = self._assert_envelope(self.client.get("/api/search/facets"))["data"]["dimensions"]
        # 「待补充」桶计数（哨兵感知）。
        self.assertEqual(dims["grade"]["missing"], 2)
        self.assertEqual(dims["textbook"]["missing"], 2)
        self.assertEqual(dims["chapter"]["missing"], 2)
        self.assertEqual(dims["qtype"]["missing"], 2)
        self.assertEqual(dims["difficulty"]["missing"], 3)
        # 哨兵值不应再作为普通取值出现在 items 中（避免前端重复展示）。
        self.assertNotIn("待补充", [i["key"] for i in dims["grade"]["items"]])
        self.assertNotIn("待补充", [i["key"] for i in dims["chapter"]["items"]])
        self.assertNotIn("未分类", [i["key"] for i in dims["qtype"]["items"]])
        self.assertNotIn("未标注", [i["key"] for i in dims["difficulty"]["items"]])
        # 非哨兵取值仍保留。
        self.assertIn({"key": "9.4", "count": 3}, dims["chapter"]["items"])


class TestQuestionWrites(ApiTestBase):
    def test_edit_save_and_version_bump(self):
        body = self._assert_envelope(self.client.put(
            "/api/questions/2", json={"patch": {"answer": "P=F/S"}}))
        self.assertEqual(body["data"]["version"], 2)
        # 留版：旧版本快照可查。
        v = self._assert_envelope(self.client.get("/api/questions/2/versions/1"))
        self.assertIsNotNone(v["data"]["snapshot"])

    def test_edit_placeholder_missing(self):
        # 新题干含 ⟦F9⟧ 但无对应公式 → 40001。
        self._assert_envelope(self.client.put(
            "/api/questions/2", json={"patch": {"text": "含占位符⟦F9⟧的题干"}}),
            code=40001, status=400)

    def test_edit_content_conflict(self):
        # 把题 2 的文本改成与题 3 相同（同来源）→ 40901，且不写库。
        self._assert_envelope(self.client.put(
            "/api/questions/2", json={"patch": {"text": "密度的定义"}}), code=40901, status=409)

    def test_difficulty(self):
        b = self._assert_envelope(self.client.post("/api/questions/2/difficulty",
                                                   json={"level": "中"}))
        self.assertEqual(b["data"]["difficulty"], "中")
        self._assert_envelope(self.client.post("/api/questions/2/difficulty",
                                               json={"level": "超难"}), code=40002, status=400)
        b = self._assert_envelope(self.client.post("/api/questions/difficulty/batch",
                                                   json={"ids": [1, 2, 999], "level": "易"}))
        self.assertEqual(b["data"]["updated"], 2)
        self.assertIn(999, b["data"]["missing"])


class TestPaperWrites(ApiTestBase):
    def _new_paper(self) -> int:
        b = self._assert_envelope(self.client.post("/api/papers",
                                                   json={"title": "单元测验", "subject": "物理"}))
        return b["data"]["id"]

    def test_create_get_patch_delete(self):
        pid = self._new_paper()
        b = self._assert_envelope(self.client.patch(f"/api/papers/{pid}",
                                                    json={"template": "测验", "status": "定稿"}))
        self.assertEqual(b["data"]["template"], "测验")
        self._assert_envelope(self.client.patch(f"/api/papers/{pid}",
                                                json={"template": "非法"}), code=40003, status=400)
        # 加题 → 非空；未 force 删除 → 40902。
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                               json={"question_ids": [1, 3], "score": 3}))
        self._assert_envelope(self.client.delete(f"/api/papers/{pid}"), code=40902, status=409)
        b = self._assert_envelope(self.client.delete(f"/api/papers/{pid}", params={"force": "true"}))
        self.assertEqual(b["data"]["removed_items"], 2)

    def test_add_move_score_remove(self):
        pid = self._new_paper()
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                                   json={"question_ids": [1, 2, 3]}))
        items = b["data"]["items"]
        self.assertEqual(len(items), 3)
        item0 = items[0]["id"]
        # 移动。
        self._assert_envelope(self.client.post(
            f"/api/papers/{pid}/questions/{item0}/move", json={"position": 3}))
        # 设分（含小数）。
        self._assert_envelope(self.client.post(
            f"/api/papers/{pid}/questions/{item0}/score", json={"score": 2.5}))
        # 非法分值 → 40004。
        self._assert_envelope(self.client.post(
            f"/api/papers/{pid}/questions/{item0}/score", json={"score": -1}),
            code=40004, status=400)
        # 批量设分。
        b = self._assert_envelope(self.client.post(
            f"/api/papers/{pid}/scores", json={"mapping": {str(items[1]["id"]): 5}}))
        self.assertEqual(b["data"]["updated"], 1)
        # 移除。
        self._assert_envelope(self.client.delete(f"/api/papers/{pid}/questions/{item0}"))

    def test_sections(self):
        pid = self._new_paper()
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/sections",
                                                   json={"name": "一、选择题"}))
        sid = b["data"]["sections"][0]["id"]
        self._assert_envelope(self.client.patch(f"/api/papers/{pid}/sections/{sid}",
                                                json={"name": "一、单选题"}))
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/sections/{sid}/move",
                                               json={"position": 1}))
        self._assert_envelope(self.client.delete(f"/api/papers/{pid}/sections/{sid}"))

    def test_export_data_and_refresh(self):
        pid = self._new_paper()
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                               json={"question_ids": [1]}))
        b = self._assert_envelope(self.client.get(f"/api/papers/{pid}/export-data"))
        self.assertIn("sections", b["data"])
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/refresh-snapshots"))

    def test_paper_item_stale_flag(self):
        """B3：试卷详情 item 暴露 ``stale``（当前 version ≠ 快照 question_version）。"""
        pid = self._new_paper()
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                                   json={"question_ids": [1]}))
        self.assertIs(b["data"]["items"][0]["stale"], False)   # 刚加入 → 快照同步
        # 编辑题 1（改答案）→ version+1 → 快照落后。
        self._assert_envelope(self.client.put("/api/questions/1",
                                              json={"patch": {"answer": "D"}}))
        b = self._assert_envelope(self.client.get(f"/api/papers/{pid}"))
        self.assertIs(b["data"]["items"][0]["stale"], True)
        # refresh-snapshots 默认**跳过**版本已变的题（保持出卷锁定）→ stale 仍为 True。
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/refresh-snapshots"))
        self.assertGreaterEqual(b["data"]["skipped_version_changed"], 1)
        b = self._assert_envelope(self.client.get(f"/api/papers/{pid}"))
        self.assertIs(b["data"]["items"][0]["stale"], True)


class TestLabelsAndSourcesWrites(ApiTestBase):
    def test_decision_preview_and_confirm(self):
        b = self._assert_envelope(self.client.post("/api/labels/decision/preview",
                                                   json={"label_name": "浮力", "decision": "确认"}))
        self.assertEqual(b["data"]["will_update"], 1)
        # 未确认批量 → 40903。
        self._assert_envelope(self.client.post("/api/labels/decision",
                                               json={"label_name": "浮力", "decision": "确认"}),
                              code=40903, status=409)
        # 确认批量 → 成功。
        b = self._assert_envelope(self.client.post("/api/labels/decision",
                                                   json={"label_name": "浮力", "decision": "确认",
                                                         "confirm": True}))
        self.assertEqual(b["data"]["updated"], 1)
        # 标签不存在 → 40406。
        self._assert_envelope(self.client.post("/api/labels/decision/preview",
                                               json={"label_name": "不存在", "decision": "确认"}),
                              code=40406, status=404)

    def test_review_resolve_and_404(self):
        self._assert_envelope(self.client.post("/api/review/1/resolve", json={"resolved": True}))
        self._assert_envelope(self.client.post("/api/review/9999/resolve", json={"resolved": True}),
                              code=40407, status=404)

    def test_source_metadata_confirm(self):
        # 未确认 → 40903（附影响题数）。
        r = self.client.post("/api/sources/1/metadata", json={"grade": "九年级下册"})
        self._assert_envelope(r, code=40903, status=409)
        self.assertIn("affected_questions", r.json()["data"])
        # 确认 → 成功。
        b = self._assert_envelope(self.client.post("/api/sources/1/metadata",
                                                   json={"grade": "九年级下册", "confirm": True}))
        self.assertEqual(b["data"]["affected_questions"], 3)

    def test_labels_export_and_import_csv(self):
        r = self.client.get("/api/labels/export-review")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("text/csv", r.headers["content-type"])
        csv_text = r.content.decode("utf-8-sig")
        self.assertIn("label_name", csv_text)
        # 导入：把 CSV 加一列 decision=确认。
        lines = csv_text.strip().splitlines()
        header = lines[0] + ",decision"
        rows = [header]
        for line in lines[1:]:
            rows.append(line + ",确认")
        payload = "\n".join(rows).encode("utf-8-sig")
        resp = self.client.post("/api/labels/import-review",
                                files={"file": ("review.csv", payload, "text/csv")})
        b = self._assert_envelope(resp)
        self.assertGreaterEqual(b["data"]["applied"], 1)


class TestJobsAndPreviewCache(ApiTestBase):
    def test_job_not_found(self):
        self._assert_envelope(self.client.get("/api/jobs/deadbeef"), code=40405, status=404)

    def test_preview_page_bad_key(self):
        self._assert_envelope(self.client.get("/api/preview/notakey/page_1.png"),
                              code=40405, status=404)

    def test_preview_cache_hit(self):
        # 建卷 + 加题。
        pid = self._assert_envelope(self.client.post("/api/papers",
                                                     json={"title": "缓存卷"}))["data"]["id"]
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                               json={"question_ids": [1]}))
        # 计算 key 并伪造缓存产物（DOCX + 1 页 PNG + meta）。
        key = pv.cache_key(self.conn, pid, "学生版", "考试")
        cdir = pv.cache_dir(key)
        cdir.mkdir(parents=True, exist_ok=True)
        (cdir / "paper.docx").write_bytes(b"PK\x03\x04 fake")
        (cdir / "page_1.png").write_bytes(b"\x89PNG fake")
        meta = {"key": key, "paper_id": pid, "page_count": 1,
                "pages": [{"n": 1, "file": "page_1.png", "width": 1654, "height": 2339}],
                "docx": str(cdir / "paper.docx"), "pdf": None, "warnings": []}
        import hashlib
        payload=b_paper.build_export_payload(self.conn,pid)
        meta.update(pv.content_fields(payload),answer_mode='学生版',template='考试',docx_sha256=hashlib.sha256((cdir/'paper.docx').read_bytes()).hexdigest())
        (cdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        # 请求预览 → 命中缓存（不提交作业、零重渲染）。
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/preview", json={}))
        self.assertTrue(b["data"]["cached"])
        self.assertEqual(len(b["data"]["pages"]), 1)
        self.assertEqual(b["data"]["pages"][0]["url"], f"/api/preview/{key}/page_1.png")
        # PNG 可访问。
        r = self.client.get(f"/api/preview/{key}/page_1.png")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers["content-type"], "image/png")
        # 越界页 → 40405。
        self._assert_envelope(self.client.get(f"/api/preview/{key}/page_2.png"),
                              code=40405, status=404)


@unittest.skipUnless(os.environ.get("WEBUI_E2E") == "1",
                     "端到端渲染测试需设置 WEBUI_E2E=1（依赖 editor_sdk + Word/WPS）")
class TestRenderE2E(ApiTestBase):
    """真实渲染（editor_sdk + Office）——默认跳过，避免拖慢常规测试。"""

    def test_preview_and_export_real(self):
        pid = self._assert_envelope(self.client.post("/api/papers",
                                                     json={"title": "E2E 卷"}))["data"]["id"]
        self._assert_envelope(self.client.post(f"/api/papers/{pid}/questions",
                                               json={"question_ids": [1]}))
        b = self._assert_envelope(self.client.post(f"/api/papers/{pid}/preview", json={}))
        if b["data"].get("cached"):
            return
        job_id = b["data"]["job_id"]
        import time
        for _ in range(120):
            j = self._assert_envelope(self.client.get(f"/api/jobs/{job_id}"))["data"]
            if j["status"] in ("done", "error"):
                break
            time.sleep(1)
        self.assertEqual(j["status"], "done", j)
        self.assertGreaterEqual(j["result"]["page_count"], 1)


if __name__ == "__main__":
    unittest.main()
