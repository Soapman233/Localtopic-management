"""整库备份 / 恢复。

为什么需要
----------
「便携个人客户端」的数据就在程序目录下的 ``outputs/bank.db`` 里——
**换电脑、重装、U 盘损坏都会丢**。所以「一键导出整库 / 恢复整库」是刚需。

设计要点
--------
* **备份用 SQLite 在线备份 API**（``Connection.backup``），而不是直接复制文件：
  即使有并发写，也能得到**一致快照**（直接 copy 可能拿到写到一半的库）。
* **恢复前必须先备份现有库**——恢复是破坏性操作，必须留回滚点。
* 恢复前用 :func:`bank.enrich.verify_backup` 校验候选文件，**不合格一律拒绝**。
* 所有函数**不抛异常**（返回 dict），便于 CLI / API 统一处理。
"""
# ---------------------------------------------------------------------------
# title: 整库备份与恢复
# description: 用 SQLite 在线备份 API 做一致快照；恢复前强制备份现有库并用 verify_backup 校验候选。
# author: 待补充
# version: 0.1.0
# category: 阶段4-导出
# ---------------------------------------------------------------------------

from __future__ import annotations

import shutil
from contextlib import closing
import sqlite3
import time
from pathlib import Path

__all__ = ["create_backup", "restore_backup", "verify_candidate", "default_backup_dir",
           "BACKUP_VERSION"]

BACKUP_VERSION = "0.1.0"

#: 恢复前自动保存的「恢复前快照」前缀。
PRE_RESTORE_PREFIX = "pre-restore-"


def default_backup_dir(db_path: str | Path) -> Path:
    """默认备份目录：与库同级的 ``backups/``（随程序目录走，保持便携）。"""
    return Path(db_path).resolve().parent / "backups"


def _now_stamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def create_backup(db_path: str | Path, dst: str | Path | None = None) -> dict:
    """把 ``db_path`` 备份到 ``dst``（省略时自动命名到 ``backups/``）。

    返回 ``{ok, path, bytes, seconds, verify}``；失败返回 ``{ok: False, error}``。
    """
    src = Path(db_path).resolve()
    if not src.is_file():
        return {"ok": False, "error": f"库不存在：{src}"}

    out = Path(dst).resolve() if dst else (default_backup_dir(src) / f"bank-{_now_stamp()}.db")
    out.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    try:
        # 在线备份：即使有并发写也能得到一致快照。
        # ⚠️ 注意：``with sqlite3.connect(...)`` **不会关闭连接**（只提交/回滚事务），
        # 必须用 ``contextlib.closing`` 显式关闭——否则句柄泄漏，
        # 在 Windows 上会让备份文件无法删除/覆盖（实测踩过）。
        with closing(sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)) as s, \
                closing(sqlite3.connect(str(out))) as d:
            s.backup(d)
    except Exception as exc:  # noqa: BLE001
        try:
            out.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "error": f"备份失败：{type(exc).__name__}: {exc}"}

    from . import enrich
    verify = enrich.verify_backup(src, out)
    return {
        "ok": bool(verify.get("ok")),
        "path": str(out),
        "bytes": out.stat().st_size,
        "seconds": round(time.perf_counter() - t0, 2),
        "verify": verify,
    }


def verify_candidate(db_path: str | Path, candidate: str | Path) -> dict:
    """校验候选恢复文件是否可用（是否原库的合格回滚点）。

    复用 :func:`bank.enrich.verify_backup` 的三重判定：
    ``structure_ok + integrity_ok + core_nonempty``。
    """
    cur = Path(db_path).resolve()
    cand = Path(candidate).resolve()
    if not cand.is_file():
        return {"ok": False, "error": f"候选文件不存在：{cand}"}
    from . import enrich
    res = enrich.verify_backup(cur, cand)
    res["candidate"] = str(cand)
    return res


def restore_backup(db_path: str | Path, candidate: str | Path,
                   *, force: bool = False) -> dict:
    """用 ``candidate`` 恢复 ``db_path``。

    **破坏性操作**，因此：

    1. 先校验候选（不合格直接拒绝，除非 ``force=True``）；
    2. **先把现有库备份**到 ``backups/pre-restore-<时间戳>.db``——
       恢复出错可回滚；
    3. 用 ``shutil.copyfile`` 覆盖（不用在线备份 API：恢复是单向替换）。

    返回 ``{ok, restored_from, pre_restore_backup, verify, ...}``。
    """
    cur = Path(db_path).resolve()
    cand = Path(candidate).resolve()
    if not cand.is_file():
        return {"ok": False, "error": f"候选文件不存在：{cand}"}

    check = verify_candidate(cur, cand) if cur.is_file() else {"ok": True, "note": "当前无库，跳过校验"}
    if not check.get("ok") and not force:
        return {"ok": False, "error": "候选文件未通过校验，已拒绝恢复（可用 force 强制）",
                "verify": check}

    # ---- 恢复前先备份现有库（回滚点）----
    pre: dict = {"ok": False, "note": "当前无库，无需备份"}
    if cur.is_file():
        pre = create_backup(cur, default_backup_dir(cur) / f"{PRE_RESTORE_PREFIX}{_now_stamp()}.db")
        if not pre.get("ok"):
            return {"ok": False, "error": f"恢复前备份失败，已中止：{pre.get('error')}",
                    "pre_restore_backup": pre}

    try:
        shutil.copyfile(cand, cur)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"写入失败：{type(exc).__name__}: {exc}",
                "pre_restore_backup": pre}

    after = verify_candidate(cur, cur)
    return {
        "ok": True,
        "restored_from": str(cand),
        "pre_restore_backup": pre.get("path") if pre.get("ok") else None,
        "verify": check,
        "post_verify": after,
        "bytes": cur.stat().st_size,
    }
