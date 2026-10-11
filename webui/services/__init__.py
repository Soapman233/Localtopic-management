"""服务层包入口。

各域服务负责「HTTP 契约 → bank 领域函数」的**编排**：参数归一化、连接事务边界、
错误码映射、响应整形。业务逻辑一律复用 ``bank/``，本层**不重复实现领域规则**。

模块
----
* ``search``        —— 检索与筛选栏（``bank.query.search_full`` / ``facets``）
* ``questions``     —— 单题详情 / 编辑 / 版本 / 媒体 / 难度（``bank.query`` / ``bank.edit``）
* ``papers``        —— 试卷 CRUD / 组卷 / 分值 / 大题 / 快照（``bank.paper``）
* ``preview``       —— 像素级预览渲染与缓存（DOCX→PDF→PNG）
* ``export_svc``    —— 预览/导出作业编排（``bank.export`` + ``preview``）
* ``labels_svc``    —— 知识点复核（``bank.labels``）
* ``review_svc``    —— 待复核公式队列（``bank.query`` / ``bank.review``）
* ``sources_svc``   —— 来源文件管理（``bank.query`` / ``bank.edit``）
* ``stats_svc``     —— 题库统计（``bank.query`` / ``bank.answers`` / ``bank.enrich`` / ``bank.labels``）
* ``settings_svc``  —— 系统设置读写（``webui.config``）
"""
# ---------------------------------------------------------------------------
# title: webui 服务层包入口
# description: 服务层包入口；各域服务负责 HTTP 契约到 bank 领域函数的编排。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from . import (
    export_svc,
    labels_svc,
    papers,
    preview,
    questions,
    review_svc,
    search,
    settings_svc,
    sources_svc,
    stats_svc,
)

__all__ = [
    "search", "questions", "papers", "preview", "export_svc",
    "labels_svc", "review_svc", "sources_svc", "stats_svc", "settings_svc",
]
