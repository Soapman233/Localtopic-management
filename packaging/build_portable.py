# -*- coding: utf-8 -*-
"""一键构建便携客户端（Windows）。

做三件事：
  1. 构建前端（``npm run build`` → ``webui/static/``）
  2. PyInstaller 打包（``packaging/portable.spec`` → ``dist/题库/``）
  3. 实测产物体积与启动

用法::

    python packaging/build_portable.py            # 全流程
    python packaging/build_portable.py --skip-frontend
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "题库"
#: 体积目标（MB）——超过则给出警告（便携定位要求轻量）
SIZE_TARGET_MB = 200


def _run(cmd: list[str], cwd: Path, *, shell: bool = False) -> int:
    print(f"\n$ {' '.join(cmd)}   (cwd={cwd})")
    t0 = time.perf_counter()
    rc = subprocess.call(cmd, cwd=str(cwd), shell=shell)
    print(f"  -> exit={rc}  {time.perf_counter() - t0:.1f}s")
    return rc


def build_frontend() -> int:
    fe = ROOT / "frontend"
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if npm is None:
        print("[ERROR] 未找到 npm，无法构建前端")
        return 1
    return _run([npm, "run", "build"], fe, shell=(os.name == "nt"))


def build_bundle() -> int:
    py = sys.executable
    return _run([py, "-m", "PyInstaller", "packaging/portable.spec",
                 "--noconfirm", "--clean", "--log-level", "WARN"], ROOT)


def measure() -> dict:
    """统计产物体积与文件数。"""
    if not DIST.is_dir():
        return {"exists": False}
    total = 0
    n = 0
    for p in DIST.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
            n += 1
    exe = DIST / "题库.exe"
    return {
        "exists": True,
        "path": str(DIST),
        "bytes": total,
        "mb": round(total / 1048576, 1),
        "files": n,
        "exe": str(exe) if exe.is_file() else None,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-frontend", action="store_true", help="跳过前端构建")
    ap.add_argument("--skip-bundle", action="store_true", help="只测体积，不重新打包")
    args = ap.parse_args(argv)

    if not args.skip_frontend:
        if build_frontend() != 0:
            print("[ERROR] 前端构建失败")
            return 1
    if not args.skip_bundle:
        if build_bundle() != 0:
            print("[ERROR] PyInstaller 打包失败")
            return 1

    m = measure()
    print("\n=== 产物体积 ===")
    if not m.get("exists"):
        print("  未找到 dist/题库/")
        return 1
    print(f"  路径   : {m['path']}")
    print(f"  体积   : {m['mb']} MB（{m['bytes']:,} 字节，{m['files']} 个文件）")
    print(f"  可执行 : {m['exe']}")
    print(f"  目标   : ≤ {SIZE_TARGET_MB} MB -> "
          f"{'✅ 达标' if m['mb'] <= SIZE_TARGET_MB else '⚠️ 超出'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
