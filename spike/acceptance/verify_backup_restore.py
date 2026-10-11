# -*- coding: utf-8 -*-
"""验收：整库备份 / 恢复（Phase 3.5）。

⚠️ 全程在 ``bank.db`` 的**副本**上操作，绝不碰交付库。

验证：
  1. 备份产物是**合格回滚点**（verify_backup 三重判定 ok）
  2. 备份内容与源库**逐表行数一致**
  3. 恢复：先用备份恢复 → 库回到备份时的状态
  4. 恢复前**自动留下 pre-restore 快照**
  5. 用**不合格文件**（空文件 / 非库）恢复 → **必须被拒绝**
  6. 交付库 sha256 前后不变
"""
from __future__ import annotations

import hashlib
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SRC_DB = Path("D:/Open-source project/Localtopic-management/outputs/bank.db")
WORK = ROOT / "spike" / "acceptance" / "_backup_test"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rowcounts(db: Path) -> dict[str, int]:
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        tabs = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t: con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tabs}
    finally:
        con.close()


def main() -> int:
    if not SRC_DB.is_file():
        print(f"[SKIP] 交付库不存在：{SRC_DB}")
        return 0

    from bank import backup as bk

    WORK.mkdir(parents=True, exist_ok=True)
    src_hash = sha256(SRC_DB)
    db = WORK / "bank.db"
    shutil.copyfile(SRC_DB, db)
    print(f"工作副本: {db.name}  ({db.stat().st_size:,} 字节)")
    print(f"交付库 sha256（前）: {src_hash[:16]}…\n")

    results: dict[str, bool] = {}

    # ---------- 1) 备份 ----------
    print("[步骤1] 创建备份")
    rep = bk.create_backup(db)
    print(f"   ok={rep.get('ok')} 路径={Path(rep.get('path', '')).name} "
          f"{rep.get('bytes', 0):,} 字节 {rep.get('seconds')}s")
    v = rep.get("verify") or {}
    print(f"   校验: structure_ok={v.get('structure_ok')} integrity_ok={v.get('integrity_ok')} "
          f"core_nonempty={v.get('core_nonempty')}")
    results["备份成功且校验合格"] = bool(rep.get("ok"))
    results["三重校验全通过"] = bool(v.get("structure_ok") and v.get("integrity_ok")
                                    and v.get("core_nonempty"))
    bak = Path(rep["path"]) if rep.get("ok") else None

    # ---------- 2) 备份内容一致性 ----------
    if bak:
        print("\n[步骤2] 备份内容与源库逐表行数比对")
        a, b = rowcounts(db), rowcounts(bak)
        diff = {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)}
        print(f"   表数 源={len(a)} 备份={len(b)}；行数不一致的表: {diff or '无'}")
        results["备份行数一致"] = not diff

    # ---------- 3) 不合格文件必须被拒绝 ----------
    print("\n[步骤3] 用不合格文件恢复（必须拒绝）")
    bad = WORK / "bad.db"
    bad.write_bytes(b"not a sqlite database")
    r = bk.restore_backup(db, bad)
    print(f"   非库文件 -> ok={r.get('ok')} error={str(r.get('error'))[:60]}")
    results["拒绝非库文件"] = (r.get("ok") is False)

    empty = WORK / "empty.db"
    empty.write_bytes(b"")
    r2 = bk.restore_backup(db, empty)
    print(f"   空文件   -> ok={r2.get('ok')} error={str(r2.get('error'))[:60]}")
    results["拒绝空文件"] = (r2.get("ok") is False)

    # ---------- 4) 正常恢复 + 自动留快照 ----------
    if bak:
        print("\n[步骤4] 正常恢复")
        before = rowcounts(db)
        r3 = bk.restore_backup(db, bak)
        print(f"   ok={r3.get('ok')}")
        print(f"   恢复前快照: {Path(r3['pre_restore_backup']).name if r3.get('pre_restore_backup') else '无'}")
        after = rowcounts(db)
        print(f"   恢复后与备份一致: {before == after}")
        results["恢复成功"] = bool(r3.get("ok"))
        results["自动留恢复前快照"] = bool(r3.get("pre_restore_backup"))
        results["恢复后数据一致"] = (before == after)
        # 恢复后库仍可用
        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        try:
            n = con.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        finally:
            con.close()
        print(f"   恢复后题目数: {n}")
        results["恢复后库可用"] = n > 0

    # ---------- 5) 交付库未污染 ----------
    print("\n[步骤5] 交付库是否被污染")
    print(f"   交付库 sha256（后）: {sha256(SRC_DB)[:16]}…")
    results["交付库未被污染"] = (sha256(SRC_DB) == src_hash)

    print("\n=== 验收结论 ===")
    for k, v_ in results.items():
        print(f"   {'PASS' if v_ else 'FAIL'}  {k}")
    ok = all(results.values())
    print(f"\n{'✅ 通过：整库备份/恢复可用' if ok else '❌ 未通过'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
