"""作业管理器：单后台线程 + 队列，串行执行预览/导出。

为什么单线程
------------
预览/导出强依赖 **editor_sdk MCP 服务**与 **Word/WPS COM**，二者都是**单实例/单会话**
资源；并发触发会争用句柄导致失败。因此用一个后台线程串行执行，天然保护外部资源。

对外接口（架构设计 §3.5）
------------------------
* :meth:`JobManager.submit`：``submit(kind, fn, **kwargs) -> job_id``
* :meth:`JobManager.get`：``get(job_id) -> dict | None``

作业状态：``pending`` → ``running`` → ``done`` | ``error``。
"""
# ---------------------------------------------------------------------------
# title: webui 作业管理器
# description: 单后台线程 + queue.Queue 串行执行预览/导出作业；submit/get 与状态查询。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import queue
import threading
import time
import uuid
from typing import Any, Callable, Optional


def _now() -> str:
    """当前时间（ISO 8601，秒精度，与 bank 一致）。"""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class JobManager:
    """单后台线程的作业队列。线程安全（``get`` / ``_set`` 均在锁内）。"""

    def __init__(self, *, workers: int = 1) -> None:
        if workers != 1:
            raise ValueError("JobManager 仅支持单工作线程（串行保护 editor_sdk/COM）")
        self._jobs: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._queue: "queue.Queue[tuple[str, Callable[..., Any], dict]]" = queue.Queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._worker, name="webui-jobs", daemon=True)
        self._thread.start()

    # -- 提交 / 查询 -------------------------------------------------------- #
    def submit(self, kind: str, fn: Callable[..., Any], **kwargs: Any) -> str:
        """提交一个作业，返回 ``job_id``（作业在后台线程串行执行）。"""
        job_id = uuid.uuid4().hex
        with self._lock:
            self._jobs[job_id] = {
                "job_id": job_id,
                "kind": kind,
                "status": "pending",
                "progress": 0.0,
                "result": None,
                "error": None,
                "error_code": None,
                "error_data": None,
                "created_at": _now(),
                "updated_at": _now(),
            }
        self._queue.put((job_id, fn, kwargs))
        return job_id

    def get(self, job_id: str) -> Optional[dict]:
        """查询作业状态；不存在返回 ``None``。"""
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job is not None else None

    def list_jobs(self) -> list[dict]:
        """列出全部作业（按创建顺序）。"""
        with self._lock:
            return [dict(j) for j in self._jobs.values()]

    # -- 内部 --------------------------------------------------------------- #
    def _set(self, job_id: str, **fields: Any) -> None:
        """更新作业字段（线程安全）。"""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.update(fields)
            job["updated_at"] = _now()

    def _worker(self) -> None:
        """后台工作线程：串行取出并执行作业。"""
        while not self._stop.is_set():
            try:
                job_id, fn, kwargs = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            self._set(job_id, status="running", progress=0.1)
            try:
                result = fn(**kwargs)
                self._set(job_id, status="done", progress=1.0, result=result,
                          error=None, error_code=None, error_data=None)
            except Exception as exc:  # noqa: BLE001 - 任何异常都记录为作业失败
                # 把异常映射为统一错误码，供前端按 code 分类（如 50001 桥接不可用）。
                from .errors import to_api_error  # 延迟导入，避免循环依赖
                mapped = to_api_error(exc)
                self._set(job_id, status="error", error=mapped.message,
                          error_code=mapped.code, error_data=mapped.data)
            finally:
                self._queue.task_done()

    def shutdown(self, *, wait: bool = False) -> None:
        """请求工作线程退出（供测试/关停使用）。"""
        self._stop.set()
        if wait:
            self._thread.join(timeout=5.0)


#: 进程级默认作业管理器（惰性创建）。
_DEFAULT_MANAGER: JobManager | None = None
_DEFAULT_LOCK = threading.Lock()


def get_manager() -> JobManager:
    """返回进程级默认作业管理器（首次调用时创建）。"""
    global _DEFAULT_MANAGER
    with _DEFAULT_LOCK:
        if _DEFAULT_MANAGER is None:
            _DEFAULT_MANAGER = JobManager()
        return _DEFAULT_MANAGER


__all__ = ["JobManager", "get_manager"]
