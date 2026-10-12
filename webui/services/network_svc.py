"""局域网访问（方案 A）服务。

定位
----
便携客户端默认**只监听回环地址**（`127.0.0.1`），手机/平板打不开。
本模块提供「**局域网访问**」开关：开启后监听全网卡，**手机连同一 WiFi 即可使用**。

安全铁律（**fail-closed**）
--------------------------
**开启局域网 = 必须同时启用访问令牌**。否则同网段的任何人都能读写整个题库
（含访客 WiFi、隔壁办公室）。这条不变量由 :func:`webui.edition.exposure_safety`
在**启动时**强制执行——配置不合法就拒绝启动，而不是"静默裸奔"。

与「方案 B（线上部署）」的关系
------------------------------
本模块只做**暴露范围**与**访问凭据**，不引入任何仅本地可用的假设：
* 令牌复用既有的 `QB_AUTH_TOKEN` 机制（`webui/auth.py` 已支持 token / token+session）；
* 地址解析走 `webui/edition.py`，线上版（`QB_EDITION=online`）自动落到 `public`；
* 因此**升级到线上部署只需换配置**（`QB_EDITION=online` + 用户体系），无需改本模块。
详见 `editions/online/README.md`。
"""
# ---------------------------------------------------------------------------
# title: 局域网访问服务
# description: 局域网开关（强制令牌）、本机局域网地址探测、扫码链接与二维码；与线上版共用同一套暴露/鉴权机制。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import io
import secrets
import socket
from pathlib import Path

from .. import config, edition

#: 设置文件中承载网络配置的键。
SETTINGS_KEY = "network"

#: 令牌长度（``secrets.token_urlsafe`` 的字节数）。
TOKEN_BYTES = 24

#: 二维码尺寸参数。
QR_SCALE = 4
QR_BORDER = 2


def lan_ip() -> str | None:
    """探测本机在局域网中的 IPv4 地址；失败返回 ``None``。

    做法：向一个公网地址建 **UDP** socket（不真正发包）取本机出口 IP。
    比遍历网卡简单，且在常见家用/办公网络下正确。
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except Exception:  # noqa: BLE001 - 无网络时不应影响启动
        return None
    finally:
        s.close()


def get_lan_config() -> dict:
    """读取局域网配置：``{enabled, token, https}``。

    ``https`` 缺省为 **True**——公共/公司网络下明文传输等于把令牌交出去，
    因此**默认加密**；仅在用户显式关闭时才用 HTTP。
    """
    raw = (config.get_settings() or {}).get(SETTINGS_KEY) or {}
    token = raw.get("token")
    return {
        "enabled": bool(raw.get("enabled")),
        "token": token if isinstance(token, str) and token.strip() else None,
        "https": raw.get("https", True) is not False,
    }


def _write_lan_config(enabled: bool, token: str | None, https: bool = True) -> None:
    config.update_settings(
        {SETTINGS_KEY: {"enabled": bool(enabled), "token": token, "https": bool(https)}})


def set_lan_enabled(enabled: bool, *, https: bool | None = None) -> dict:
    """开启/关闭局域网访问。

    * 开启：若无令牌则**生成一个**并持久化；``https`` 缺省保持当前值（首次为 True）；
    * 关闭：保留令牌与 https 设置（下次开启无需重新扫码）。

    ⚠️ 监听地址与 TLS 都在**启动时**绑定，因此改动**需重启**才生效。
    """
    cfg = get_lan_config()
    token = cfg["token"]
    if enabled and not token:
        token = secrets.token_urlsafe(TOKEN_BYTES)
    want_https = cfg["https"] if https is None else bool(https)
    _write_lan_config(enabled, token, want_https)
    return {"enabled": enabled, "token": token, "https": want_https,
            "restart_required": True}


def set_https(enabled: bool) -> dict:
    """单独切换「局域网是否使用 HTTPS」。**需重启生效**。"""
    cfg = get_lan_config()
    _write_lan_config(cfg["enabled"], cfg["token"], bool(enabled))
    return {"enabled": cfg["enabled"], "token": cfg["token"], "https": bool(enabled),
            "restart_required": True}


def rotate_token() -> dict:
    """重新生成令牌（旧链接立即失效）。"""
    cfg = get_lan_config()
    token = secrets.token_urlsafe(TOKEN_BYTES)
    _write_lan_config(cfg["enabled"], token, cfg["https"])
    return {"enabled": cfg["enabled"], "token": token, "https": cfg["https"],
            "restart_required": True}


def tls_files() -> tuple[Path, Path] | None:
    """需要 HTTPS 时准备自签证书，返回 ``(cert, key)``；否则 ``None``。

    仅在「局域网已开启 **且** https 未关闭」时生成——单机模式用不到 TLS，
    没必要在磁盘上留私钥。
    """
    cfg = get_lan_config()
    if not cfg["enabled"] or not cfg["https"]:
        return None
    from . import tls_svc
    ip = lan_ip()
    hosts = [h for h in (ip, "localhost") if h]
    return tls_svc.ensure_cert(hosts)


def mask_token(token: str | None) -> str | None:
    """令牌掩码（仅供界面显示，**不回传明文**）。"""
    if not token:
        return None
    return f"{token[:4]}…{token[-4:]}" if len(token) > 12 else "…"


def build_lan_url(token: str | None, *, host: str | None = None,
                  port: int | None = None, https: bool | None = None) -> str | None:
    """构造手机可直接打开的链接（**含令牌**，扫码即登录）。

    形如 ``https://192.168.0.103:8720/?t=<token>``。
    前端读取 ``?t=`` 后写入 localStorage 并从地址栏抹掉（避免留在浏览历史里）。

    ``https`` 缺省取配置值（**默认加密**）。
    """
    ip = host or lan_ip()
    if not ip or not token:
        return None
    use_https = get_lan_config()["https"] if https is None else bool(https)
    scheme = "https" if use_https else "http"
    return f"{scheme}://{ip}:{port or edition.resolve_port()}/?t={token}"


def qr_svg(url: str) -> str | None:
    """把链接渲染成 SVG 二维码（供界面直接内联显示）；失败返回 ``None``。"""
    try:
        import segno
    except Exception:  # noqa: BLE001 - 缺库不应让接口 500
        return None
    try:
        qr = segno.make(url, error="m")
        buf = io.BytesIO()
        qr.save(buf, kind="svg", scale=QR_SCALE, border=QR_BORDER)
        return buf.getvalue().decode("utf-8")
    except Exception:  # noqa: BLE001
        return None


def apply_to_environment() -> dict:
    """**启动时**把局域网配置落到环境变量，供 :mod:`webui.edition` 解析。

    必须在 `edition.resolve_host()` / `auth_token()` **之前**调用。
    用 ``setdefault``：显式传入的 `QB_HOST` / `QB_AUTH_TOKEN` **优先**，
    便于排障与线上部署覆盖。

    返回 ``{applied, host, token_set}``（**不含令牌明文**）。
    """
    import os

    cfg = get_lan_config()
    applied = False
    if cfg["enabled"]:
        if not os.environ.get("QB_HOST", "").strip():
            os.environ["QB_HOST"] = "0.0.0.0"
            applied = True
        if cfg["token"] and not os.environ.get("QB_AUTH_TOKEN", "").strip():
            os.environ["QB_AUTH_TOKEN"] = cfg["token"]
            applied = True
    return {"applied": applied, "host": edition.resolve_host(),
            "token_set": edition.auth_enabled()}


def network_status(*, include_link: bool = False) -> dict:
    """网络状态（供界面与排障）。

    ``include_link=True`` 时**额外返回含令牌的链接与二维码**——
    只在用户主动"查看手机访问方式"时调用，避免令牌出现在常规轮询里。
    """
    cfg = get_lan_config()
    ip = lan_ip()
    port = edition.resolve_port()
    from . import tls_svc
    out = {
        "lan_enabled": cfg["enabled"],
        "lan_ip": ip,
        "port": port,
        "host": edition.resolve_host(),
        "exposure": edition.resolve_exposure(),
        "token_set": cfg["token"] is not None,
        "token_masked": mask_token(cfg["token"]),
        "auth_enabled": edition.auth_enabled(),
        "restart_required": cfg["enabled"] != (edition.resolve_exposure() != "local"),
        # ---- HTTPS（自签证书）----
        "https": cfg["https"],
        "scheme": "https" if cfg["https"] else "http",
        "tls_available": tls_svc.available(),
        "cert_fingerprint": tls_svc.fingerprint() if cfg["https"] else None,
    }
    if include_link:
        url = build_lan_url(cfg["token"], host=ip, port=port)
        out["lan_url"] = url
        out["qr_svg"] = qr_svg(url) if url else None
    return out


__all__ = [
    "SETTINGS_KEY", "TOKEN_BYTES",
    "lan_ip", "get_lan_config", "set_lan_enabled", "set_https", "rotate_token",
    "mask_token", "build_lan_url", "qr_svg", "network_status",
    "apply_to_environment", "tls_files",
]
