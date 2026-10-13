# -*- coding: utf-8 -*-
"""桌面客户端外壳 · **骨架（未实现、未验证）**。

🔴 **诚实标注（务必先读）**
================================
1. **未安装依赖**：`pywebview` / `pystray` **没有**写进 `requirements.txt`，本轮不安装。
2. **未端到端验证**：本文件从未在装有 pywebview 的机器上跑通过；下面每一处都只保证「结构正确」，
   不保证「行为正确」。**不要**声称外壳可用。
3. 设计规范 §4.5 的 7 条契约里，**3 条靠外壳实现**——单实例、最小化到托盘、`client_state.db`；
   这 3 条在本文件里都是 **TODO 占位**（见对应函数）。另外 4 条已在前端落地，外壳无需重复做。

技术选型
--------
**pywebview + 系统 WebView2**（Windows 11 自带 Edge WebView2 Runtime）。外壳层预计 **+3–8 MB**。

为什么「跟随系统深色」在外壳里**不需要**额外代码
------------------------------------------------
前端 `frontend/src/lib/themeMode.ts` 已用 `window.matchMedia('(prefers-color-scheme: dark)')`
并监听变化；WebView2 会把操作系统的深浅偏好透传给页面。外壳只要正常起窗口，前端即自动跟随系统。
**不要**在外壳里再写一套主题判断——两套会互相打架。

用法（**当前会因缺依赖而失败，属预期**）::

    python editions/desktop/desktop_main.py            # 默认 127.0.0.1:8720
    python editions/desktop/desktop_main.py --port 9000
"""
from __future__ import annotations

# ⚠️ 与 editions/local/portable_main.py 同理：冻结后 spawn 子进程会重跑本文件，
#    没有 freeze_support() 会导致无限递归启动（源码运行时是空操作）。
import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()

import argparse
import os
import socket
import sys
import threading
import time
from pathlib import Path

#: 客户端 UX 状态库文件名（**绝不**写进 `bank.db`）。规范 §4.5「状态库」条。
CLIENT_STATE_DB_NAME = "client_state.db"


# --------------------------------------------------------------------------- #
# 路径 / 环境（与本地便携版同口径）
# --------------------------------------------------------------------------- #
def _data_root() -> Path:
    """数据根目录：打包后 = exe 所在目录；源码运行 = 仓库根。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _bootstrap() -> None:
    """把数据根目录钉到 exe 旁边，并确保包可导入。"""
    root = _data_root()
    os.environ.setdefault("QB_DATA_ROOT", str(root))
    os.environ.setdefault("QB_EDITION", "local")
    os.environ.setdefault("QB_EXPORT_ENGINE", "native")
    if not getattr(sys, "frozen", False):
        repo = Path(__file__).resolve().parents[2]
        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))


def _client_state_db_path() -> Path:
    """客户端 UX 状态库路径（`outputs/webui/client_state.db`）。

    ⚠️ **TODO（待外壳实现）**：本轮**不建库、不建表**，仅约定路径。
    该库只放客户端界面状态（窗口位置 / 上次页面 / 托盘提示已读…），
    **绝不**写题库数据（那是 `outputs/bank.db` 的职责）。
    """
    return _data_root() / "outputs" / "webui" / CLIENT_STATE_DB_NAME


# --------------------------------------------------------------------------- #
# 单实例（TODO）
# --------------------------------------------------------------------------- #
def _acquire_single_instance() -> bool:
    """尝试取得单实例锁；返回是否为本机唯一实例。

    ⚠️ **TODO（待外壳实现）**：规范 §4.5 第 2 条要求「重复双击**聚焦已有窗口**」。

    候选方案（均**未验证**）：
      * Windows 具名互斥体：`ctypes.windll.kernel32.CreateMutexW(None, False, name)`，
        已存在则 `GetLastError() == ERROR_ALREADY_EXISTS`；随后用
        `FindWindowW` + `SetForegroundWindow` 聚焦已有窗口（需与 pywebview 的窗口句柄联动）。
      * 退化方案：把「窗口句柄 + 进程 id」写入 `client_state.db`，启动时探测存活。

    当前实现**恒返回 True**（即不做单实例约束）——以免给出「看起来已实现」的假象。
    """
    return True


# --------------------------------------------------------------------------- #
# 托盘（TODO）
# --------------------------------------------------------------------------- #
def _setup_tray(window: object) -> None:
    """配置系统托盘与「关闭 = 最小化到托盘」。

    ⚠️ **TODO（待外壳实现）**：规范 §4.5 第 3 条。

    候选做法（**未验证**）：
      * 监听 `window.events.closing`：返回 `False` 取消关闭，改为 `window.hide()`；
      * 托盘用 `pystray`（**尚未引入依赖**）提供「显示 / 退出」菜单——
        必须给「退出」，否则隐藏后用户只能靠任务管理器结束进程。

    当前为空实现（占位），参数 `window` 暂未使用。
    """
    _ = window  # 占位：待实现时替换为真实的托盘逻辑
    return None


# --------------------------------------------------------------------------- #
# 内嵌 webui 服务
# --------------------------------------------------------------------------- #
def _free_port(preferred: int) -> int:
    """优先用 `preferred`；被占用时退回系统分配的空闲端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])


def _start_webui(host: str, port: int) -> threading.Thread:
    """在后台线程里启动 `webui`（uvicorn）。

    ⚠️ **未验证**：webui 的启动入口签名以 `webui/__main__.py` 为准；
    若其内部假定「在主线程运行」，后台线程启动可能失败（需实测调整）。
    """
    def _run() -> None:
        from webui.__main__ import main as webui_main  # 延迟导入：先完成 _bootstrap()
        webui_main(["--host", host, "--port", str(port)])

    t = threading.Thread(target=_run, name="webui", daemon=True)
    t.start()
    return t


def _wait_ready(host: str, port: int, timeout_s: float = 20.0) -> bool:
    """轮询端口直到可连接（或超时）。"""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.2)
    return False


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="题库桌面客户端外壳（骨架，未验证）")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8720)
    parser.add_argument("--no-window", action="store_true", help="只起服务、不开窗口（排障用）")
    args = parser.parse_args(argv)

    if not _acquire_single_instance():
        # TODO：此处应「聚焦已有窗口」后直接返回 0。
        print("已有实例在运行（单实例逻辑尚未实现）。", file=sys.stderr)
        return 0

    _bootstrap()
    print(f"客户端 UX 状态库（未启用）：{_client_state_db_path()}")

    port = _free_port(args.port)
    _start_webui(args.host, port)
    if not _wait_ready(args.host, port):
        print("webui 未在预期时间内就绪；本骨架未做错误处理，请查看 outputs/webui/start.log。", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{port}/"
    if args.no_window:
        print(f"webui 已就绪：{url}（--no-window，未开窗口）")
        return 0

    # ⚠️ 延迟导入 + 诚实失败：未安装 pywebview 时给出可读提示，而不是 ImportError 栈。
    try:
        import webview  # type: ignore[import-not-found]  # noqa: PLC0415 - 延迟导入是刻意的
    except ImportError:
        print(
            "缺少依赖 pywebview（本轮刻意未加入 requirements.txt）。\n"
            "本文件是**未验证的骨架**，安装依赖并端到端验证前不要使用。",
            file=sys.stderr,
        )
        return 2

    window = webview.create_window("初中物理 · 题库与组卷", url)
    # ⚠️ TODO：托盘与「关闭 = 最小化到托盘」尚未实现（规范 §4.5 第 3 条）。
    _setup_tray(window)
    # ⚠️ TODO：单实例「聚焦已有窗口」尚未实现（规范 §4.5 第 2 条）。
    #
    # 「跟随系统深色」无需在此处理：前端 matchMedia 已跟随系统，WebView2 会透传 OS 偏好。
    webview.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
