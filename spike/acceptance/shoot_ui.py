# -*- coding: utf-8 -*-
"""前端视觉验证：多视口截图 + 横向溢出检测。

为什么需要
----------
此前所有 UI 改动都**只能靠设计原则推断**，无法验证"实际长什么样"。
本脚本用 Playwright 驱动**本机已装的 Chrome**（`executable_path` 直指
`chrome.exe`，**无需下载 500MB Chromium**），把观感验证变成可重复执行的动作。

产出：`spike/acceptance/_shots/` 下的 PNG + 一份溢出检测报告。

用法::

    python spike/acceptance/shoot_ui.py                # 全部页面 × 桌面/移动
    python spike/acceptance/shoot_ui.py builder search # 只拍指定页面
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "spike" / "acceptance" / "_shots"
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"

#: 本机浏览器候选（优先 Chrome，其次 Edge）。用已装浏览器可免去 Chromium 下载。
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

#: 视口（宽, 高, 标签）。桌面取 1440 覆盖主流笔记本；移动取 iPhone 14 逻辑像素。
VIEWPORTS = [
    (1440, 900, "desktop"),
    (390, 844, "mobile"),
]

#: 页面清单（路径, 短名）。路径与 `frontend/src/router.tsx` 的路由表一致。
PAGES = [
    ("/builder", "builder"),
    ("/search", "search"),
    ("/import", "import"),
    ("/manage/knowledge", "manage-knowledge"),
    ("/manage/formula-review", "manage-formula"),
    ("/manage/sources", "manage-sources"),
    ("/manage/stats", "manage-stats"),
    ("/settings", "settings"),
]


def _find_browser() -> str | None:
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def _start_server() -> subprocess.Popen:
    env = dict(os.environ)
    env["QB_DATA_ROOT"] = str(ROOT / "spike" / "acceptance" / "_shots_run")
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
    only = set(sys.argv[1:])
    browser = _find_browser()
    if not browser:
        print("[SKIP] 未找到 Chrome/Edge")
        return 0
    print(f"使用浏览器：{browser}")

    OUT.mkdir(parents=True, exist_ok=True)
    server = _start_server()
    print(f"服务已启动：{BASE}")

    report: list[dict] = []
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=browser)
            try:
                for w, h, vp_tag in VIEWPORTS:
                    ctx = b.new_context(viewport={"width": w, "height": h},
                                        device_scale_factor=1)
                    page = ctx.new_page()
                    for path, name in PAGES:
                        if only and name not in only:
                            continue
                        # ⚠️ 项目用 **HashRouter**（`createHashRouter`）：必须走 `/#/path`，
                        #    直接请求 `/builder` 会命中后端的 404（实测踩过）。
                        page.goto(f"{BASE}/#{path}", wait_until="load", timeout=30000)
                        # SPA 首屏渲染 + 懒加载 chunk 落地
                        try:
                            page.wait_for_load_state("networkidle", timeout=8000)
                        except Exception:  # noqa: BLE001
                            pass
                        page.wait_for_timeout(900)

                        shot = OUT / f"{vp_tag}-{name}.png"
                        page.screenshot(path=str(shot), full_page=True)

                        # 横向溢出检测：文档宽度超过视口即视为溢出（移动端最常见的破版）
                        metrics = page.evaluate("""() => {
                          const de = document.documentElement;
                          const over = [];
                          for (const el of document.querySelectorAll('*')) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 0 && r.right > de.clientWidth + 1) {
                              over.push({
                                tag: el.tagName.toLowerCase(),
                                cls: (el.className && el.className.toString().slice(0, 60)) || '',
                                right: Math.round(r.right),
                              });
                            }
                          }
                          return {
                            docW: de.scrollWidth, viewW: de.clientWidth,
                            overflowCount: over.length, samples: over.slice(0, 5),
                          };
                        }""")
                        rec = {"page": name, "viewport": vp_tag, **metrics}
                        report.append(rec)
                        flag = "溢出" if metrics["docW"] > metrics["viewW"] + 1 else "ok"
                        print(f"  [{vp_tag:7}] {name:18} 文档宽={metrics['docW']:5} "
                              f"视口宽={metrics['viewW']:5} 越界元素={metrics['overflowCount']:3} {flag}")
                    ctx.close()
            finally:
                b.close()
    finally:
        _stop(server)

    (OUT / "overflow-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    bad = [r for r in report if r["docW"] > r["viewW"] + 1]
    print(f"\n截图输出：{OUT}")
    print(f"横向溢出页面：{len(bad)} / {len(report)}")
    for r in bad:
        print(f"  ⚠️ [{r['viewport']}] {r['page']} 文档 {r['docW']} > 视口 {r['viewW']}")
        for s in r["samples"]:
            print(f"       越界: <{s['tag']} class=\"{s['cls']}\"> right={s['right']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
