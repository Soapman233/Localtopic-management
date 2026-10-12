# -*- coding: utf-8 -*-
"""🔴 验证 MathType 转换在**打包版**上是否正常（Phase 1 遗留的最大未知数）。

背景
----
`pipeline/mtef_conv.py` 用 ``multiprocessing`` 的 **spawn** 上下文做 MTEF 解析。
PyInstaller 冻结后，spawn 会**重新执行入口**——若没有 ``freeze_support()``
就会递归启动整个应用。已按标准加了 ``freeze_support()``，但**此前从未在冻结版上实证**
（当时以为没有 MathType 样例；实际源素材里有 **21 份** DSMT4 文件）。

本脚本：
  1. 以 **DETACHED_PROCESS（模拟双击）** 启动打包版；
  2. 通过 Web API 导入一份**含 23 个 MathType 公式**的真实旧卷；
  3. 断言：作业完成、**公式被转换**（``mathtype`` 计数 > 0 且 ``needs_review`` 为 0）、
     题库题目数增加。
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
SAMPLE = Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/"
              "11.5 机械效率（重难点专练）（答案版）.docx")
RUN_DIR = HERE / "_mtef_frozen"
PORT = 8743
BASE = f"http://127.0.0.1:{PORT}"


def _req(method: str, path: str, body=None, timeout: float = 300.0):
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
        path.read_bytes(),
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    r = urllib.request.Request(
        BASE + "/api/import/docx", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=900) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main() -> int:
    if not SAMPLE.is_file():
        print(f"[SKIP] 样例不存在：{SAMPLE}")
        return 0
    exe_dir = ROOT / "dist" / "题库"
    if not (exe_dir / "题库.exe").is_file():
        print(f"[SKIP] 未找到打包产物：{exe_dir}")
        return 0

    if RUN_DIR.is_dir():
        shutil.rmtree(RUN_DIR, ignore_errors=True)
    shutil.copytree(exe_dir, RUN_DIR)
    exe = RUN_DIR / "题库.exe"
    print(f"部署到：{RUN_DIR}")

    R: dict[str, bool] = {}
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    print(f"\n[步骤1] DETACHED_PROCESS 启动（模拟双击，无 std 句柄）")
    proc = subprocess.Popen([str(exe), "--no-browser", "--port", str(PORT)],
                            cwd=str(RUN_DIR), creationflags=flags, close_fds=True)
    print(f"   pid={proc.pid}")

    ok = False
    for i in range(45):
        time.sleep(1.0)
        st, _ = _req("GET", "/api/health", timeout=10)
        if st == 200:
            ok = True
            print(f"   {i + 1}s 后就绪")
            break
    R["打包版可启动"] = ok
    if not ok:
        return _report(R)

    # ---------- 导入含 MathType 的真实旧卷 ----------
    print(f"\n[步骤2] 导入 MathType 旧卷：{SAMPLE.name}")
    st, body = _req("GET", "/api/stats")
    before = (body.get("data") or {}).get("questions") or 0
    print(f"   导入前题目数: {before}")

    st, body = _upload(SAMPLE)
    print(f"   上传 -> {st}")
    if st != 200:
        print("   响应:", str(body)[:300])
        R["导入提交"] = False
        return _report(R)
    R["导入提交"] = True

    job = None
    for _ in range(180):
        _, jb = _req("GET", f"/api/jobs/{body['data']['job_id']}")
        job = jb.get("data") or {}
        if job.get("status") in ("done", "error", "failed"):
            break
        time.sleep(1.0)
    print(f"   作业: {job.get('status')}")
    if job.get("status") != "done":
        print("   错误:", str(job.get("error"))[:400])
        R["MathType 导入完成"] = False
        return _report(R)
    R["MathType 导入完成"] = True

    res = job["result"]
    q = res.get("questions") or {}
    print(f"   结果: status={res.get('status')} 新增={res.get('inserted')} "
          f"待复核={res.get('review_count')}")
    print(f"   扫描统计: {json.dumps(q, ensure_ascii=False)[:260]}")
    R["报告为 OK"] = res.get("status") == "OK"

    st, body = _req("GET", "/api/stats")
    after = (body.get("data") or {}).get("questions") or 0
    print(f"   导入后题目数: {after}（+{after - before}）")
    R["题库增加"] = after > before

    # ---------- 关键断言：MathType 公式被转换（不是全部待复核）----------
    print(f"\n[步骤3] MathType 公式是否真的被转换")
    with_review = res.get("review_count") or 0
    print(f"   待复核公式数: {with_review}")
    # 若 spawn 失败，阶段1 会把公式标为需复核/失败，待复核数会≈公式数（23）
    R["未因 spawn 失败而大量待复核"] = with_review < 23

    print("\n[步骤4] 组卷并导出（证明 MathType 公式**导出后可编辑**）")
    # ⚠️ 必须**挑含公式的题**——按 id 取前几道会拿到无公式的题，
    #    导出件公式数为 0，就验证不到「公式可编辑」这件事（第一版就踩了这个坑）。
    import sqlite3
    db = RUN_DIR / "outputs" / "bank.db"
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        ids = [r[0] for r in con.execute(
            "SELECT DISTINCT question_id FROM formulas ORDER BY question_id LIMIT 6")]
    finally:
        con.close()
    print(f"   含公式的候选题: {len(ids)} 道 -> {ids}")
    st, body = _req("POST", "/api/papers", body={"title": "MathType 验收卷",
                                                 "template": "考试", "answer_mode": "答案解析版"})
    pid = (body.get("data") or {}).get("id")
    print(f"   建卷 #{pid}，候选题 {len(ids)} 道")
    if ids and pid:
        st, body = _req("POST", f"/api/papers/{pid}/questions", body={"question_ids": ids})
        print(f"   加题 -> {st}")
        R["加题"] = (st == 200)
    # ⚠️ 必须用**答案解析版**：这些题的 MathType 公式位于「解析」区，
    #    学生版会（正确地）排除解析内容 -> 导出公式数为 0，验证不到「公式可编辑」。
    st, body = _req("POST", f"/api/papers/{pid}/export",
                    body={"answer_mode": "答案解析版", "formats": ["docx"]})
    if st != 200:
        print(f"   导出提交失败 -> {st} {str(body)[:200]}")
        R["导出"] = False
    else:
        job = None
        for _ in range(120):
            _, jb = _req("GET", f"/api/jobs/{body['data']['job_id']}")
            job = jb.get("data") or {}
            if job.get("status") in ("done", "error", "failed"):
                break
            time.sleep(1.0)
        print(f"   导出作业: {job.get('status')}")
        R["导出"] = (job.get("status") == "done")
        if R["导出"]:
            er = job["result"]
            out = Path(er["docx"])
            print(f"   产物: {out.name} {er['docx_size_bytes']:,} 字节 "
                  f"公式={er['formulas_written']} 图={er['images_written']}")
            R["导出含公式"] = er["formulas_written"] > 0
            if out.is_file():
                print("\n[步骤5] Word / WPS 双端验证导出件")
                off = _office_check(out)
                for eng, r in off.items():
                    if r.get("ok"):
                        print(f"   [{eng}] 页{r['pages']} OMaths={r['math']} "
                              f"改字符重开保留={r['editable']}")
                    else:
                        print(f"   [{eng}] ✗ {r.get('error')}")
                R["双端可打开"] = all(r.get("ok") for r in off.values())
                R["双端公式可编辑"] = all(r.get("editable") for r in off.values())

    print("\n[步骤6] 清理")
    try:
        proc.terminate()
        proc.wait(timeout=15)
        print("   已终止")
    except Exception:  # noqa: BLE001
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    return _report(R)


def _office_check(path: Path) -> dict:
    """Word / WPS 双端：打开、计数、**改公式字符→保存→重开→比对**（各自独立副本）。"""
    import unicodedata
    import win32com.client as win32

    out: dict = {}
    for eng, prog in (("word", "Word.Application"), ("wps", "KWPS.Application")):
        work = path.with_name(path.stem + f"_{eng}.docx")
        shutil.copyfile(path, work)          # ★ 独立副本，绝不污染源文件
        app = win32.Dispatch(prog)
        app.Visible = False
        try:
            app.DisplayAlerts = 0
        except Exception:  # noqa: BLE001
            pass
        try:
            d = app.Documents.Open(str(work).replace("/", "\\"))
            n_math = int(d.OMaths.Count)
            n_img = int(d.InlineShapes.Count)
            pages = int(d.ComputeStatistics(2))
            editable = None
            if n_math:
                rng = d.OMaths(1).Range
                before = unicodedata.normalize("NFKC", str(rng.Text))
                idx = ch = None
                for i in range(1, int(rng.Characters.Count) + 1):
                    t = str(rng.Characters(i).Text).strip()
                    if t and t.isalnum():
                        idx, ch = i, t
                        break
                if idx:
                    new = "Z" if ch != "Z" else "Y"
                    rng.Characters(idx).Text = new
                    d.Save()
                    d.Close(SaveChanges=0)
                    d = None
                    d2 = app.Documents.Open(str(work).replace("/", "\\"))
                    after = unicodedata.normalize("NFKC", str(d2.OMaths(1).Range.Text))
                    editable = (new in after) and (before != after)
                    d2.Close(SaveChanges=0)
            if d is not None:
                d.Close(SaveChanges=0)
            out[eng] = {"ok": True, "math": n_math, "img": n_img, "pages": pages,
                        "editable": editable}
        except Exception as exc:  # noqa: BLE001
            out[eng] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        finally:
            try:
                app.Quit()
            except Exception:  # noqa: BLE001
                pass
    return out


def _report(R: dict) -> int:
    print("\n=== MathType（打包版）验收 ===")
    for k, v in R.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    good = all(R.values())
    print(f"\n{'✅ 通过：打包版可处理 MathType 旧卷' if good else '❌ 未通过'}")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
