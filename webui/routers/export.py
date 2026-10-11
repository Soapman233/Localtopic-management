"""预览 / 导出路由：作业提交、作业状态、预览 PNG。"""
# ---------------------------------------------------------------------------
# title: webui 预览/导出路由
# description: /api/papers/{id}/preview|export、/api/jobs/{id}、/api/preview/{key}/page_{n}.png。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .. import db
from ..errors import CODE_JOB_NOT_FOUND, not_found, ok
from ..jobs import get_manager
from ..schemas import ExportRequest, PreviewRequest
from ..services import export_svc as svc
from ..services import preview as pv

router = APIRouter(prefix="/api", tags=["export"])

#: 缓存 key 白名单（sha256 十六进制）。
_KEY_RE = re.compile(r"^[0-9a-f]{64}$")


@router.post("/papers/{paper_id}/preview")
def api_preview(paper_id: int, body: PreviewRequest | None = None) -> dict:
    """提交预览：命中缓存同步返回；否则返回 ``job_id`` 供轮询。"""
    body = body or PreviewRequest()
    with db.read_conn() as conn:
        data = svc.preview_request(conn, paper_id, answer_mode=body.answer_mode,
                                   template=body.template)
    return ok(data)


@router.post("/papers/{paper_id}/export")
def api_export(paper_id: int, body: ExportRequest | None = None) -> dict:
    """提交导出作业，返回 ``job_id``（Word/WPS 缺失时自动降级为仅 DOCX）。"""
    body = body or ExportRequest()
    with db.read_conn() as conn:
        data = svc.export_request(conn, paper_id, answer_mode=body.answer_mode,
                                  template=body.template, formats=body.formats,
                                  out_dir=body.out_dir)
    return ok(data)


@router.get("/jobs/{job_id}")
def api_job(job_id: str) -> dict:
    """查询作业状态：``{status, progress, result?, error?, error_code?}``。"""
    job = get_manager().get(job_id)
    if job is None:
        raise not_found(CODE_JOB_NOT_FOUND, f"作业不存在：{job_id}")
    return ok(job)


@router.get("/preview/{key}/page_{n}.png")
def api_preview_page(key: str, n: int) -> FileResponse:
    """读取预览缓存的第 ``n`` 页 PNG（key 做白名单校验，路径不可穿越）。"""
    if not _KEY_RE.match(key or ""):
        raise not_found(CODE_JOB_NOT_FOUND, "预览 key 非法")
    meta = pv.load_meta(key)
    if meta is None:
        raise not_found(CODE_JOB_NOT_FOUND, f"预览缓存不存在：{key}")
    pv.validate_meta(key,meta)
    total = int(meta.get("page_count") or 0)
    if n < 1 or n > total:
        raise not_found(CODE_JOB_NOT_FOUND, f"页码越界：{n}（共 {total} 页）")
    path = pv.page_path(key, n)
    if not path.is_file():
        raise not_found(CODE_JOB_NOT_FOUND, f"预览页不存在：{n}")
    return FileResponse(str(path), media_type="image/png")


__all__ = ["router"]
