"""探针数据导出工具：从只读连接导出演示卷 #1 的 export-data，并抽取图片。

用途（探针专用，不接入生产）：
  1. 复用生产代码 ``bank.paper.build_export_payload`` 生成与
     ``GET /api/papers/1/export-data`` **完全一致** 的 JSON（含题干 ⟦Fn⟧ 占位符、
     公式 latex、图片引用、分值、答案/解析）。
  2. 把题目引用的图片二进制抽取到 ``spike/a4-preview/public/media/``，
     供原型在**不启动后端**时也能显示图片（离线可复现）。

硬性约束：**只读**打开 ``outputs/bank.db``，绝不写入。
"""

from __future__ import annotations

import json
import mimetypes
import sqlite3
import sys
from pathlib import Path

# 让脚本能 import 到仓库根目录的 bank 包
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from bank import paper as paper_mod  # noqa: E402

DB_PATH = REPO_ROOT / "outputs" / "bank.db"
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "data"
MEDIA_DIR = Path(__file__).resolve().parents[1] / "public" / "media"
PAPER_ID = 1


def _open_readonly() -> sqlite3.Connection:
    """只读打开 bank.db（URI mode=ro，杜绝任何写入）。"""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _png_size(data: bytes) -> tuple[int, int] | None:
    """读取 PNG 宽高（IHDR）。"""
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        import struct
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    return None


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    """读取 JPEG 宽高（扫描 SOF 段）。"""
    import struct
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return int(w), int(h)
        seglen = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seglen
    return None


def _gif_size(data: bytes) -> tuple[int, int] | None:
    """读取 GIF 宽高（逻辑屏幕描述符）。"""
    import struct
    if len(data) >= 10 and data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return int(w), int(h)
    return None


def _natural_size(data: bytes) -> tuple[int, int] | None:
    """按魔数推断图片原始像素宽高（PNG/JPEG/GIF），失败返回 None。"""
    return _png_size(data) or _jpeg_size(data) or _gif_size(data)


def _dump_media(conn: sqlite3.Connection, payload: dict) -> dict[str, dict]:
    """把 payload 中出现的题目图片复制到 public/media/。

    返回 ``{"{question_id}:{media_path}": {"url","w","h"}}`` 映射，供原型改写图片引用
    并**预置显示尺寸**（消解「图片异步加载导致分页错乱」）。
    """
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    url_map: dict[str, dict] = {}
    # 复用生产代码的取图逻辑（按 sha256 从源 DOCX 包内取）
    try:
        from webui.services.questions import get_media  # type: ignore
    except Exception:
        get_media = None  # type: ignore

    for section in payload.get("sections", []):
        for q in section.get("questions", []):
            qid = q.get("question_id")
            for im in q.get("images") or []:
                # 注意：export payload 的 image 引用只有 media_path/sha256，没有 id，
                # 需要回查 images 表拿到主键。
                img_id = im.get("id")
                if img_id is None:
                    row = conn.execute(
                        "SELECT id FROM images WHERE question_id = ?"
                        " AND (media_path = ? OR sha256 = ?) LIMIT 1",
                        (qid, im.get("media_path"), im.get("sha256"))).fetchone()
                    img_id = row["id"] if row else None
                if img_id is None:
                    print(f"  [warn] 找不到图片记录 q={qid} path={im.get('media_path')}")
                    continue
                if get_media is None:
                    continue
                try:
                    src = Path(get_media(conn, qid, img_id))
                except Exception as exc:  # 图片缺失不阻塞
                    print(f"  [warn] 取图失败 q={qid} img={img_id}: {exc}")
                    continue
                if not src.is_file():
                    print(f"  [warn] 图片文件不存在 q={qid} img={img_id}: {src}")
                    continue
                ext = src.suffix or (mimetypes.guess_extension(
                    mimetypes.guess_type(str(src))[0] or "") or ".bin")
                name = f"q{qid}_img{img_id}{ext}"
                dst = MEDIA_DIR / name
                raw = src.read_bytes()
                dst.write_bytes(raw)
                size = _natural_size(raw)
                info = {"url": f"media/{name}", "w": None, "h": None}
                if size is not None:
                    info["w"], info["h"] = size
                url_map[f"{qid}:{im.get('media_path')}"] = info
    return url_map


def main() -> int:
    if not DB_PATH.is_file():
        print(f"[error] 找不到数据库：{DB_PATH}")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = _open_readonly()
    try:
        payload = paper_mod.build_export_payload(conn, PAPER_ID)
        url_map = _dump_media(conn, payload)
    finally:
        conn.close()

    # 把图片引用改写成离线可用的相对 url，并写入原始像素宽高（供前端预置显示尺寸）
    def _rewrite(payload: dict) -> None:
        for section in payload.get("sections", []):
            for q in section.get("questions", []):
                qid = q.get("question_id")
                for im in q.get("images") or []:
                    info = url_map.get(f"{qid}:{im.get('media_path')}")
                    if not info:
                        continue
                    im["offline_url"] = info["url"]
                    if info.get("w"):
                        im["natural_w"] = info["w"]
                        im["natural_h"] = info["h"]

    _rewrite(payload)

    # 学生版 + 答案解析版都导出，供原型切换答案模式
    conn = _open_readonly()
    try:
        payload_answer = paper_mod.build_export_payload(conn, PAPER_ID,
                                                        answer_mode="答案解析版")
    finally:
        conn.close()
    _rewrite(payload_answer)

    out = {"student": payload, "answer": payload_answer}
    out_path = OUT_DIR / "export_data.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    n_q = sum(s["item_count"] for s in payload["sections"])
    n_img = len(url_map)
    print(f"[ok] 试卷：{payload['paper']['title']}（id={PAPER_ID}）")
    print(f"[ok] 大题 {len(payload['sections'])} 个，题目 {n_q} 道")
    print(f"[ok] 抽取图片 {n_img} 张 -> {MEDIA_DIR}")
    print(f"[ok] 导出 JSON -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
