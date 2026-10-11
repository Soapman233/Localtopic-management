"""预览 / 导出作业编排。

职责
----
* ``preview_request`` —— 计算内容指纹：命中缓存**同步返回**；未命中则做**环境自检（M3）**
  后提交后台作业，返回 ``job_id``。
* ``export_request`` —— 校验格式；Word/WPS 缺失时**自动降级**为「仅 DOCX」并明确提示；
  editor_sdk 缺失则直接失败（50001）。
* ``run_preview_job`` / ``run_export_job`` —— 由 :class:`webui.jobs.JobManager` **单线程串行**
  执行（保护 editor_sdk 单实例与 Word COM）。
* 预览与导出**共享同一份渲染产物**（``webui.services.preview`` 的缓存 DOCX）。
"""
# ---------------------------------------------------------------------------
# title: webui 预览/导出编排
# description: 预览/导出作业提交与执行；环境自检与降级（M3）；复用 preview 缓存产物。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import re
import shutil
from pathlib import Path

from bank import db as _bdb
from bank import export as _export
from bank import paper as _paper
from bank import export_content as _content

from .. import config, errors
from ..jobs import get_manager
from . import papers as _papers
from . import preview as _preview

#: 合法导出格式。
FORMATS: tuple[str, ...] = ("docx", "pdf")
#: 文件名非法字符。
_UNSAFE_RE = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def _safe_name(text: str) -> str:
    """把标题压成安全的文件名片段。"""
    cleaned = _UNSAFE_RE.sub("_", str(text or "")).strip().strip(".")
    return (cleaned or "paper")[:80]


def _editor_sdk_available() -> bool:
    """editor_sdk 是否可达（短超时探测，避免阻塞）。"""
    return bool(config.detect_editor_sdk(timeout=0.3).get("available"))


def _office_available() -> bool:
    """本机是否有 Word / WPS（注册表探测，不启动进程）。"""
    return bool(config.detect_office().get("available"))


def _ensure_editor_sdk() -> None:
    """editor_sdk 不可达时抛 50001（明确提示，不静默失败）。"""
    if not _editor_sdk_available():
        raise errors.bridge_error(
            "未检测到 editor_sdk 服务（127.0.0.1:39099 起）：公式渲染与 DOCX 生成不可用。"
            "请先启动 editor_sdk 后重试。")


def _validate_mode_template(mode: str, template: str) -> None:
    """校验答案模式与模板取值（非法抛 40003）。"""
    if mode not in _paper.ANSWER_MODES:
        raise errors.bad_request(errors.CODE_INVALID_TEMPLATE,
                                 f"answer_mode 取值必须是 {_paper.ANSWER_MODES}，收到 {mode!r}")
    if template not in _export.TEMPLATE_SPECS:
        raise errors.bad_request(errors.CODE_INVALID_TEMPLATE,
                                 f"template 取值必须是 {tuple(_export.TEMPLATE_SPECS)}，"
                                 f"收到 {template!r}")


# --------------------------------------------------------------------------- #
# 请求入口（同步部分）
# --------------------------------------------------------------------------- #
def preview_request(conn, paper_id: int, *, answer_mode: str | None = None,
                    template: str | None = None) -> dict:
    """``POST /api/papers/{id}/preview`` 的同步逻辑。

    * 命中缓存 → ``{"cached": true, "key", "pages":[...]}``（**零重渲染**）；
    * 未命中 → 环境自检（editor_sdk + Office）后提交作业 →
      ``{"cached": false, "job_id", "key", "pages": []}``。
    """
    row = _papers.get_paper_row(conn, paper_id)
    if row is None:
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷不存在：{paper_id}")
    mode = answer_mode or row["answer_mode"]
    tpl = template or row["template"]
    _validate_mode_template(mode, tpl)

    payload=_paper.build_export_payload(conn,paper_id,answer_mode=mode,template=tpl)
    _content.require_export_allowed(payload['diagnostics'],mode)
    key = _preview.payload_key(payload)
    if _preview.is_cached(key):
        meta = _preview.load_meta(key) or {}
        _preview.validate_meta(key,meta)
        meta["cached"] = True
        meta["elapsed_ms"] = 0
        meta["job_id"] = None
        return _preview.public_meta(meta)

    # 环境自检（M3）：缺失依赖时**明确失败**，不静默、不返回空页面。
    _ensure_editor_sdk()
    if not _office_available():
        raise errors.bridge_error(
            "未检测到 Microsoft Word / WPS：无法生成 PDF，像素级预览不可用。"
            "可改用「导出 DOCX」，或安装 Word/WPS 后重试。")

    job_id = get_manager().submit("preview", run_preview_job,
                                  paper_id=paper_id, answer_mode=mode,
                                  template=tpl, key=key, expected_content_digest=payload['content_digest'])
    return {"cached": False, "job_id": job_id, "key": key, "pages": [], **_preview.content_fields(payload)}


def export_request(conn, paper_id: int, *, answer_mode: str | None = None,
                   template: str | None = None, formats: list | None = None,
                   out_dir: str | None = None) -> dict:
    """``POST /api/papers/{id}/export`` 的同步逻辑，返回 ``{job_id, key, formats, warnings}``。

    Word/WPS 缺失时**自动降级**（去掉 ``pdf``）并在 ``warnings`` 中明确提示。
    """
    row = _papers.get_paper_row(conn, paper_id)
    if row is None:
        raise errors.not_found(errors.CODE_PAPER_NOT_FOUND, f"试卷不存在：{paper_id}")
    mode = answer_mode or row["answer_mode"]
    tpl = template or row["template"]
    _validate_mode_template(mode, tpl)
    payload=_paper.build_export_payload(conn,paper_id,answer_mode=mode,template=tpl)
    _content.require_export_allowed(payload['diagnostics'],mode)

    wanted = [f for f in (formats or ["docx"]) if f in FORMATS]
    if not wanted:
        wanted = ["docx"]
    warnings: list[str] = []
    if "pdf" in wanted and not _office_available():
        wanted = [f for f in wanted if f != "pdf"]
        warnings.append("未检测到 Microsoft Word / WPS：已降级为「仅导出 DOCX」。")

    # DOCX 生成默认走自研引擎（bank.docx_writer），**不需要 editor_sdk**；
    # 仅当显式选择 bridge 引擎时才强制要求该服务。
    if _export.resolve_export_engine() == "bridge":
        _ensure_editor_sdk()

    key = _preview.payload_key(payload)
    target = out_dir or str(config.get_export_dir())
    job_id = get_manager().submit("export", run_export_job,
                                  paper_id=paper_id, answer_mode=mode, template=tpl,
                                  formats=wanted, out_dir=target, expected_content_digest=payload['content_digest'])
    return {"job_id": job_id, "key": key, "formats": wanted,
            "answer_mode": mode, "template": tpl, "warnings": warnings, **_preview.content_fields(payload)}


# --------------------------------------------------------------------------- #
# 作业执行体（在 JobManager 单线程中运行）
# --------------------------------------------------------------------------- #
def run_preview_job(paper_id: int, answer_mode: str | None, template: str | None,
                    key: str, expected_content_digest: str) -> dict:
    """预览作业：渲染（或命中缓存）并返回公开元数据。"""
    return _preview.render(paper_id, answer_mode, template, key, expected_content_digest=expected_content_digest)


def run_export_job(paper_id: int, answer_mode: str | None, template: str | None,
                   formats: list, out_dir: str, expected_content_digest: str) -> dict:
    """导出作业：复用预览缓存产物，落地 DOCX（+PDF）到导出目录，返回导出报告。"""
    payload=_preview.current_payload(paper_id,answer_mode,template,expected_content_digest=expected_content_digest)
    key=_preview.payload_key(payload)

    rendered = _preview.render(paper_id, answer_mode, template, key, expected_content_digest=expected_content_digest)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    base = _safe_name(f"{rendered.get('title') or ('paper' + str(paper_id))}"
                      f"_{rendered.get('answer_mode') or answer_mode}_{key[:8]}")
    docx_dst = out / f"{base}.docx"
    _preview.current_payload(paper_id,answer_mode,template,key=key,expected_content_digest=expected_content_digest)
    if (_preview.load_meta(key) or {}).get('docx_sha256')!=__import__('hashlib').sha256(_preview.docx_path(key).read_bytes()).hexdigest():
        raise _content.ExportEvidenceStale(payload['diagnostics'])
    shutil.copyfile(_preview.docx_path(key), docx_dst)

    pdf_dst: Path | None = None
    warnings = list(rendered.get("warnings") or [])
    if "pdf" in formats:
        src_pdf = _preview.pdf_path(key)
        if src_pdf.is_file():
            pdf_dst = out / f"{base}.pdf"
            shutil.copyfile(src_pdf, pdf_dst)
        else:
            warnings.append("PDF 未生成（Word/WPS 不可用或导出失败），已仅导出 DOCX。")

    return {
        **_preview.content_fields(payload),
        "paper_id": paper_id,
        "title": rendered.get("title"),
        "template": rendered.get("template"),
        "answer_mode": rendered.get("answer_mode"),
        "docx": str(docx_dst),
        "docx_size_bytes": docx_dst.stat().st_size if docx_dst.is_file() else 0,
        "pdf": str(pdf_dst) if pdf_dst else None,
        "pdf_size_bytes": pdf_dst.stat().st_size if pdf_dst and pdf_dst.is_file() else 0,
        "formats": list(formats),
        "question_count": rendered.get("question_count"),
        "section_count": rendered.get("section_count"),
        "formulas_written": rendered.get("formulas_written"),
        "images_written": rendered.get("images_written"),
        "page_count": rendered.get("page_count"),
        "cache_key": key,
        "cached": bool(rendered.get("cached")),
        "warnings": warnings,
        "bridge_errors": rendered.get("bridge_errors") or [],
    }


__all__ = [
    "FORMATS", "preview_request", "export_request",
    "run_preview_job", "run_export_job",
]
