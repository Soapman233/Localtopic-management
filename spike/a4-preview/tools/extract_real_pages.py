"""从真实导出的 A4 PDF 中提取「每页从第几题开始」与「正文行距」，用于与探针断页位置比对。

用法：
    python tools/extract_real_pages.py <pdf路径> [<pdf路径> ...]
输出：JSON（每份 PDF 的页数、每页起始题号、正文行距估计）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium

# 题号前缀：行首的「N．（」或「N．」
QNUM_RE = re.compile(r'(?:^|\s)(\d{1,2})．')


def page_question_starts(text: str) -> list[int]:
    """返回本页「新起」的题号（按出现顺序）。"""
    return [int(m.group(1)) for m in QNUM_RE.finditer(text)]


def line_pitch(page) -> float | None:
    """估计正文行距：取相邻文本行 top 坐标的众数间距（pt）。"""
    tp = page.get_textpage()
    ys: list[float] = []
    for i in range(tp.count_chars()):
        try:
            box = tp.get_charbox(i)  # (l, b, r, t)
        except Exception:  # noqa: BLE001
            continue
        ys.append(round(box[3], 1))
    ys = sorted(set(ys), reverse=True)
    diffs = [round(ys[i] - ys[i + 1], 1) for i in range(len(ys) - 1)]
    # 只保留 10–30pt 的间距（正文行距量级），取众数
    cand = [d for d in diffs if 10 <= d <= 30]
    if not cand:
        return None
    from collections import Counter
    return Counter(cand).most_common(1)[0][0]


def main() -> int:
    out = {}
    for arg in sys.argv[1:]:
        p = Path(arg)
        pdf = pdfium.PdfDocument(str(p))
        pages = []
        for i in range(len(pdf)):
            text = ' '.join(pdf[i].get_textpage().get_text_range().split())
            pages.append({
                'page': i + 1,
                'q_starts': page_question_starts(text),
                'chars': len(text),
                'head': text[:60],
            })
        out[p.name] = {
            'page_count': len(pdf),
            'size_pt': list(pdf[0].get_size()),
            'line_pitch_pt': line_pitch(pdf[0]),
            'pages': pages,
        }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
