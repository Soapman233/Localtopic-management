"""像素级预览渲染与缓存（DOCX → PDF → PNG）。

链路（与最终导出**完全同源**，故逐像素一致）
------------------------------------------------
``bank.paper.build_export_payload`` → ``bank.export.build_document_plan`` →
``EditorBridge.render_plan_to_docx``（原生 OMML）→ ``postprocess_bridge_docx`` →
``bank.export.export_pdf``（Word/WPS COM）→ ``pypdfium2`` 逐页渲染 ``page_N.png``。

缓存策略
--------
``cache_key = sha256(paper.meta + 有序[(item_id, question_version, score, seq, section_id)])``；
只要该指纹不变（``paper_questions.snapshot_json`` 已锁定内容），渲染结果必然不变 →
直接命中缓存、**零重渲染**。缓存目录 ``outputs/webui/preview_cache/<key>/``。

产物（供导出复用）
------------------
``paper.docx``（DOCX）、``paper.pdf``（若环境允许）、``page_N.png``（逐页位图）、
``meta.json``（页面尺寸/计数/告警/统计）。导出命中同一 key 时**直接复用** ``paper.docx``。
"""
# ---------------------------------------------------------------------------
# title: webui 像素级预览引擎
# description: 预览渲染（DOCX→PDF→PNG）+ 内容指纹缓存；与导出共享渲染产物。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from bank import db as _bdb
from bank import export as _export
from bank import paper as _paper
from bank import export_content as _content

from .. import config, errors

#: 缓存根目录。
CACHE_ROOT: Path = config.PREVIEW_CACHE_DIR
#: PNG 渲染缩放（约 2.2 → 150dpi 级别，A4 页面 ≈ 1654×2339）。
SCALE: float = 2.2


def _now() -> str:
    """当前时间（ISO 8601，秒精度）。"""
    return time.strftime("%Y-%m-%dT%H:%M:%S")


# --------------------------------------------------------------------------- #
# 缓存 key / 路径
# --------------------------------------------------------------------------- #
def cache_key(conn, paper_id: int, answer_mode: str | None = None,
              template: str | None = None) -> str:
    """计算内容指纹（含试卷元数据 + 有序条目指纹）。"""
    payload=_paper.build_export_payload(conn,paper_id,answer_mode=answer_mode,template=template)
    _content.require_export_allowed(payload['diagnostics'],payload['answer_mode'])
    return payload_key(payload)


def payload_key(payload: dict) -> str:
    """预览/导出缓存 key。

    ⚠️ **必须包含导出引擎**：缓存产物是「某引擎渲染出来的 DOCX」，
    若 key 不含引擎，切换 ``QB_EXPORT_ENGINE`` 后会**继续复用旧引擎的产物**，
    且从文件名/大小上看不出差别（实测踩过：清缓存后才复现真实行为）。
    """
    return _content.digest({
        'content_digest': payload['content_digest'],
        'content_guard_revision': _content.CONTENT_GUARD_REVISION,
        'layout_revision': _content.LAYOUT_REVISION,
        'export_engine': _export.resolve_export_engine(),
    })


def current_payload(paper_id, answer_mode, template, *, key=None, expected_content_digest=None):
    conn=_bdb.connect_readonly(config.get_db_path())
    try:
        payload=_paper.build_export_payload(conn,paper_id,answer_mode=answer_mode,template=template)
    finally:conn.close()
    if (key is not None and payload_key(payload)!=key) or (expected_content_digest is not None and payload['content_digest']!=expected_content_digest):
        raise _content.ExportEvidenceStale(payload['diagnostics'])
    _content.require_export_allowed(payload['diagnostics'],payload['answer_mode'])
    return payload


def content_fields(payload):
    return {k:payload[k] for k in ('content_digest','content_guard_revision','layout_revision','diagnostics')}


def validate_meta(key,meta):
    """旧URL/缓存也回到当前内容守卫；老revision 或**换了导出引擎**都视为过期。"""
    if (not meta.get('paper_id') or
            meta.get('content_guard_revision') != _content.CONTENT_GUARD_REVISION or
            meta.get('layout_revision') != _content.LAYOUT_REVISION or
            meta.get('export_engine') != _export.resolve_export_engine()):
        raise _content.ExportEvidenceStale(meta.get('diagnostics') or {})
    return current_payload(meta['paper_id'],meta.get('answer_mode'),meta.get('template'),
                           key=key,expected_content_digest=meta.get('content_digest'))


def cache_dir(key: str) -> Path:
    """某 key 的缓存目录。"""
    return CACHE_ROOT / key


def meta_path(key: str) -> Path:
    """缓存元数据文件路径。"""
    return cache_dir(key) / "meta.json"


def docx_path(key: str) -> Path:
    """缓存 DOCX 路径。"""
    return cache_dir(key) / "paper.docx"


def pdf_path(key: str) -> Path:
    """缓存 PDF 路径。"""
    return cache_dir(key) / "paper.pdf"


def page_path(key: str, n: int) -> Path:
    """缓存第 ``n`` 页 PNG 路径。"""
    return cache_dir(key) / f"page_{n}.png"


def load_meta(key: str) -> dict | None:
    """读取缓存元数据；不存在或损坏返回 ``None``。"""
    path = meta_path(key)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def is_cached(key: str) -> bool:
    """判断某 key 是否**完整命中**缓存（meta + DOCX + 至少一页 PNG 且页面文件齐全）。"""
    meta = load_meta(key)
    if not meta:
        return False
    if meta.get('content_guard_revision')!=_content.CONTENT_GUARD_REVISION or meta.get('layout_revision')!=_content.LAYOUT_REVISION:
        return False
    if not docx_path(key).is_file():
        return False
    if hashlib.sha256(docx_path(key).read_bytes()).hexdigest()!=meta.get('docx_sha256'):
        return False
    pages = meta.get("pages") or []
    if not pages:
        return False
    return all((cache_dir(key) / pg["file"]).is_file() for pg in pages)


def public_meta(meta: dict) -> dict:
    """给缓存元数据补上每页的可访问 URL（供前端 ``<img src>``）。"""
    key = meta.get("key")
    pages = []
    for pg in meta.get("pages") or []:
        pages.append({
            "n": pg.get("n"), "file": pg.get("file"),
            "url": f"/api/preview/{key}/page_{pg.get('n')}.png",
            "width": pg.get("width"), "height": pg.get("height"),
        })
    out = dict(meta)
    out["pages"] = pages
    return out


# --------------------------------------------------------------------------- #
# 渲染
# --------------------------------------------------------------------------- #
def _render_pages(pdf_file: Path, out_dir: Path) -> list[dict]:
    """把 PDF 逐页渲染为 PNG，返回 ``[{n,file,width,height}]``。"""
    import pypdfium2 as pdfium  # 延迟导入：缺依赖时给出明确错误

    pages: list[dict] = []
    doc = pdfium.PdfDocument(str(pdf_file))
    try:
        for i in range(len(doc)):
            page = doc[i]
            bitmap = page.render(scale=SCALE)
            pil = bitmap.to_pil()
            name = f"page_{i + 1}.png"
            pil.save(out_dir / name)
            pages.append({"n": i + 1, "file": name,
                          "width": pil.width, "height": pil.height})
    finally:
        doc.close()
    return pages


def _cleanup_raw(raw: Path) -> None:
    """尽力删除桥接中间文件（句柄释放后即可删除）。"""
    for _ in range(20):
        try:
            raw.unlink()
            break
        except FileNotFoundError:
            break
        except OSError:
            time.sleep(0.5)


def _generate_docx(plan: dict, key: str) -> tuple[dict, "_export.EditorBridge | None"]:
    """生成 DOCX。

    引擎由 :func:`bank.export.resolve_export_engine` 决定（``QB_EXPORT_ENGINE``，
    **默认 native**）：

    * **native** —— 自研 :mod:`bank.docx_writer`，**不需要 editor_sdk**，
      直接产出正确的 OOXML，**无需桥接后处理**；
    * ``bridge`` —— 原 editor_sdk 链路（含一次自动重试，缓解单实例服务的瞬时抖动）；
    * ``auto`` —— native 失败时回退 bridge 并如实记录。

    返回值第二项在 native 路径下为 ``None``（调用方需容错）。
    """
    cdir = cache_dir(key)
    raw = cdir / "paper.__raw__.docx"
    engine = _export.resolve_export_engine()

    if engine in ("native", "auto"):
        try:
            from bank import docx_writer
            written = docx_writer.write_plan(plan, docx_path(key))
            _cleanup_raw(raw)
            return written, None
        except Exception as exc:  # noqa: BLE001 - auto 才回退，native 直接抛
            if engine != "auto":
                raise
            plan.setdefault("warnings", []).append(
                f"native 渲染失败（{type(exc).__name__}: {exc}），已回退 bridge")

    # ---- bridge 路径 ----
    last_exc: Exception | None = None
    for attempt in (1, 2):
        bridge = _export.EditorBridge()
        try:
            written = _export.render_plan_to_docx(bridge, plan, raw)
            _export.postprocess_bridge_docx(raw, dst=docx_path(key))
            _cleanup_raw(raw)
            return written, bridge
        except Exception as exc:  # noqa: BLE001 - 重试一次，仍失败则向上抛
            last_exc = exc
            try:
                bridge.close()
            except Exception:  # noqa: BLE001
                pass
            _cleanup_raw(raw)
            if attempt == 1:
                time.sleep(1.0)
    raise last_exc  # type: ignore[misc]


def render(paper_id: int, answer_mode: str | None, template: str | None,
           key: str, *, expected_content_digest: str | None = None) -> dict:
    """渲染（或命中缓存）一份预览，返回公开元数据（含页面 URL）。

    * 命中完整缓存 → 直接返回，**不重跑渲染**（``cached=True``）；
    * 未命中 → DOCX → PDF → PNG，写 ``meta.json``，返回 ``cached=False``。
    * **PDF 失败不抛异常**：记录 ``warnings`` 与 ``pdf=None``，仍产出 DOCX
      （导出可降级为「仅 DOCX」）；预览端点会在提交作业前先行环境自检。
    """
    payload=current_payload(paper_id,answer_mode,template,key=key,expected_content_digest=expected_content_digest)
    if is_cached(key):
        meta = load_meta(key) or {}
        validate_meta(key,meta)
        meta["cached"] = True
        meta["elapsed_ms"] = 0
        return public_meta(meta)

    t0 = time.time()
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cdir = cache_dir(key)
    cdir.mkdir(parents=True, exist_ok=True)

    conn = _bdb.connect_readonly(config.get_db_path())
    try:
        payload = _paper.build_export_payload(conn, paper_id, answer_mode=answer_mode, template=template)
        _content.require_export_allowed(payload['diagnostics'],payload['answer_mode'])
        if payload_key(payload)!=key:raise _content.ExportEvidenceStale(payload['diagnostics'])

        def _resolver(source_id, media_path, sha256):
            return _export.resolve_media(conn, source_id, media_path, sha256)

        plan = _export.build_document_plan(payload, template=template,
                                           media_resolver=_resolver)
    finally:
        conn.close()

    written, bridge = _generate_docx(plan, key)

    # native 路径无 bridge（返回 None）；字段统一容错，避免属性访问炸掉整个作业。
    bridge_warnings = list(getattr(bridge, "warnings", []) or [])
    bridge_errors = list(getattr(bridge, "errors", []) or [])
    warnings: list[str] = list(plan.get("warnings") or []) + bridge_warnings
    pdf_res = _export.export_pdf(docx_path(key), pdf_path(key))
    pdf_file: Path | None = None
    pages: list[dict] = []
    if pdf_res.get("ok") and pdf_path(key).is_file():
        pdf_file = pdf_path(key)
        try:
            pages = _render_pages(pdf_file, cdir)
        except Exception as exc:  # noqa: BLE001 - 位图化失败降级为「无预览页」
            warnings.append(f"PDF 位图化失败：{exc}")
            pages = []
    else:
        warnings.append(f"PDF 生成失败（预览不可用）：{pdf_res.get('error')}")

    current_payload(paper_id,answer_mode,template,key=key,expected_content_digest=payload['content_digest'])
    meta = {
        **content_fields(payload),
        'docx_sha256': hashlib.sha256(docx_path(key).read_bytes()).hexdigest(),
        "key": key,
        "paper_id": paper_id,
        "title": plan.get("title"),
        "template": plan.get("template"),
        "answer_mode": plan.get("answer_mode"),
        # 记录渲染所用引擎：换引擎即缓存过期（见 payload_key 说明）
        "export_engine": _export.resolve_export_engine(),
        "page_count": len(pages),
        "pages": pages,
        "docx": str(docx_path(key)),
        "pdf": str(pdf_file) if pdf_file else None,
        "formulas_written": written.get("formulas_written", written.get("formulas", 0)),
        "images_written": written.get("images_written", written.get("images", 0)),
        "question_count": sum(len(s["questions"]) for s in plan.get("sections") or []),
        "section_count": len(plan.get("sections") or []),
        "warnings": warnings,
        "bridge_errors": bridge_errors,
        "created_at": _now(),
        "elapsed_ms": int((time.time() - t0) * 1000),
        "cached": False,
    }
    meta_path(key).write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                              encoding="utf-8")
    return public_meta(meta)


__all__ = [
    "CACHE_ROOT", "SCALE", "cache_key", "cache_dir", "meta_path", "docx_path",
    "pdf_path", "page_path", "load_meta", "is_cached", "public_meta", "render",
]
