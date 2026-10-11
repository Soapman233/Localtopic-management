"""DOCX 导入服务：把老师上传的试卷 DOCX 变成题库里的题。

链路（Phase 2.1 调查确认，**最小 2 步**）::

    pipeline.stage1.process_file(path, out_dir, timeout, verbose) -> dict
    bank.importer.import_file(conn, qjson_path) -> dict

为什么这是便携路线的关键
------------------------
个人客户端是「**自己建库**」——没有管理员帮忙建库，**导入是唯一的建库途径**。
此前导入只能通过 4+ 条命令行，Web 界面完全没有入口。

实测结论（Phase 2.1，`outputs/handoff/R-可编程导入调查报告.md`）
----------------------------------------------------------------
* `process_file` **永不抛异常**（失败落 ``status="ERROR"``）；
* **不依赖 `editor_sdk` / COM / cwd / 环境变量**；
* 单文件耗时 ~0.01s（纯 OMML 路径）；重复导入**幂等**（全 skipped）；
* ⚠️ `pipeline.mtef_conv` 的 MathType 路径用 ``spawn`` 多进程
  → **PyInstaller 打包必须加 `freeze_support()`**（见 Phase 3）。
"""
# ---------------------------------------------------------------------------
# title: DOCX 导入服务
# description: 上传 DOCX → 阶段1 预处理 → 入库；复用 JobManager 单线程作业范式；不依赖 editor_sdk。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import shutil
from pathlib import Path

from pipeline import stage1 as _stage1

from .. import config, db as _wdb, errors
from ..jobs import get_manager

#: 单个上传文件大小上限（字节）。试卷 DOCX 通常 <10MB，100MB 留足余量。
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

#: 允许的扩展名。
ALLOWED_SUFFIXES: tuple[str, ...] = (".docx",)

#: 单文件处理超时（秒）——传给 ``stage1.process_file``。
IMPORT_TIMEOUT = 300.0

#: 导入功能开关（便携版若需隐藏入口可关掉）。
FEATURE_ENV = "QB_IMPORT_ENABLED"


def import_enabled() -> bool:
    """导入功能是否启用（默认启用；设 ``QB_IMPORT_ENABLED=0`` 关闭）。"""
    import os
    return os.environ.get(FEATURE_ENV, "1").strip().lower() not in ("0", "false", "no", "off")


def upload_dir() -> Path:
    """上传暂存目录（位于 webui 数据目录下，随 QB_DB_PATH 走）。"""
    d = config.WEBUI_DIR / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def work_dir() -> Path:
    """阶段1 预处理产物目录（导入完成后可清理）。"""
    d = config.WEBUI_DIR / "import_work"
    d.mkdir(parents=True, exist_ok=True)
    return d


def validate_upload(filename: str | None, size: int | None) -> None:
    """校验上传文件；非法即抛（40010 缺失 / 40011 非法）。

    * 功能关闭 → 40011；
    * 无文件名或大小为 0 → 40010；
    * 扩展名不在白名单 → 40011；
    * 超过大小上限 → 40011。
    """
    if not import_enabled():
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD, "导入功能已关闭（QB_IMPORT_ENABLED=0）。")
    name = (filename or "").strip()
    if not name or not size:
        raise errors.bad_request(
            errors.CODE_MISSING_UPLOAD, "未提供文件，或文件为空。")
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD,
            f"仅支持 {', '.join(ALLOWED_SUFFIXES)}，收到 {suffix or '（无扩展名）'}。")
    if size > MAX_UPLOAD_BYTES:
        raise errors.bad_request(
            errors.CODE_INVALID_UPLOAD,
            f"文件过大（{size / 1048576:.1f} MB），上限 {MAX_UPLOAD_BYTES // 1048576} MB。")


def import_request(filename: str | None, size: int | None,
                   upload_path: Path) -> dict:
    """校验并提交导入作业，返回 ``{job_id, filename, size_bytes}``。"""
    validate_upload(filename, size)
    job_id = get_manager().submit("import", run_import_job,
                                  upload_path=str(upload_path),
                                  original_name=(filename or "").strip())
    return {"job_id": job_id, "filename": (filename or "").strip(),
            "size_bytes": int(size or 0)}


def run_import_job(upload_path: str, original_name: str) -> dict:
    """作业执行体：阶段1 预处理 → 入库。返回导入报告。

    在 ``JobManager`` 单线程中运行，与导出/预览**串行**，避免争用。
    """
    src = Path(upload_path)
    work = work_dir()
    out_dir = work / src.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- 1) 阶段1：DOCX -> scan.json + questions.json ----
    rec = _stage1.process_file(src, out_dir, IMPORT_TIMEOUT, False)
    if rec.get("status") != "OK":
        return {
            "status": "ERROR",
            "filename": original_name,
            "stage": "preprocess",
            "error": rec.get("error") or "阶段1 预处理失败",
            "record": {k: v for k, v in rec.items() if k != "traceback"},
        }

    qjson = out_dir / f"{src.stem}.questions.json"
    if not qjson.is_file():
        return {"status": "ERROR", "filename": original_name, "stage": "preprocess",
                "error": f"未生成题目文件：{qjson.name}"}

    # ---- 2) 入库（写事务；失败自动回滚，不污染已有数据）----
    with _wdb.write_txn() as conn:
        imp = _stage1_import(conn, qjson)

    # ``bank.importer.import_file`` 的返回键：new / updated / skipped / junk
    # （**不是** inserted —— 曾按 inserted 读取导致报告恒为 0，实测发现）
    inserted = int(imp.get("new") or 0)
    updated = int(imp.get("updated") or 0)
    result = {
        "status": "OK",
        "filename": original_name,
        "questions": rec.get("questions") or {},
        "review_count": rec.get("review_count") or 0,
        "seconds": rec.get("seconds"),
        "import": {k: v for k, v in imp.items() if k != "file"},
        "imported": inserted + updated,
        "inserted": inserted,
        "updated": updated,
        "skipped": int(imp.get("skipped") or 0),
        "junk": int(imp.get("junk") or 0),
    }
    _cleanup(out_dir, src)
    return result


def _stage1_import(conn, qjson: Path) -> dict:
    """调用 ``bank.importer.import_file``（内部已捕获异常，不外抛）。"""
    from bank import importer
    return importer.import_file(conn, qjson, verbose=False)


def _cleanup(out_dir: Path, upload: Path) -> None:
    """清理中间产物（失败不致命，仅忽略）。"""
    for p in (out_dir,):
        try:
            shutil.rmtree(p, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
    try:
        upload.unlink()
    except Exception:  # noqa: BLE001
        pass


__all__ = [
    "MAX_UPLOAD_BYTES", "ALLOWED_SUFFIXES", "IMPORT_TIMEOUT", "FEATURE_ENV",
    "import_enabled", "upload_dir", "work_dir", "validate_upload",
    "import_request", "run_import_job",
]
