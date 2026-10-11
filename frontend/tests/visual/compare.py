"""
视觉回归比对（1366×768）。

用法：
    python tests/visual/compare.py <baselineDir> <newDir> [--out <heatmapDir>]

判定口径：
  * mean_diff  平均像素差（0–255）；< 1.0 视为「无可见变化」
  * pct_gt32   差异 > 32 的像素占比；< 0.5% 视为「无结构性变化」
  * 自校验     同一张图自比必须恒为 0（用于确认度量本身没写错）

退出码：0 = 无超阈值差异；1 = 存在超阈值页面（需人工看图判定）。

依赖：PIL + numpy（项目 Python 环境已具备）。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

MEAN_THRESHOLD = 1.0
PCT_THRESHOLD = 0.005


def load(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("L"), dtype=np.float32)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    base, new = Path(argv[1]), Path(argv[2])
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else new.parent / "visual-diff"

    names = sorted(p.stem for p in base.glob("*.png"))
    if not names:
        print(f"基线为空：{base}")
        return 2
    out.mkdir(parents=True, exist_ok=True)

    print(f"{'页面':<24}{'尺寸':<8}{'mean':>8}{'>32占比':>10}   判定")
    print("-" * 68)
    flagged: list[str] = []
    for name in names:
        b, n = base / f"{name}.png", new / f"{name}.png"
        if not n.exists():
            print(f"{name:<24}{'缺新图':<8}")
            flagged.append(name)
            continue
        a1, a2 = load(b), load(n)
        if a1.shape != a2.shape:
            print(f"{name:<24}{'不同':<8}{'-':>8}{'-':>10}   结构性变化（尺寸不同）")
            flagged.append(name)
            continue
        d = np.abs(a1 - a2)
        mean, pct = float(d.mean()), float((d > 32).mean())
        ok = mean < MEAN_THRESHOLD and pct < PCT_THRESHOLD
        verdict = "无可见变化" if ok else ("轻微差异" if mean < 3.0 else "**需人工判定**")
        if not ok:
            flagged.append(name)
        print(f"{name:<24}{'一致':<8}{mean:>8.2f}{pct:>9.2%}   {verdict}")
        Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).save(out / f"{name}-diff.png")

    first = names[0]
    self_diff = float(np.abs(load(base / f"{first}.png") - load(base / f"{first}.png")).mean())
    print("-" * 68)
    print(f"度量自校验（自比应为 0）：{self_diff:.4f}")
    print(f"差异热力图 → {out}")
    if flagged:
        print(f"⚠️ 需人工看图判定：{flagged}")
        print("   若确认为**预期变化**，才可用 capture.mjs 覆盖基线并更新 baseline-manifest.json。")
        return 1
    print("✅ 全部页面在阈值内")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
