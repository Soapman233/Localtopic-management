# -*- coding: utf-8 -*-
"""桌面外壳验收（自动化部分）。

为什么要有它
------------
规范 §4.5 的 3 条外壳契约里，**2 条可以自动化验证**：
  - 契约 ① 单实例：互斥体语义（第二次获取必须失败）+ 无窗口时聚焦要安全返回
  - 契约 ③ `client_state.db`：读写往返 + **绝不落在 `bank.db`**

契约 ② 的**托盘行为无法自动化**（要人工点图标菜单看"点 × 是否只最小化"），
但它的**核心逻辑**（closing 处理函数返回 False 并调用 hide）可以断言。
**本脚本会把"不能自动化的部分"明确打印出来，不假装通过。**

用法::

    python editions/desktop/verify_desktop.py            # 全部（含真实开窗，约 6 秒）
    python editions/desktop/verify_desktop.py --no-window # 跳过开窗（纯逻辑）
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def _load_desktop_main():
    """按路径加载 `desktop_main`（不在包内，无法常规 import）。"""
    spec = importlib.util.spec_from_file_location("_desktop_main_under_test", HERE / "desktop_main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = _load_desktop_main()
RESULTS: dict[str, bool | None] = {}


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS[name] = ok
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  —— {detail}" if detail else ""))


# ── 契约 ③：client_state.db ────────────────────────────────────────────────
def verify_client_state() -> None:
    print("\n[契约③] 客户端状态库 client_state.db")

    # 结构：必须在 outputs/webui/ 下，且**不是** bank.db
    p = mod.client_state_path(ROOT)
    ok_path = p.parent.name == "webui" and p.name == "client_state.db"
    check("路径为 outputs/webui/client_state.db（不碰 bank.db）", ok_path, str(p))

    with tempfile.TemporaryDirectory(prefix="qb-client-state-") as tmp:
        root = Path(tmp)
        st = mod.ClientState(mod.client_state_path(root))

        # 读写往返
        st.set("theme_mode", "system")
        check("字符串读写往返", st.get("theme_mode") == "system")

        # JSON 往返
        st.set_json("window_geometry", {"x": 10, "y": 20, "width": 1366, "height": 768})
        geo = st.get_window_geometry()
        check("JSON 往返（窗口几何）", geo.get("width") == 1366 and geo.get("x") == 10, str(geo))

        # 默认值
        check("缺键返回默认值", st.get("nope", "d") == "d")

        # 覆盖写
        st.set("theme_mode", "dark")
        check("覆盖写生效", st.get("theme_mode") == "dark")

        # 退出标志
        check("退出标志默认 False", st.quit_requested() is False)
        st.request_quit()
        check("置位后退出标志 True", st.quit_requested() is True)

        # schema 版本
        # ⚠️ 必须用 `closing()`：`with sqlite3.connect(...)` **只提交/回滚事务、不关闭连接**，
        #    在 Windows 上会让 `client_state.db` 保持被占用 → 临时目录清理时 WinError 32。
        #    （本文件第一版就踩了这个坑，正好印证了 `ClientState` 注释里那条。）
        import sqlite3
        from contextlib import closing as _closing
        with _closing(sqlite3.connect(mod.client_state_path(root))) as c:
            ver = c.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        check("写入 schema_version", ver is not None, str(ver))

        # **关键**：确认整个过程没有生成/修改 bank.db
        bank = root / "outputs" / "bank.db"
        check("全程未创建 bank.db", not bank.exists())


# ── 契约 ①：单实例 ─────────────────────────────────────────────────────────
def verify_single_instance() -> None:
    print("\n[契约①] 单实例（命名互斥体）")
    name = r"Local\QB_Tiku_Verify_" + str(int(time.time()))

    first = mod.SingleInstance(name)
    check("首次获取成功", first.acquire() is True)

    second = mod.SingleInstance(name)
    check("第二次获取失败（= 已存在实例）", second.acquire() is False)

    # 找不到窗口时必须**安全返回 False**，不能抛异常（第一个实例可能还在启动）
    check("无窗口时 focus_existing 安全返回 False", second.focus_existing("不存在的窗口标题") is False)

    first.release()
    third = mod.SingleInstance(name)
    check("释放后可再次获取", third.acquire() is True)
    third.release()


# ── 契约 ②：关闭 → 最小化（逻辑层）─────────────────────────────────────────
class _FakeWindow:
    """假窗口：只记录 hide 调用，用于断言 closing 逻辑（不需要真 GUI）。"""

    def __init__(self) -> None:
        self.hidden = False
        self.destroyed = False
        self.x, self.y, self.width, self.height = 1, 2, 800, 600

    def hide(self) -> None:
        self.hidden = True

    def destroy(self) -> None:
        self.destroyed = True


def verify_closing_handler() -> None:
    print("\n[契约②] 关闭 × → 最小化到托盘（逻辑层；托盘交互见下方人工项）")
    with tempfile.TemporaryDirectory(prefix="qb-closing-") as tmp:
        st = mod.ClientState(mod.client_state_path(Path(tmp)))
        st.set("quit_requested", "0")
        w = _FakeWindow()
        handler = mod.make_closing_handler(w, st, tray=None)

        ret = handler()
        check("默认：返回 False（取消关闭）", ret is False, f"ret={ret!r}")
        check("默认：调用了 hide（最小化到托盘）", w.hidden is True)
        check("默认：没有 destroy（未退出）", w.destroyed is False)
        check("默认：记录了窗口几何", st.get_window_geometry().get("width") == 800)

        # 托盘「退出」置位后，必须允许真正关闭
        st.request_quit()
        w2 = _FakeWindow()
        ret2 = mod.make_closing_handler(w2, st, tray=None)()
        check("置位退出后：返回 True（允许关闭）", ret2 is True, f"ret={ret2!r}")
        check("置位退出后：不再 hide", w2.hidden is False)


# ── 真实开窗（GUI）─────────────────────────────────────────────────────────
def verify_window_opens(seconds: float = 5.0) -> None:
    print(f"\n[GUI] 真实开窗（pywebview + 系统 WebView2，约 {seconds:.0f} 秒后自动关闭）")
    try:
        import webview
    except Exception as exc:  # noqa: BLE001
        check("pywebview 可用", False, str(exc))
        return

    result = {"created": False, "destroyed": False, "error": None, "backend": None}

    def closer():
        time.sleep(seconds)
        try:
            result["destroyed"] = True
            window.destroy()
        except Exception as e:  # noqa: BLE001
            result["error"] = f"{type(e).__name__}: {e}"

    try:
        window = webview.create_window(
            "题库外壳验收", html="<h1>外壳验收</h1><p>窗口已创建，稍后自动关闭。</p>",
            width=480, height=300,
        )
        result["created"] = True
        webview.start(closer, gui="edgechromium")
        g = getattr(webview, "guilib", None)
        result["backend"] = getattr(g, "__name__", str(g))
    except Exception as e:  # noqa: BLE001
        result["error"] = f"{type(e).__name__}: {e}"

    check("窗口创建成功", result["created"], json.dumps(result, ensure_ascii=False))
    check("窗口正常关闭（无异常）", result["destroyed"] and not result["error"],
          f"backend={result['backend']} error={result['error']}")


def main() -> int:
    args = set(sys.argv[1:])
    print("=== 桌面外壳验收（自动化部分）===")
    verify_client_state()
    verify_single_instance()
    verify_closing_handler()

    if "--no-window" not in args:
        verify_window_opens()
    else:
        print("\n[GUI] 已按 --no-window 跳过真实开窗")

    auto = {k: v for k, v in RESULTS.items() if v is not None}
    ok = all(auto.values())
    print(f"\n自动化项：{sum(1 for v in auto.values() if v)} / {len(auto)} 通过")
    print("\n🔴 必须人工确认的（自动化做不到）")
    print("  1) 点窗口 × → 窗口消失但**进程仍在**（托盘图标出现），再次双击图标能唤回窗口")
    print("  2) 双击第二次启动 → **不新开窗口**，而是把已有窗口带到前台")
    print("  3) 关掉窗口后重新打开 → **主题偏好与局域网令牌仍在**（验证 storage_path 生效）")
    print("  运行 `python editions/desktop/desktop_main.py` 后逐条核对。")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
