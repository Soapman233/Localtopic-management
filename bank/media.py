"""只读媒体信息与复核预览：按内容指纹关联快照图片，并转换旧式预览格式。"""
# ---------------------------------------------------------------------------
# title: 题库媒体信息与复核预览
# description: 批量读取图片 id/原始尺寸，保留快照指纹语义；源 DOCX 公式预览按内容缓存为 PNG。
# author: 待补充
# version: 0.1.0
# category: Web界面-领域层
# ---------------------------------------------------------------------------

from __future__ import annotations

import hashlib
import io
import zipfile
from functools import lru_cache
from collections import defaultdict
from pathlib import Path, PurePosixPath

from PIL import Image


def _member(media_path: str) -> str:
    """只允许源包内媒体成员；不把 ZIP 路径用于文件系统写入。"""
    member = PurePosixPath("word/" + media_path.replace("\\", "/"))
    if ".." in member.parts or member.parts[:2] != ("word", "media"):
        raise ValueError("预览媒体路径无效")
    return str(member)


@lru_cache(maxsize=512)
def _dimensions(source: str, mtime_ns: int, size: int,
                media: tuple[tuple[str, str], ...]) -> tuple[tuple[int, int] | None, ...]:
    """每份源卷只打开一次 ZIP；源文件变动即失效，只读取图片头。"""
    dimensions: list[tuple[int, int] | None] = []
    try:
        with zipfile.ZipFile(source) as doc:
            for media_path, sha256 in media:
                dims = None
                try:
                    blob = doc.read(_member(media_path))
                    if not sha256 or hashlib.sha256(blob).hexdigest() == sha256:
                        with Image.open(io.BytesIO(blob)) as image:
                            dims = image.size
                except (OSError, KeyError, ValueError, zipfile.BadZipFile):
                    pass
                dimensions.append(dims)
    except (OSError, zipfile.BadZipFile):
        return tuple(None for _ in media)
    return tuple(dimensions)


def question_images(conn, question_ids: list[int]) -> dict[int, list[dict]]:
    """一次查出当前卷的图片信息；源图缺失或损坏时尺寸为空，保留缺失提示。"""
    ids = list(dict.fromkeys(question_ids))
    if not ids:
        return {}
    slots = ",".join("?" for _ in ids)
    rows = conn.execute(
        "SELECT i.id, i.question_id, i.media_path, i.sha256, s.path"
        " FROM images i JOIN source_files s ON s.id = i.source_id"
        f" WHERE i.question_id IN ({slots}) ORDER BY i.id", ids).fetchall()
    out: dict[int, list[dict]] = {}
    groups = defaultdict(list)
    for row in rows:
        groups[row["path"]].append(row)
    for source_path, group in groups.items():
        dimensions = tuple(None for _ in group)
        try:
            source = Path(source_path)
            stat = source.stat()
            dimensions = _dimensions(str(source), stat.st_mtime_ns, stat.st_size,
                tuple((r["media_path"] or "", r["sha256"] or "") for r in group))
        except (OSError, TypeError, ValueError):
            pass
        for row, dims in zip(group, dimensions):
            image = {k: row[k] for k in ("id", "media_path", "sha256")}
            image.update(width=dims[0] if dims else None, height=dims[1] if dims else None)
            out.setdefault(row["question_id"], []).append(image)
    return out


def enrich_export_images(conn, payload: dict) -> dict:
    """只补显示信息，不以当前题库图片替换已锁定的快照图片。"""
    questions = [q for s in payload["sections"] for q in s["questions"]]
    index = question_images(conn, [q["question_id"] for q in questions if q.get("images")])
    for q in questions:
        for image in q.get("images", []):
            # 同名媒体可能已经改过：只有内容指纹一致才使用现有媒体直链。
            match = next((im for im in index.get(q["question_id"], [])
                          if image.get("sha256") and im["sha256"] == image["sha256"]), None)
            image.update(id=match["id"] if match else None,
                         width=match["width"] if match else None,
                         height=match["height"] if match else None,
                         url=f'/api/questions/{q["question_id"]}/media/{match["id"]}' if match else None)
            for block in q.get('content_blocks') or []:
                if block.get('kind')=='image' and block.get('instance_id')==image.get('instance_id'):
                    block.update({key:image[key] for key in ('id','url','width','height')})
    return payload


def render_review_preview(source: str | None, preview: str | None, cache_dir: Path) -> Path:
    """把源公式预览转为浏览器可读 PNG；文件名为完整内容指纹，避免跨卷串图。"""
    if not source or not preview:
        raise ValueError("该公式没有源预览图")
    try:
        with zipfile.ZipFile(source) as doc:
            blob = doc.read(_member(preview))
        digest = hashlib.sha256(blob).hexdigest()
        out = cache_dir / f"{digest}-144.png"
        if not out.exists():
            with Image.open(io.BytesIO(blob)) as image:
                # Windows Pillow 通过系统 GDI 解码 WMF/EMF，无需 Office 或导出桥接。
                if image.format == "WMF":
                    image.load(dpi=144)
                else:
                    image.load()
                converted = image.convert("RGBA")
                cache_dir.mkdir(parents=True, exist_ok=True)
                buffer = io.BytesIO()
                converted.save(buffer, format="PNG")
                out.write_bytes(buffer.getvalue())
        return out
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
        raise ValueError(f"源预览图无法读取或转换：{exc}") from exc
