# -*- coding: utf-8 -*-
"""Phase 4.2：端到端净时间实测（P-01）。

⚠️ **只测工具侧，不编造人工基线**
----------------------------------
研究结论要求「以**减少净时间支出**为唯一硬指标」「凡不能算清省了多少分钟的功能都应被质疑」。
本脚本给出**工具侧各步骤的原始计时**（可复现）。

**手工组卷基线本脚本不测**——它需要真实教师用 Word 实际操作并计时，
由我在开发机上"估"一个数字就是编造。基线需人工测量后回填（见交接文档的空白表）。

计时口径：HTTP 请求往返（含服务端处理），不含人工操作与阅读时间。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXE_DIR = ROOT / "dist" / "题库"
RUN = HERE / "_p42_timing"
PORT = 8746
BASE = f"http://127.0.0.1:{PORT}"
DOCX = Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/"
            "11.5 机械效率（重难点专练）（答案版）.docx")


def _req(method: str, path: str, body=None, timeout: float = 600.0):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as exc:  # noqa: BLE001
        return None, {"_err": f"{type(exc).__name__}: {exc}"}


def _upload(path: Path):
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode("utf-8"),
        b"Content-Type: application/vnd.openxmlformats-officedocument"
        b".wordprocessingml.document\r\n\r\n",
        path.read_bytes(), f"\r\n--{boundary}--\r\n".encode(),
    ])
    r = urllib.request.Request(
        BASE + "/api/import/docx", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=900) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _poll(job_id: str, tries: int = 180) -> dict:
    job = {}
    for _ in range(tries):
        _, b = _req("GET", f"/api/jobs/{job_id}")
        job = (b or {}).get("data") or {}
        if job.get("status") in ("done", "error", "failed"):
            return job
        time.sleep(0.5)
    return job


def main() -> int:
    if not (EXE_DIR / "题库.exe").is_file() or not DOCX.is_file():
        print("[SKIP] 缺少打包产物或样例")
        return 0
    if RUN.is_dir():
        shutil.rmtree(RUN, ignore_errors=True)
    shutil.copytree(EXE_DIR, RUN)

    log: list[tuple[str, float]] = []
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

    t0 = time.perf_counter()
    proc = subprocess.Popen([str(RUN / "题库.exe"), "--no-browser", "--port", str(PORT)],
                            cwd=str(RUN), creationflags=flags, close_fds=True)
    ready = False
    while time.perf_counter() - t0 < 60:
        time.sleep(0.5)
        st, _ = _req("GET", "/api/health", timeout=5)
        if st == 200:
            ready = True
            break
    t_start = time.perf_counter() - t0
    log.append(("① 冷启动（双击到可访问）", t_start))
    print(f"① 冷启动: {t_start:.2f}s  就绪={ready}")
    if not ready:
        return 1

    # ② 导入
    t = time.perf_counter()
    st, body = _upload(DOCX)
    job = _poll(body["data"]["job_id"])
    t_import = time.perf_counter() - t
    log.append(("② 导入一份旧卷", t_import))
    res = job.get("result") or {}
    print(f"② 导入: {t_import:.2f}s  status={job.get('status')} "
          f"新增={res.get('inserted')} 待复核={res.get('review_count')}")

    # ③ 组卷（建卷 + 加 10 题）
    t = time.perf_counter()
    _, b = _req("GET", "/api/search?q=&limit=10")
    d = (b or {}).get("data") or {}
    items = d.get("items") or d.get("results") or []
    ids = [x.get("id") for x in items if x.get("id")]
    _, b = _req("POST", "/api/papers", body={"title": "计时卷", "template": "考试",
                                             "answer_mode": "答案解析版"})
    pid = (b.get("data") or {}).get("id")
    if ids and pid:
        _req("POST", f"/api/papers/{pid}/questions", body={"question_ids": ids})
    t_paper = time.perf_counter() - t
    log.append((f"③ 组卷（建卷+加 {len(ids)} 题）", t_paper))
    print(f"③ 组卷: {t_paper:.2f}s  {len(ids)} 题")

    # ④ 导出
    t = time.perf_counter()
    st, b = _req("POST", f"/api/papers/{pid}/export",
                 body={"answer_mode": "答案解析版", "formats": ["docx"]})
    job = _poll(b["data"]["job_id"]) if st == 200 else {}
    t_export = time.perf_counter() - t
    log.append(("④ 导出 DOCX", t_export))
    er = job.get("result") or {}
    print(f"④ 导出: {t_export:.2f}s  status={job.get('status')} "
          f"公式={er.get('formulas_written')} 页={er.get('page_count')}")

    # ⑤ 备份
    t = time.perf_counter()
    st, _ = _req("POST", "/api/backup/create")
    t_backup = time.perf_counter() - t
    log.append(("⑤ 整库备份", t_backup))
    print(f"⑤ 备份: {t_backup:.2f}s  status={st}")

    total = sum(v for _, v in log)
    print("\n=== 工具侧净耗时（原始计时）===")
    for k, v in log:
        print(f"   {v:8.2f}s  {k}")
    print(f"   {'-' * 8}")
    print(f"   {total:8.2f}s  合计（不含人工操作与阅读时间）")

    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:  # noqa: BLE001
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    out = HERE / "_p42_timing.json"
    out.write_text(json.dumps({"steps": log, "total_seconds": round(total, 2),
                               "note": "工具侧 HTTP 往返；人工基线需另行实测"},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n原始计时已写入 {out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
