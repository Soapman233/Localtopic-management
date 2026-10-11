"""版本（edition）配置：区分「本地运行版」与「线上部署版」。

设计原则
--------
两个版本**共享同一套内核**（``bank/`` ``pipeline/`` ``webui/`` ``frontend/``），
差异只在**运行形态**，由本模块统一收敛，避免复制代码：

============  ========================  ================================
维度           本地运行版 (local)         线上部署版 (online)
============  ========================  ================================
监听地址        ``127.0.0.1``（仅回环）    ``0.0.0.0``（容器/服务器）
访问范围        本机一人                  局域网/公网多人
鉴权            无                        nginx Basic Auth + 可选 API 令牌
部署方式        双击 ``启动题库.bat``       Docker Compose + nginx
数据            本机 ``outputs/bank.db``   挂载卷持久化
============  ========================  ================================

环境变量（前缀 ``QB_``）
------------------------
* ``QB_EDITION``     ``local`` | ``online``，默认 ``local``。
* ``QB_HOST``        监听地址；缺省时按 edition 取值（local→127.0.0.1，online→0.0.0.0）。
* ``QB_PORT``        监听端口，默认 ``8720``。
* ``QB_AUTH_TOKEN``  访问令牌。**仅当设置时**才启用 ``/api/*`` 的 Bearer 鉴权；
                     默认不设置 → 与历史行为完全一致（本地版无需任何改动）。

约定
----
* 本模块**只依赖标准库**，可被 ``config`` / ``__main__`` / ``app`` 安全导入。
* 所有取值都有安全默认，**任何缺失都不应导致启动失败**。
"""
# ---------------------------------------------------------------------------
# title: 版本（edition）配置
# description: 收敛本地运行版 / 线上部署版的差异：QB_EDITION / QB_HOST / QB_PORT / QB_AUTH_TOKEN；只依赖标准库，任何缺失都有安全默认。
# author: 待补充
# version: 0.1.0
# category: Web界面
# ---------------------------------------------------------------------------


from __future__ import annotations

import os

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #
#: 合法的版本取值。
EDITIONS: tuple[str, ...] = ("local", "online")
#: 默认版本。
DEFAULT_EDITION = "local"
#: 各版本的默认监听地址。
_EDITION_HOSTS: dict[str, str] = {"local": "127.0.0.1", "online": "0.0.0.0"}
#: 默认端口。
DEFAULT_PORT = 8720
#: 无需鉴权即可访问的路径（健康检查供容器探针/负载均衡使用）。
_AUTH_EXEMPT_PATHS: tuple[str, ...] = ("/api/health",)


def current_edition() -> str:
    """当前版本；取值非法时回落到 :data:`DEFAULT_EDITION`（不抛异常）。"""
    value = os.environ.get("QB_EDITION", "").strip().lower()
    return value if value in EDITIONS else DEFAULT_EDITION


def is_online() -> bool:
    """是否为线上部署版。"""
    return current_edition() == "online"


def resolve_host() -> str:
    """生效的监听地址：``QB_HOST`` 优先，否则按版本取默认值。"""
    host = os.environ.get("QB_HOST", "").strip()
    return host or _EDITION_HOSTS[current_edition()]


def resolve_port() -> int:
    """生效的监听端口：``QB_PORT`` 优先，非法时回落默认值。"""
    raw = os.environ.get("QB_PORT", "").strip()
    if raw.isdigit():
        port = int(raw)
        if 1 <= port <= 65535:
            return port
    return DEFAULT_PORT


def auth_token() -> str | None:
    """访问令牌；未设置（或为空）时返回 ``None``，表示**不启用** API 鉴权。"""
    token = os.environ.get("QB_AUTH_TOKEN", "").strip()
    return token or None


def auth_enabled() -> bool:
    """是否启用 ``/api/*`` 的 Bearer 鉴权。"""
    return auth_token() is not None


def is_auth_exempt(path: str) -> bool:
    """该路径是否豁免鉴权（健康检查等）。"""
    return path in _AUTH_EXEMPT_PATHS


def edition_summary() -> dict:
    """版本摘要（供启动日志与 ``/api/health`` 展示）。

    注意：**不返回令牌明文**，只说明是否启用。
    """
    edition = current_edition()
    return {
        "edition": edition,
        "host": resolve_host(),
        "port": resolve_port(),
        "auth_enabled": auth_enabled(),
        "notes": {
            "local": "本机单人使用，仅监听回环地址，无鉴权。",
            "online": "多人访问，建议置于 nginx 之后并开启 Basic Auth。",
        }[edition],
    }


__all__ = [
    "EDITIONS", "DEFAULT_EDITION", "DEFAULT_PORT",
    "current_edition", "is_online", "resolve_host", "resolve_port",
    "auth_token", "auth_enabled", "is_auth_exempt", "edition_summary",
]
