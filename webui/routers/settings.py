"""系统设置路由。"""
# ---------------------------------------------------------------------------
# title: webui 系统设置路由
# description: GET/PUT /api/settings；调用 webui.services.settings_svc。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from fastapi import APIRouter

from ..errors import ok
from ..schemas import SettingsUpdate
from ..services import settings_svc as svc

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings")
def api_get_settings() -> dict:
    """读取系统设置。"""
    return ok(svc.get_settings())


@router.put("/settings")
def api_update_settings(body: SettingsUpdate) -> dict:
    """更新系统设置（部分字段）。"""
    return ok(svc.update_settings(body.dict(exclude_unset=True)))


__all__ = ["router"]
