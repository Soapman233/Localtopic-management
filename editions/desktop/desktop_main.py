# -*- coding: utf-8 -*-
"""桌面客户端外壳（pywebview + 系统 WebView2）。

设计规范 §4.5 的 7 条契约里，**3 条必须靠外壳实现**——本文件就是这 3 条：
  ① 单实例（重复双击 → 聚焦已有窗口，不新开）
  ② 关闭 × → 最小化到托盘（不是退出）
  ③ 客户端 UX 状态放 `outputs/webui/client_state.db`（**绝不写 `bank.db`**）

另 4 条（自动保存明示 / 继续上次的卷 / 首启四步引导 / 跟随系统深色）**已在前端落地**
（见 `frontend/src/components/AutosaveNotice.tsx` 等），外壳**无需重复做**——
尤其是主题：前端用 `matchMedia('(prefers-color-scheme: dark)')` 并监听变化，
WebView2 会把系统偏好透传给页面，**外壳里再写一套会与前端打架**。

🔴 两个"不设就出错"的参数（实测查过 pywebview 6.2.1 源码）
----------------------------------------------------------
1. **`storage_path` 必须设**：`winforms.py:743` 是
   `if not _state['private_mode'] or _state['storage_path']:` ——
   不设就落回 pywebview 自己的目录，且**默认 `private_mode=True` 会每次启动清空站点数据**。
   本应用把**主题偏好**与**局域网令牌**都存在 `localStorage`，清空 = 用户每次开都要重新扫码/重设主题。
2. **`window.events.closing` 返回 `False` 会取消关闭**（`window.py:163` 的 `Event(self, True)`，
   第二个参数即"使用处理函数返回值"）——这是"点 × 只最小化"的实现依据。

技术选型
--------
pywebview + **系统 WebView2**（Windows 11 自带 Edge WebView2 Runtime；本机实测 154.0.4258.62）。
外壳层预计 **+3–8 MB**（不含 PyInstaller 已带的 Python 运行时），无 Electron 那样的整包 Chromium。

用法::

    python editions/desktop/desktop_main.py            # 起窗口
    python editions/desktop/verify_desktop.py          # 自动化验收（单实例 / client_state / 窗口）
"""
from __future__ import annotations

import ctypes
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from pathlib import Path

# ── 常量 ────────────────────────────────────────────────────────────────────
APP_TITLE = "初中物理 · 题库与组卷"
DEFAULT_PORT = 8720
#: 单实例互斥体名（**Local\ 前缀 = 每个登录会话一个实例**；用 Global\ 需要额外权限）。
MUTEX_NAME = r"Local\QB_Tiku_SingleInstance_v1"
#: `client_state.db` 的表结构版本（将来加字段时用得上）。
STATE_SCHEMA_VERSION = 1

ERROR_ALREADY_EXISTS = 183
SW_RESTORE = 9


def app_root() -> Path:
    """数据根：打包后 = exe 所在目录；源码运行 = 仓库根。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def client_state_path(root: Path | None = None) -> Path:
    """`client_state.db` 的路径。

    ⚠️ 放在 `outputs/webui/`（与 `settings.json`、`auth.db` 同级），
    **绝不放进 `bank.db`**——那是交付数据，客户端 UX 状态不属于它。
    """
    return (root or app_root()) / "outputs" / "webui" / "client_state.db"


# ── 契约 ③：客户端状态库 ────────────────────────────────────────────────────
class ClientState:
    """客户端 UX 状态（键值表）。

    为什么单独一个库而不是复用 `settings.json`：`settings.json` 是**应用设置**
    （老师可见、可改、会被同步），而这里是**外壳行为状态**（窗口位置、是否已看过引导、
    是否请求退出）。两者生命周期与可见性都不同，混在一起会让"设置"里冒出老师看不懂的键。
    """

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or client_state_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # ⚠️ 用 `closing()` 而不是 `with sqlite3.connect(...)`：
        #    后者只提交/回滚事务、**不关闭连接**，在 Windows 上会让文件被占用。
        #    （本项目在备份模块踩过同一个坑。）
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS kv ("
                "  key TEXT PRIMARY KEY,"
                "  value TEXT NOT NULL,"
                "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
                ")"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
                (str(STATE_SCHEMA_VERSION),),
            )
            conn.commit()

    def get(self, key: str, default: str | None = None) -> str | None:
        with closing(sqlite3.connect(self.path)) as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set(self, key: str, value: str) -> None:
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute(
                "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                (key, value),
            )
            conn.commit()

    def get_json(self, key: str, default=None):
        raw = self.get(key)
        if raw is None:
            return default
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default

    def set_json(self, key: str, value) -> None:
        self.set(key, json.dumps(value, ensure_ascii=False))

    # ---- 具体用途（都只是上面的薄封装，便于调用方不写裸键名） ----
    def get_window_geometry(self) -> dict:
        return self.get_json("window_geometry", {}) or {}

    def set_window_geometry(self, x: int, y: int, width: int, height: int) -> None:
        self.set_json("window_geometry", {"x": x, "y": y, "width": width, "height": height})

    def request_quit(self) -> None:
        """托盘「退出」置位：关闭处理函数看到它才真正退出（否则只最小化）。"""
        self.set("quit_requested", "1")

    def quit_requested(self) -> bool:
        return self.get("quit_requested") == "1"


# ── 契约 ①：单实例 ─────────────────────────────────────────────────────────
class SingleInstance:
    """Windows 命名互斥体实现的单实例。

    第二个实例**不新开窗口**，而是找到第一个实例的窗口并把它带到前台——
    这正是规范 §4.5「重复双击聚焦已有窗口」的要求。
    """

    def __init__(self, name: str = MUTEX_NAME) -> None:
        # `use_last_error=True` 才能可靠地读 GetLastError（`ctypes.windll` 不捕获）。
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._user32 = ctypes.WinDLL("user32", use_last_error=True)
        self._name = name
        self._handle = None

    def acquire(self) -> bool:
        """尝试成为唯一实例。返回 False 表示已有实例在跑。"""
        handle = self._kernel32.CreateMutexW(None, False, self._name)
        if not handle:
            # 建不出来就别拦着用户：宁可多开一个，也不能因为互斥体失败而打不开应用。
            return True
        already = ctypes.get_last_error() == ERROR_ALREADY_EXISTS
        if already:
            self._kernel32.CloseHandle(handle)
            return False
        self._handle = handle
        return True

    def focus_existing(self, title: str = APP_TITLE) -> bool:
        """把已有实例的窗口带到前台（按窗口标题查找）。

        返回是否找到。**找不到不算错误**——可能第一个实例还在启动中（窗口尚未创建），
        此时安静退出即可，用户再点一次就行。
        """
        return focus_window_by_title(title)

    def release(self) -> None:
        if self._handle:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


# ── 契约 ②：关闭 → 托盘 ─────────────────────────────────────────────────────
def focus_window_by_title(title: str = APP_TITLE) -> bool:
    """把标题匹配的窗口带到前台（`FindWindowW` + `ShowWindow(SW_RESTORE)` + `SetForegroundWindow`）。

    单独抽出来是因为**两个场景都要用**：第二个实例聚焦已有窗口、以及托盘「显示主窗口」。
    """
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = user32.FindWindowW(None, title)
    if not hwnd:
        return False
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
    return True


class TrayController:
    """系统托盘图标（pystray）。

    🔴 三条硬要求（**第一版全都违反了，导致"点 × 后找不到页面"**）
    -------------------------------------------------------------
    1. **启动时就创建图标**，而不是等到第一次关闭。第一版只在 `closing` 里 `start()`，
       于是用户根本不知道有托盘图标存在，Win11 还会把新图标收进折叠区（`^`）——
       **两个因素叠加 = 找不到**。
    2. **必须能确认图标真的在跑**（`start()` 返回 True 且线程存活）。
       第一版 `start()` 把异常全吞了、返回 False 也没人看，**照样隐藏窗口** →
       托盘不可用时用户被彻底困住。现在调用方会用这个返回值决定"能不能最小化"。
    3. **幂等**：第一版每次关闭都 `start()`，会重复建图标/线程。
    """

    def __init__(self, on_show, on_quit, title: str = APP_TITLE) -> None:
        self._on_show = on_show
        self._on_quit = on_quit
        self._title = title
        self._icon = None
        self._thread: threading.Thread | None = None
        self._last_error: str | None = None

    @staticmethod
    def _image():
        """画一个简单的托盘图标（PIL 画，不依赖外部图片文件）。

        图案与 `frontend/public/favicon.svg` 一致：品牌蓝底 + 白色纸面。
        """
        from PIL import Image, ImageDraw

        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=14, fill=(47, 99, 234, 255))
        d.rectangle((18, 12, 44, 52), fill=(255, 255, 255, 255))
        for i, y in enumerate((22, 30, 38)):
            d.rectangle((23, y, 39 if i < 2 else 33, y + 3), fill=(159, 179, 224, 255))
        return img

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def registered(self) -> bool:
        """图标是否**真的注册到系统 shell**（不只是"线程还活着"）。

        为什么要查这个：`thread.is_alive()` 只能说明 pystray 的后台线程没崩，
        **不能说明任务栏右下角真的出现了图标**。而 pystray 的 win32 后端暴露了
        真实的 OS 句柄——实测 `_hwnd`（隐藏窗口）+ `_icon_handle`（Shell_NotifyIcon 的
        图标句柄）+ `visible`。三者齐了才算"图标在系统里存在"。

        ⚠️ 仍**不能**保证图标在**可见区域**：Windows 11 默认把新出现的托盘图标
        收进折叠区（`^`）。这一层只能靠 `notify()` 提示 + 文档说明，
        **无法从程序侧强制**。
        """
        if self._icon is None:
            return False
        hwnd = getattr(self._icon, "_hwnd", None)
        handle = getattr(self._icon, "_icon_handle", None)
        visible = getattr(self._icon, "visible", None)
        return bool(hwnd) and bool(handle) and visible is not False

    def start(self) -> bool:
        """启动托盘（非阻塞、**幂等**）。返回"图标是否确实在跑"。

        ⚠️ 返回值**会被用来决定能不能最小化到托盘**——不可用时宁可真的关闭，
        也不能把用户困在一个找不到的窗口里。
        """
        if self._icon is not None and self._thread is not None and self._thread.is_alive():
            return True  # 幂等：已经在跑
        try:
            import pystray
        except Exception as exc:  # noqa: BLE001 - 缺依赖不该让应用打不开
            self._last_error = f"缺少 pystray：{exc}"
            return False
        try:
            menu = pystray.Menu(
                # `default=True` → **双击图标即执行**（还原窗口），这是用户最直觉的操作。
                pystray.MenuItem("显示主窗口", lambda *_: self._on_show(), default=True),
                pystray.MenuItem("退出", lambda *_: self._on_quit()),
            )
            self._icon = pystray.Icon("qb-tiku", self._image(), self._title, menu)
            self._thread = threading.Thread(target=self._icon.run, daemon=True)
            self._thread.start()
            # 给后端一点时间建图标；再确认线程还活着 + **图标真的注册到 shell**
            time.sleep(0.6)
            if not self._thread.is_alive():
                self._last_error = "pystray 图标线程启动后立即退出"
                return False
            if not self.registered():
                self._last_error = "图标未注册到系统 shell（句柄为空）"
                return False
            return True
        except Exception as exc:  # noqa: BLE001
            self._last_error = f"{type(exc).__name__}: {exc}"
            return False

    def notify(self, message: str, title: str | None = None) -> bool:
        """弹一条系统通知（告诉用户"窗口去哪了"）。

        为什么需要：Windows 11 **默认把新出现的托盘图标收进折叠区**（`^`）。
        只把窗口藏起来、不留一句话，用户就会以为程序崩了——这是实测遇到的真实问题。
        """
        if self._icon is None:
            return False
        try:
            self._icon.notify(message, title or self._title)
            return True
        except Exception:  # noqa: BLE001
            return False

    def stop(self) -> None:
        if self._icon is not None:
            try:
                self._icon.stop()
            except Exception:  # noqa: BLE001
                pass
            self._icon = None


def make_closing_handler(window, state: ClientState, tray: TrayController | None, *, can_tray: bool):
    """构造 `window.events.closing` 的处理函数：**默认只最小化，不退出**。

    规范 §4.5 原文：「关闭 × → 最小化到托盘（不是退出）」。

    🔴 但有一条**比规范更重要的底线**：**不能把用户困住**。
    所以 `can_tray` 为假（托盘图标没跑起来）时，**直接允许真正关闭**——
    宁可不满足"最小化到托盘"，也不能让老师点完 × 之后找不到程序。

    返回值语义（pywebview 6.x）：返回 `False` **取消**关闭。
    """

    def on_closing() -> bool:
        if state.quit_requested():
            return True  # 托盘「退出」已置位 → 允许真正关闭
        if not can_tray or tray is None:
            # 托盘不可用：**真的关闭**（不困住用户）。留一行日志便于排查。
            print("[外壳] 托盘不可用，本次关闭将真正退出（避免窗口被隐藏后找不到）。")
            return True
        try:
            # 记录几何信息，下次打开还原（属于「客户端 UX 状态」）
            state.set_window_geometry(
                int(window.x or 0), int(window.y or 0), int(window.width), int(window.height)
            )
        except Exception:  # noqa: BLE001 - 记不住位置不该阻止最小化
            pass
        window.hide()
        # 第一次最小化时告诉用户「窗口去哪了」——Win11 会把新托盘图标收进折叠区，
        # 不提示的话用户会以为程序崩了。
        if state.get("tray_hint_shown") != "1":
            state.set("tray_hint_shown", "1")
            tray.notify(
                "题库已最小化到系统托盘（在任务栏右下角的 ^ 折叠区里）。"
                "双击托盘图标可唤回窗口；右键菜单里可以退出。"
            )
        return False

    return on_closing


# ── 服务进程 ────────────────────────────────────────────────────────────────
def start_server(port: int = DEFAULT_PORT, root: Path | None = None) -> subprocess.Popen:
    """以子进程方式起 `webui`（与 `editions/local/启动题库.bat` 同一条路径）。

    ⚠️ 必须带 `--no-browser`：外壳自己开窗口，不需要系统浏览器再来一个。
    """
    base = root or app_root()
    env = dict(os.environ)
    env.setdefault("QB_DATA_ROOT", str(base))
    env.setdefault("QB_EDITION", "local")
    env.setdefault("QB_EXPORT_ENGINE", "native")
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    return subprocess.Popen(
        [sys.executable, "-m", "webui", "--no-browser", "--port", str(port)],
        cwd=str(base), env=env, creationflags=flags, close_fds=True,
    )


def wait_health(port: int = DEFAULT_PORT, timeout: float = 60.0) -> bool:
    """等 `/api/health` 就绪。"""
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.5)
    return False


# ── 入口 ────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    port = DEFAULT_PORT
    for i, a in enumerate(args):
        if a == "--port" and i + 1 < len(args):
            port = int(args[i + 1])

    guard = SingleInstance()
    if not guard.acquire():
        # 已有实例：把它的窗口带到前台，然后**安静退出**（不报错——这是正常路径）。
        found = guard.focus_existing()
        print(f"[外壳] 已有实例在运行，{'已聚焦其窗口' if found else '但窗口尚未就绪（请稍后再点一次）'}。")
        return 0

    try:
        import webview
    except Exception as exc:  # noqa: BLE001
        print(f"[外壳] 缺少 pywebview（{exc}）。请先 pip install pywebview。", file=sys.stderr)
        return 2

    state = ClientState()
    # 每次启动清掉上次的退出请求（否则第一次托盘退出后，以后一点 × 就真退了）
    state.set("quit_requested", "0")

    root = app_root()
    server = start_server(port, root)
    if not wait_health(port):
        print("[外壳] 后端服务未在 60 秒内就绪。", file=sys.stderr)
        return 3

    geo = state.get_window_geometry()
    window = webview.create_window(
        APP_TITLE,
        url=f"http://127.0.0.1:{port}/",
        width=int(geo.get("width") or 1366),
        height=int(geo.get("height") or 768),
        x=geo.get("x"),
        y=geo.get("y"),
        min_size=(1024, 640),
        # 无地址栏（pywebview 默认就没有）、无黑窗。
        background_color="#F5F6F8",
    )

    def restore_window() -> None:
        """从托盘还原窗口。

        🔴 只用 `window.show()` 不够：窗口可能仍处于最小化/被其它窗口压住，
        用户会以为"点了没反应"。所以 `show()` + `restore()` + **`SetForegroundWindow`**
        三件事都做（最后一步按标题找到窗口句柄强制置前）。
        """
        try:
            window.show()
            window.restore()
        except Exception as exc:  # noqa: BLE001
            print(f"[外壳] 还原窗口失败：{exc}")
        focus_window_by_title()

    def quit_app() -> None:
        state.request_quit()
        tray.stop()
        try:
            window.destroy()
        except Exception:  # noqa: BLE001
            pass

    tray = TrayController(on_show=restore_window, on_quit=quit_app)

    # 🔴 托盘在**启动时**就创建（不是等第一次关闭才建）：
    #    否则用户根本不知道它存在，而 Win11 还会把新图标收进折叠区 → "找不到页面"。
    can_tray = tray.start()
    if can_tray:
        print(f"[外壳] 托盘图标已就绪（{APP_TITLE}）。点 × 会最小化到托盘，不会退出。")
    else:
        print(f"[外壳] ⚠️ 托盘不可用（{tray.last_error}）——点 × 将**真正退出**，避免窗口被隐藏后找不到。")

    window.events.closing += make_closing_handler(window, state, tray, can_tray=can_tray)

    try:
        webview.start(
            # 🔴 不设 storage_path 的话，localStorage（主题偏好、局域网令牌）每次启动都会被清空。
            private_mode=False,
            storage_path=str(root / "outputs" / "webui" / "webview_storage"),
            # 用系统 WebView2（本机已装）；显式指定避免落到 MSHTML。
            gui="edgechromium",
        )
    finally:
        tray.stop()
        try:
            server.terminate()
        except Exception:  # noqa: BLE001
            pass
        guard.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
