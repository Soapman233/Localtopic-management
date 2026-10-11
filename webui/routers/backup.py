"""整库备份 / 恢复路由。

便携客户端的数据全在 ``outputs/bank.db`` 一个文件里——换电脑、重装、U 盘损坏都会丢。
本路由把 :mod:`bank.backup` 的能力暴露给界面，让老师**一键导出 / 一键恢复**。

* ``GET  /api/backup/info``      —— 库路径 / 大小 / 备份目录 / 已有备份
* ``POST /api/backup/create``    —— 在服务端创建一份备份，返回路径与校验结果
* ``GET  /api/backup/download``  —— 下载当前整库（换机时带走）
* ``POST /api/backup/restore``   —— 上传备份文件并恢复（**恢复前自动留回滚点**）

⚠️ 恢复会替换正在使用的库文件。单机单用户场景下可接受，但**建议恢复后重启服务**，
响应中会明确提示。
"""
# ---------------------------------------------------------------------------
# title: webui 备份/恢复路由
# description: 整库导出与恢复；恢复前自动备份现有库并用 verify_backup 校验候选。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse

from bank import backup as _bk

from .. import config, errors
from ..errors import ok

router = APIRouter(prefix="/api", tags=["backup"])

_CHUNK = 1024 * 1024
_UNSAFE = re.compile(r"[^\w.\u4e00-\u9fff-]+")


def _safe(name: str) -> str:
    base = Path(name or "backup.db").name
    return (_UNSAFE.sub("_", base).strip("._") or "backup.db")[:120]


def _db_path() -> Path:
    return Path(config.get_db_path()).resolve()


@router.get("/backup/info")
def api_backup_info() -> dict:
    """当前库与备份目录概况（供界面展示）。"""
    db = _db_path()
    bdir = _bk.default_backup_dir(db)
    backups = sorted((p.name for p in bdir.glob("*.db")), reverse=True)[:20] if bdir.is_dir() else []
    return ok({
        "db_path": str(db),
        "db_exists": db.is_file(),
        "db_bytes": db.stat().st_size if db.is_file() else 0,
        "backup_dir": str(bdir),
        "backups": backups,
    })


@router.post("/backup/create")
def api_backup_create() -> dict:
    """在服务端创建一份备份（默认写入库同级的 ``backups/``）。"""
    rep = _bk.create_backup(_db_path())
    if not rep.get("ok"):
        raise errors.bad_request(errors.CODE_INVALID_UPLOAD,
                                 f"备份失败：{rep.get('error')}")
    return ok({
        "path": rep["path"],
        "bytes": rep["bytes"],
        "seconds": rep["seconds"],
        "verify_ok": bool((rep.get("verify") or {}).get("ok")),
    })


@router.get("/backup/download")
def api_backup_download() -> FileResponse:
    """下载当前整库（换机 / 备份到本地用）。"""
    db = _db_path()
    if not db.is_file():
        raise errors.not_found(errors.CODE_SOURCE_NOT_FOUND, f"库不存在：{db}")
    # 先做一次在线备份再下载：避免下载过程中库被写入导致文件不一致
    tmp = _bk.default_backup_dir(db) / "download-snapshot.db"
    rep = _bk.create_backup(db, tmp)
    if not rep.get("ok"):
        raise errors.bad_request(errors.CODE_INVALID_UPLOAD,
                                 f"生成下载快照失败：{rep.get('error')}")
    return FileResponse(str(rep["path"]), media_type="application/octet-stream",
                        filename="题库备份.db")


@router.post("/backup/restore")
def api_backup_restore(file: UploadFile = File(...)) -> dict:
    """上传备份文件并恢复。

    **恢复前会自动把现有库备份到 ``backups/pre-restore-<时间戳>.db``**；
    候选文件先经 ``verify_backup`` 校验，不合格一律拒绝。
    """
    db = _db_path()
    stage = _bk.default_backup_dir(db) / f"upload-{_safe(file.filename)}"
    stage.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    try:
        with stage.open("wb") as fh:
            while True:
                chunk = file.file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                fh.write(chunk)
    except Exception as exc:  # noqa: BLE001
        stage.unlink(missing_ok=True)
        raise errors.bad_request(errors.CODE_INVALID_UPLOAD, f"文件读取失败：{exc}") from exc

    if size == 0:
        stage.unlink(missing_ok=True)
        raise errors.bad_request(errors.CODE_MISSING_UPLOAD, "文件为空。")

    rep = _bk.restore_backup(db, stage)
    if not rep.get("ok"):
        raise errors.bad_request(errors.CODE_INVALID_UPLOAD,
                                 f"恢复失败：{rep.get('error')}")
    return ok({
        "restored_from": rep["restored_from"],
        "pre_restore_backup": rep.get("pre_restore_backup"),
        "bytes": rep["bytes"],
        "restart_advised": True,
        "message": "恢复完成。建议重启题库服务，以确保所有页面读取到新数据。",
    })


__all__ = ["router"]
