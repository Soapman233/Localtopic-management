# -*- coding: utf-8 -*-
"""P2 交互验收：⌘K 全局快速跳转 + 新建试卷滑出面板（真实浏览器）。

为什么单测不够
--------------
`CommandPalette` / `SlideOver` 的**组件行为**有 vitest 覆盖，但下面这几件事
只有在真浏览器里才成立，也正是最容易坏的地方：

1. `Ctrl+K` 的**全局 keydown**是否真的挂上了（挂载时机 / 事件目标）；
2. 顶栏那个**可点击入口**是否真的能打开面板（⌘K 在手机上不存在，
   只给快捷键等于移动端没这个功能）；
3. **懒加载 chunk** 能否真的被拉到（我把这两个组件改成了 `lazy()`，
   一旦 chunk 路径或 Suspense 边界写错，单测里直接渲染组件是发现不了的）；
4. 面板真的出现在**可访问树**里（`role="dialog"` / `role="combobox"`）。

用法::

    python spike/acceptance/verify_p2_interactions.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "spike" / "acceptance" / "_p2_run"
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

REAL_DB_CANDIDATES = [
    ROOT / "outputs" / "bank.db",
    Path(r"D:\Open-source project\Localtopic-management\outputs\bank.db"),
]


def _find_browser() -> str | None:
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def _start_server() -> subprocess.Popen:
    # 用真实库副本（题库为空时找题页是空态，会掩盖面板行为）。
    db_dst = DATA / "outputs" / "bank.db"
    db_dst.parent.mkdir(parents=True, exist_ok=True)
    for cand in REAL_DB_CANDIDATES:
        if cand.is_file() and cand.stat().st_size > 1024 * 1024:
            shutil.copyfile(cand, db_dst)
            break
    (DATA / "outputs" / "webui").mkdir(parents=True, exist_ok=True)
    (DATA / "outputs" / "webui" / "settings.json").write_text(
        '{"db_path": "%s", "theme": {"primary": "#3370FF", "dark": false}}'
        % str(db_dst).replace("\\", "/"),
        encoding="utf-8",
    )

    env = dict(os.environ)
    env["QB_DATA_ROOT"] = str(DATA)
    env["QB_HOST"] = "127.0.0.1"
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    proc = subprocess.Popen(
        [sys.executable, "-m", "webui", "--no-browser", "--port", str(PORT)],
        cwd=str(ROOT), env=env, creationflags=flags, close_fds=True,
    )
    for _ in range(60):
        time.sleep(1.0)
        try:
            with urllib.request.urlopen(f"{BASE}/api/health", timeout=5) as r:
                if r.status == 200:
                    return proc
        except Exception:  # noqa: BLE001
            pass
    return proc


def _stop(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:  # noqa: BLE001
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    browser = _find_browser()
    if not browser:
        print("[SKIP] 未找到 Chrome/Edge")
        return 0
    server = _start_server()
    print(f"服务：{BASE}")
    results: dict[str, bool] = {}

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=browser)
            ctx = b.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()

            # ---- 1) Ctrl+K 唤起（全局快捷键 + 懒加载 chunk）----
            page.goto(f"{BASE}/#/builder", wait_until="load", timeout=30000)
            page.wait_for_timeout(1500)
            page.keyboard.press("Control+k")
            page.wait_for_timeout(800)
            box = page.get_by_role("combobox")
            results["Ctrl+K 唤起面板"] = box.count() == 1
            print(f"   Ctrl+K -> combobox 数量 = {box.count()}")

            # ---- 2) 输入关键词，首项应为「搜索题目「x」」----
            box.fill("浮力")
            page.wait_for_timeout(400)
            opts = page.get_by_role("option")
            first = opts.first.inner_text() if opts.count() else ""
            results["首项为搜索题目"] = "搜索题目「浮力」" in first
            print(f"   首项 = {first!r}")

            # ---- 3) Enter 跳转并带上 keyword ----
            page.keyboard.press("Enter")
            page.wait_for_timeout(1200)
            results["Enter 跳到找题并带 keyword"] = "/search" in page.url and "keyword=" in page.url
            print(f"   跳转后 URL = {page.url}")

            # ---- 4) 顶栏可点击入口（移动端唯一可用路径）----
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            page.get_by_role("button", name="快速跳转").click()
            page.wait_for_timeout(700)
            results["顶栏入口可打开"] = page.get_by_role("combobox").count() == 1
            print(f"   顶栏入口 -> combobox 数量 = {page.get_by_role('combobox').count()}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

            # ---- 5) 新建试卷滑出面板（懒加载 + 可访问名）----
            # 顶栏切换器在宽屏渲染「试卷列表」按钮、窄屏渲染同名图标按钮
            # （`data-testid="open-paper-list"` 只在窄屏那支上），故按可访问名点。
            page.get_by_role("button", name="试卷列表").click()
            page.wait_for_timeout(600)
            page.get_by_role("button", name="新建试卷").click()
            page.wait_for_timeout(900)
            dlg = page.get_by_role("dialog", name="新建试卷")
            results["滑出面板出现且可访问名正确"] = dlg.count() == 1
            print(f"   滑出面板 dialog 数量 = {dlg.count()}")
            results["面板含标题输入框"] = page.get_by_label("试卷标题").count() == 1
            print(f"   标题输入框数量 = {page.get_by_label('试卷标题').count()}")

            ctx.close()
            b.close()
    finally:
        _stop(server)

    print("\n=== P2 交互验收（真实浏览器）===")
    for k, v in results.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    good = all(results.values()) and bool(results)
    print(f"\n{'✅ 通过' if good else '❌ 未通过'}")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
