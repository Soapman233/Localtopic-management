"""探针：验证「单文件导入」能否被服务进程干净地调用。

回答的问题（不改任何业务代码）：
  1. 能否在同一进程内连续调用 pipeline.stage1.process_file 处理真实 DOCX，
     并拿到结构化结果？随后 bank.importer.import_file 能否把该 JSON 导入副本库？
  2. 坏文件 / 非 DOCX / 空文件 / 缺文件时：抛异常还是静默返回？是否污染已打开的事务？
  3. 单文件耗时量级（实测秒数）。
  4. 是否可重入：连续处理 2 个文件，第二次是否受第一次残留状态影响？
  5. mtef_conv 的 spawn 多进程路径在「被导入调用」时是否可用（MathType 隔离所需）。

铁律：只写 spike/programmatic_import/ 下的探针、工作目录与副本库；绝不碰交付库。

运行：
    <venv>/python.exe spike/programmatic_import/probe_import.py
"""
from __future__ import annotations

import json
import shutil
import sys
import time
import traceback
from pathlib import Path

# --- 让脚本不依赖 cwd：把项目根加入 sys.path ---------------------------------
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import stage1                       # noqa: E402
from pipeline import docx_scan                     # noqa: E402
from pipeline import mtef_conv                     # noqa: E402
from bank import db as bank_db                     # noqa: E402
from bank import importer                          # noqa: E402

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"                               # process_file 的产出目录
TMP_DB = HERE / "tmp_bank.db"                      # 副本库
SAMPLE = ROOT / "spike" / "a4-preview" / ".evidence" / "real" / "paper1_student_A4.docx"


def _line(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def _fresh_work() -> None:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)


def _fresh_db():
    """新建空副本库（用 bank/db.py 建表逻辑），绝不使用交付库。"""
    if TMP_DB.exists():
        TMP_DB.unlink()
    conn = bank_db.connect(TMP_DB)          # create=True -> init_db(DDL)
    return conn


# --------------------------------------------------------------------------- #
# 探针 1：同进程内 process_file -> import_file 全链路
# --------------------------------------------------------------------------- #
def probe1_end_to_end():
    _line("探针 1：process_file(真实 DOCX) -> import_file(副本库)")
    print(f"样例文件 : {SAMPLE}")
    print(f"存在     : {SAMPLE.is_file()}  大小={SAMPLE.stat().st_size if SAMPLE.is_file() else 0} bytes")

    rec = stage1.process_file(SAMPLE, WORK, timeout=10.0, verbose=False)
    print("\n[process_file 返回结构] keys =", sorted(rec.keys()))
    print(json.dumps({k: rec[k] for k in rec
                      if k not in ("traceback", "outputs")},
                     ensure_ascii=False, indent=2))
    print("outputs  :", rec.get("outputs"))

    # 用产物 JSON 走 importer（单文件）
    qjson = WORK / f"{SAMPLE.stem}.questions.json"
    print(f"\n产出 questions.json : {qjson}  存在={qjson.is_file()}")

    conn = _fresh_db()
    try:
        imp = importer.import_file(conn, qjson, verbose=False)
        print("\n[import_file 返回结构]")
        print(json.dumps(imp, ensure_ascii=False, indent=2))

        # 幂等：再导入一次应全部 skipped
        imp2 = importer.import_file(conn, qjson, verbose=False)
        print("\n[再次 import_file（幂等验证）] new=%s updated=%s skipped=%s"
              % (imp2.get("new"), imp2.get("updated"), imp2.get("skipped")))

        st = conn.execute("SELECT COUNT(*) c FROM questions").fetchone()["c"]
        sf = conn.execute("SELECT COUNT(*) c FROM source_files").fetchone()["c"]
        fo = conn.execute("SELECT COUNT(*) c FROM formulas").fetchone()["c"]
        print(f"[副本库计数] source_files={sf} questions={st} formulas={fo}")
    finally:
        conn.close()
    return rec


# --------------------------------------------------------------------------- #
# 探针 2：坏输入行为 + 事务污染
# --------------------------------------------------------------------------- #
def probe2_bad_inputs():
    _line("探针 2：坏输入行为（process_file 层）")
    bad_dir = WORK / "_bad"
    bad_dir.mkdir(parents=True, exist_ok=True)

    empty_docx = bad_dir / "empty.docx"
    empty_docx.write_bytes(b"")                       # 空文件

    text_docx = bad_dir / "notzip.docx"
    text_docx.write_text("这不是一个 zip / docx 文件", encoding="utf-8")  # 假扩展名

    corrupt_docx = bad_dir / "corrupt.docx"
    corrupt_docx.write_bytes(b"PK\x03\x04" + b"\x00" * 40)  # zip 魔数但内容损坏

    missing = bad_dir / "does_not_exist.docx"          # 不存在

    for label, path in [("空文件", empty_docx), ("非 DOCX(文本)", text_docx),
                        ("损坏 ZIP", corrupt_docx), ("文件不存在", missing)]:
        rec = stage1.process_file(path, WORK, timeout=5.0, verbose=False)
        print(f"\n[{label}] status={rec['status']}  error={rec.get('error')!r}")
        print(f"         seconds={rec.get('seconds')}  (是否抛异常: 否，已内部捕获)")

    print("\n[事务污染验证] 在同一个连接里：好文件 -> 坏文件 -> 好文件")
    conn = _fresh_db()
    try:
        good = WORK / f"{SAMPLE.stem}.questions.json"
        r1 = importer.import_file(conn, good, verbose=False)
        # 构造一个坏 questions.json：questions 里塞一个非法 formula_ids（字符串而非列表）
        bad_json = bad_dir / "bad.questions.json"
        bad_json.write_text(json.dumps({
            "path": str(SAMPLE),
            "questions": [{"number": "1", "text": "x⟦F1⟧", "formula_ids": "F1"}]},
            ensure_ascii=False), encoding="utf-8")
        r2 = importer.import_file(conn, bad_json, verbose=False)
        # 坏文件后连接是否仍可用
        usable = True
        try:
            conn.execute("SELECT COUNT(*) FROM questions").fetchone()
        except Exception as e:
            usable = False
            print("  连接不可用:", e)
        r3 = importer.import_file(conn, good, verbose=False)   # 幂等 -> skipped
        print(f"  好文件 : {r1['status']} new={r1.get('new')}")
        print(f"  坏文件 : {r2['status']} error={r2.get('error')!r}")
        print(f"  连接仍可用 : {usable}")
        print(f"  再导入 : {r3['status']} skipped={r3.get('skipped')}")
        n = conn.execute("SELECT COUNT(*) c FROM questions").fetchone()["c"]
        print(f"  坏文件未写入题目 : questions={n}（应等于好文件题目数）")
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# 探针 3：耗时
# --------------------------------------------------------------------------- #
def probe3_timing():
    _line("探针 3：单文件耗时（实测）")
    times = []
    for i in range(3):
        t0 = time.perf_counter()
        rec = stage1.process_file(SAMPLE, WORK, timeout=10.0, verbose=False)
        dt = time.perf_counter() - t0
        times.append(dt)
        print(f"  第{i + 1}次: status={rec['status']} "
              f"seconds(内部)={rec.get('seconds')} wall={dt:.2f}s")
    print(f"  wall 用时: {['%.2f' % t for t in times]}  平均={sum(times)/len(times):.2f}s")
    print(f"  scan.convert_seconds={rec.get('scan', {}).get('convert_seconds')}")
    return times


# --------------------------------------------------------------------------- #
# 探针 4：可重入（连续 2 个文件）
# --------------------------------------------------------------------------- #
def probe4_reentrancy():
    _line("探针 4：可重入（连续处理 2 个文件）")
    sample2 = ROOT / "spike" / "a4-preview" / ".evidence" / "real" / "paper1_answer_A4.docx"
    print(f"文件A : {SAMPLE.name}")
    print(f"文件B : {sample2.name}  存在={sample2.is_file()}")

    ra = stage1.process_file(SAMPLE, WORK, timeout=10.0, verbose=False)
    rb = stage1.process_file(sample2, WORK, timeout=10.0, verbose=False)
    print(f"\n  A status={ra['status']} questions={ra.get('questions', {}).get('questions')}")
    print(f"  B status={rb['status']} questions={rb.get('questions', {}).get('questions')}")

    # 反向再跑一次 A，比较结果是否与第一次一致（无残留状态影响）
    ra2 = stage1.process_file(SAMPLE, WORK, timeout=10.0, verbose=False)
    same = (ra.get("questions") == ra2.get("questions")
            and ra.get("scan", {}).get("formulas") == ra2.get("scan", {}).get("formulas"))
    print(f"  A 再跑一次结果一致 : {same}")
    print(f"  A#1 stats={ra.get('scan')}")
    print(f"  A#2 stats={ra2.get('scan')}")

    # segment 的模块级开关是否被污染
    print(f"  segment.FILTER_TABLE_NUMERIC = {stage1.segment.FILTER_TABLE_NUMERIC}")
    return ra, rb, ra2


# --------------------------------------------------------------------------- #
# 探针 5：mtef_conv 的 spawn 多进程路径在「被导入调用」时是否可用
# --------------------------------------------------------------------------- #
def probe5_multiprocessing():
    _line("探针 5：mtef_conv.convert_many 的 spawn 多进程（MathType 隔离路径）")
    # 无真实 MathType 样例；用两段 dummy stream 触发进程机制本身。
    # dummy 会被解析为 FAIL，但我们验证的是「spawn 能否在服务/被导入进程中正常启停」。
    streams = [b"\x1c\x00\x00\x00" + b"\x00" * 20, b"\x00" * 8]
    try:
        results, elapsed = mtef_conv.convert_many(streams, per_equation_timeout=3.0)
        print(f"  convert_many 返回 : {results}")
        print(f"  elapsed           : {elapsed}s")
        print("  spawn 多进程路径   : 可用（无异常）")
    except Exception as exc:
        print(f"  spawn 多进程路径   : 失败 -> {type(exc).__name__}: {exc}")
        traceback.print_exc()
    print(f"  multiprocessing start method = "
          f"{__import__('multiprocessing').get_start_method(allow_none=True)}")


def main() -> int:
    _line("环境")
    print(f"python    : {sys.executable}")
    print(f"project   : {ROOT}")
    print(f"工作目录  : {WORK}")
    print(f"副本库    : {TMP_DB}")

    _fresh_work()
    probe1_end_to_end()
    probe2_bad_inputs()
    probe3_timing()
    probe4_reentrancy()
    probe5_multiprocessing()

    _line("探针结束")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
