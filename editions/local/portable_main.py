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
3. 首次运行自动建库（空库 → 建表），并**自动打开浏览器**。

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
    _bootstrap()
    from webui.__main__ import main as webui_main
    return webui_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
