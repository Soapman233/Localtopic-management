# -*- coding: utf-8 -*-
"""T19：全站**表格列同值率**扫描（规范 §4.2 Table）。

规范原文：
> **某列取值同值率 > 60% 时，该列不应作为逐行徽章**，改为顶部筛选 + 行级标记。

为什么必须实测而不是静态扫描
--------------------------
同值率是**数据属性**，不是代码属性——只有把真实题库渲染出来、逐列统计取值分布
才能得出。静态读代码只能看到「有这一列」，看不到「这一列的 83% 都是同一个值」。
（评审 F5 对来源页做过一次这样的测量，本脚本把它推广到**全站所有表格**。）

判定口径
--------
- 只统计**数据行**（跳过表头行）；
- 空值统一记作 `（空）`——「大量空值」本身也是一种同值，同样不提供信息；
- 同值率 = 该列出现次数最多的取值 ÷ 该列非表头单元格总数；
- 报告 `> 0.6` 的列，并按同值率降序。

用法::

    python spike/acceptance/probe_table_columns.py
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
DATA = ROOT / "spike" / "acceptance" / "_t19_run"
PORT = 8792
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

#: 有表格的页面（路径, 短名）。与 `frontend/src/router.tsx` 路由表一致。
PAGES = [
    ("/manage/sources", "sources"),
    ("/manage/knowledge", "knowledge"),
    ("/manage/formula-review", "formula"),
    ("/manage/stats", "stats"),
    ("/builder", "builder"),
    ("/search", "search"),
]


def _find_browser() -> str | None:
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def _prepare() -> None:
    db_dst = DATA / "outputs" / "bank.db"
    db_dst.parent.mkdir(parents=True, exist_ok=True)
    for cand in REAL_DB_CANDIDATES:
        if cand.is_file() and cand.stat().st_size > 1024 * 1024:
            shutil.copyfile(cand, db_dst)
            break
    (DATA / "outputs" / "webui").mkdir(parents=True, exist_ok=True)
    (DATA / "outputs" / "webui" / "settings.json").write_text(
        json.dumps({"db_path": str(db_dst).replace("\\", "/")}, ensure_ascii=False),
        encoding="utf-8",
    )


def _start() -> subprocess.Popen:
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


#: 在页面里逐表逐列统计取值分布。返回每个表的列统计。
PROBE_JS = """() => {
  const out = [];
  document.querySelectorAll('table').forEach((table, ti) => {
    const headCells = [...table.querySelectorAll('thead th, thead td')].map((c) => (c.textContent || '').trim());
    const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.querySelectorAll('td').length > 0);
    if (rows.length === 0) return;
    const nCols = Math.max(...rows.map((r) => r.querySelectorAll('td').length));
    const cols = [];
    for (let c = 0; c < nCols; c += 1) {
      const vals = rows.map((r) => {
        const cell = r.querySelectorAll('td')[c];
        if (!cell) return null;
        const t = (cell.textContent || '').trim();
        return t === '' ? '（空）' : t;
      }).filter((v) => v !== null);
      if (vals.length === 0) continue;
      const counts = new Map();
      for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
      const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      cols.push({
        header: headCells[c] || `第 ${c + 1} 列`,
        rows: vals.length,
        topValue: top.length > 40 ? top.slice(0, 40) + '…' : top,
        topShare: n / vals.length,
        distinct: counts.size,
      });
    }
    out.push({ table: ti + 1, rows: rows.length, cols });
  });
  return out;
}"""


def main() -> int:
    browser = _find_browser()
    if not browser:
        print("[SKIP] 未找到 Chrome/Edge")
        return 0
    _prepare()
    server = _start()
    print(f"服务：{BASE}（真实库副本）\n")

    findings: list[dict] = []
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=browser)
            ctx = b.new_context(viewport={"width": 1366, "height": 768}, device_scale_factor=1)
            page = ctx.new_page()
            for path, name in PAGES:
                page.goto(f"{BASE}/?t19={name}#{path}", wait_until="load", timeout=30000)
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:  # noqa: BLE001
                    pass
                page.wait_for_timeout(900)
                tables = page.evaluate(PROBE_JS)
                if not tables:
                    print(f"  {name:12} 无表格")
                    continue
                for t in tables:
                    bad = [c for c in t["cols"] if c["topShare"] > 0.6]
                    print(f"  {name:12} 表{t['table']}（{t['rows']} 行 × {len(t['cols'])} 列）："
                          f"同值率 >60% 的列 = {len(bad)}")
                    for c in bad:
                        print(f"       ⚠️ [{c['topShare'] * 100:5.1f}%] {c['header']}"
                              f"  （{c['distinct']} 种取值，最常见 = {c['topValue']!r}）")
                        findings.append({"page": name, "table": t["table"], **c})
            ctx.close()
            b.close()
    finally:
        _stop(server)

    out = ROOT / "spike" / "acceptance" / "_t19_columns.json"
    out.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n违规列合计：{len(findings)}")
    print(f"报告：{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
