"""DOCX 导入路由：上传试卷 DOCX 并入库。

* ``GET  /api/import/status`` —— 导入功能是否可用 + 限制（供前端决定是否显示入口）
* ``POST /api/import/docx``   —— 上传并提交导入作业，返回 ``job_id`` 供轮询

错误码：``40010`` 未提供/空文件；``40011`` 格式不支持 / 超限 / 功能关闭。
"""
# ---------------------------------------------------------------------------
# title: webui DOCX 导入路由
# description: 上传 DOCX 提交导入作业；流式落盘并施加大小上限；错误码 40010/40011。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from .. import errors
from ..errors import ok
from ..services import import_svc as svc

router = APIRouter(prefix="/api", tags=["import"])

#: 落盘时的分块大小。
_CHUNK = 1024 * 1024

_UNSAFE = re.compile(r"[^\w.\u4e00-\u9fff-]+")


def _safe_name(name: str) -> str:
    """把上传文件名收敛为安全文件名（保留中文与扩展名）。"""
    base = Path(name or "upload.docx").name
    cleaned = _UNSAFE.sub("_", base).strip("._") or "upload.docx"
    return cleaned[:120]


@router.get("/import/status")
def api_import_status() -> dict:
    """导入功能状态与限制（前端据此决定是否显示入口、提示文案）。"""
    return ok({
        "enabled": svc.import_enabled(),
        "allowed_suffixes": list(svc.ALLOWED_SUFFIXES),
        "max_bytes": svc.MAX_UPLOAD_BYTES,
        "timeout_seconds": svc.IMPORT_TIMEOUT,
    })


@router.post("/import/docx")
def api_import_docx(file: UploadFile = File(...)) -> dict:
    """上传 DOCX 并提交导入作业。

    **流式落盘并在超过上限时立即中断**——不先把整个文件收进内存/磁盘再判断，
    避免超大文件打满磁盘。
    """
    if not svc.import_enabled():
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD, "导入功能已关闭（QB_IMPORT_ENABLED=0）。")

    original = (file.filename or "").strip()
    suffix = Path(original).suffix.lower()
    if not original:
        raise errors.bad_request(errors.CODE_MISSING_UPLOAD, "未提供文件。")
    if suffix not in svc.ALLOWED_SUFFIXES:
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD,
            f"仅支持 {', '.join(svc.ALLOWED_SUFFIXES)}，收到 {suffix or '（无扩展名）'}。")

    dest = svc.upload_dir() / _safe_name(original)
    size = 0
    digest = hashlib.sha256()
    try:
        with dest.open("wb") as fh:
            while True:
                chunk = file.file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > svc.MAX_UPLOAD_BYTES:
                    raise errors.bad_request(
                        errors.CODE_INVALID_UPLOAD,
                        f"文件过大，上限 {svc.MAX_UPLOAD_BYTES // 1048576} MB。")
                digest.update(chunk)
                fh.write(chunk)
    except errors.ApiError:
        dest.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD, f"文件读取失败：{exc}") from exc

    if size == 0:
        dest.unlink(missing_ok=True)
        raise errors.bad_request(errors.CODE_MISSING_UPLOAD, "文件为空。")

    # ⚠️ **归档为源文件**：内容守卫在组卷/导出时会回读源 DOCX 核验题目来源，
    # 缺失即报 source_unavailable blocker（实测会打断「导入→组卷→导出」主流程）。
    archived = svc.store_source(dest, original, digest.hexdigest())
    return ok(svc.import_request(original, size, archived))


__all__ = ["router"]
