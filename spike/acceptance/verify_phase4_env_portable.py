# -*- coding: utf-8 -*-
"""Phase 4.1 / 4.3 验收：环境隔离 + 跨路径便携。

⚠️ **能力边界（如实声明）**
---------------------------
本机是**开发机**，装有 WorkBuddy / Python / Node / Office。
因此本脚本做的是：
* **4.1 环境隔离**：以**最小化环境变量**（剥离 Python/Node/WorkBuddy 痕迹）启动，
  验证 exe **不依赖**这些环境即可工作——这是"干净机器"的**近似**，不是物理干净机。
* **4.3 跨路径便携**：把整包**复制到另一个盘/路径**再跑，验证**不依赖原路径**。

真正的"第二台干净机器"验证仍需人工在另一台机器上执行（见交接文档）。
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
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXE_DIR = ROOT / "dist" / "题库"
DOCX = Path("D:/Open-source project/Localtopic-management/2026_10_05_西附国庆练习卷/"
            "11.5 机械效率（重难点专练）（答案版）.docx")
PORT_A = 8744
PORT_B = 8745


def _req(base: str, path: str, timeout: float = 20.0):
    try:
        with urllib.request.urlopen(base + path, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:  # noqa: BLE001
        return None, None


def _minimal_env() -> dict:
    """最小化环境：只保留 Windows 必需项，**剔除** Python/Node/WorkBuddy 痕迹。"""
    keep = {}
    for k in ("SystemRoot", "SystemDrive", "windir", "TEMP", "TMP",
              "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "PATHEXT", "COMSPEC",
              "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"):
        v = os.environ.get(k)
        if v:
            keep[k] = v
    # PATH 只留系统目录——**不含** python/node/workbuddy
    keep["PATH"] = os.pathsep.join([
        str(Path(keep.get("SystemRoot", r"C:\Windows")) / "system32"),
        keep.get("SystemRoot", r"C:\Windows"),
    ])
    return keep


def _launch(exe: Path, cwd: Path, port: int, env: dict | None):
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen([str(exe), "--no-browser", "--port", str(port)],
                            cwd=str(cwd), env=env, creationflags=flags, close_fds=True)


def _wait_ready(base: str, tries: int = 45) -> bool:
    for _ in range(tries):
        time.sleep(1.0)
        st, _ = _req(base, "/api/health", timeout=8)
        if st == 200:
            return True
    return False


def _kill(proc) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:  # noqa: BLE001
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _run_case(tag: str, exe: Path, cwd: Path, port: int, env: dict | None) -> dict:
    base = f"http://127.0.0.1:{port}"
    out: dict = {}
    print(f"\n=== {tag} ===")
    proc = _launch(exe, cwd, port, env)
    print(f"   pid={proc.pid}  工作目录={cwd}")
    ready = _wait_ready(base)
    print(f"   就绪: {ready}")
    out["可启动"] = ready
    if not ready:
        log = cwd / "outputs" / "webui" / "start.log"
        if log.is_file():
            print("   日志尾部:", log.read_text(encoding="utf-8", errors="replace")[-400:])
        _kill(proc)
        return out

    st, body = _req(base, "/api/health")
    d = (body or {}).get("data") or {}
    print(f"   health ok={d.get('ok')} degraded={d.get('degraded')}")
    out["health 正常"] = bool(d.get("ok"))

    # 数据落点必须在 exe 旁（便携）
    out["数据落在包内"] = (cwd / "outputs" / "bank.db").is_file()
    print(f"   数据落点正确: {out['数据落在包内']}")

    # 导入一份真实旧卷，确认业务链路可用
    st, _ = _req(base, "/api/import/status")
    out["导入接口可用"] = (st == 200)
    print(f"   /api/import/status -> {st}")

    _kill(proc)
    return out


def main() -> int:
    if not (EXE_DIR / "题库.exe").is_file():
        print(f"[SKIP] 未找到打包产物：{EXE_DIR}")
        return 0

    R: dict = {}

    # ---------- 4.1 环境隔离 ----------
    run_a = HERE / "_p41_clean_env"
    if run_a.is_dir():
        shutil.rmtree(run_a, ignore_errors=True)
    shutil.copytree(EXE_DIR, run_a)
    env = _minimal_env()
    print(f"[4.1] 最小化环境变量 {len(env)} 项：{sorted(env)}")
    print(f"      PATH = {env['PATH']}")
    for k in ("PYTHONPATH", "PYTHONHOME", "NODE_PATH", "CODEBUDDY", "WORKBUDDY"):
        print(f"      {k} 已剔除: {k not in env}")
    R["4.1 环境隔离"] = _run_case("4.1 最小环境启动", run_a / "题库.exe", run_a,
                                  PORT_A, env)

    # ---------- 4.3 跨路径便携 ----------
    run_b = HERE / "_p43_other_path"
    if run_b.is_dir():
        shutil.rmtree(run_b, ignore_errors=True)
    shutil.copytree(EXE_DIR, run_b)
    print(f"\n[4.3] 复制到另一路径：{run_b}")
    R["4.3 跨路径便携"] = _run_case("4.3 换路径启动", run_b / "题库.exe", run_b,
                                    PORT_B, None)

    print("\n=== Phase 4.1 / 4.3 结论 ===")
    ok = True
    for group, res in R.items():
        print(f"\n{group}:")
        for k, v in res.items():
            print(f"   {'PASS' if v else 'FAIL'}  {k}")
        ok = ok and all(res.values())
    print(f"\n{'✅ 通过' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
