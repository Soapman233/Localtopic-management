# -*- coding: utf-8 -*-
"""便携客户端「**双击场景**」验收：无控制台启动。

🔴 为什么必须单独有这个脚本
---------------------------
打包用 ``console=False``，exe 是 ``WINDOWS_GUI`` 子系统，**不分配控制台**。
从 shell / CI 启动时，进程会**继承有效的输出句柄**，``sys.stdout`` 不为 ``None``
——于是「从 shell 启动一切正常」的验证**根本测不到双击路径**。

用户双击时 ``sys.stdout is None``，uvicorn 配日志会崩：
``AttributeError: 'NoneType' object has no attribute 'isatty'``。

本脚本用 ``DETACHED_PROCESS`` 启动，**切断句柄继承**，真实模拟双击。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN_DIR = HERE / "_detached_run"
PORT = 8742
BASE = f"http://127.0.0.1:{PORT}"


def _http(path: str, timeout: float = 15.0):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:  # noqa: BLE001
        return None, None


def main() -> int:
    exe = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (
        HERE.parents[1] / "dist" / "题库" / "题库.exe")
    if not exe.is_file():
        print(f"[SKIP] 未找到 exe：{exe}")
        return 0

    import shutil
    if RUN_DIR.is_dir():
        shutil.rmtree(RUN_DIR, ignore_errors=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    for item in exe.parent.iterdir():
        dst = RUN_DIR / item.name
        shutil.copytree(item, dst) if item.is_dir() else shutil.copy2(item, dst)
    target = RUN_DIR / exe.name
    print(f"部署到：{RUN_DIR}")

    R: dict[str, bool] = {}
    # ---------- 关键：DETACHED_PROCESS + **不给任何 std 句柄**（≈ 双击）----------
    # ⚠️ 绝不能传 stdout=DEVNULL：那等于**给了它有效句柄**，
    #    sys.stdout 不为 None，就复现不出双击场景（本脚本第一版就踩了这个坑）。
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    print(f"\n[步骤1] 以 DETACHED_PROCESS 启动（模拟双击，无控制台、无 std 句柄）")
    print(f"   creationflags={flags}")
    proc = subprocess.Popen([str(target), "--no-browser", "--port", str(PORT)],
                            cwd=str(RUN_DIR), creationflags=flags, close_fds=True)
    print(f"   pid={proc.pid}")

    # ---------- 等待并探测 ----------
    ok = False
    for i in range(40):
        time.sleep(1.0)
        st, _ = _http("/api/health")
        if st == 200:
            ok = True
            print(f"\n[步骤2] {i + 1}s 后 /api/health -> 200")
            break
    R["无控制台可启动"] = ok
    if not ok:
        print("\n[步骤2] ✗ 未能在 40s 内就绪")

    if ok:
        st, body = _http("/api/health")
        d = (body or {}).get("data") or {}
        print(f"   ok={d.get('ok')} degraded={d.get('degraded')} schema={d.get('schema_version')}")
        R["health 正常"] = bool(d.get("ok"))
        for ep in ("/api/import/status", "/api/backup/info", "/api/stats"):
            st, _ = _http(ep)
            print(f"   {ep} -> {st}")
            R[f"{ep} 可用"] = (st == 200)

    # ---------- 数据落点 ----------
    print("\n[步骤3] 数据是否落在 exe 旁")
    outputs = RUN_DIR / "outputs"
    print(f"   outputs/ 存在: {outputs.is_dir()}")
    print(f"   bank.db 存在 : {(outputs / 'bank.db').is_file()}")
    R["数据落在 exe 旁"] = (outputs / "bank.db").is_file()

    # ---------- 日志 ----------
    print("\n[步骤4] 启动日志（无控制台时的唯一排障入口）")
    log = outputs / "webui" / "start.log"
    if log.is_file():
        text = log.read_text(encoding="utf-8", errors="replace")
        print(f"   {log.name} {log.stat().st_size} 字节")
        for line in text.splitlines()[:6]:
            print(f"     | {line}")
        R["生成启动日志"] = log.stat().st_size > 0
    else:
        print("   ✗ 无 start.log")
        R["生成启动日志"] = False

    # ---------- 清理 ----------
    print("\n[步骤5] 清理")
    try:
        proc.terminate()
        proc.wait(timeout=15)
        print("   已终止")
    except Exception as exc:  # noqa: BLE001
        print(f"   终止失败（{exc}），尝试 taskkill")
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("\n=== 双击场景验收 ===")
    for k, v in R.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    good = all(R.values())
    print(f"\n{'✅ 通过：打包版双击可用（无控制台）' if good else '❌ 未通过'}")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
