"""把证据截图底部/右侧的空白背景裁掉（探针工具）。

用法：python crop_png.py <dir>
需要 Pillow（本项目 kb 环境自带）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def crop_uniform(path: Path, bg_tol: int = 6) -> None:
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    bg = px[w - 1, h - 1]  # 取右下角作为背景色

    def is_bg(c) -> bool:
        return abs(c[0] - bg[0]) <= bg_tol and abs(c[1] - bg[1]) <= bg_tol and abs(c[2] - bg[2]) <= bg_tol

    # 从底部找第一行「非背景」
    bottom = h
    for y in range(h - 1, -1, -1):
        row_has_content = any(not is_bg(px[x, y]) for x in range(0, w, 3))
        if row_has_content:
            bottom = min(h, y + 12)
            break
    # 从右侧找第一列「非背景」
    right = w
    for x in range(w - 1, -1, -1):
        col_has_content = any(not is_bg(px[x, y]) for y in range(0, bottom, 3))
        if col_has_content:
            right = min(w, x + 12)
            break

    if bottom < h or right < w:
        im.crop((0, 0, right, bottom)).save(path)
        print(f"[crop] {path.name} {w}x{h} -> {right}x{bottom}")
    else:
        print(f"[crop] {path.name} 无需裁剪")


def main() -> int:
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    for p in sorted(d.glob('*.png')):
        try:
            crop_uniform(p)
        except Exception as exc:  # noqa: BLE001
            print(f"[crop] {p.name} 失败：{exc}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
