"""webui —— 题库 Web 界面后端（FastAPI，纯本地单机）。

设计要点
--------
* **复用而非重写**：HTTP 层只做「契约 + 校验 + 事务编排」，业务逻辑一律调用 ``bank/``。
* **只读路径不改库**：导出/预览走 ``bank.db.connect_readonly``。
* **写路径串行**：所有写操作经 :mod:`webui.db` 的应用级写锁 + 独立写连接。
* **一键启动**：``python -m webui``（见 :mod:`webui.__main__`），由 ``启动题库.bat`` 调用。

模块划分
--------
* ``config``    —— 配置读写（DB 路径、导出目录、默认模板、KaTeX/主题偏好）与环境自检
* ``db``        —— 连接工厂（读/写连接、busy_timeout、应用级写锁）
* ``errors``    —— 统一错误类型与异常处理器（``{code,data,message}``）
* ``schemas``   —— Pydantic 请求/响应模型
* ``jobs``      —— 单后台线程作业队列（预览/导出串行）
* ``app``       —— FastAPI 应用工厂（挂载路由、异常处理器、静态资源、``/api/health``）
* ``routers``   —— 路由（由 T03 填充）
* ``services``  —— 服务层（由 T03 填充）
"""
# ---------------------------------------------------------------------------
# title: webui 包入口
# description: 题库 Web 界面后端的包入口与模块划分说明（FastAPI，纯本地单机）。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
