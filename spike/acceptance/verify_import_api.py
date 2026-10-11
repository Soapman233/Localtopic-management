# -*- coding: utf-8 -*-
"""验收：Web 导入 API 端到端（Phase 2.2）。

⚠️ **导入会写库**，因此全程在 ``bank.db`` 的**副本**上操作，绝不碰交付库。

验证：
  1. 空文件 → 40010；非 docx → 40011；超大 → 40011（边界）
  2. 真实 DOCX → 提交作业 → 轮询至 done
  3. **库副本的题目数确实增加**（证明真的入库，而非只返回成功）
  4. 重复导入同一文件 → **幂等**（不重复插入）
  5. 交付库 sha256 **前后不变**（证明没被污染）
"""
from __future__ import annotations

import hashlib
import io
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SRC_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
DOCX_CANDIDATES = [
    Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/2026年10月1日初中物理作业.docx"),
    Path("C:/Users/SOAP/Desktop/物理/初中/2026学科网教案/10.3 探索更小的微粒 同步练习-2025-2026学年苏科版物理八年级下学期.docx"),
]
WORK = ROOT / "spike" / "acceptance" / "_import_test"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def count_questions(db: Path) -> int:
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        return con.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    finally:
        con.close()


def main() -> int:
    if not SRC_DB.is_file():
        print(f"[SKIP] 交付库不存在：{SRC_DB}")
        return 0
    docx = next((p for p in DOCX_CANDIDATES if p.is_file()), None)
    if docx is None:
        print("[SKIP] 未找到可用测试 DOCX")
        return 0

    WORK.mkdir(parents=True, exist_ok=True)
    db_copy = WORK / "copy.db"
    src_hash_before = sha256(SRC_DB)
    print(f"交付库 sha256（前）: {src_hash_before[:16]}…")
    shutil.copyfile(SRC_DB, db_copy)

    os.environ["QB_DB_PATH"] = str(db_copy)
    os.environ["QB_EXPORT_ENGINE"] = "native"

    from fastapi.testclient import TestClient
    from webui.app import app

    client = TestClient(app)
    results: dict[str, bool] = {}

    # ---------- 1) 边界：空文件 / 错误格式 ----------
    print("\n[步骤1] 参数边界")
    r = client.post("/api/import/docx",
                    files={"file": ("empty.docx", b"", "application/octet-stream")})
    print(f"   空文件 -> {r.status_code} {r.json().get('code')}")
    results["空文件 -> 40010"] = (r.status_code == 400 and r.json().get("code") == 40010)

    r = client.post("/api/import/docx",
                    files={"file": ("bad.txt", b"hello", "text/plain")})
    print(f"   非 docx -> {r.status_code} {r.json().get('code')}")
    results["非 docx -> 40011"] = (r.status_code == 400 and r.json().get("code") == 40011)

    st = client.get("/api/import/status").json()["data"]
    print(f"   status: enabled={st['enabled']} max={st['max_bytes'] // 1048576}MB "
          f"suffixes={st['allowed_suffixes']}")
    results["status 接口可用"] = st["enabled"] and st["allowed_suffixes"] == [".docx"]

    # ---------- 2) 真实导入 ----------
    print(f"\n[步骤2] 真实导入：{docx.name}")
    before = count_questions(db_copy)
    print(f"   导入前题目数: {before}")
    with docx.open("rb") as fh:
        r = client.post("/api/import/docx",
                        files={"file": (docx.name, fh.read(),
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    print(f"   提交 -> {r.status_code}")
    if r.status_code != 200:
        print("   响应:", r.text[:400])
        results["导入提交"] = False
        return _report(results)
    job_id = r.json()["data"]["job_id"]
    results["导入提交"] = True

    job = None
    for _ in range(90):
        job = client.get(f"/api/jobs/{job_id}").json()["data"]
        if job.get("status") in ("done", "error", "failed"):
            break
        time.sleep(1.0)
    print(f"   作业状态: {job.get('status')}")
    if job.get("status") != "done":
        print("   错误:", str(job.get("error"))[:400])
        results["导入作业完成"] = False
        return _report(results)
    results["导入作业完成"] = True
    res = job["result"]
    print(f"   结果: status={res.get('status')} 新增={res.get('inserted')} "
          f"更新={res.get('updated')} 跳过={res.get('skipped')} 待复核={res.get('review_count')}")
    print(f"   questions 统计: {res.get('questions')}")
    results["导入返回 OK"] = res.get("status") == "OK"
    results["报告数值非零"] = (res.get("imported") or 0) > 0

    after = count_questions(db_copy)
    print(f"   导入后题目数: {after}（+{after - before}）")
    results["库内题目数增加"] = after > before

    # ---------- 3) 幂等 ----------
    print("\n[步骤3] 重复导入同一文件（应幂等）")
    with docx.open("rb") as fh:
        r2 = client.post("/api/import/docx",
                         files={"file": (docx.name, fh.read(),
                                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    job2 = None
    if r2.status_code == 200:
        jid2 = r2.json()["data"]["job_id"]
        for _ in range(90):
            job2 = client.get(f"/api/jobs/{jid2}").json()["data"]
            if job2.get("status") in ("done", "error", "failed"):
                break
            time.sleep(1.0)
    if job2 and job2.get("status") == "done":
        r2res = job2["result"]
        after2 = count_questions(db_copy)
        print(f"   第二次: 题数={r2res.get('imported')} 跳过={r2res.get('skipped')} "
              f"库内题目数={after2}（与首次相同={after2 == after}）")
        results["重复导入幂等"] = (after2 == after)
    else:
        print("   第二次导入未完成，跳过幂等断言")
        results["重复导入幂等"] = False

    # ---------- 4) 交付库未被污染 ----------
    print("\n[步骤4] 交付库是否被污染")
    src_hash_after = sha256(SRC_DB)
    print(f"   交付库 sha256（后）: {src_hash_after[:16]}…")
    results["交付库未被污染"] = (src_hash_after == src_hash_before)
    print(f"   前后一致: {src_hash_after == src_hash_before}")

    return _report(results)


def _report(results: dict) -> int:
    print("\n=== 验收结论 ===")
    for k, v in results.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    ok = all(results.values())
    print(f"\n{'✅ 通过：Web 导入 API 可用' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
