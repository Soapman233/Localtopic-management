# -*- coding: utf-8 -*-
"""便携客户端启动入口（供 PyInstaller 打包）。

为什么需要单独的入口
--------------------
1. **``freeze_support()`` 必须最早调用**——``pipeline/mtef_conv.py`` 用
   ``multiprocessing`` 的 **spawn** 上下文处理 MathType 公式。冻结（打包）后，
   spawn 会重新执行本入口；若不加 ``freeze_support()``，子进程会**递归启动整个
   应用**（经典 PyInstaller + multiprocessing 故障）。源码运行时该调用是空操作。
2. **数据必须落在 exe 旁边，而不是临时解包目录**——打包后 ``webui.config.ROOT``
   会解析到 ``_MEIPASS``（临时目录，退出即删）。本入口用 ``QB_DATA_ROOT``
   把数据根目录钉到 exe 所在目录，实现「绿色免安装、数据随身」。
3. **GUI 子系统下 ``sys.stdout``/``sys.stderr`` 是 ``None``**（见 :func:`_ensure_streams`)——
   打包用 ``console=False``（双击不弹黑窗），PE 子系统为 ``WINDOWS_GUI``，
   **任何启动方式都不会分配控制台**。而 uvicorn 配置日志时会读
   ``sys.stdout.isatty()`` → ``AttributeError: 'NoneType' object has no attribute 'isatty'``
   → **进程直接崩溃**。必须先把它们接到日志文件。
4. 首次运行自动建库（空库 → 建表），并**自动打开浏览器**。

用法（源码运行也可，便于排障）::

    python editions/local/portable_main.py            # 默认 127.0.0.1:8720
    python editions/local/portable_main.py --port 9000 --no-browser
"""
from __future__ import annotations

# ⚠️ 必须最先执行：冻结后 spawn 子进程会重跑本文件，没有它会导致无限递归启动。
import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()

import os
import sys
from pathlib import Path


def _data_root() -> Path:
    """数据根目录：打包后 = exe 所在目录；源码运行 = 仓库根。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def log_path() -> Path:
    """启动日志路径（``<数据根>/outputs/webui/start.log``）。"""
    return _data_root() / "outputs" / "webui" / "start.log"


def _ensure_streams() -> Path | None:
    """保证 ``sys.stdout``/``sys.stderr`` 非 ``None``，否则接到日志文件。

    🔴 **这是打包版能否双击运行的关键**：``console=False`` 的 exe 是
    ``WINDOWS_GUI`` 子系统，**不分配控制台**，``sys.stdout`` 为 ``None``；
    uvicorn 的日志配置会访问 ``sys.stdout.isatty()`` 而**崩溃**。

    接到文件还顺带解决了「首启无日志、出错看不到原因」的问题。

    返回日志路径（无需接管时为 ``None``）。
    """
    if sys.stdout is not None and sys.stderr is not None:
        return None
    target = log_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # line buffering：崩溃时也能看到最后一行
        fh = open(target, "a", encoding="utf-8", buffering=1)
    except Exception:  # noqa: BLE001 - 日志建不出来也不能因此启动失败
        import io
        fh = io.StringIO()
    if sys.stdout is None:
        sys.stdout = fh
    if sys.stderr is None:
        sys.stderr = fh
    return target


def _fatal(title: str, message: str) -> None:
    """致命错误：写日志 + **弹窗**告知用户（无控制台时否则什么都看不到）。"""
    try:
        print(f"[FATAL] {message}", file=sys.stderr or sys.__stderr__)
    except Exception:  # noqa: BLE001
        pass
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, f"{message}\n\n日志：{log_path()}",
                                         title, 0x10)  # MB_ICONERROR
    except Exception:  # noqa: BLE001 - 非 Windows / 无 GUI 时静默
        pass


def _bootstrap() -> None:
    """把数据根目录钉到 exe 旁边，并确保包可导入。"""
    root = _data_root()
    # 用 setdefault：允许用户显式覆盖（例如把数据放到 U 盘另一个目录）
    os.environ.setdefault("QB_DATA_ROOT", str(root))
    # 便携版默认不启用鉴权（单机单用户），并默认使用自研导出引擎
    os.environ.setdefault("QB_EDITION", "local")
    os.environ.setdefault("QB_EXPORT_ENGINE", "native")
    if not getattr(sys, "frozen", False):
        repo = Path(__file__).resolve().parents[2]
        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))


def main(argv: list[str] | None = None) -> int:
    # ⚠️ 顺序不可颠倒：先接好流，再 import webui/uvicorn（它们会在导入/配置时读 stdout）
    _ensure_streams()
    _bootstrap()
    try:
        from webui.__main__ import main as webui_main
        return webui_main(argv)
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - 无控制台时必须让用户看见
        import traceback
        traceback.print_exc()
        _fatal("题库启动失败", f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
