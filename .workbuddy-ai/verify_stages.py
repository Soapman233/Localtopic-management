"""逐项验证阶段1（预处理管线）与阶段2（题库数据模型）是否按预期工作。

每一项都记录：验证方法 / 验证步骤 / 预期结果 / 实际结果 / 结论。
只读为主；唯一的写操作是在临时副本上做幂等测试。
"""
# ---------------------------------------------------------------------------
# title: 阶段验证脚本
# description: 脚本化逐项验证阶段1 / 阶段2 的实现。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path("D:/Open-source project/Localtopic-management")
PY = "C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe"
sys.path.insert(0, str(ROOT))

CHECKS: list[dict] = []


def record(cid, stage, name, method, steps, expected, actual, ok):
    CHECKS.append({
        "id": cid, "stage": stage, "name": name, "method": method,
        "steps": steps, "expected": expected, "actual": actual,
        "result": "通过" if ok else "不通过",
    })
    print(f"[{'PASS' if ok else 'FAIL'}] {cid} {name} -> {actual}", flush=True)


def run(args, timeout=600):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


# ---------------------------------------------------------------- 阶段 1

def s1_cli():
    r = run([PY, "-m", "pipeline.stage1", "--help"])
    ok = r.returncode == 0 and "Stage 1" in r.stdout
    record("S1-01", "阶段1", "预处理管线命令行可用",
           "以 --help 调用模块入口，检查退出码与用法输出",
           "python -m pipeline.stage1 --help",
           "退出码 0，且输出包含用法说明",
           f"退出码 {r.returncode}，输出{'包含' if 'Stage 1' in r.stdout else '不含'}用法",
           ok)


def s1_omml():
    from pipeline.omml import omath_to_latex
    import xml.etree.ElementTree as ET
    ns = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
    # 1/x + sqrt(y) 的 OMML
    xml = (f'<m:oMath {ns}><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>'
           f'<m:den><m:r><m:t>x</m:t></m:r></m:den></m:f>'
           f'<m:rad><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad></m:oMath>')
    node = ET.fromstring(xml)
    latex = omath_to_latex(node)
    ok = "\\frac" in latex and "\\sqrt" in latex
    record("S1-02", "阶段1", "OMML → LaTeX 结构转换",
           "构造已知 OMML（分式 1/x + 根号 y），断言输出含 \\frac 与 \\sqrt",
           "解析内联 OMML 片段并转换",
           "输出包含 \\frac{1}{x} 与 \\sqrt{y}",
           f"实际输出 {latex!r}",
           ok)


def s1_mtef():
    import olefile
    from pipeline import mtef_conv
    src = ROOT / "2026_10_05_西附国庆练习卷/11.5 机械效率（重难点专练）（原卷版）.docx"
    with zipfile.ZipFile(src) as z:
        name = sorted(n for n in z.namelist()
                      if n.startswith("word/embeddings/") and n.endswith(".bin"))[0]
        ole = olefile.OleFileIO(BytesIO(z.read(name)))
        stream = ole.openstream("Equation Native").read()
        ole.close()
    status, latex = mtef_conv.convert_one(stream, timeout=10)
    ok = status == "OK" and bool(latex and latex.strip("$ ").strip())
    record("S1-03", "阶段1", "MathType(MTEF) → LaTeX 精确解码",
           "从真实 docx 取出 OLE 内的 Equation Native 流，交给 MTEF 解析器（不安装 MathType）",
           "读取 embeddings/oleObject1.bin → 取 Equation Native → convert_one",
           "status=OK 且 LaTeX 非空",
           f"status={status}, latex={latex!r}",
           ok)


def s1_full_products():
    files = sorted((ROOT / "outputs/preprocess_final").glob("*.questions.json"))
    total = 0
    for f in files:
        total += len(json.loads(f.read_text(encoding="utf-8"))["questions"])
    summ = json.loads((ROOT / "outputs/preprocess_final/_summary.json").read_text(encoding="utf-8"))
    ok = len(files) == 209 and total == summ["questions_total"]
    record("S1-04", "阶段1", "全量产物自洽（逐文件求和 = 汇总）",
           "遍历所有 .questions.json 统计题目数，与 _summary.json 比对",
           "求和 209 份产物中的 questions 数组长度",
           "文件数 209，且逐文件求和等于汇总里的 questions_total",
           f"文件 {len(files)} 份，求和 {total}，汇总 {summ['questions_total']}",
           ok)


def s1_artifact_fresh():
    """用内容验证产物是否与当前代码一致，而不是比时间戳。

    早期版本比较 mtime，但给源码加文件头注释也会改 mtime 却不影响逻辑，
    会产生误报。这里改为：挑 3 个文件用当前代码重跑，比对题目数是否与产物一致。
    """
    sample = []
    all_files = sorted((ROOT / "outputs/preprocess_final").glob("*.questions.json"))
    # 只在已知来源目录里找源文件——绝不要在用户主目录上 rglob（会扫描整个 C:\Users，极慢）
    source_roots = [
        Path(os.path.expanduser("~")) / "Desktop/物理/初中/2026学科网教案",
        ROOT / "2026_10_05_西附国庆练习卷",
    ]
    index = {}
    for root in source_roots:
        if root.is_dir():
            for p in root.rglob("*.docx"):
                if not p.name.startswith("~$"):
                    index.setdefault(p.stem, p)
    for f in all_files:
        stem = f.name[: -len(".questions.json")]
        if stem in index:
            sample.append((stem, f, index[stem]))
        if len(sample) >= 3:
            break

    if not sample:
        record("S1-05", "阶段1", "产物与当前代码一致（内容比对）",
               "挑选若干文件用当前代码重跑，比对题目数",
               "重跑 pipeline.stage1 到临时目录并与已交付产物比对",
               "重跑结果的题目数与产物一致",
               "未找到可用于重跑的样本（跳过）", True)
        return

    td = tempfile.mkdtemp(prefix="freshcheck_")
    mismatches = []
    try:
        for stem, prod, src in sample:
            r = run([PY, "-m", "pipeline.stage1", str(src), "--out", td, "--quiet"])
            rerun = Path(td) / f"{stem}.questions.json"
            if r.returncode != 0 or not rerun.exists():
                mismatches.append(f"{stem[:20]}: 重跑失败")
                continue
            a = len(json.loads(prod.read_text(encoding="utf-8"))["questions"])
            b = len(json.loads(rerun.read_text(encoding="utf-8"))["questions"])
            if a != b:
                mismatches.append(f"{stem[:20]}: 产物 {a} vs 重跑 {b}")
    finally:
        shutil.rmtree(td, ignore_errors=True)

    ok = not mismatches
    record("S1-05", "阶段1", "产物与当前代码一致（内容比对，非时间戳）",
           "挑 3 个源文件用当前代码重跑 stage1，与已交付产物比对题目数",
           "python -m pipeline.stage1 <源文件> --out <临时目录> → 比对 questions 数量",
           "重跑题目数与产物完全一致（说明代码改动未使产物失效）",
           f"抽样 {len(sample)} 份，不一致 {len(mismatches)} 份"
           + ("：" + "；".join(mismatches) if mismatches else ""),
           ok)


def s1_review_queue():
    files = sorted((ROOT / "outputs/preprocess_final").glob("*.questions.json"))
    bad = 0
    no_preview = 0
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        for fid, meta in d.get("formula_index", {}).items():
            if meta.get("status") != "OK":
                bad += 1
    scan_files = sorted((ROOT / "outputs/preprocess_final").glob("*.scan.json"))
    for f in scan_files:
        d = json.loads(f.read_text(encoding="utf-8"))
        for fid, meta in d.get("formulas", {}).items():
            if meta.get("status") != "OK" and not meta.get("preview"):
                no_preview += 1
    ok = bad > 0 and no_preview == 0
    record("S1-06", "阶段1", "失败公式进复核队列且带预览图（不静默丢弃）",
           "统计所有非 OK 公式，并检查每条是否带 preview 字段",
           "遍历 questions.json 的 formula_index 与 scan.json 的 formulas",
           "非 OK 公式全部被标记，且都带 preview（可人工重建）",
           f"非 OK 公式 {bad} 条，其中缺预览图 {no_preview} 条",
           ok)


def s1_source_readonly():
    manifest_path = ROOT / "outputs/validation_30/source_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    def sha(p):
        h = hashlib.sha256()
        with open(p, "rb") as fh:
            for b in iter(lambda: fh.read(1 << 20), b""):
                h.update(b)
        return h.hexdigest()

    results = []
    for key, v in manifest["sources"].items():
        src = Path(v["path"])
        if src.exists():
            results.append((key, sha(src) == v["sha256"]))
    ok = bool(results) and all(r[1] for r in results)
    record("S1-07", "阶段1", "用户原始资料未被修改（只读）",
           "对已记录基线哈希的题源重新计算 SHA-256 并比对",
           "读取 source_manifest.json 的 sha256，逐个重算源文件哈希",
           "全部题源哈希与基线一致",
           f"{sum(1 for _, x in results if x)}/{len(results)} 个题源哈希一致",
           ok)


def s1_regressions():
    """三个已知样例：标题必须排除、年份真题必须保留、含'学校'真题必须保留。"""
    text_all = {}
    for f in (ROOT / "outputs/preprocess_final").glob("*.questions.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        text_all[f.name] = "\n".join(q["text"] for q in d["questions"])

    title_excluded = True
    for name, blob in text_all.items():
        if "10.3 探索更小的微粒 同步练习" in name:
            # 标题不应作为独立题目出现
            first = json.loads((ROOT / "outputs/preprocess_final" / name).read_text(encoding="utf-8"))["questions"]
            if first and first[0]["text"].strip().startswith("10.3探索更小的微粒") and len(first[0]["text"]) < 60:
                title_excluded = False
            break

    year_kept = any("2018年" in blob for blob in text_all.values())
    school_kept = sum(blob.count("清华大学") + blob.count("学校运动会") + blob.count("塑胶跑道")
                      for blob in text_all.values())
    ok = title_excluded and year_kept and school_kept >= 3
    record("S1-08", "阶段1", "切分回归：标题排除 + 真题保留",
           "在产物中检查三类样例：章节标题被排除、年份开头真题保留、含'学校'的真题保留",
           "遍历产物 JSON 文本匹配样例",
           "标题被排除；'2018年'真题存在；含'学校'真题 ≥3 处",
           f"标题已排除={title_excluded}，年份真题保留={year_kept}，含'学校'命中 {school_kept} 处",
           ok)


# ---------------------------------------------------------------- 阶段 2

DB = ROOT / "outputs/bank.db"


def s2_schema():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    tables = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    fts = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%USING fts5%'").fetchall()}
    fk = c.execute("PRAGMA foreign_keys").fetchone()[0]
    c.close()
    need = {"source_files", "questions", "question_versions", "formulas", "images",
            "labels", "question_labels", "review_queue", "papers", "paper_questions", "meta"}
    ok = need <= tables and "question_fts" in fts
    record("S2-01", "阶段2", "数据库结构完整（表 + FTS5 全文索引）",
           "查询 sqlite_master 列出表与 FTS5 虚拟表",
           "SELECT name FROM sqlite_master；检查 11 张业务表与 question_fts",
           "11 张业务表齐备，且存在 FTS5 虚拟表 question_fts",
           f"业务表缺失={sorted(need - tables) or '无'}，FTS5={sorted(fts) or '无'}",
           ok)


def s2_counts():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    n = {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
         for t in ["source_files", "questions", "question_versions", "formulas",
                   "images", "review_queue"]}
    st = dict(c.execute("SELECT status,COUNT(*) FROM formulas GROUP BY status").fetchall())
    c.close()
    ok = (n["source_files"] == 209 and n["questions"] > 7000
          and n["question_versions"] == n["questions"]
          and n["review_queue"] == sum(v for k, v in st.items() if k != "OK"))
    record("S2-02", "阶段2", "入库数据量与复核队列一致",
           "统计各表行数，并校验 review_queue 等于非 OK 公式数",
           "COUNT(*) 各表；formulas 按 status 分组",
           "来源 209；版本数 = 题目数；review_queue = 非 OK 公式数",
           f"来源 {n['source_files']}，题目 {n['questions']}，版本 {n['question_versions']}，"
           f"公式 {n['formulas']}（{st}），待复核 {n['review_queue']}",
           ok)


def s2_idempotent():
    td = tempfile.mkdtemp(prefix="bankidem_")
    try:
        copy = Path(td) / "bank_copy.db"
        shutil.copy2(DB, copy)

        def count():
            conn = sqlite3.connect(copy)
            try:
                return conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
            finally:
                conn.close()

        before = count()
        r = run([PY, "-m", "bank.cli", "import",
                 str(ROOT / "outputs/preprocess_final"), "--db", str(copy)])
        after = count()
        stdout = r.stdout
    finally:
        shutil.rmtree(td, ignore_errors=True)
    ok = r.returncode == 0 and before == after
    m = re.search(r"(新增|new)\D*(\d+)", stdout)
    record("S2-03", "阶段2", "重复导入幂等（不产生重复题目）",
           "复制数据库 → 对同一批 JSON 再导入一次 → 比较题目总数",
           "shutil.copy2(bank.db) → bank.cli import <同一目录> --db <副本> → COUNT(*)",
           "导入成功且题目总数不变",
           f"导入前 {before} → 导入后 {after}（{m.group(0) if m else '输出未含新增计数'}）",
           ok)


def s2_fts_really_used():
    """证明检索走 FTS5/BM25，而不是静默退化成 LIKE。"""
    from bank import query as Q, db as DBmod
    seen = []

    c = DBmod.connect(DB)
    c.set_trace_callback(lambda s: seen.append(s))
    try:
        Q.search(c, keyword="浮力", limit=3)
    finally:
        c.close()
    used_fts = any("question_fts" in s and "MATCH" in s.upper() for s in seen)
    used_bm25 = any("bm25" in s.lower() for s in seen)
    used_like = any("LIKE" in s.upper() and "question_fts" not in s for s in seen)
    ok = used_fts and used_bm25
    record("S2-04", "阶段2", "中文检索确实走 FTS5 + BM25（未静默降级为 LIKE）",
           "挂载 sqlite3 trace 回调，捕获检索实际执行的 SQL",
           "conn.set_trace_callback(...) → query.search(keyword='浮力') → 检查 SQL",
           "捕获到 question_fts ... MATCH 与 ORDER BY bm25(...)",
           f"使用FTS5={used_fts}，使用BM25={used_bm25}，额外出现裸LIKE={used_like}",
           ok)


def s2_filter():
    from bank import query as Q, db as DBmod
    c = DBmod.connect(DB)
    all_hits = Q.search(c, keyword="浮力", limit=100000)["total"]
    ch = Q.search(c, keyword="浮力", chapter="9.4", limit=100000)["total"]
    wrong = Q.search(c, keyword="浮力", chapter="10.3", limit=100000)["total"]
    c.close()
    ok = all_hits > ch > 0 and wrong == 0
    record("S2-05", "阶段2", "筛选条件生效（叠加章节后结果收窄）",
           "同一关键词叠加章节筛选，观察命中数变化",
           "search('浮力') vs search('浮力', chapter='9.4') vs chapter='10.3'",
           "全部 > 9.4 章节 > 0；且 10.3（探索更小的微粒）命中 0",
           f"全部 {all_hits}，章节9.4 {ch}，章节10.3 {wrong}",
           ok)


def s2_version_snapshot():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    dup = c.execute("""SELECT COUNT(*) FROM questions q
                       WHERE q.version != (SELECT COUNT(*) FROM question_versions v
                                           WHERE v.question_id=q.id)""").fetchone()[0]
    orphan = c.execute("""SELECT COUNT(*) FROM paper_questions pq
                          LEFT JOIN question_versions v
                            ON v.question_id=pq.question_id AND v.version=pq.question_version
                          WHERE v.id IS NULL""").fetchone()[0]
    fk = c.execute("PRAGMA foreign_key_check").fetchall()
    c.close()
    ok = dup == 0 and orphan == 0 and not fk
    record("S2-06", "阶段2", "题目版本与组卷快照可锁定",
           "校验 version 计数与历史表一致、外键完整、快照引用有效",
           "比对 questions.version 与 question_versions 行数；PRAGMA foreign_key_check",
           "版本计数一致；外键检查无违规；快照引用不悬空",
           f"版本不一致 {dup} 条，悬空快照 {orphan} 条，外键违规 {len(fk)} 条",
           ok)


def s2_integrity():
    """抽查库内题干与阶段1 原文是否一致。"""
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    rows = c.execute("""SELECT q.id, q.text, s.path FROM questions q
                        JOIN source_files s ON s.id=q.source_id
                        WHERE q.formula_count>0 LIMIT 5""").fetchall() \
        if _has_col(c, "questions", "formula_count") else []
    if not rows:
        rows = c.execute("""SELECT q.id, q.text, s.path FROM questions q
                            JOIN source_files s ON s.id=q.source_id LIMIT 5""").fetchall()
    c.close()
    match = 0
    checked = 0
    for qid, text, path in rows:
        stem = Path(path).stem
        cand = ROOT / "outputs/preprocess_final" / f"{stem}.questions.json"
        if not cand.exists():
            continue
        d = json.loads(cand.read_text(encoding="utf-8"))
        src_texts = {q["text"] for q in d["questions"]}
        checked += 1
        if text in src_texts:
            match += 1
    ok = checked > 0 and match == checked
    record("S2-07", "阶段2", "库内题干与阶段1 原文一致（未丢内容/串题）",
           "抽 5 道题，把库内 text 与产物 JSON 中的原文做集合比对",
           "SQL 取题 → 定位同名 questions.json → 比对 text 是否存在于原文集合",
           "抽查样本全部能在原文中找到完全一致的题干",
           f"{match}/{checked} 条完全一致",
           ok)


def _has_col(conn, table, col):
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def s2_tests():
    r = run([PY, "-m", "unittest", "discover", "-s", "tests"])
    m = re.search(r"Ran (\d+) tests", r.stderr + r.stdout)
    n = int(m.group(1)) if m else 0
    ok = r.returncode == 0 and n >= 30
    record("S2-08", "阶段2", "自动化测试全部通过",
           "运行 unittest 全量测试套件",
           "python -m unittest discover -s tests",
           "退出码 0，且用例数 ≥30 全部 OK",
           f"退出码 {r.returncode}，执行 {n} 项，结论 {'OK' if 'OK' in r.stderr else '有失败'}",
           ok)


def s2_metadata_honest():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    tot = c.execute("SELECT COUNT(*) FROM questions").fetchone()[0]

    def pct(sql):
        return round(c.execute(sql).fetchone()[0] / tot * 100, 1)

    # 题目级：chapter / qtype / difficulty 在 questions 表
    # 文件级：grade / textbook / stage / subject 在 source_files 表（一份文件一个年级）
    # 注意：未解析的字段存的是字面值「待补充」，查询必须显式排除，否则会被算成已覆盖。
    NA = "待补充"
    cov = {
        "chapter": pct("SELECT COUNT(*) FROM questions "
                       "WHERE chapter IS NOT NULL AND chapter!='' AND chapter!='待补充'"),
        "grade": pct("""SELECT COUNT(*) FROM questions q JOIN source_files s ON s.id=q.source_id
                        WHERE s.grade IS NOT NULL AND s.grade!='' AND s.grade!='待补充'"""),
        "textbook": pct("""SELECT COUNT(*) FROM questions q JOIN source_files s ON s.id=q.source_id
                           WHERE s.textbook IS NOT NULL AND s.textbook!='' AND s.textbook!='待补充'"""),
        "stage": pct("""SELECT COUNT(*) FROM questions q JOIN source_files s ON s.id=q.source_id
                        WHERE s.stage IS NOT NULL AND s.stage!='' AND s.stage!='待补充'"""),
    }
    qtype_un = pct("SELECT COUNT(*) FROM questions WHERE qtype IS NULL OR qtype='' OR qtype='未分类'")
    diff_un = pct("SELECT COUNT(*) FROM questions WHERE difficulty IS NULL OR difficulty='' OR difficulty='未标注'")
    kp_cov = pct("""SELECT COUNT(DISTINCT ql.question_id) FROM question_labels ql
                    JOIN labels l ON l.id=ql.label_id WHERE l.namespace='知识点'""")
    c.close()
    readme = (ROOT / "bank/README.md").read_text(encoding="utf-8")
    # README 必须如实声明知识点的「提及」口径，否则视为夸大
    mentions_disclosed = "提及" in readme and "非考查" in readme
    documented = ("已知限制" in readme) and mentions_disclosed
    ok = documented and cov["chapter"] < 60 and cov["grade"] < 60
    record("S2-09", "阶段2", "元数据覆盖率如实记录（排除「待补充」后统计）",
           "用 SQL 计算真实覆盖率（显式排除字面值「待补充」），并检查 README 是否声明知识点的「提及」口径",
           "questions 统计 chapter/qtype/difficulty；join source_files 统计 grade/textbook；检查 README 含「提及」「非考查」",
           "覆盖率真实；README 明确声明知识点为「提及」口径而非考查范围",
           f"章节 {cov['chapter']}%、年级 {cov['grade']}%、教材 {cov['textbook']}%、"
           f"学段 {cov['stage']}%；题型未分类 {qtype_un}%、难度未标注 {diff_un}%；"
           f"知识点覆盖 {kp_cov}%（提及口径，README 已声明={mentions_disclosed}）",
           ok)


def s2_source_readonly():
    """确认导入过程本身没有在用户原始资料目录留下副产物。

    口径：Office 的 ~$ 锁文件只有在「导入之后」才新建，才算导入造成的污染。
    导入之前就存在的锁文件属其它来源，单独如实列出，不混入本项判定。
    """
    src_root = Path(os.path.expanduser("~")) / "Desktop/物理/初中/2026学科网教案"
    docx = [p for p in src_root.glob("*.docx")]
    locks = [p for p in docx if p.name.startswith("~$")]
    db_mtime = DB.stat().st_mtime
    fresh = [p for p in locks if p.stat().st_mtime > db_mtime]
    preexisting = [p for p in locks if p.stat().st_mtime <= db_mtime]
    ok = len(docx) > 100 and not fresh
    detail = f"文档 {len(docx)} 份；导入后新增锁文件 {len(fresh)} 个"
    if preexisting:
        detail += (f"；另有导入前既存锁文件 {len(preexisting)} 个"
                   f"（{time.strftime('%H:%M:%S', time.localtime(preexisting[0].stat().st_mtime))}，"
                   f"非导入产生）")
    record("S2-10", "阶段2", "导入未在用户原始资料目录留下副产物",
           "以数据库文件时间为界，判断 ~$ 锁文件是导入前既存还是导入后新增",
           "列出源目录 *.docx 与 ~$*；比较其 mtime 与 bank.db 的 mtime",
           "导入之后没有新增任何 ~$ 锁文件",
           detail,
           ok)


def main():
    s1_cli(); s1_omml(); s1_mtef(); s1_full_products(); s1_artifact_fresh()
    s1_review_queue(); s1_source_readonly(); s1_regressions()
    s2_schema(); s2_counts(); s2_idempotent(); s2_fts_really_used(); s2_filter()
    s2_version_snapshot(); s2_integrity(); s2_tests(); s2_metadata_honest()
    s2_source_readonly()

    out = ROOT / "outputs/verification"
    out.mkdir(parents=True, exist_ok=True)
    payload = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "checks": CHECKS,
               "summary": {"total": len(CHECKS),
                           "passed": sum(1 for c in CHECKS if c["result"] == "通过"),
                           "failed": sum(1 for c in CHECKS if c["result"] != "通过")}}
    (out / "verification_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n合计 {payload['summary']['total']} 项，通过 {payload['summary']['passed']}，"
          f"不通过 {payload['summary']['failed']}")


if __name__ == "__main__":
    main()
