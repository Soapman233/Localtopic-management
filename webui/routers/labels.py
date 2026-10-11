"""知识点复核路由。"""
# ---------------------------------------------------------------------------
# title: webui 知识点复核路由
# description: /api/labels* —— 按标签汇总、逐条复核、决策预检/确认否决、复核 CSV 导出导入。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import FileResponse

from .. import config, db
from ..errors import ok
from ..schemas import LabelDecisionPreviewRequest, LabelDecisionRequest
from ..services import labels_svc as svc

router = APIRouter(prefix="/api", tags=["labels"])


@router.get("/labels/review-summary")
def api_review_summary(namespace: str = "知识点", status: Optional[str] = "待复核",
                       limit: Optional[int] = None) -> dict:
    """按标签汇总复核情况 + 状态计数。"""
    with db.read_conn() as conn:
        return ok(svc.review_summary(conn, namespace=namespace, status=status, limit=limit))


@router.get("/labels/review-items")
def api_review_items(label_name: str, status: Optional[str] = "待复核",
                     namespace: str = "知识点", limit: int = Query(50, ge=1, le=500),
                     offset: int = Query(0, ge=0)) -> dict:
    """某标签的逐条复核清单。"""
    with db.read_conn() as conn:
        return ok(svc.review_items(conn, label_name=label_name, status=status,
                                   namespace=namespace, limit=limit, offset=offset))


@router.post("/labels/decision/preview")
def api_decision_preview(body: LabelDecisionPreviewRequest) -> dict:
    """只读预检一次决策的影响条数。"""
    with db.read_conn() as conn:
        return ok(svc.decision_preview(conn, label_name=body.label_name,
                                       decision=body.decision, question_id=body.question_id))


@router.post("/labels/decision")
def api_decision(body: LabelDecisionRequest) -> dict:
    """确认 / 否决（批量需 ``confirm=true``）。"""
    with db.write_txn() as conn:
        return ok(svc.decision(conn, label_name=body.label_name, decision=body.decision,
                               question_id=body.question_id, confirm=body.confirm,
                               force=body.force))


@router.get("/labels/export-review")
def api_export_review(status: Optional[str] = "待复核", namespace: str = "知识点") -> FileResponse:
    """导出复核清单 CSV。"""
    with db.read_conn() as conn:
        path = svc.export_review_csv(conn, status=status, namespace=namespace)
    return FileResponse(str(path), media_type="text/csv", filename=Path(path).name)


@router.post("/labels/import-review")
def api_import_review(file: UploadFile = File(...), force: bool = False) -> dict:
    """导入老师填写的复核 CSV。"""
    tmp_dir = config.WEBUI_DIR / "csv"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"import_{Path(file.filename or 'review.csv').name}"
    with tmp_path.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    with db.write_txn() as conn:
        result = svc.import_review_csv(conn, tmp_path, force=force)
    return ok(result)


__all__ = ["router"]
