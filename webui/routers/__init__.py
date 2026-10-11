"""路由聚合包。

把各域路由（search/questions/papers/export/labels/review/sources/stats/settings）
实例化后放入 :data:`ROUTERS`；:func:`webui.app.create_app` 会遍历挂载。
"""
# ---------------------------------------------------------------------------
# title: webui 路由聚合
# description: 路由包入口；聚合各域 APIRouter，app 工厂遍历挂载。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from typing import List

from fastapi import APIRouter

from . import (auth, backup, export, imports, labels, papers, questions, review,
               search, settings, sources, stats)

#: 待挂载的路由列表（顺序即注册顺序）。
ROUTERS: List[APIRouter] = [
    auth.router,
    search.router,
    questions.router,
    papers.router,
    export.router,
    imports.router,
    backup.router,
    labels.router,
    review.router,
    sources.router,
    stats.router,
    settings.router,
]

__all__ = ["ROUTERS"]
