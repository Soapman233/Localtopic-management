# -*- coding: utf-8 -*-
"""便携客户端（打包 exe）端到端验收：模拟老师首次使用的完整流程。

针对**正在运行的打包 exe**（默认 http://127.0.0.1:8720），走真实 HTTP：

  1. 环境：health / import status / backup info
  2. **导入**一份真实旧卷 DOCX → 题库从 0 变成 N 题
  3. **检索**刚导入的题
  4. **组卷**：建卷 → 加题
  5. **导出**：生成 DOCX（native 引擎，不需要 editor_sdk）
  6. **双端验证**：用 Word / WPS 打开导出件，确认公式为原生 OMath 且可编辑
  7. **备份**：导出整库快照

这是「便携客户端可用」的最终判定——空库起步，全流程跑通。
"""
from __future__ import annotations

import json
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8720"
HERE = Path(__file__).resolve().parent
DOCX = Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/2026年10月1日初中物理作业.docx")


def req(method: str, path: str, *, body=None, timeout: float = 180.0):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, raw


def upload_docx(path: Path) -> tuple[int, dict]:
    """multipart 上传 DOCX。"""
    boundary = uuid.uuid4().hex
    payload = path.read_bytes()
    name = path.name
    parts = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode("utf-8"),
        b"Content-Type: application/vnd.openxmlformats-officedocument"
        b".wordprocessingml.document\r\n\r\n",
        payload,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    r = urllib.request.Request(
        BASE + "/api/import/docx", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=600) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def poll_job(job_id: str, *, tries: int = 120) -> dict:
    for _ in range(tries):
        st, body = req("GET", f"/api/jobs/{job_id}")
        job = body.get("data") or {}
        if job.get("status") in ("done", "error", "failed"):
            return job
        time.sleep(1.0)
    return job or {}


def check_docx_in_office(path: Path) -> dict:
    """Word / WPS 双端：打开、公式数、改字符重开比对（各自独立副本）。"""
    import win32com.client as win32
    out = {}
    for eng, prog in (("word", "Word.Application"), ("wps", "KWPS.Application")):
        work = path.with_name(path.stem + f"_{eng}.docx")
        shutil.copyfile(path, work)
        app = win32.Dispatch(prog)
        app.Visible = False
        try:
            app.DisplayAlerts = 0
        except Exception:
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
            except Exception:
                pass
    return out


def main() -> int:
    if not DOCX.is_file():
        print(f"[SKIP] 测试 DOCX 不存在：{DOCX}")
        return 0

    R: dict[str, bool] = {}

    # ---------- 1) 环境 ----------
    print("[步骤1] 环境自检")
    st, body = req("GET", "/api/health")
    h = body.get("data") or {}
    print(f"   health -> {st}  ok={h.get('ok')} degraded={h.get('degraded')} "
          f"schema={h.get('schema_version')}")
    R["health 正常"] = (st == 200 and h.get("ok") and not h.get("degraded"))

    st, body = req("GET", "/api/import/status")
    isd = body.get("data") or {}
    print(f"   import/status -> {st} enabled={isd.get('enabled')} "
          f"max={isd.get('max_bytes', 0) // 1048576}MB")
    R["导入功能可用"] = (st == 200 and isd.get("enabled") is True)

    # ---------- 2) 导入 ----------
    print(f"\n[步骤2] 导入真实旧卷：{DOCX.name}")
    st, body = req("GET", "/api/stats")
    before = (body.get("data") or {}).get("questions") or 0
    print(f"   导入前题目数: {before}")

    st, body = upload_docx(DOCX)
    print(f"   上传 -> {st}")
    if st != 200:
        print("   响应:", str(body)[:300])
        R["导入提交"] = False
        return _report(R)
    R["导入提交"] = True
    job = poll_job(body["data"]["job_id"])
    print(f"   作业: {job.get('status')}")
    if job.get("status") != "done":
        print("   错误:", str(job.get("error"))[:300])
        R["导入完成"] = False
        return _report(R)
    R["导入完成"] = True
    res = job["result"]
    print(f"   结果: 新增={res.get('inserted')} 跳过={res.get('skipped')} "
          f"待复核={res.get('review_count')}")

    st, body = req("GET", "/api/stats")
    after = (body.get("data") or {}).get("questions") or 0
    print(f"   导入后题目数: {after}（+{after - before}）")
    R["题库从空变有"] = (before == 0 and after > 0)

    # ---------- 3) 检索 ----------
    print("\n[步骤3] 检索")
    st, body = req("GET", "/api/search?q=%E5%8A%9B&limit=3")
    items = (body.get("data") or {}).get("items") or (body.get("data") or {}).get("results") or []
    print(f"   /api/search?q=力 -> {st}，命中 {len(items)} 条")
    R["检索可用"] = (st == 200)

    # ---------- 4) 组卷 ----------
    print("\n[步骤4] 组卷")
    st, body = req("GET", "/api/search?q=&limit=5")
    d = body.get("data") or {}
    items = d.get("items") or d.get("results") or []
    ids = [it.get("id") for it in items if it.get("id")]
    print(f"   取到候选题 {len(ids)} 道")
    st, body = req("POST", "/api/papers", body={"title": "便携验收卷", "template": "考试",
                                                "answer_mode": "学生版"})
    if st != 200:
        print(f"   建卷失败 -> {st} {str(body)[:200]}")
        R["建卷"] = False
        return _report(R)
    pid = body["data"]["id"]
    print(f"   已建卷 #{pid}")
    R["建卷"] = True
    if ids:
        st, body = req("POST", f"/api/papers/{pid}/questions", body={"question_ids": ids})
        print(f"   加题 -> {st}")
        R["加题"] = (st == 200)

    # ---------- 5) 导出 ----------
    print("\n[步骤5] 导出 DOCX（native 引擎）")
    st, body = req("POST", f"/api/papers/{pid}/export",
                   body={"answer_mode": "学生版", "formats": ["docx"]})
    if st != 200:
        print(f"   导出提交失败 -> {st} {str(body)[:300]}")
        R["导出"] = False
        return _report(R)
    job = poll_job(body["data"]["job_id"])
    print(f"   作业: {job.get('status')}")
    if job.get("status") != "done":
        print("   错误:", str(job.get("error"))[:300])
        R["导出"] = False
        return _report(R)
    R["导出"] = True
    er = job["result"]
    docx_out = Path(er["docx"])
    print(f"   产物: {docx_out.name} {er['docx_size_bytes']:,} 字节 "
          f"公式={er['formulas_written']} 图={er['images_written']} 页={er.get('page_count')}")
    print(f"   bridge_errors={er.get('bridge_errors')}")
    R["导出产物存在"] = docx_out.is_file() and er["docx_size_bytes"] > 0

    # ---------- 6) 双端验证 ----------
    print("\n[步骤6] Word / WPS 双端验证")
    office = check_docx_in_office(docx_out)
    for eng, r in office.items():
        if r.get("ok"):
            print(f"   [{eng}] 页{r['pages']} OMaths={r['math']} 图={r['img']} "
                  f"改字符重开保留={r['editable']}")
        else:
            print(f"   [{eng}] ✗ {r.get('error')}")
    R["双端可打开"] = all(r.get("ok") for r in office.values())
    if er["formulas_written"]:
        R["双端公式可编辑"] = all(r.get("editable") for r in office.values())

    # ---------- 7) 备份 ----------
    print("\n[步骤7] 整库备份")
    st, body = req("POST", "/api/backup/create")
    print(f"   /api/backup/create -> {st} 校验={((body.get('data') or {}).get('verify_ok'))}")
    R["备份可用"] = (st == 200 and (body.get("data") or {}).get("verify_ok"))

    return _report(R)


def _report(R: dict) -> int:
    print("\n=== 便携客户端端到端验收 ===")
    for k, v in R.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    ok = all(R.values())
    print(f"\n{'✅ 通过：打包客户端可完成「空库 → 导入 → 组卷 → 导出 → 双端可编辑」全流程' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
