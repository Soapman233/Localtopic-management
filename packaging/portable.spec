# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：便携轻量个人客户端。

设计取舍
--------
* **onedir（目录模式）而非 onefile**：单文件包在 Windows 上极易被**杀毒软件误报**，
  且每次启动都要解压到临时目录（慢）。目录模式启动快、误报少。
* **数据不打进包**：``outputs/`` 由启动器钉到 exe 旁边（见 ``portable_main.py``），
  首次运行**自动建空库**——所以**不分发 62MB 的预建库**，包体大幅缩小。
* **不打包 Office/editor_sdk**：导出走自研 ``bank.docx_writer``，无需外部服务。
  Word/WPS 仅用于「打开」文件（消费端），不是生成依赖。

构建::

    pyinstaller packaging/portable.spec --noconfirm --clean
"""
import sys
from pathlib import Path

#: 仓库根目录（spec 在 packaging/ 下）。
ROOT = Path(SPECPATH).resolve().parent

# --- 需要随包分发的**数据文件**（非 Python 模块）--------------------------- #
datas: list[tuple[str, str]] = []

# 前端构建产物（FastAPI 静态托管）。必须先跑 `npm run build`。
_static = ROOT / "webui" / "static"
if _static.is_dir():
    datas.append((str(_static), "webui/static"))

# vendor 的 MTEF 解析器（MathType OLE → LaTeX，Apache-2.0）。
_vendor = ROOT / "pipeline" / "vendor"
if _vendor.is_dir():
    datas.append((str(_vendor), "pipeline/vendor"))

# --- 隐式依赖（PyInstaller 静态分析看不到的）------------------------------- #
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "multiprocessing.spawn",
    "multiprocessing.pool",
    # 自研导出链路（延迟导入，静态分析可能漏）
    "bank.docx_writer",
    "bank.latex2omml",
    "bank.backup",
    "pipeline.stage1",
    "pipeline.mtef_conv",
    "pipeline.docx_scan",
    "pipeline.segment",
    "webui.routers.imports",
    "webui.routers.backup",
    "webui.routers.network",
    "webui.services.import_svc",
    "webui.services.network_svc",
    "webui.services.tls_svc",
    # 局域网访问：二维码生成（延迟导入，静态分析会漏）
    "segno",
    # 局域网 HTTPS：自签证书生成（延迟导入，静态分析会漏）
    "cryptography",
    "cryptography.x509",
    "cryptography.hazmat.primitives.asymmetric.rsa",
    "cryptography.hazmat.primitives.hashes",
    "cryptography.hazmat.primitives.serialization",
    "cryptography.x509.oid",
]

# --- 排除（显著减小体积）--------------------------------------------------- #
excludes = [
    "tkinter", "matplotlib", "numpy", "scipy", "pandas",
    "PyQt5", "PySide2", "PySide6", "wx",
    "IPython", "jupyter", "notebook",
    "pytest", "httpx", "httpcore",  # httpx 仅测试用（TestClient）
    "setuptools", "pip", "wheel",
    "pydoc_data", "test", "unittest",
]

a = Analysis(
    [str(ROOT / "editions" / "local" / "portable_main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="题库",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,               # UPX 会显著提高杀毒误报率，不用
    console=False,           # 无控制台窗口（双击即用）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="题库",
)
