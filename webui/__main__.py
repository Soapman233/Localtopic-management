"""一键启动器：``python -m webui``（由 ``启动题库.bat`` 双击调用）。

流程（架构设计 §1.6）
--------------------
1. 选定解释器（``sys.executable``；``启动题库.bat`` 已优先选择 ``kb`` 环境）；
2. 校验数据库存在，否则提示先执行 ``python -m bank.cli init``（不静默失败）；
3. **幂等迁移**：版本快照列、provenance 列、复核状态列、组卷 schema、答案列；
4. 校验前端构建产物 ``webui/static/index.html``，缺失则提示先 ``npm run build``；
5. **环境自检（M3）**：检测 editor_sdk 与 Word/WPS，缺失时**明确提示降级**；
6. 起 ``uvicorn`` 于 ``127.0.0.1:8720``；
7. 后台线程延时 1.5s 后自动打开浏览器；
8. 控制台打印「题库已启动，关闭此窗口即退出」。
"""
# ---------------------------------------------------------------------------
# title: webui 一键启动器
# description: python -m webui：幂等迁移 + 环境自检 + 起 uvicorn + 自动开浏览器。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

from . import config, edition


def _print(msg: str = "") -> None:
    """带前缀的启动日志（中文）。"""
    print(f"[题库] {msg}", flush=True)


def migrate_database(db_path: Path) -> list[str]:
    """对数据库执行**幂等迁移**，返回本次实际变更项（重复执行返回 ``[]``）。"""
    from bank import answers as _answers
    from bank import db as _db
    from bank import enrich as _enrich
    from bank import labels as _labels
    from bank import paper as _paper
    from bank import edit as _edit

    conn = _db.connect(db_path)
    try:
        changed: list[str] = []
        changed += _edit.ensure_version_snapshot_columns(conn)
        changed += _enrich.ensure_provenance_columns(conn)
        changed += _labels.ensure_review_status_column(conn)
        changed += _answers.ensure_answer_columns(conn)
        changed += _paper.ensure_paper_schema(conn)
        return changed
    finally:
        conn.close()


def _open_browser_later(url: str, delay: float = 1.5) -> None:
    """后台线程：延时后打开浏览器。"""
    def _run() -> None:
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - 打开浏览器失败不应影响服务
            pass

    threading.Thread(target=_run, name="webui-open-browser", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    """启动 Web 服务；返回进程退出码。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    # 局域网配置（方案 A）落到环境变量：必须在 resolve_host/auth_token **之前**。
    # 显式传入的 QB_HOST/QB_AUTH_TOKEN 优先（setdefault），便于排障与线上部署覆盖。
    from .services import network_svc as _net
    _net.apply_to_environment()
    # 版本配置：监听地址/端口由 ``QB_EDITION`` / ``QB_HOST`` / ``QB_PORT`` 决定。
    host = edition.resolve_host()
    port = edition.resolve_port()
    # 允许 ``python -m webui --port 9000`` 覆盖端口（便于排障）。
    if "--port" in argv:
        try:
            port = int(argv[argv.index("--port") + 1])
        except (IndexError, ValueError):
            _print(f"端口参数非法，回落默认 {config.DEFAULT_PORT}")
            port = config.DEFAULT_PORT

    db_path = config.get_db_path()
    _print(f"解释器：{sys.executable}")
    _print(f"数据库：{db_path}")
    _ed = edition.edition_summary()
    _print(f"版本：{_ed['edition']}（{_ed['notes']}）")
    if _ed["auth_enabled"]:
        _print("鉴权：已启用（/api/* 需携带 Bearer 令牌）")
    if _ed["edition"] == "online" and host == "0.0.0.0":
        _print("提示：线上版监听 0.0.0.0，请务必置于 nginx 之后并开启访问控制。")

    # 🔴 安全不变量（fail-closed）：**非回环监听必须有鉴权**，否则拒绝启动。
    #    理由：把监听改成 0.0.0.0 却没设令牌 = 同网段任何人可读写整个题库；
    #    这种"静默裸奔"比不能用更糟。见 webui/edition.py::exposure_safety。
    _safety = edition.exposure_safety()
    if not _safety["ok"]:
        _print(f"安全校验未通过：{_safety['reason']}")
        _print(f"  {_safety['hint']}")
        return 1
    if _safety["exposure"] == "lan":
        _print(f"局域网访问：已开启（http://{host}:{port}）——手机连同一 WiFi 即可使用。")

    if not db_path.is_file():
        # 便携客户端**首启必须能自动建库**——老师不会去命令行跑 bank.cli init。
        # 设 QB_AUTO_INIT=0 可恢复「拒绝启动」的旧行为（开发时避免误指向空库）。
        if os.environ.get("QB_AUTO_INIT", "1").strip().lower() in ("0", "false", "no", "off"):
            _print("数据库不存在，无法启动。")
            _print("请先在项目根目录执行：python -m bank.cli init 后再导入数据。")
            return 1
        _print("数据库不存在，正在创建一个空库（首次使用属正常）。")
        _print("建好后请在「导入试卷」页导入你的第一份旧卷。")

    try:
        changed = migrate_database(db_path)
    except Exception as exc:  # noqa: BLE001 - 迁移失败必须明确报错
        _print(f"数据库迁移失败：{exc}")
        return 1
    if changed:
        _print(f"已执行迁移：{'、'.join(changed)}")
    else:
        _print("数据库 schema 已是最新（无迁移）。")

    if not (config.STATIC_DIR / "index.html").is_file():
        _print("警告：未找到前端构建产物 webui/static/index.html。")
        _print("      请先在 frontend/ 目录执行：npm install && npm run build")
        _print("      （服务仍会启动，但浏览器将看不到界面，仅 /api/* 可用）")

    # 环境自检（M3）：明确提示降级，不静默失败。
    env = config.environment_report()
    _print("环境自检：")
    _print(f"  - editor_sdk：{'可用' if env['editor_sdk']['available'] else '不可用'}"
           f"（端口 {env['editor_sdk'].get('port') or '未探测到'}）")
    _print(f"  - Word：{'可用' if env['office']['word']['available'] else '不可用'}；"
           f"WPS：{'可用' if env['office']['wps']['available'] else '不可用'}")
    for msg in env["messages"]:
        _print(f"  ! 降级：{msg}")

    url = f"http://{host}:{port}"
    _print("题库已启动，关闭此窗口即退出。")
    _print(f"访问地址：{url}")

    _open_browser_later(url)

    import uvicorn
    from .app import app

    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
