"""命令行入口。

用法::

    python -m bank.cli init
    python -m bank.cli import <目录或文件>
    python -m bank.cli stats
    python -m bank.cli search "浮力" --chapter 10.3 --limit 5
    python -m bank.cli search "浮力" --kp-confirmed-only      # 严格模式：只命中已确认知识点
    python -m bank.cli show <题目id>
    python -m bank.cli review
    python -m bank.cli labels [--namespace chapter]
    python -m bank.cli labels review-list --namespace 知识点 --limit 20
    python -m bank.cli labels confirm --label 压强
    python -m bank.cli labels reject  --label 太阳系 --question 4
    python -m bank.cli labels export-review --out review.csv
    python -m bank.cli labels import-review review.csv
    python -m bank.cli sources [--limit 20]
    python -m bank.cli enrich [--dry-run] [--db PATH]
    python -m bank.cli normalize [--dry-run] [--no-snapshots] [--db PATH]
    python -m bank.cli answers extract [--dry-run] [--refresh-snapshots
                        [--refresh-paper ID ... | --refresh-all]] [--db PATH]
    python -m bank.cli paper new --title "初二物理周末练习" --subject 物理 --stage 初中
    python -m bank.cli paper list
    python -m bank.cli paper show <paper_id>
    python -m bank.cli paper add <paper_id> <question_id...> [--section 一、选择题] [--position N]
    python -m bank.cli paper remove <paper_id> <item_id>
    python -m bank.cli paper move <paper_id> <item_id> <new_position>
    python -m bank.cli paper score <paper_id> <item_id> <score>
    python -m bank.cli paper section add|rename|move|delete ...
    python -m bank.cli paper delete <paper_id> [--force]
    python -m bank.cli paper export-data <paper_id> [--out out.json]
    python -m bank.cli export paper <paper_id> --answer-mode 学生版 --out <路径.docx> [--pdf] [--template 考试]
    python -m bank.cli export verify <路径.docx> [--out 报告.json]
"""
# ---------------------------------------------------------------------------
# title: 命令行入口
# description: 题库的命令行入口：建库、导入、检索、统计、元数据补全等子命令。
# author: 待补充
# version: 0.1.0
# category: 阶段2-题库
# ---------------------------------------------------------------------------

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from . import answers as _answers
from . import db as _db
from . import enrich as _enrich
from . import export as _export
from . import export_content as _content
from . import importer as _imp
from . import labels as _lbl
from . import latexnorm as _latexnorm
from . import paper as _paper
from . import query as _q


def _add_db_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", default=str(_db.DEFAULT_DB_PATH),
                        help="数据库文件路径（默认 outputs/bank.db）")


def cmd_init(args) -> int:
    conn = _db.connect(args.db)
    print(f"已建库：{args.db}  schema_version={_db.schema_version(conn)}")
    conn.close()
    return 0


def cmd_import(args) -> int:
    conn = _db.connect(args.db)
    try:
        stats = _imp.import_path(conn, args.path,
                                 skip_numeric_junk=not args.keep_numeric_junk,
                                 verbose=not args.quiet)
    except FileNotFoundError as exc:
        # F3：路径不存在时明确报错（不再静默空跑）。
        print(f"导入失败：{exc}")
        return 1
    finally:
        conn.close()
    s = stats
    print("\n--- 导入完成 ---")
    print(f"文件       : 共 {s.files_total}，导入 {s.files_imported}，"
          f"跳过(已存在) {s.files_skipped}，失败 {s.files_failed}")
    print(f"题目       : 新增 {s.questions_new}，更新 {s.questions_updated}，"
          f"跳过(重复) {s.questions_skipped}，忽略(数值垃圾) {s.questions_junk}")
    print(f"公式       : {s.formulas}")
    print(f"图片       : {s.images}")
    print(f"待复核入队 : {s.review}")
    if s.errors:
        print(f"错误       : {len(s.errors)}")
        for e in s.errors[:20]:
            print(f"  - {e['file']}: {e['error']}")
    return 0 if s.files_failed == 0 else 1


def cmd_stats(args) -> int:
    conn = _db.connect(args.db)
    st = _q.stats(conn)
    conn.close()
    print("=== 题库统计 ===")
    print(f"来源文件 : {st['sources']}")
    print(f"题目     : {st['questions']}")
    print(f"公式     : {st['formulas']}（OK {st['formulas_ok']}）")
    print(f"图片     : {st['images']}")
    print(f"标签     : {st['labels']}")
    print(f"待复核   : 未处理 {st['review_open']}，已处理 {st['review_resolved']}")
    print("公式状态分布 :", "  ".join(f"{x['status']}={x['count']}"
                                      for x in st["formula_status"]))
    for key, title in (("by_stage", "学段"), ("by_subject", "学科"),
                       ("by_grade", "年级"), ("by_textbook", "教材版本"),
                       ("by_qtype", "题型")):
        items = st[key]
        if items:
            print(f"{title}分布 :", "  ".join(f"{x['key'] or '未标注'}={x['count']}"
                                              for x in items[:12]))
    if st["top_chapters"]:
        print("章节 Top  :", "  ".join(f"{x['key']}={x['count']}"
                                       for x in st["top_chapters"][:12]))
    return 0


def cmd_search(args) -> int:
    conn = _db.connect(args.db)
    if args.kp_confirmed_only:
        _lbl.ensure_review_status_column(conn)   # 兼容尚未迁移的旧库
    res = _q.search(conn, keyword=args.keyword, stage=args.stage, subject=args.subject,
                    grade=args.grade, textbook=args.textbook, chapter=args.chapter,
                    qtype=args.qtype, difficulty=args.difficulty, labels=args.label,
                    needs_review=True if args.review else None,
                    label_review=_lbl.REVIEW_CONFIRMED if args.kp_confirmed_only else None,
                    label_namespace=_lbl.KNOWLEDGE_NAMESPACE if args.kp_confirmed_only else None,
                    limit=args.limit, offset=args.offset)
    conn.close()
    if args.kp_confirmed_only:
        print("[严格模式] 仅命中「已确认」的知识点标签（未复核/已否决的标签被排除）")
    print(f"命中 {res['total']} 条，显示第 {res['offset'] + 1}~"
          f"{res['offset'] + len(res['items'])} 条：")
    for it in res["items"]:
        head = (it["section"] or "")[:12]
        print(f"  [id={it['id']}] {it['stage'] or '-'}/{it['grade'] or '-'}"
              f"/{it['chapter'] or '-'}/{it['qtype'] or '-'}  {head}")
        print(f"        题号 {it['number']}  字符 {it['char_length']}  来源：{it['file_name'][:40]}")
    return 0


def cmd_show(args) -> int:
    conn = _db.connect(args.db)
    q = _q.get_question(conn, args.id)
    conn.close()
    if q is None:
        print(f"未找到题目 id={args.id}")
        return 1
    print(f"=== 题目 #{q['id']} ===")
    print(f"题号   : {q['number']}   版本: v{q['version']}   题型: {q['qtype']}   难度: {q['difficulty']}")
    print(f"来源   : {q['src_file']}")
    print(f"元数据 : 学段={q['src_stage']} 年级={q['src_grade']} 学科={q['src_subject']}"
          f" 教材={q['src_textbook']} 章节={q['chapter']}")
    print(f"段落   : {q['start_paragraph']}~{q['end_paragraph']}   小题: {q['sub_question_count']}")
    label_txt = ", ".join(f"{l['namespace']}:{l['name']}" for l in q["labels"])
    print(f"标签   : {label_txt}")
    print("--- 题干（含 ⟦Fn⟧ 占位符）---")
    print(q["text"])
    if q["formulas"]:
        print("--- 公式 ---")
        for f in q["formulas"]:
            flag = "  [待复核]" if f["needs_review"] else ""
            print(f"  {f['fid']}(seq{f['seq']}) {f['kind']}/{f['status']}  "
                  f"latex={f['latex']!r}{flag}")
    if q["images"]:
        print("--- 图片 ---")
        for im in q["images"]:
            print(f"  {im['media_path']}  sha256={(im['sha256'] or '')[:12]}")
    print("--- 版本历史 ---")
    for v in q["versions"]:
        print(f"  v{v['version']}  {v['created_at']}  hash={v['content_hash'][:12]}"
              f"  长度={v['char_length']}")
    return 0


def cmd_review(args) -> int:
    conn = _db.connect(args.db)
    res = _q.list_review(conn, resolved=args.resolved, status=args.status,
                         limit=args.limit, offset=args.offset)
    conn.close()
    print(f"待复核 {res['total']} 条，显示 {len(res['items'])} 条：")
    for it in res["items"]:
        print(f"  [rq={it['id']}] 题#{it['question_id']} {it['kind']}/{it['status']}"
              f"  progid={it['progid']}  part={it['part']}")
        print(f"        {it['reason']}  预览={it['preview']}")
    return 0


def cmd_labels(args) -> int:
    """``labels`` 子命令：默认列出标签；``review-*`` 走知识点人工复核工作流。"""
    conn = _db.connect(args.db)
    action = getattr(args, "action", None)

    if action is None:
        rows = _q.list_labels(conn, namespace=args.namespace)
        conn.close()
        print(f"标签 {len(rows)} 个：")
        for r in rows[: args.limit]:
            print(f"  [{r['namespace']}] {r['name']}  ({r['c']})")
        return 0

    ns = args.namespace or _lbl.KNOWLEDGE_NAMESPACE
    _lbl.ensure_review_status_column(conn)

    if action == "review-list":
        status = args.status if args.status is not None else _lbl.REVIEW_PENDING
        rows = _lbl.review_summary(conn, namespace=ns, status=status, limit=args.limit)
        counts = _lbl.status_counts(conn, namespace=ns)
        conn.close()
        print(f"复核清单（命名空间={ns}，过滤状态={status or '全部'}）：{len(rows)} 个标签")
        print(f"关联总数：待复核 {counts[_lbl.REVIEW_PENDING]}，"
              f"已确认 {counts[_lbl.REVIEW_CONFIRMED]}，已否决 {counts[_lbl.REVIEW_REJECTED]}")
        print(f"  {'label_id':>8}  {'标签':<14} {'命中':>6} {'待复核':>7} {'已确认':>7} {'已否决':>7}")
        for r in rows:
            print(f"  {r['label_id']:>8}  {r['label_name']:<14} {r['total']:>6}"
                  f" {r['pending']:>7} {r['confirmed']:>7} {r['rejected']:>7}")
        return 0

    if action in ("confirm", "reject"):
        if not args.label:
            conn.close()
            print("缺少 --label（标签名）")
            return 2
        decision = _lbl.REVIEW_CONFIRMED if action == "confirm" else _lbl.REVIEW_REJECTED
        res = _lbl.set_review_status(conn, label_name=args.label, decision=decision,
                                     question_id=args.question, namespace=ns, force=args.force)
        conn.close()
        if not res["found"]:
            print(f"未找到标签：{args.label}（命名空间={ns}）")
            return 1
        scope = f"题 #{args.question}" if args.question is not None else "该标签全部待复核关联"
        print(f"{decision} 标签「{args.label}」（{scope}）："
              f"更新 {res['updated']} 条，命中 {res['matched']} 条，"
              f"已终态未覆盖 {res['already_decided']} 条"
              + ("（--force 覆盖模式）" if args.force else ""))
        return 0

    if action == "export-review":
        if not args.out:
            conn.close()
            print("缺少 --out（输出 CSV 路径）")
            return 2
        status = args.status if args.status is not None else _lbl.REVIEW_PENDING
        res = _lbl.export_review(conn, args.out, namespace=ns, status=status, limit=args.limit)
        conn.close()
        print(f"已导出复核清单：{res['rows']} 行 -> {res['path']}"
              f"（命名空间={ns}，状态={status or '全部'}）")
        return 0

    if action == "import-review":
        if not args.csv:
            conn.close()
            print("缺少 CSV 路径（labels import-review <csv>）")
            return 2
        res = _lbl.import_review(conn, args.csv, force=args.force)
        conn.close()
        print(f"读回复核决定：处理 {res['total']} 行，应用 {res['applied']} 行，"
              f"跳过 {res['skipped']} 行")
        for e in res["errors"][:20]:
            print(f"  - {e}")
        if len(res["errors"]) > 20:
            print(f"  …（其余 {len(res['errors']) - 20} 条省略）")
        return 0

    conn.close()
    print(f"未知 labels 子命令：{action}")
    return 2


def cmd_sources(args) -> int:
    conn = _db.connect(args.db)
    rows = _q.list_sources(conn, limit=args.limit)
    conn.close()
    print(f"来源文件 {len(rows)} 个：")
    for r in rows:
        print(f"  [id={r['id']}] {r['questions_count']:4d}题 {r['formulas_count']:4d}式 "
              f"{r['stage'] or '-'}/{r['grade'] or '-'}/{r['textbook'] or '-'}"
              f"/{r['chapter'] or '-'}  {r['file_name'][:44]}")
    return 0


def cmd_enrich(args) -> int:
    conn = _db.connect(args.db)
    before = _enrich.coverage(conn)
    stats = _enrich.enrich(conn, dry_run=args.dry_run)

    if args.dry_run:
        print("=== 元数据补全（dry-run，未写库）===")
        print(f"grade  将新增 {stats['grade']['new']}  来源 {stats['grade']['sources']}")
        print(f"textbook 将新增 {stats['textbook']['new']}  来源 {stats['textbook']['sources']}")
        print(f"chapter 将新增 {stats['chapter']['new']}  来源 {stats['chapter']['sources']}")
        kp = stats["knowledge"]
        print(f"知识点 将新增关联 {kp['new_links']} 条，去重后标签 {kp['new_labels']} 个，"
              f"覆盖题目 {kp['questions']} 道  来源 {kp['sources']}")
        print(f"difficulty 未处理（源数据无标注）: {stats['difficulty_untouched']} 道保持 未标注")
        conn.close()
        return 0

    after = _enrich.coverage(conn)
    print("=== 元数据补全完成 ===")
    print(f"grade  新增 {stats['grade']['new']}"
          f"（另标记既有值来源 {stats['grade']['marked_preexisting']}）"
          f"  来源 {stats['grade']['sources']}")
    print(f"textbook 新增 {stats['textbook']['new']}"
          f"（另标记既有值来源 {stats['textbook']['marked_preexisting']}）"
          f"  来源 {stats['textbook']['sources']}")
    print(f"chapter 新增 {stats['chapter']['new']}"
          f"（另标记既有值来源 {stats['chapter']['marked_preexisting']}）"
          f"  来源 {stats['chapter']['sources']}")
    kp = stats["knowledge"]
    print(f"知识点 新增关联 {kp['new_links']} 条，去重后标签 {kp['new_labels']} 个，"
          f"覆盖题目 {kp['questions']} 道  来源 {kp['sources']}")
    print(f"difficulty 未处理（源数据无标注）: {stats['difficulty_untouched']} 道保持 未标注")
    print()
    print("=== 覆盖率对比（占位符不计入）===")
    print(_enrich.format_coverage_table(before, after))
    conn.close()
    return 0


def cmd_normalize(args) -> int:
    """规范化库内 LaTeX 表示（D1/D2）：还原 ``[U+XXXX]`` + 去掉 ``$`` 定界符。

    写库前**自动备份**并校验（``--no-backup`` 可跳过，不推荐）；``--dry-run`` 只统计。
    """
    conn = _db.connect(args.db)
    try:
        if args.dry_run:
            res = _latexnorm.migrate_latex(conn, include_snapshots=not args.no_snapshots,
                                           dry_run=True)
            print("=== LaTeX 规范化（dry-run，未写库）===")
            _print_normalize(res)
            return 0
        backup_path = None
        if not args.no_backup:
            backup_path = _enrich.backup_db(args.db)
            chk = _enrich.verify_backup(args.db, backup_path)
            print(f"已备份：{backup_path}")
            print(f"备份校验：ok={chk['ok']}  {chk.get('verdict')}")
            if not chk["ok"]:
                print("备份校验失败，已中止迁移（未改动库）。")
                return 1
        res = _latexnorm.migrate_latex(conn, include_snapshots=not args.no_snapshots)
        print("=== LaTeX 规范化完成 ===")
        _print_normalize(res)
        if backup_path:
            print(f"备份：{backup_path}（如需回滚，可复制覆盖 bank.db）")
        return 0
    finally:
        conn.close()


def _print_normalize(res: dict) -> None:
    """打印 LaTeX 规范化统计。"""
    print(f"formulas.latex   : 共 {res['formulas_total']} 条，改动 {res['formulas_changed']} 条")
    print(f"  [U+XXXX] 转义   : {res['uplus_before']} -> {res['uplus_after']}")
    print(f"  $ 定界符        : {res['dollar_before']} -> {res['dollar_after']}")
    if res["include_snapshots"]:
        print(f"试卷快照          : 扫描 {res['snapshots_scanned']} 行，改动 {res['snapshots_changed']} 行")
    else:
        print("试卷快照          : 已跳过（--no-snapshots）")


def cmd_answers(args) -> int:
    """``answers`` 子命令：抽取答案 / 解析（路径 A 内联拆分 + 路径 B/C 配对文件）。"""
    conn = _db.connect(args.db)
    try:
        if args.answers_action == "extract":
            result = _answers.extract(conn, dry_run=args.dry_run)
            _print_answers_result(result, args)
            if not args.dry_run and args.refresh_snapshots:
                return _refresh_snapshots_after_answers(conn, args)
            return 0
        print(f"未知 answers 子命令：{args.answers_action}")
        return 2
    finally:
        conn.close()


def _refresh_snapshots_after_answers(conn, args) -> int:
    """抽取答案后按**显式范围**刷新快照（F6）。

    * ``--refresh-paper <id>``（可重复）：只刷新指定试卷；
    * ``--refresh-all``：显式刷新**全部试卷**（影响全库，慎用）；
    * 两者都没给：报错并提示，**绝不**默认刷全库。
    """
    papers = list(args.refresh_paper or [])
    if not papers and not args.refresh_all:
        print("\n快照刷新未执行：请用 `--refresh-paper <试卷id>` 指定试卷，"
              "或用 `--refresh-all` 显式刷新**全部试卷**（影响全库）。")
        return 2
    targets = papers if papers else [None]
    all_flag = not papers
    for pid in targets:
        res = _paper.refresh_snapshots(conn, pid, all_papers=all_flag)
        scope = "全部试卷" if all_flag else f"试卷 #{pid}"
        print(f"\n快照刷新（{scope}）：共 {res['total']} 条，刷新 {res['refreshed']} 条，"
              f"因版本已变跳过 {res['skipped_version_changed']} 条")
    return 0


def _print_answers_result(result: dict, args) -> None:
    """打印答案抽取统计（dry-run 与实跑分别呈现）。"""
    inline, paired = result["inline"], result["paired"]
    mode = "dry-run（未写库）" if result["dry_run"] else "已写库"
    print(f"=== 答案 / 解析抽取（{mode}）===")

    print("\n--- 路径 A：题干内联拆分 ---")
    print(f"  拆出答案 : {inline['answer']}")
    print(f"  拆出解析 : {inline['analysis']}")
    print(f"  合计（有答案或解析）: {inline['either']}")
    print(f"  无内联标记 : {inline['skipped_no_marker']}")
    print(f"  空题干放弃 : {inline['skipped_empty_stem']}")
    print(f"  已有来源跳过 : {inline['kept_existing']}")

    print("\n--- 路径 B / C：配对文件抽取 ---")
    sf = paired["source_files"]
    print(f"  含原卷版的配对组 : {paired['groups']}"
          f"（解析版 {sf['解析版']} / 答案版 {sf['答案版']}"
          f" / 评分细则 {sf['参考答案及评分细则']}）")
    print(f"  对齐成功 : {paired['matched']}"
          f"（按题干 {paired['match_stem']} + 按题号 {paired['match_number']}）")
    sk = paired["skipped"]
    print(f"  跳过 : 无答案数据 {sk['no_data']}，题干对不上 {sk['no_stem']}，"
          f"题干歧义 {sk['ambiguous_stem']}，题号对不上 {sk['no_number']}，"
          f"题号歧义 {sk['ambiguous_number']}，题号无佐证 {sk['no_corroboration']}")
    for ex in paired["examples"]:
        print(f"    例：原卷版题号 {ex['number']} ← {ex['from']} 答案 {ex['answer']!r}")

    before, after = result["before"], result["after"]
    if result["dry_run"]:
        print("\n--- 当前覆盖（dry-run 未改动）---")
        print(f"  有答案 {before['with_answer']} / {before['total']}，"
              f"有解析 {before['with_analysis']} / {before['total']}")
        print("  （dry-run 的「拆出」数量为按当前库计算的**预估新增**）")
    else:
        print("\n--- 前后对比 ---")
        print(f"  有答案 : {before['with_answer']} → {after['with_answer']}"
              f"（共 {after['total']} 题）")
        print(f"  有解析 : {before['with_analysis']} → {after['with_analysis']}")
        print(f"  按来源分布 : {after['by_source']}")


def _fmt_score(score) -> str:
    return "—" if score is None else f"{score:g}"


def cmd_paper(args) -> int:
    """``paper`` 子命令：组卷操作（建卷 / 加题 / 重排 / 设分 / 大题 / 导出数据）。"""
    conn = _db.connect(args.db)
    action = args.action

    try:
        if action == "new":
            paper = _paper.create_paper(
                conn, args.title, subject=args.subject, stage=args.stage, grade=args.grade,
                template=args.template, answer_mode=args.answer_mode, status=args.status)
            print(f"已新建试卷 #{paper['id']}：{paper['title']}")
            print(f"  学科={paper['subject']} 学段={paper['stage']} 年级={paper['grade']}"
                  f" 模板={paper['template']} 答案显示={paper['answer_mode']}"
                  f" 状态={paper['status']} 作者={paper['created_by']}")
            return 0

        if action == "list":
            rows = _paper.list_papers(conn, status=args.status, subject=args.subject)
            print(f"试卷 {len(rows)} 份：")
            for r in rows:
                print(f"  [id={r['id']}] {r['title']}  模板={r['template']}"
                      f" 答案={r['answer_mode']} 状态={r['status']}"
                      f"  题目={r['item_count']} 大题={r['section_count']}"
                      f" 总分={_fmt_score(r['total_score'])} 未设分={r['unscored_count']}")
            return 0

        if action == "show":
            paper = _paper.get_paper(conn, args.paper_id)
            if paper is None:
                print(f"未找到试卷 id={args.paper_id}")
                return 1
            _print_paper(paper)
            return 0

        if action == "add":
            res = _paper.add_questions(
                conn, args.paper_id, args.question_ids, section=args.section,
                position=args.position, score=args.score,
                keep_material_together=args.group)
            print(f"已加入 {res['count']} 道题到试卷 #{args.paper_id}"
                  + ("（已按材料/大题整组展开）" if res["expanded"] else ""))
            for a in res["added"]:
                print(f"  item={a['item_id']}  题#{a['question_id']}"
                      f"  v{a['question_version']}  seq={a['seq']}")
            return 0

        if action == "remove":
            res = _paper.remove_question(conn, args.paper_id, args.item_id)
            print(f"移除条目 {args.item_id}：{'成功' if res['removed'] else '失败（' + res.get('reason', '') + '）'}")
            return 0 if res["removed"] else 1

        if action == "move":
            res = _paper.move_question(conn, args.paper_id, args.item_id, args.new_position)
            if not res["moved"]:
                print(f"移动失败：{res.get('reason')}")
                return 1
            print(f"条目 {args.item_id} 已移动到第 {res['position']} 位")
            return 0

        if action == "score":
            res = _paper.set_score(conn, args.paper_id, args.item_id, args.score)
            if not res["updated"]:
                print(f"设分失败：{res.get('reason')}")
                return 1
            print(f"条目 {args.item_id} 分值 = {_fmt_score(res['score'])}")
            return 0

        if action == "delete":
            res = _paper.delete_paper(conn, args.paper_id, force=args.force)
            if not res["deleted"]:
                print(f"未删除：{res.get('reason')}")
                return 1
            print(f"已删除试卷 #{args.paper_id}（清理条目 {res.get('removed_items', 0)} 条）")
            return 0

        if action == "section":
            return _cmd_paper_section(conn, args)

        if action == "export-data":
            payload = _paper.build_export_payload(conn, args.paper_id,
                                                   answer_mode=args.answer_mode)
            text = json.dumps(payload, ensure_ascii=False, indent=2)
            if args.out:
                out_path = Path(args.out)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(text, encoding="utf-8")
                # 打印**真实字节数**（UTF-8 编码后的长度），而非字符数。
                n_bytes = out_path.stat().st_size
                print(f"已写出导出数据：{args.out}（{n_bytes:,} 字节，UTF-8）")
            else:
                print(text)
            return 0 if payload['diagnostics']['export_allowed'] else 3
    except ValueError as exc:
        print(f"参数错误：{exc}")
        return 2
    except OSError as exc:
        # F4：文件系统类错误（如输出父目录是文件）友好提示，不抛裸 traceback。
        print(f"文件操作失败：{exc}")
        return 1
    finally:
        conn.close()

    print(f"未知 paper 子命令：{action}")
    return 2


def cmd_export(args) -> int:
    """``export`` 子命令：把试卷导出为 DOCX/PDF，或做双客户端可编辑性验证。"""
    action = args.export_action
    if action == "verify":
        report = _export.verify_cross_client(args.docx, out=args.out)
        print(f"=== 双客户端可编辑性验证：{args.docx} ===")
        for key in ("word", "wps"):
            row = report.get("clients", {}).get(key, {})
            print(f"[{key}] 状态={row.get('status')} 公式数={row.get('maths')}"
                  f" 重开后公式数={row.get('reopened_maths')}"
                  f" 改字符保留={row.get('edit_persistence')}"
                  + (f" 错误={row.get('error')}" if row.get("error") else ""))
        if args.out:
            print(f"报告已写出：{args.out}")
        ok = all(report.get("clients", {}).get(k, {}).get("status") == "PASS"
                 for k in ("word", "wps"))
        return 0 if ok else 1

    if action != "paper":
        print(f"未知 export 子命令：{action}")
        return 2

    # 导出是**只读**流程：用只读连接打开库，保证不改动 bank.db（不触发 schema 迁移/写 meta）。
    try:
        conn = _db.connect_readonly(args.db)
    except FileNotFoundError as exc:
        print(f"导出失败：{exc}")
        return 1
    try:
        bridge = _export.EditorBridge(python=args.bridge_python)
        report = _export.export_paper_docx(
            conn, args.paper_id, args.out, answer_mode=args.answer_mode,
            template=args.template, bridge=bridge)
        print(f"=== 已导出试卷 #{report['paper_id']}：{report['title']} ===")
        print(f"模板 : {report['template']}   答案显示: {report['answer_mode']}")
        print(f"DOCX : {report['docx']}（{report['size_bytes']:,} 字节）")
        print(f"题目 : {report['question_count']} 道，大题 {report['section_count']} 个")
        print(f"公式 : 已写入 {report['formulas_written']} 个（payload 共 "
              f"{report['audit']['payload_formulas']} 个）")
        print(f"图片 : 已写入 {report['images_written']} 张（payload 共 "
              f"{report['audit']['payload_images']} 张，缺失 "
              f"{report['audit']['missing_images']} 张）")
        print(f"兼容修补 : 图片 graphicData {report['word_compat_fixes']} 处，"
              f"公式符号实体 {report['math_entity_fixes']} 处，"
              f"图片空段合并 {report['image_paragraph_merges']} 处")
        for w in report["warnings"]:
            print(f"  [警告] {w}")
        for w in report["bridge_warnings"]:
            print(f"  [桥接警告] {w}")
        for e in report["bridge_errors"]:
            print(f"  [桥接错误] {e}")

        if args.pdf:
            res = _export.export_pdf(report["docx"])
            if res.get("ok"):
                print(f"PDF  : {res['pdf']}（{res['size_bytes']:,} 字节，{res['client']}）")
            else:
                print(f"PDF  : 导出失败 - {res.get('error')}")
                return 1
        return 0
    except ValueError as exc:
        # F4：不存在的试卷 ID 等参数错误 -> 友好提示 + 非零退出码。
        print(f"导出失败：参数错误 - {exc}")
        return 2
    except OSError as exc:
        # F4：--out 父目录是文件 / 磁盘写入失败等 -> 友好提示 + 非零退出码。
        print(f"导出失败：文件写入错误 - {exc}")
        return 1
    except _content.ExportContentError as exc:
        print(f'内容阻断：{exc}')
        for issue in exc.diagnostics['issues']:
            print(f"  序号{issue['seq']} item{issue['item_id']} qid{issue['question_id']} v{issue['question_version']}：{issue['message']}；{issue['suggested_action']}")
        return 3
    except _export.ExportError as exc:
        print(f"导出失败：{exc}")
        return 1
    except sqlite3.OperationalError as exc:
        # 只读连接上发生写操作（通常意味着库尚未迁移到阶段3 schema）。
        print(f"导出失败（只读连接）：{exc}")
        print("提示：请先运行 `bank.cli init` / `bank.cli import` 把库迁移到最新 schema。")
        return 1
    finally:
        conn.close()


def _cmd_paper_section(conn, args) -> int:
    """``paper section`` 子命令分发。"""
    sub = args.section_action
    if sub == "add":
        sec = _paper.add_section(conn, args.paper_id, args.name,
                                 description=args.description, position=args.position)
        print(f"已新增大题 #{sec['id']}：{sec['name']}（seq={sec['seq']}）")
        return 0
    if sub == "rename":
        sec = _paper.rename_section(conn, args.paper_id, args.section_id, args.name)
        print(f"大题 #{sec['id']} 已更名为：{sec['name']}")
        return 0
    if sub == "move":
        res = _paper.move_section(conn, args.paper_id, args.section_id, args.new_position)
        print(f"大题 {args.section_id} 已移动到第 {res['position']} 位（题目块已重排）")
        return 0
    if sub == "delete":
        res = _paper.delete_section(conn, args.paper_id, args.section_id, force=args.force)
        if not res["deleted"]:
            print(f"未删除：{res.get('reason')}")
            return 1
        print(f"已删除大题 {args.section_id}（{res.get('ungrouped', 0)} 道题变为未分组）")
        return 0
    print(f"未知 section 子命令：{sub}")
    return 2


def _print_paper(paper: dict) -> None:
    """打印试卷详情（含题目列表、题序、分值、总分、大题小计）。"""
    s = paper["summary"]
    print(f"=== 试卷 #{paper['id']}：{paper['title']} ===")
    print(f"学科 : {paper['subject']}   学段: {paper['stage']}   年级: {paper['grade']}")
    print(f"模板 : {paper['template']}   答案显示: {paper['answer_mode']}"
          f"   状态: {paper['status']}")
    print(f"作者 : {paper['created_by']}   创建: {paper['created_at']}"
          f"   更新: {paper['updated_at']}")
    print(f"题目 : {s['item_count']} 道   大题: {s['section_count']} 个"
          f"   总分: {_fmt_score(s['total_score'])}"
          f"（已设分 {s['scored_count']} 道，未设分 {s['unscored_count']} 道）")
    items = paper["items"]
    if not items:
        print("（暂无题目）")
        return
    by_section: dict = {}
    for it in items:
        by_section.setdefault(it["section_id"], []).append(it)
    for sec in paper["sections"]:
        print(f"--- {sec['name']}（{sec['item_count']} 道，小计 {_fmt_score(sec['subtotal'])} 分）---")
        for it in by_section.get(sec["id"], []):
            _print_item(it)
    ungrouped = by_section.get(None, [])
    if ungrouped:
        print(f"--- {_paper.UNGROUPED}（{len(ungrouped)} 道）---")
        for it in ungrouped:
            _print_item(it)
    if s["qtype_distribution"]:
        print("题型分布：" + "  ".join(f"{k}={v}" for k, v in s["qtype_distribution"].items()))


def _print_item(it: dict) -> None:
    print(f"  seq {it['seq']:>3}  [item={it['id']}] 题#{it['question_id']}"
          f"  v{it['question_version']}  {it['qtype'] or '未分类'}"
          f"  分值 {_fmt_score(it['score'])}  字符 {it['char_length']}"
          f"  式{it['formula_count']}/图{it['image_count']}")
    src = it["snapshot"].get("source", {})
    print(f"           来源：{it['source_file'] or '-'}"
          f"  段落 {src.get('start_paragraph')}~{src.get('end_paragraph')}")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="bank.cli", description="私有题库：导入 / 检索 / 统计")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="建库（建表建索引）")
    _add_db_arg(p)
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("import", help="导入阶段1 的 JSON（文件或目录）")
    p.add_argument("path", help="questions.json 文件或目录")
    p.add_argument("--keep-numeric-junk", action="store_true",
                   help="保留被误切为题目纯数值行（默认跳过）")
    p.add_argument("--quiet", action="store_true")
    _add_db_arg(p)
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("stats", help="统计")
    _add_db_arg(p)
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("search", help="检索题目")
    p.add_argument("keyword", nargs="?", default=None, help="中文关键词")
    p.add_argument("--stage"); p.add_argument("--subject"); p.add_argument("--grade")
    p.add_argument("--textbook"); p.add_argument("--chapter"); p.add_argument("--qtype")
    p.add_argument("--difficulty")
    p.add_argument("--label", action="append", help="标签名（可重复）")
    p.add_argument("--review", action="store_true", help="只看含待复核公式的题目")
    p.add_argument("--kp-confirmed-only", action="store_true",
                   help="严格模式：只命中「已确认」的知识点标签（默认未复核标签也可命中）")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--offset", type=int, default=0)
    _add_db_arg(p)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("show", help="查看某题完整信息")
    p.add_argument("id", type=int)
    _add_db_arg(p)
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("review", help="待复核队列")
    p.add_argument("--resolved", action="store_true", help="显示已处理的")
    p.add_argument("--status", default=None, help="按公式状态过滤（如 FAIL）")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--offset", type=int, default=0)
    _add_db_arg(p)
    p.set_defaults(func=cmd_review)

    p = sub.add_parser("labels", help="列出标签 / 知识点人工复核")
    p.add_argument("action", nargs="?", default=None,
                   choices=["review-list", "confirm", "reject", "export-review", "import-review"],
                   help="默认（省略）列出标签；否则走知识点复核工作流")
    p.add_argument("csv", nargs="?", default=None, help="import-review 的 CSV 路径")
    p.add_argument("--namespace", default=None,
                   help="命名空间（默认：列标签时全部；复核时 知识点）")
    p.add_argument("--limit", type=int, default=100, help="列出条数上限")
    p.add_argument("--status", default=None,
                   help="review-list/export-review 的复核状态（待复核/已确认/已否决）")
    p.add_argument("--label", default=None, help="confirm/reject 的标签名")
    p.add_argument("--question", type=int, default=None,
                   help="confirm/reject 的题目 id（省略则批量作用于该标签全部待复核关联）")
    p.add_argument("--out", default=None, help="export-review 输出 CSV 路径")
    p.add_argument("--force", action="store_true",
                   help="覆盖已有决定（默认只处理「待复核」，绝不改动已确认/已否决）")
    _add_db_arg(p)
    p.set_defaults(func=cmd_labels)

    p = sub.add_parser("sources", help="列出来源文件")
    p.add_argument("--limit", type=int, default=0)
    _add_db_arg(p)
    p.set_defaults(func=cmd_sources)

    p = sub.add_parser("enrich", help="补全题目元数据（保守推断 + 来源留痕）")
    p.add_argument("--dry-run", action="store_true", help="只统计不写库")
    _add_db_arg(p)
    p.set_defaults(func=cmd_enrich)

    p = sub.add_parser("normalize", help="规范化库内 LaTeX（还原 [U+XXXX] 转义、去掉 $ 定界符）")
    p.add_argument("--dry-run", action="store_true", help="只统计不写库")
    p.add_argument("--no-snapshots", action="store_true",
                   help="只规范化 formulas.latex，不动试卷快照")
    p.add_argument("--no-backup", action="store_true", help="跳过自动备份（不推荐）")
    _add_db_arg(p)
    p.set_defaults(func=cmd_normalize)

    _add_answers_subparser(sub)
    _add_paper_subparser(sub)
    _add_export_subparser(sub)
    return ap


def _add_answers_subparser(sub) -> None:
    """注册 ``answers`` 及其子命令。"""
    p = sub.add_parser("answers", help="抽取答案 / 解析（内联拆分 + 配对文件）")
    asub = p.add_subparsers(dest="answers_action", required=True)

    ep = asub.add_parser("extract", help="执行答案/解析抽取（路径 A + 路径 B/C）")
    ep.add_argument("--dry-run", action="store_true", help="只统计不写库")
    ep.add_argument("--refresh-snapshots", action="store_true",
                    help="写库后同步刷新已建试卷的快照，使旧卷也能带上答案（需配 --refresh-paper 或 --refresh-all）")
    ep.add_argument("--refresh-paper", type=int, action="append", default=None,
                    help="刷新指定试卷的快照（可重复；与 --refresh-snapshots 配合）")
    ep.add_argument("--refresh-all", action="store_true",
                    help="显式刷新**全部试卷**的快照（影响全库，慎用）")
    _add_db_arg(ep)
    ep.set_defaults(func=cmd_answers)


def _add_paper_subparser(sub) -> None:
    """注册 ``paper`` 及其嵌套子命令。"""
    p = sub.add_parser("paper", help="组卷：建卷 / 加题 / 重排 / 设分 / 大题 / 导出数据")
    psub = p.add_subparsers(dest="action", required=True)

    # paper new
    np = psub.add_parser("new", help="新建试卷")
    np.add_argument("--title", required=True)
    np.add_argument("--subject", default=None)
    np.add_argument("--stage", default=None)
    np.add_argument("--grade", default=None)
    np.add_argument("--template", default=_paper.DEFAULT_TEMPLATE,
                    choices=list(_paper.TEMPLATES))
    np.add_argument("--answer-mode", default=_paper.DEFAULT_ANSWER_MODE,
                    choices=list(_paper.ANSWER_MODES))
    np.add_argument("--status", default=_paper.DEFAULT_STATUS,
                    choices=list(_paper.PAPER_STATUSES))
    _add_db_arg(np)
    np.set_defaults(func=cmd_paper)

    # paper list
    lp = psub.add_parser("list", help="列出试卷")
    lp.add_argument("--status", default=None)
    lp.add_argument("--subject", default=None)
    _add_db_arg(lp)
    lp.set_defaults(func=cmd_paper)

    # paper show
    sp = psub.add_parser("show", help="查看试卷详情")
    sp.add_argument("paper_id", type=int)
    _add_db_arg(sp)
    sp.set_defaults(func=cmd_paper)

    # paper add
    ap_ = psub.add_parser("add", help="加入题目（可指定大题与位置）")
    ap_.add_argument("paper_id", type=int)
    ap_.add_argument("question_ids", type=int, nargs="+", help="题目 id（可多个）")
    ap_.add_argument("--section", default=None,
                     help="大题：id 或名称（名称不存在时自动创建）")
    ap_.add_argument("--position", type=int, default=None, help="插入的全卷题序（1 起）")
    ap_.add_argument("--score", type=float, default=None, help="统一分值（省略=未设分值）")
    ap_.add_argument("--group", action="store_true",
                     help="按「材料/大题」整组加入并保持相邻")
    _add_db_arg(ap_)
    ap_.set_defaults(func=cmd_paper)

    # paper remove
    rp = psub.add_parser("remove", help="移除题目条目")
    rp.add_argument("paper_id", type=int)
    rp.add_argument("item_id", type=int)
    _add_db_arg(rp)
    rp.set_defaults(func=cmd_paper)

    # paper move
    mp = psub.add_parser("move", help="移动题目条目")
    mp.add_argument("paper_id", type=int)
    mp.add_argument("item_id", type=int)
    mp.add_argument("new_position", type=int)
    _add_db_arg(mp)
    mp.set_defaults(func=cmd_paper)

    # paper score
    scp = psub.add_parser("score", help="设置题目分值")
    scp.add_argument("paper_id", type=int)
    scp.add_argument("item_id", type=int)
    scp.add_argument("score", type=float)
    _add_db_arg(scp)
    scp.set_defaults(func=cmd_paper)

    # paper delete
    dp = psub.add_parser("delete", help="删除试卷（破坏性）")
    dp.add_argument("paper_id", type=int)
    dp.add_argument("--force", action="store_true", help="确认删除（试卷非空时必需）")
    _add_db_arg(dp)
    dp.set_defaults(func=cmd_paper)

    # paper export-data
    ep = psub.add_parser("export-data", help="产出导出结构化数据（JSON，供阶段4）")
    ep.add_argument("paper_id", type=int)
    ep.add_argument("--answer-mode", default=None, choices=list(_paper.ANSWER_MODES))
    ep.add_argument("--out", default=None, help="输出 JSON 路径（省略则打印到标准输出）")
    _add_db_arg(ep)
    ep.set_defaults(func=cmd_paper)

    # paper section ...
    sec = psub.add_parser("section", help="大题分组管理")
    ssub = sec.add_subparsers(dest="section_action", required=True)

    sa = ssub.add_parser("add", help="新增大题")
    sa.add_argument("paper_id", type=int)
    sa.add_argument("name")
    sa.add_argument("--position", type=int, default=None)
    sa.add_argument("--description", default=None)
    _add_db_arg(sa)
    sa.set_defaults(func=cmd_paper)

    sr = ssub.add_parser("rename", help="重命名大题")
    sr.add_argument("paper_id", type=int)
    sr.add_argument("section_id", type=int)
    sr.add_argument("name")
    _add_db_arg(sr)
    sr.set_defaults(func=cmd_paper)

    sm = ssub.add_parser("move", help="移动大题（题目块随之重排）")
    sm.add_argument("paper_id", type=int)
    sm.add_argument("section_id", type=int)
    sm.add_argument("new_position", type=int)
    _add_db_arg(sm)
    sm.set_defaults(func=cmd_paper)

    sd = ssub.add_parser("delete", help="删除大题（破坏性）")
    sd.add_argument("paper_id", type=int)
    sd.add_argument("section_id", type=int)
    sd.add_argument("--force", action="store_true", help="确认删除（大题非空时必需）")
    _add_db_arg(sd)
    sd.set_defaults(func=cmd_paper)


def _add_export_subparser(sub) -> None:
    """注册 ``export`` 及其子命令（阶段4：试卷导出）。"""
    p = sub.add_parser("export", help="导出试卷 DOCX/PDF（原生 OMML 公式）")
    esub = p.add_subparsers(dest="export_action", required=True)

    pp = esub.add_parser("paper", help="导出指定试卷为 DOCX（可同时导出 PDF）")
    pp.add_argument("paper_id", type=int)
    pp.add_argument("--answer-mode", default=None, choices=list(_paper.ANSWER_MODES),
                    help="答案显示方式（省略则用试卷自身设置）")
    pp.add_argument("--out", required=True, help="输出 .docx 路径")
    pp.add_argument("--pdf", action="store_true", help="同时导出 PDF（供打印对照）")
    pp.add_argument("--template", default=None, choices=list(_paper.TEMPLATES),
                    help="覆盖模板（考试/测验/作业；省略则用试卷自身设置）")
    pp.add_argument("--bridge-python", default=None,
                    help="桥接脚本使用的解释器（默认自动探测）")
    _add_db_arg(pp)
    pp.set_defaults(func=cmd_export)

    vp = esub.add_parser("verify", help="Word/WPS 双客户端公式可编辑性验证")
    vp.add_argument("docx", help="待验证的 .docx 路径")
    vp.add_argument("--out", default=None, help="验证报告 JSON 输出路径")
    vp.set_defaults(func=cmd_export)


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
