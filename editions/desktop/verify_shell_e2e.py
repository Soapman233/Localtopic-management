# -*- coding: utf-8 -*-
"""桌面外壳**端到端**验收（起服务 → 开窗口 → 单实例拦截）。

为什么还要单独一个 E2E
----------------------
`verify_desktop.py` 验的是**单元级契约**（互斥体语义、client_state 读写、closing 逻辑）。
但"外壳真的能起来"还依赖另外三件事，只有整条链路跑一遍才能确认：
  1. 子进程能否拉起 `webui` 并等到 `/api/health` 就绪；
  2. 窗口能否真的加载**真实应用**（而不是内联 HTML）；
  3. **第二个实例会不会被拦住**——而且**不会顺带再起一个后端服务**
     （这是单实例最容易被写错的地方：先起服务再判互斥体，等于每次双击都多一个服务）。

用法::

    python editions/desktop/verify_shell_e2e.py

⚠️ 会真的开一个窗口（约 20 秒）并起一个后端子进程，结束时**全部杀掉**。
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

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable
PORT = 8731
BASE = f"http://127.0.0.1:{PORT}"
DESKTOP = ROOT / "editions" / "desktop" / "desktop_main.py"

RESULTS: dict[str, bool] = {}


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS[name] = ok
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  —— {detail}" if detail else ""))


def _flags() -> int:
    return subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0


def health(port: int = PORT, timeout: float = 2.0) -> int | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as r:
            return r.status
    except (urllib.error.URLError, OSError):
        return None


def port_listening(port: int = PORT) -> bool:
    """用 netstat 判断端口是否被监听（比 connect 更贴近"有服务在跑"）。"""
    try:
        # ⚠️ 中文 Windows 的 netstat 输出是 **GBK**，不是 UTF-8——
        #    不指定编码会抛 UnicodeDecodeError（本文件第一版就踩了）。
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True,
            encoding="gbk", errors="replace", timeout=20,
        ).stdout or ""
    except Exception:  # noqa: BLE001
        return health(port) is not None
    return any(f":{port} " in line and "LISTENING" in line for line in out.splitlines())


def kill(proc: subprocess.Popen) -> None:
    try:
        subprocess.call(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001
        try:
            proc.terminate()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    if port_listening():
        print(f"[SKIP] 端口 {PORT} 已被占用，先清干净再跑。")
        return 0

    print("=== 桌面外壳端到端验收 ===")
    first = None
    try:
        # ---- ① 第一个实例：起服务 + 开窗口 ----
        print(f"\n[①] 启动第一个实例（端口 {PORT}）")
        first = subprocess.Popen(
            [PY, str(DESKTOP), "--port", str(PORT)],
            # 第一实例的 stdout 用不上：**不要用管道**——它的输出可能是 GBK，
            # 管道读取线程解码失败会抛 UnicodeDecodeError（本文件第一版就踩了）。
            cwd=str(ROOT), creationflags=_flags(), close_fds=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        ok = False
        for _ in range(60):
            time.sleep(1)
            if health() == 200:
                ok = True
                break
        check("后端服务就绪（/api/health = 200）", ok)
        check("端口在监听", port_listening())

        # 窗口是异步创建的：给它一点时间再判
        time.sleep(6)
        check("第一个实例仍在运行（窗口未崩）", first.poll() is None)

        # ---- ② 第二个实例：必须被单实例拦下 ----
        print(f"\n[②] 启动第二个实例（应被拦下、且**不再起服务**）")
        t0 = time.time()
        second = subprocess.run(
            [PY, str(DESKTOP), "--port", str(PORT)],
            cwd=str(ROOT), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=90, creationflags=_flags(),
        )
        elapsed = time.time() - t0
        out = (second.stdout or "") + (second.stderr or "")
        check("第二个实例快速退出（< 30 秒）", elapsed < 30, f"{elapsed:.1f}s")
        check("退出码为 0（正常路径，不是报错）", second.returncode == 0, f"rc={second.returncode}")
        check("提示「已有实例在运行」", "已有实例在运行" in out, out.strip().splitlines()[-1][:80] if out.strip() else "(无输出)")

        # 关键：第二个实例**不能**顺带再起一个服务 —— 端口只有一个监听者
        try:
            net = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True,
                encoding="gbk", errors="replace", timeout=20,
            ).stdout or ""
            pids = {ln.split()[-1] for ln in net.splitlines() if f":{PORT} " in ln and "LISTENING" in ln}
        except Exception:  # noqa: BLE001
            pids = set()
        check("端口仍只有 1 个监听者（第二个实例没起服务）", len(pids) == 1, f"listeners={sorted(pids)}")

        # ---- ③ 真实应用已加载 ----
        print("\n[③] 窗口指向的是真实应用")
        try:
            with urllib.request.urlopen(f"{BASE}/", timeout=5) as r:
                html = r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            html = ""
            check("首页可访问", False, str(e))
        else:
            check("首页可访问", True)
        check("首页是应用外壳（含 root 挂载点与 favicon）", 'id="root"' in html and "favicon" in html)
    finally:
        print("\n[清理]")
        if first is not None:
            kill(first)
            time.sleep(3)
        # 兜底：杀掉可能残留的 webui 子进程
        try:
            net = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True,
                encoding="gbk", errors="replace", timeout=20,
            ).stdout or ""
            for ln in net.splitlines():
                if f":{PORT} " in ln and "LISTENING" in ln:
                    pid = ln.split()[-1]
                    subprocess.call(["taskkill", "/F", "/PID", pid],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
        print(f"  端口已释放: {not port_listening()}")

    ok = all(RESULTS.values())
    print(f"\n端到端：{sum(1 for v in RESULTS.values() if v)} / {len(RESULTS)} 通过")
    print("\n🔴 仍需人工确认（自动化做不到）")
    print("  1) 点窗口 × → 窗口消失、进程仍在、托盘图标出现；双击托盘图标能唤回窗口")
    print("  2) 关掉窗口再启动 → 主题偏好与局域网令牌仍在（storage_path 生效）")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
