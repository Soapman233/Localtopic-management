"""系统设置服务。

读写 ``outputs/webui/settings.json``（复用 :mod:`webui.config`）。非法设置抛 40006。
"""
# ---------------------------------------------------------------------------
# title: webui 系统设置服务
# description: 读取/更新 settings.json（DB 路径/导出目录/默认模板/KaTeX/主题）；非法设置抛 40006。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from .. import config, errors


def get_settings() -> dict:
    """当前设置（读文件 + 合并默认值）。"""
    return config.get_settings()


def update_settings(patch: dict) -> dict:
    """更新部分设置字段并持久化，返回更新后的完整设置。"""
    try:
        return config.update_settings(patch or {})
    except ValueError as exc:
        raise errors.bad_request(errors.CODE_INVALID_SETTINGS, str(exc))


__all__ = ["get_settings", "update_settings"]
