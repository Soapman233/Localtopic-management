# -*- coding: utf-8 -*-
"""前端视觉验证：多视口截图 + 横向溢出检测。

为什么需要
----------
此前所有 UI 改动都**只能靠设计原则推断**，无法验证"实际长什么样"。
本脚本用 Playwright 驱动**本机已装的 Chrome**（`executable_path` 直指
`chrome.exe`，**无需下载 500MB Chromium**），把观感验证变成可重复执行的动作。

🔴 两个"验证条件必须与真实使用一致"的修正（本项目血的教训）
---------------------------------------------------------
1. **数据必须是真实数据，不能是空库**。
   早期版本用独立空 `QB_DATA_ROOT` 起服务，于是所有截图都是「题库为空」的引导态——
   题干、公式、图片、题目卡片**一个都没被验证过**，等于没验证。
   现在：把**真实交付库复制**一份到临时数据根（`QB_DB_PATH` 指向副本），
   源 DOCX 仍从 `source_files.path` 指向的原始位置**只读**读取（图片在 docx 内）。
   ⚠️ **绝不指向真实交付库本体**——服务会往数据根写 settings/log，指向本体即污染交付数据。
2. **深色模式必须单独拍**。
   顶栏/侧栏/卡片在深色下取的是另一套 token，浅色通过不代表深色通过。
   用 `--dark` 让服务端 settings 的 `theme.dark=true` 后重拍一遍。

产出：`spike/acceptance/_shots/` 下的 PNG + 一份溢出检测报告。

用法::

    python spike/acceptance/shoot_ui.py                  # 全部页面 × 桌面/移动（浅色）
    python spike/acceptance/shoot_ui.py --dark           # 同上，深色模式（文件名带 dark- 前缀）
    python spike/acceptance/shoot_ui.py builder search   # 只拍指定页面
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "spike" / "acceptance" / "_shots"
#: 临时数据根（脚本自建自用；**不是**交付数据目录）。
SHOTS_DATA = ROOT / "spike" / "acceptance" / "_shots_data"
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"

#: 真实交付库候选（按顺序取第一个存在的）。可用 `QB_SHOTS_DB` 环境变量覆盖。
REAL_DB_CANDIDATES = [
    ROOT / "outputs" / "bank.db",
    Path(r"D:\Open-source project\Localtopic-management\outputs\bank.db"),
]

#: 本机浏览器候选（优先 Chrome，其次 Edge）。用已装浏览器可免去 Chromium 下载。
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

#: 视口（宽, 高, 标签）。矩阵对齐设计规范 §2.8 断点表 + §5.4 视觉回归要求。
#: ⚠️ 1024 是**必须**的：设置页的横向溢出（评审 F6，`right=1029 > 1024`）只在这个宽度出现，
#:    而 1440 与 390 都测不到——「漏了 1024」本身就是上一轮"未验证"的一部分。
VIEWPORTS = [
    (1366, 768, "desktop"),  # 主目标分辨率（老师办公机，规范 §2.8）
    (1024, 768, "narrow"),   # 窄屏态（规范 §5.4；F6 溢出的发生处）
    (390, 844, "mobile"),    # iPhone 14 逻辑像素
]

#: 静态页面清单（路径, 短名）。路径与 `frontend/src/router.tsx` 的路由表一致。
PAGES = [
    ("/builder", "builder"),
    ("/search", "search"),
    ("/import", "import"),
    ("/manage/knowledge", "manage-knowledge"),
    ("/manage/formula-review", "manage-formula"),
    ("/manage/sources", "manage-sources"),
    ("/manage/stats", "manage-stats"),
    ("/settings", "settings"),
    # 导出中心不带 paperId 时走「未选择试卷」分支——顺带验证该分支的呈现。
    ("/export", "export"),
]


def _find_browser() -> str | None:
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def _real_db() -> Path | None:
    """取真实交付库（只读源，用于复制）。"""
    override = os.environ.get("QB_SHOTS_DB", "").strip()
    candidates = [Path(override)] if override else REAL_DB_CANDIDATES
    for p in candidates:
        # 0 字节是 worktree 里的占位文件，不是真库——跳过（否则会拍出空态）。
        if p.is_file() and p.stat().st_size > 1024 * 1024:
            return p
    return None


def _prepare_data_root(dark: bool) -> tuple[Path, list[str]]:
    """准备临时数据根：复制真实库 + 写入 settings（含主题模式）。

    返回 ``(数据根, 额外页面列表)``。额外页面是**依赖真实数据 id 的页面**
    （单题详情需要真实题目 id，硬编码会失效）。
    """
    src_db = _real_db()
    db_dst = SHOTS_DATA / "outputs" / "bank.db"
    db_dst.parent.mkdir(parents=True, exist_ok=True)
    if src_db is None:
        print("  [警告] 未找到真实交付库（>1MB）——本次截图是**空库状态**，无法验证题干/公式/图片")
        extra: list[str] = []
    else:
        shutil.copyfile(src_db, db_dst)
        print(f"  数据：已复制真实库 {src_db}（{src_db.stat().st_size / 1048576:.1f} MB）")
        # 取一道**有公式、有图片**的题（最能暴露版式问题），退化为任意一题。
        with sqlite3.connect(f"file:{db_dst}?mode=ro", uri=True) as c:
            row = c.execute(
                "SELECT q.id FROM questions q "
                "JOIN images i ON i.question_id = q.id "
                "JOIN formulas f ON f.question_id = q.id "
                "ORDER BY q.id LIMIT 1"
            ).fetchone() or c.execute("SELECT id FROM questions ORDER BY id LIMIT 1").fetchone()
        extra = [f"/question/{row[0]}"] if row else []
        if extra:
            print(f"  详情页样本：{extra[0]}")

    settings = {
        "db_path": str(db_dst).replace("\\", "/"),
        "default_template": "考试",
        "katex": {"throw_on_error": False, "strict": False},
        "theme": {"primary": "#3370FF", "dark": bool(dark)},
    }
    webui_dir = SHOTS_DATA / "outputs" / "webui"
    webui_dir.mkdir(parents=True, exist_ok=True)
    (webui_dir / "settings.json").write_text(
        json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    return SHOTS_DATA, extra


def _start_server(data_root: Path) -> subprocess.Popen:
    env = dict(os.environ)
    env["QB_DATA_ROOT"] = str(data_root)
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
    args = list(sys.argv[1:])
    dark = "--dark" in args
    only = {a for a in args if not a.startswith("--")}

    browser = _find_browser()
    if not browser:
        print("[SKIP] 未找到 Chrome/Edge")
        return 0
    print(f"使用浏览器：{browser}")
    print(f"模式：{'深色' if dark else '浅色'}")

    OUT.mkdir(parents=True, exist_ok=True)
    data_root, extra_pages = _prepare_data_root(dark)
    pages = PAGES + [(p, "question-detail") for p in extra_pages]

    server = _start_server(data_root)
    print(f"服务已启动：{BASE}")
    prefix = "dark-" if dark else ""

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
                    for idx, (path, name) in enumerate(pages):
                        if only and name not in only:
                            continue
                        # ⚠️ 项目用 **HashRouter**（`createHashRouter`）：必须走 `/#/path`，
                        #    直接请求 `/builder` 会命中后端的 404（实测踩过）。
                        #
                        # 🔴 **必须强制整页重载**：两个 hash 之间 `goto` 只触发 hashchange，
                        #    浏览器**不会重新加载文档**——于是 React 组件状态（如侧栏折叠分组）
                        #    会从上一页泄漏到下一页，拍出来的不是「直接打开该页」的样子。
                        #    实测踩过：/manage/* 展开过折叠分组后，后续 /question/* 截图里
                        #    侧栏仍显示展开态。加一个每次递增的 query 参数强制真实导航。
                        page.goto(f"{BASE}/?shot={idx}#{path}", wait_until="load", timeout=30000)
                        # SPA 首屏渲染 + 懒加载 chunk 落地
                        try:
                            page.wait_for_load_state("networkidle", timeout=8000)
                        except Exception:  # noqa: BLE001
                            pass
                        page.wait_for_timeout(900)

                        shot = OUT / f"{prefix}{vp_tag}-{name}.png"
                        page.screenshot(path=str(shot), full_page=True)

                        # 横向溢出检测：文档宽度超过视口即视为溢出（移动端最常见的破版）
                        #
                        # ⚠️ 逐元素取样时**必须排除不可见元素**：关闭状态的右侧滑出面板
                        #    （`anchor="right"` + `keepMounted`）停在 `translateX(100%)`，
                        #    天然「右边界超出视口」，但它不可见、不影响布局——不排除就会
                        #    每页稳定报 21 个假阳性，把真实信号淹掉。
                        metrics = page.evaluate("""() => {
                          const de = document.documentElement;
                          const over = [];
                          for (const el of document.querySelectorAll('*')) {
                            const r = el.getBoundingClientRect();
                            if (r.width <= 0 || r.right <= de.clientWidth + 1) continue;
                            const cs = getComputedStyle(el);
                            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
                            if (el.closest('[aria-hidden="true"]')) continue;
                            over.push({
                              tag: el.tagName.toLowerCase(),
                              cls: (el.className && el.className.toString().slice(0, 60)) || '',
                              right: Math.round(r.right),
                            });
                          }
                          return {
                            docW: de.scrollWidth, viewW: de.clientWidth,
                            overflowCount: over.length, samples: over.slice(0, 5),
                          };
                        }""")
                        rec = {"page": name, "viewport": vp_tag, "dark": dark, **metrics}
                        report.append(rec)
                        flag = "溢出" if metrics["docW"] > metrics["viewW"] + 1 else "ok"
                        print(f"  [{vp_tag:7}] {name:18} 文档宽={metrics['docW']:5} "
                              f"视口宽={metrics['viewW']:5} 越界元素={metrics['overflowCount']:3} {flag}")
                    ctx.close()
            finally:
                b.close()
    finally:
        _stop(server)

    name = "overflow-report-dark.json" if dark else "overflow-report.json"
    (OUT / name).write_text(
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
