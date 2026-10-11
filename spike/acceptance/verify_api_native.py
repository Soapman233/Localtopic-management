# -*- coding: utf-8 -*-
"""验收：**Web API 导出路径**是否已摆脱 editor_sdk。

设计（与 CLI 侧同一套反证逻辑）：
  1. 把 ``editor_sdk_port`` 指向死端口，使 editor_sdk 不可达；
  2. 通过 FastAPI TestClient 走真实 API：POST /api/papers/{id}/export → 轮询 job；
  3. **API 导出必须成功**——若成功，即证明该路径不再依赖 editor_sdk
     （bridge 引擎在同样条件下必然失败）；
  4. 检查产物确为自研引擎产出（部件数 14，而非桥接后处理的 25）。

注意：本脚本会写 ``outputs/export/`` 与预览缓存，属正常导出行为，不写题库。
"""
from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
DEAD_PORT = "39999"


def main() -> int:
    if not DB.is_file():
        print(f"[SKIP] 交付库不存在：{DB}")
        return 0

    os.environ["QB_DB_PATH"] = str(DB)
    os.environ["QB_EXPORT_ENGINE"] = "native"
    os.environ["editor_sdk_port"] = DEAD_PORT          # ← 让 editor_sdk 不可达

    from fastapi.testclient import TestClient
    from webui.app import app

    results: dict[str, bool] = {}
    client = TestClient(app)

    # ---- 反证：确认死端口确实让 editor_sdk 不可达 ----
    from webui import config as wconfig
    sdk = wconfig.detect_editor_sdk(timeout=0.3)
    print(f"[步骤1] editor_sdk 可达性: {sdk.get('available')}（期望 False）")
    results["反证(editor_sdk 应不可达)"] = not sdk.get("available")

    # ---- 健康检查 ----
    r = client.get("/api/health")
    print(f"[步骤2] /api/health -> {r.status_code}")
    results["健康检查"] = r.status_code == 200

    # ---- 提交导出 ----
    r = client.post("/api/papers/1/export", json={"answer_mode": "学生版", "formats": ["docx"]})
    print(f"[步骤3] POST /api/papers/1/export -> {r.status_code}")
    if r.status_code != 200:
        print("   响应:", r.text[:400])
        results["API 导出成功"] = False
        print("\n=== 结论 ===\n   FAIL  API 导出失败")
        return 1
    body = r.json()["data"]
    job_id = body["job_id"]
    print(f"   job_id={job_id}  warnings={body.get('warnings')}")
    results["API 提交作业"] = True

    # ---- 轮询（作业跑在 JobManager 单线程里，需给足时间）----
    import time
    job = None
    for _ in range(60):
        jr = client.get(f"/api/jobs/{job_id}")
        job = jr.json()["data"]
        if job.get("status") in ("done", "error", "failed"):
            break
        time.sleep(1.0)
    print(f"[步骤4] 作业状态: {job.get('status')} progress={job.get('progress')}")
    results["API 导出成功"] = job.get("status") == "done"

    if job.get("status") != "done":
        print("   错误:", str(job.get("error"))[:300])
    else:
        res = job["result"]
        docx = Path(res["docx"])
        print(f"   产物: {docx.name}  {res['docx_size_bytes']:,} 字节  "
              f"公式={res['formulas_written']} 图={res['images_written']} 页={res['page_count']}")
        print(f"   bridge_errors={res.get('bridge_errors')}")

        # ---- 判别引擎：自研产物 14 个部件；桥接后处理为 25 个 ----
        with zipfile.ZipFile(docx) as z:
            names = z.namelist()
            doc = z.read("word/document.xml").decode("utf-8")
        n_parts = len(names)
        is_native = not any(p in names for p in ("word/settings.xml", "docProps/core.xml"))
        print(f"[步骤5] 部件数={n_parts}；含桥接后处理痕迹="
              f"{any(p in names for p in ('word/settings.xml','docProps/core.xml'))}"
              f" -> 判定 {'native' if is_native else 'bridge'}")
        results["产物为自研引擎"] = is_native
        results["无哨兵残留"] = "\ue000" not in doc
        results["公式为原生 OMML"] = doc.count("<m:oMath>") == res["formulas_written"]

    print("\n=== 验收结论 ===")
    for k, v in results.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    ok = all(results.values())
    print(f"\n{'✅ 通过：Web API 导出已摆脱 editor_sdk' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
