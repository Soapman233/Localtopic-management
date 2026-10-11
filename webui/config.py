"""配置读写与环境自检。

职责
----
1. **路径常量**：项目根、DB 路径、导出目录、预览缓存目录、静态资源目录、设置文件。
2. **设置读写**：持久化到 ``outputs/webui/settings.json``（DB 路径、导出目录、默认模板、
   KaTeX 偏好、主题偏好），带字段校验；缺失字段回落到默认值。
3. **环境自检（M3 裁定）**：检测 editor_sdk 服务（默认 127.0.0.1:39099 起探测 10 个端口）
   与本机 Office（Microsoft Word / WPS）。缺失时给出**降级说明**，供启动器与前端明确提示，
   **不静默失败**。

约定
----
* 本模块**只依赖标准库**（``json`` / ``socket`` / ``winreg`` 按需导入）。
* 所有路径为绝对路径（基于 ``webui/`` 包的父目录，即项目根）。
"""
# ---------------------------------------------------------------------------
# title: webui 配置与环境自检
# description: 路径常量、settings.json 读写与校验（含主色格式/深色布尔）、editor_sdk/Office 环境检测与降级说明。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import os
import re
import socket
from pathlib import Path

# --------------------------------------------------------------------------- #
# 路径常量
# --------------------------------------------------------------------------- #
#: 项目根目录（``webui/`` 包的父目录）。
ROOT = Path(__file__).resolve().parent.parent

#: **数据根目录**——``outputs/`` 挂在这里。
#:
#: 源码运行时等于 :data:`ROOT`（数据就在仓库里，保持便携）。
#: **打包（PyInstaller）后必须由启动器用 ``QB_DATA_ROOT`` 指向 exe 所在目录**——
#: 否则 ``ROOT`` 会解析到 ``_MEIPASS`` 临时解包目录，数据写进去**退出即丢**。
DATA_ROOT = Path(os.environ.get("QB_DATA_ROOT") or ROOT).resolve()

#: ``outputs/`` 目录。
OUTPUTS_DIR = DATA_ROOT / "outputs"
#: Web 运行时产物目录（设置、预览缓存）。
WEBUI_DIR = OUTPUTS_DIR / "webui"
#: 默认题库数据库。
DEFAULT_DB_PATH = OUTPUTS_DIR / "bank.db"
#: 默认导出目录。
EXPORT_DIR = OUTPUTS_DIR / "export"
#: 预览缓存目录。
PREVIEW_CACHE_DIR = WEBUI_DIR / "preview_cache"
#: 设置文件。
SETTINGS_PATH = WEBUI_DIR / "settings.json"
#: 前端构建产物目录（FastAPI 静态托管）。
STATIC_DIR = Path(__file__).resolve().parent / "static"

#: 服务监听地址 / 端口（只监听回环，符合「纯本地单机、不涉公网」）。
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8720

#: editor_sdk MCP 默认端口与探测个数（与 ``bank/export.py`` 对齐）。
EDITOR_SDK_DEFAULT_PORT = 39099
EDITOR_SDK_PORT_SCAN = 10

#: 试卷模板 / 答案模式取值域（与 ``bank.paper`` 对齐）。
TEMPLATES: tuple[str, ...] = ("考试", "测验", "作业")
ANSWER_MODES: tuple[str, ...] = ("学生版", "答案解析版", "仅答案")

#: 默认设置。
DEFAULT_SETTINGS: dict = {
    "db_path": str(DEFAULT_DB_PATH),
    "export_dir": str(EXPORT_DIR),
    "default_template": "考试",
    "katex": {"throw_on_error": False, "strict": False},
    "theme": {"primary": "#3370FF", "dark": False},
}


# --------------------------------------------------------------------------- #
# 设置读写
# --------------------------------------------------------------------------- #
def _read_json(path: Path) -> dict:
    """读取 JSON 文件；不存在 / 损坏时返回空字典（不抛异常）。"""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _merge(base: dict, override: dict) -> dict:
    """浅合并（嵌套字典逐层合并），返回新字典。"""
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            merged = dict(out[key])
            merged.update(value)
            out[key] = merged
        else:
            out[key] = value
    return out


def validate_settings(patch: dict) -> None:
    """校验设置补丁；非法则抛 :class:`ValueError`（含可读原因）。"""
    if not isinstance(patch, dict):
        raise ValueError("设置必须是对象")
    if "db_path" in patch:
        if not isinstance(patch["db_path"], str) or not patch["db_path"].strip():
            raise ValueError("db_path 必须是非空字符串")
    if "export_dir" in patch:
        if not isinstance(patch["export_dir"], str) or not patch["export_dir"].strip():
            raise ValueError("export_dir 必须是非空字符串")
    if "default_template" in patch:
        if patch["default_template"] not in TEMPLATES:
            raise ValueError(f"default_template 取值必须是 {TEMPLATES}，"
                             f"收到 {patch['default_template']!r}")
    if "katex" in patch:
        if not isinstance(patch["katex"], dict):
            raise ValueError("katex 必须是对象")
    if "theme" in patch:
        if not isinstance(patch["theme"], dict):
            raise ValueError("theme 必须是对象")
        theme = patch["theme"]
        if "primary" in theme and (not isinstance(theme["primary"], str)
                                  or not re.fullmatch(r"#[0-9a-fA-F]{6}", theme["primary"])):
            raise ValueError("主色必须为 #RRGGBB 格式的颜色")
        if "dark" in theme and not isinstance(theme["dark"], bool):
            raise ValueError("深色模式必须为布尔值")


def load_settings() -> dict:
    """读取设置（与默认值合并）；文件缺失/损坏时返回默认值。"""
    return _merge(DEFAULT_SETTINGS, _read_json(SETTINGS_PATH))


def save_settings(settings: dict) -> dict:
    """写出设置到 ``settings.json``，返回写入后的完整设置。"""
    validate_settings(settings)
    merged = _merge(DEFAULT_SETTINGS, settings)
    WEBUI_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2),
                             encoding="utf-8")
    return merged


def get_settings() -> dict:
    """当前设置（读文件 + 合并默认值）。"""
    return load_settings()


def update_settings(patch: dict) -> dict:
    """更新部分设置字段并持久化，返回更新后的完整设置。"""
    validate_settings(patch)
    return save_settings(_merge(load_settings(), patch))


def get_db_path() -> Path:
    """当前生效的数据库路径。

    优先级：环境变量 ``QB_DB_PATH``（线上/容器部署常用）→ 设置文件 → 默认路径。
    """
    override = os.environ.get("QB_DB_PATH", "").strip()
    if override:
        return Path(override)
    return Path(load_settings().get("db_path") or DEFAULT_DB_PATH)


def get_export_dir() -> Path:
    """当前生效的导出目录。

    优先级：环境变量 ``QB_EXPORT_DIR`` → 设置文件 → 默认目录。
    """
    override = os.environ.get("QB_EXPORT_DIR", "").strip()
    if override:
        return Path(override)
    return Path(load_settings().get("export_dir") or EXPORT_DIR)


# --------------------------------------------------------------------------- #
# 环境自检（M3）
# --------------------------------------------------------------------------- #
def detect_editor_sdk(*, timeout: float = 1.0) -> dict:
    """检测本机 editor_sdk MCP 服务是否可达。

    端口发现规则与 ``bank/export.py`` 对齐：``editor_sdk_port`` 环境变量优先，
    否则从 :data:`EDITOR_SDK_DEFAULT_PORT` 起依次探测 :data:`EDITOR_SDK_PORT_SCAN` 个端口。
    仅做 TCP 连通性探测（快速、无副作用）。
    """
    configured = os.environ.get("editor_sdk_port", "").strip()
    if configured.isdigit():
        ports = [int(configured)]
    else:
        ports = list(range(EDITOR_SDK_DEFAULT_PORT,
                           EDITOR_SDK_DEFAULT_PORT + EDITOR_SDK_PORT_SCAN))
    for port in ports:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect(("127.0.0.1", port))
            return {"available": True, "port": port,
                    "endpoint": f"http://127.0.0.1:{port}/mcp"}
        except OSError:
            continue
        finally:
            sock.close()
    return {"available": False, "port": None,
            "endpoint": None, "scanned_ports": ports}


def _app_path(exe_name: str) -> str | None:
    """从注册表 ``App Paths`` 查可执行文件路径（Windows）；查不到返回 None。"""
    try:
        import winreg  # 仅 Windows 可用
    except ImportError:  # pragma: no cover - 非 Windows
        return None
    subkeys = (
        rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}",
        rf"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}",
    )
    for subkey in subkeys:
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    value, _ = winreg.QueryValueEx(key, "")
                    if value:
                        return str(value)
            except OSError:
                continue
    return None


def detect_office() -> dict:
    """检测本机 Office 客户端（Microsoft Word / WPS）。

    用于 PDF 导出能力判断：``bank.export.export_pdf`` 优先 Word、回退 WPS。
    通过注册表 ``App Paths`` 检测，**不启动任何 Office 进程**。
    """
    word = _app_path("WINWORD.EXE")
    wps = _app_path("wps.exe") or _app_path("wpsmain.exe")
    return {
        "word": {"available": bool(word), "path": word},
        "wps": {"available": bool(wps), "path": wps},
        "available": bool(word or wps),
    }


def environment_report() -> dict:
    """汇总环境自检结果，并给出**降级说明**（M3）。

    返回 ``{"editor_sdk": {...}, "office": {...}, "degraded": bool, "messages": [...]}``。
    缺失依赖时 ``messages`` 明确说明哪项能力被降级，供启动器打印与前端提示。
    """
    editor = detect_editor_sdk()
    office = detect_office()
    messages: list[str] = []
    if not editor["available"]:
        messages.append(
            "未检测到 editor_sdk 服务（127.0.0.1:39099 起）：公式渲染与 DOCX/PDF "
            "导出不可用。请先启动 editor_sdk 后再使用导出功能。")
    if not office["available"]:
        messages.append(
            "未检测到 Microsoft Word / WPS：无法导出 PDF，已降级为「仅导出 DOCX」。"
            "如需 PDF，请安装 Word 或 WPS。")
    return {
        "editor_sdk": editor,
        "office": office,
        "degraded": bool(messages),
        "messages": messages,
    }


__all__ = [
    "ROOT", "DATA_ROOT", "OUTPUTS_DIR", "WEBUI_DIR", "DEFAULT_DB_PATH", "EXPORT_DIR",
    "PREVIEW_CACHE_DIR", "SETTINGS_PATH", "STATIC_DIR", "DEFAULT_HOST", "DEFAULT_PORT",
    "EDITOR_SDK_DEFAULT_PORT", "EDITOR_SDK_PORT_SCAN", "TEMPLATES", "ANSWER_MODES",
    "DEFAULT_SETTINGS",
    "load_settings", "save_settings", "get_settings", "update_settings",
    "validate_settings", "get_db_path", "get_export_dir",
    "detect_editor_sdk", "detect_office", "environment_report",
]
