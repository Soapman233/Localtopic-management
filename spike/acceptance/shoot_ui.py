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
    #: `--selftest`：**门禁自检**。运行时往页面注入三种**已知缺陷**，确认三个探测器都能抓到。
    #: 为什么必须有：一个永远返回 0 的检查等于没有检查（项目铁律）。
    #: 自检让「门禁有效」成为**可重复执行**的事实，而不是"我手工试过一次"。
    selftest = "--selftest" in args
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

                    # 🔴 采集 `pageerror`（未捕获的 JS 异常）与 console error。
                    #    这是评审用的硬指标（规范 §4.4「单页 pageerror = 0」），
                    #    也是**唯一能发现"页面看着正常但脚本已经崩了"的手段**——
                    #    截图看不出来。列表按页清空（见循环内），避免跨页串。
                    page_errors: list[str] = []
                    page.on("pageerror", lambda e: page_errors.append(f"pageerror: {e}"))
                    page.on(
                        "console",
                        lambda m: page_errors.append(
                            f"console.error: {m.text} @ {(m.location or {}).get('url', '?')}"
                        ) if m.type == "error" else None,
                    )
                    for idx, (path, name) in enumerate(pages):
                        if only and name not in only:
                            continue
                        page_errors.clear()
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

                        # `--selftest`：注入三种已知缺陷（同色文字 / 裸数字语义 Chip / 横向溢出），
                        # 然后照常跑探测器——三个都必须报警，否则说明探测器坏了。
                        if selftest:
                            page.evaluate("""() => {
                              const sc = document.createElement('span');
                              sc.id = '__selftest_samecolor';
                              sc.style.cssText = 'color: rgb(255,255,255); background-color: rgb(255,255,255)';
                              sc.textContent = '反证同色文字';
                              document.body.appendChild(sc);

                              const chip = document.createElement('span');
                              chip.className = 'MuiChip-root MuiChip-colorWarning';
                              chip.textContent = '999';
                              document.body.appendChild(chip);

                              const wide = document.createElement('div');
                              wide.style.cssText = 'width: 99999px; height: 1px';
                              document.body.appendChild(wide);
                            }""")
                            page.wait_for_timeout(250)

                        shot = OUT / f"{prefix}{vp_tag}-{name}.png"
                        page.screenshot(path=str(shot), full_page=True)

                        # 横向溢出检测：文档宽度超过视口即视为溢出（移动端最常见的破版）
                        #
                        # ⚠️ 逐元素取样时**必须排除不可见元素**：关闭状态的右侧滑出面板
                        #    （`anchor="right"` + `keepMounted`）停在 `translateX(100%)`，
                        #    天然「右边界超出视口」，但它不可见、不影响布局——不排除就会
                        #    每页稳定报 21 个假阳性，把真实信号淹掉。
                        # 🔴 这里同时跑**四项门禁**（评审 §5.3「把已发生的缺陷变成规则」）：
                        #   ① 横向溢出 ② 文字与背景同色（F1 那一类：深色白底白字）
                        #   ③ 语义色 Chip 的裸数字（F3：中性计数被染成警告橙）
                        #   ④ 同一行内同值重复渲染（F3：知识点页「关联 2,378 条」+ 徽章「2378」）
                        # 前三项是**硬失败**；④ 可能因数据巧合误报，仅统计并列出（见下方说明）。
                        # ⚠️ 用 **raw 字符串**（`r"""`）：这段是 JS，里面有 `\(`、`\d`、`\u4e00`
                        #    等正则转义。非 raw 时 Python 会把它们当自身转义处理
                        #    （`\u4e00` 会变成真汉字、`\(` 触发 SyntaxWarning）——语义可能被悄悄改掉。
                        metrics = page.evaluate(r"""() => {
                          const CJK = /[\u4e00-\u9fff]/;

                          /** 解析 `rgb(r, g, b)` / `rgba(...)` → [r,g,b,a]；透明返回 null。 */
                          const parseColor = (c) => {
                            const m = /rgba?\(([^)]+)\)/.exec(c || '');
                            if (!m) return null;
                            const p = m[1].split(',').map((x) => parseFloat(x));
                            const a = p.length > 3 ? p[3] : 1;
                            return a === 0 ? null : [p[0], p[1], p[2], a];
                          };

                          /** 相对亮度（WCAG）。 */
                          const lum = ([r, g, b]) => {
                            const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
                            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
                          };

                          /** 沿祖先链找最近的不透明背景（半透明按 alpha 叠到白/黑上近似）。 */
                          const effectiveBg = (el) => {
                            let node = el;
                            while (node && node !== document.documentElement) {
                              const c = parseColor(getComputedStyle(node).backgroundColor);
                              if (c) {
                                if (c[3] >= 0.999) return [c[0], c[1], c[2]];
                                // 半透明：粗略叠到其父背景（再取一次不透明祖先）
                                const parent = effectiveBg(node.parentElement || document.body);
                                return [0, 1, 2].map((i) => c[i] * c[3] + parent[i] * (1 - c[3]));
                              }
                              node = node.parentElement;
                            }
                            return [255, 255, 255];
                          };

                          /** 对比度。 */
                          const ratio = (a, b) => {
                            const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
                            return (hi + 0.05) / (lo + 0.05);
                          };

                          const sameColor = [];
                          const bareNumberChips = [];
                          const dupValues = [];

                          // ② 文字与背景同色（只查有可见文本的最小元素）
                          for (const el of document.querySelectorAll('body *')) {
                            if (el.children.length > 0) continue;
                            const text = (el.textContent || '').trim();
                            if (!text) continue;
                            const cs = getComputedStyle(el);
                            if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
                            const fg = parseColor(cs.color);
                            if (!fg) continue;
                            const r = ratio([fg[0], fg[1], fg[2]], effectiveBg(el));
                            if (r < 1.5) {
                              sameColor.push({ text: text.slice(0, 30), ratio: Number(r.toFixed(2)) });
                            }
                          }

                          // ③ 语义色 Chip 的文本必须含中文状态词（裸数字 = 中性计数，不该用语义色）
                          for (const chip of document.querySelectorAll('.MuiChip-colorWarning, .MuiChip-colorError, .MuiChip-colorSuccess')) {
                            const t = (chip.textContent || '').trim();
                            if (!t) continue;
                            if (!CJK.test(t)) bareNumberChips.push({ text: t.slice(0, 30), cls: chip.className.slice(0, 40) });
                          }

                          // ④ 同一行内同值重复（去掉千分位后比对 ≥3 位数字）
                          for (const row of document.querySelectorAll('tr, li, .MuiCard-root')) {
                            const t = row.textContent || '';
                            const nums = (t.match(/\d[\d,]{2,}/g) || []).map((x) => x.replace(/,/g, ''));
                            const seen = new Map();
                            for (const n of nums) seen.set(n, (seen.get(n) || 0) + 1);
                            for (const [n, c] of seen) if (c >= 2) dupValues.push({ value: n, times: c });
                          }

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
                            sameColorCount: sameColor.length, sameColorSamples: sameColor.slice(0, 4),
                            bareNumberChipCount: bareNumberChips.length, bareNumberChipSamples: bareNumberChips.slice(0, 4),
                            dupValueCount: dupValues.length, dupValueSamples: dupValues.slice(0, 4),
                          };
                        }""")
                        rec = {
                            "page": name, "viewport": vp_tag, "dark": dark, **metrics,
                            "pageErrors": list(page_errors),
                        }
                        report.append(rec)
                        flags = []
                        if metrics["docW"] > metrics["viewW"] + 1:
                            flags.append("溢出")
                        if page_errors:
                            flags.append(f"JS错误×{len(page_errors)}")
                        if metrics["sameColorCount"]:
                            flags.append(f"同色文字×{metrics['sameColorCount']}")
                        if metrics["bareNumberChipCount"]:
                            flags.append(f"裸数字语义Chip×{metrics['bareNumberChipCount']}")
                        if metrics["dupValueCount"]:
                            flags.append(f"同值重复×{metrics['dupValueCount']}")
                        flag = " ".join(flags) if flags else "ok"
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
    print()
    print(f"截图输出：{OUT}")

    # ── 五项门禁汇总（**前四项硬失败**，第五项仅报告）──────────────────────────
    over = [r for r in report if r["docW"] > r["viewW"] + 1]
    same = [r for r in report if r["sameColorCount"]]
    errs = [r for r in report if r.get("pageErrors")]
    bare = [r for r in report if r["bareNumberChipCount"]]
    dup = [r for r in report if r["dupValueCount"]]

    print(f"① 横向溢出页面：{len(over)} / {len(report)}")
    for r in over:
        print(f"  [{r['viewport']}] {r['page']} 文档 {r['docW']} > 视口 {r['viewW']}")
        for smp in r["samples"]:
            print(f"       越界: <{smp['tag']} class={smp['cls']!r}> right={smp['right']}")

    print(f"② 文字与背景同色：{len(same)} / {len(report)}（评审 F1 那一类缺陷）")
    for r in same:
        for smp in r["sameColorSamples"]:
            print(f"  [{r['viewport']}] {r['page']} 对比度 {smp['ratio']}:1  {smp['text']!r}")

    # ③ 规范 §4.4 要求单页 `pageerror = 0`。这也是**唯一能发现「页面看着正常、
    #    脚本其实已经崩了」的手段**——截图看不出来。
    print(f"③ JS 错误（pageerror / console.error）：{len(errs)} / {len(report)}")
    for r in errs:
        for e in r["pageErrors"][:3]:
            print(f"  [{r['viewport']}] {r['page']} {e[:120]}")

    print(f"④ 语义色 Chip 却是裸数字（中性计数不该染语义色）：{len(bare)} / {len(report)}")
    for r in bare:
        for smp in r["bareNumberChipSamples"]:
            print(f"  [{r['viewport']}] {r['page']} {smp['text']!r}")

    # ⑤ 仅报告：真实数据里同值巧合（某题数恰等于某公式数）会误报，
    #    故**不作为失败条件**，只列出供人工判断——比"要么全信要么全弃"更有用。
    print(f"⑤ 同一行内同值重复（**仅报告**，可能是数据巧合）：{len(dup)} / {len(report)}")
    for r in dup[:6]:
        for smp in r["dupValueSamples"]:
            print(f"  · [{r['viewport']}] {r['page']} 值 {smp['value']} 出现 {smp['times']} 次")

    failed = bool(over or same or errs or bare)

    # ── 门禁自检：三个探测器都必须抓到注入的缺陷 ──────────────────────────────
    if selftest:
        checks = {
            "① 横向溢出": len(over) > 0,
            "② 文字与背景同色": len(same) > 0,
            "④ 裸数字语义 Chip": len(bare) > 0,
        }
        print()
        print("=== 门禁自检（注入已知缺陷，三个探测器都必须报警）===")
        for k, v in checks.items():
            print(f"  {'PASS' if v else 'FAIL'}  {k}")
        good = all(checks.values())
        print()
        print("门禁自检" + ("通过：三个探测器均有效" if good else "未通过：存在失效的探测器"))
        return 0 if good else 1

    print()
    print(("门禁未通过" if failed else "门禁通过（①②③④）")
          + f"：①溢出 {len(over)} ②同色文字 {len(same)} ③JS错误 {len(errs)} ④裸数字语义Chip {len(bare)}"
          + f"；⑤ 仅报告 {len(dup)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
