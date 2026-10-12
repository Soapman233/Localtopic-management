"""局域网访问（方案 A）路由。

* ``GET  /api/network/status`` —— 状态（**不含令牌**，可安全轮询）
* ``GET  /api/network/link``   —— 含令牌的手机链接 + 二维码（**仅用户主动索取时调用**）
* ``POST /api/network/enable`` / ``/disable`` / ``/rotate`` —— 开关与换令牌

⚠️ 这些端点在启用鉴权后同样受保护（`/api/*` 默认需 Bearer）；
   未启用鉴权时仅在回环地址上可达（见 `webui/edition.py::exposure_safety`）。
"""
# ---------------------------------------------------------------------------
# title: webui 局域网访问路由
# description: 局域网开关/状态/手机链接与二维码；令牌只在校验通过后返回。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from fastapi import APIRouter

from ..errors import ok
from ..services import network_svc as svc

router = APIRouter(prefix="/api", tags=["network"])


@router.get("/network/status")
def api_network_status() -> dict:
    """网络状态（**不含令牌明文**）。"""
    return ok(svc.network_status())


@router.get("/network/link")
def api_network_link() -> dict:
    """手机访问链接与二维码（**含令牌**）。

    只在用户点「查看手机访问方式」时调用——避免令牌出现在常规轮询里。
    """
    return ok(svc.network_status(include_link=True))


@router.post("/network/enable")
def api_network_enable() -> dict:
    """开启局域网访问（无令牌则自动生成）。**需重启生效**。"""
    res = svc.set_lan_enabled(True)
    return ok({
        "lan_enabled": res["enabled"],
        "token_set": res["token"] is not None,
        "restart_required": res["restart_required"],
        "message": "已开启局域网访问。请**重启题库**后生效；"
                   "重启后手机连同一 WiFi 即可通过下方链接或二维码访问。",
    })


@router.post("/network/disable")
def api_network_disable() -> dict:
    """关闭局域网访问（令牌保留，便于下次直接开启）。**需重启生效**。"""
    res = svc.set_lan_enabled(False)
    return ok({
        "lan_enabled": res["enabled"],
        "restart_required": res["restart_required"],
        "message": "已关闭局域网访问。重启题库后仅本机可访问。",
    })


@router.post("/network/rotate")
def api_network_rotate() -> dict:
    """重新生成令牌——**旧链接与旧二维码立即失效**。"""
    res = svc.rotate_token()
    return ok({
        "lan_enabled": res["enabled"],
        "token_set": res["token"] is not None,
        "restart_required": res["restart_required"],
        "message": "已更换访问令牌，旧链接已失效。请重启题库后用新链接重新扫码。",
    })


__all__ = ["router"]
