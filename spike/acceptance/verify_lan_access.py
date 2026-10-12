# -*- coding: utf-8 -*-
"""方案 A 端到端验收：局域网访问（打包版）。

验证链条（**必须全绿才算 A 可用**）：

  1. 默认启动 → **仅回环**（手机打不开），这是安全默认；
  2. 经 API 开启局域网 → 配置落盘；
  3. **重启后** → 监听 `0.0.0.0` 且自动带上令牌；
  4. **局域网地址可达**（模拟手机）：带令牌 200 / 不带令牌 **401**；
  5. 取到含令牌的链接与二维码（扫码即登录）；
  6. 🔴 **安全不变量**：强行 `QB_HOST=0.0.0.0` 且无令牌 → **拒绝启动**（fail-closed）。
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXE_DIR = ROOT / "dist" / "题库"
RUN = HERE / "_lan_e2e"
PORT = 8751
LOOPBACK = f"http://127.0.0.1:{PORT}"


def lan_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except Exception:  # noqa: BLE001
        return None
    finally:
        s.close()


def _req(base: str, path: str, *, token: str | None = None, method: str = "GET",
         timeout: float = 20.0):
    """发起请求。

    ⚠️ HTTPS 用的是**自签证书**，必须用不校验的 SSL 上下文——
    否则连不上（这不是缺陷，是自签证书的固有属性；手机端表现为需点一次「继续访问」）。
    """
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = urllib.request.Request(base + path, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=ctx) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:  # noqa: BLE001
        return None, None


def _launch(port: int, env_extra: dict | None = None):
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    return subprocess.Popen([str(RUN / "题库.exe"), "--no-browser", "--port", str(port)],
                            cwd=str(RUN), env=env, creationflags=flags, close_fds=True)


def _wait(base: str, tries: int = 40) -> bool:
    for _ in range(tries):
        time.sleep(1.0)
        st, _ = _req(base, "/api/health", timeout=6)
        if st == 200:
            return True
    return False


def _wait_any(port: int, tries: int = 40) -> str | None:
    """探测回环地址就绪，**自动识别 http/https**，返回可用的 base。

    ⚠️ 局域网开启后服务端走 HTTPS，此时仍按 http 探测会一直失败
    （本脚本第一版就因此把「重启后可启动」误判为 FAIL）。
    """
    for _ in range(tries):
        time.sleep(1.0)
        for scheme in ("https", "http"):
            base = f"{scheme}://127.0.0.1:{port}"
            st, _ = _req(base, "/api/health", timeout=6)
            if st == 200:
                return base
    return None


def _kill(proc) -> None:
    """终止并**确认已退出**。

    ⚠️ 必须确认：本脚本多步复用端口，若旧进程没死干净，
    下一步的 `_wait` 会探到**旧进程**，把「拒绝启动」误判成「启动成功」
    （本脚本第一版就踩了这个坑）。
    """
    try:
        proc.terminate()
        proc.wait(timeout=20)
    except Exception:  # noqa: BLE001
        subprocess.call(["taskkill", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            pass
    # 再确认端口确实空出来了
    for _ in range(20):
        if proc.poll() is not None:
            return
        time.sleep(0.5)


def _port_free(port: int) -> bool:
    """端口是否空闲（能绑定说明空闲）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _port_of(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def main() -> int:
    if not (EXE_DIR / "题库.exe").is_file():
        print(f"[SKIP] 未找到打包产物：{EXE_DIR}")
        return 0
    ip = lan_ip()
    if not ip:
        print("[SKIP] 本机无局域网地址，无法验证局域网访问")
        return 0

    if RUN.is_dir():
        shutil.rmtree(RUN, ignore_errors=True)
    shutil.copytree(EXE_DIR, RUN)
    P1, P2, P3 = 8761, 8762, 8763          # ⚠️ 每步用**独立端口**，避免探到上一步的残留进程
    print(f"部署到：{RUN}\n局域网地址：{ip}\n")

    R: dict[str, bool] = {}

    # ---------- 1) 默认仅回环 ----------
    print(f"[步骤1] 默认启动（端口 {P1}，应仅回环）")
    p1 = _launch(P1)
    base1 = _wait_any(P1)
    ok = base1 is not None
    print(f"   回环就绪: {ok}（协议 {base1.split(':')[0] if base1 else '—'}）")
    R["默认可启动"] = ok
    st_lan, _ = _req(f"http://{ip}:{P1}", "/api/health", timeout=5)
    print(f"   局域网地址访问 -> {st_lan}（期望 None=连不上）")
    R["默认仅本机可达"] = (st_lan is None)

    # ---------- 2) 开启局域网 ----------
    print(f"\n[步骤2] 经 API 开启局域网访问（端口 {P1}）")
    st, body = _req(base1, "/api/network/enable", method="POST")
    d = (body or {}).get("data") or {}
    print(f"   enable -> {st} lan_enabled={d.get('lan_enabled')} "
          f"token_set={d.get('token_set')} restart_required={d.get('restart_required')}")
    R["开启接口可用"] = (st == 200 and bool(d.get("lan_enabled")) and bool(d.get("token_set")))
    st, body = _req(base1, "/api/network/link")
    link = (body or {}).get("data") or {}
    token = link["lan_url"].split("?t=")[-1] if link.get("lan_url") else None
    print(f"   链接: {link.get('lan_url')}")
    print(f"   二维码: {len(link.get('qr_svg') or '')} 字节")
    R["返回链接与二维码"] = bool(link.get("lan_url")) and bool(link.get("qr_svg"))
    _kill(p1)
    print(f"   旧进程已退出: {p1.poll() is not None}；端口 {P1} 空闲: {_port_free(P1)}")

    # ---------- 3) 重启后生效 + 局域网鉴权 ----------
    print(f"\n[步骤3] 重启（端口 {P2}）→ 应自动监听全网卡并带上令牌")
    p2 = _launch(P2)
    base2 = _wait_any(P2)
    print(f"   回环就绪: {base2 is not None}（协议 {base2.split(':')[0] if base2 else '—'}）")
    R["重启后可启动"] = (base2 is not None)

    LAN = f"https://{ip}:{P2}"
    st_lan, _ = _req(LAN, "/api/health", timeout=10)
    print(f"   局域网 /api/health（豁免）-> {st_lan}")
    R["局域网可达(HTTPS)"] = (st_lan == 200)

    # 🔴 HTTPS 的核心价值：同网段的**明文嗅探拿不到令牌**。这里验证同一端口
    #    不接受明文 HTTP（否则中间人可直接读走令牌）。
    st_plain, _ = _req(f"http://{ip}:{P2}", "/api/health", timeout=6)
    print(f"   同端口明文 HTTP -> {st_plain}（期望 None=握手失败）")
    R["明文 HTTP 被拒"] = (st_plain is None)

    R["链接为 https"] = bool(link.get("lan_url", "").startswith("https://"))
    print(f"   手机链接协议: {link.get('lan_url', '')[:8]}…")

    st_no, _ = _req(LAN, "/api/papers", timeout=10)
    print(f"   局域网 /api/papers 不带令牌 -> {st_no}（期望 401）")
    R["无令牌被拒(401)"] = (st_no == 401)
    st_yes, _ = _req(LAN, "/api/papers", token=token, timeout=10)
    print(f"   局域网 /api/papers 带令牌   -> {st_yes}（期望 200）")
    R["带令牌可访问"] = (st_yes == 200)
    st_bad, _ = _req(LAN, "/api/papers", token="wrong-token", timeout=10)
    print(f"   局域网 /api/papers 错令牌   -> {st_bad}（期望 401）")
    R["错令牌被拒(401)"] = (st_bad == 401)

    # 顺手关掉局域网，为下一步的"危险配置"清场。
    # ⚠️ **必须带令牌**：局域网开启后鉴权已生效，不带令牌的 disable 会被 401 拒绝
    #    （本脚本第一版就因此没关掉配置，导致下一步误判——见步骤4 的断言）。
    st_dis, _ = _req(base2, "/api/network/disable", token=token, method="POST")
    print(f"   关闭局域网 -> {st_dis}（期望 200）")
    R["关闭接口可用(带令牌)"] = (st_dis == 200)
    _kill(p2)
    print(f"   旧进程已退出: {p2.poll() is not None}；端口 {P2} 空闲: {_port_free(P2)}")

    # ---------- 4) 🔴 安全不变量 ----------
    print(f"\n[步骤4] 🔴 安全不变量：QB_HOST=0.0.0.0 且无令牌 → 应**拒绝启动**（端口 {P3}）")
    # 确认配置确实已关闭（否则 exe 会从 settings 里取回令牌，就不是"无令牌"了）
    import json as _json
    settings_file = RUN / "outputs" / "webui" / "settings.json"
    net_cfg = {}
    if settings_file.is_file():
        try:
            net_cfg = (_json.loads(settings_file.read_text(encoding="utf-8")) or {}).get("network") or {}
        except Exception:  # noqa: BLE001
            net_cfg = {}
    print(f"   前置检查 settings.network.enabled = {net_cfg.get('enabled')}（必须为 False）")
    R["危险配置前置条件成立"] = (net_cfg.get("enabled") is False)

    log = RUN / "outputs" / "webui" / "start.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("", encoding="utf-8")          # 清空，便于只看本次
    p3 = _launch(P3, {"QB_HOST": "0.0.0.0", "QB_AUTH_TOKEN": ""})
    # 先等进程自己退出（安全校验失败应立刻返回）
    exited = False
    for _ in range(20):
        time.sleep(0.5)
        if p3.poll() is not None:
            exited = True
            break
    started = (_wait_any(P3, tries=8) is not None) if not exited else False
    print(f"   进程自行退出: {exited}（退出码 {p3.poll()}）")
    print(f"   端口是否被监听: {started}（期望 False）")
    if log.is_file():
        for line in log.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-4:]:
            print(f"      | {line[:110]}")
    R["危险配置被拒绝启动"] = (exited or not started) and not started
    _kill(p3)

    print("\n=== 方案 A 端到端验收 ===")
    for k, v in R.items():
        print(f"   {'PASS' if v else 'FAIL'}  {k}")
    good = all(R.values())
    print(f"\n{'✅ 通过：局域网访问可用且安全默认正确' if good else '❌ 未通过'}")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
