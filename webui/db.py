"""连接工厂：读连接 / 写连接 + 应用级写锁。

设计（架构设计 §1.1 难点 6 / §8.8 单写者约定）
----------------------------------------------
* SQLite 保持 ``journal_mode=delete``（**不启用 WAL**，保住「只读导出不改 bank.db」保证）；
* 用 **应用级单写者锁**（:data:`WRITE_LOCK`）+ ``busy_timeout=5000`` 规避 ``SQLITE_BUSY``；
* **每请求一个连接**（SQLite 连接不跨线程共享；``check_same_thread=False`` 仅为放宽
  线程校验，实际仍按请求创建/关闭）；
* 写路径统一走 :func:`write_txn` 上下文管理器：加锁 → 单连接 → 单事务提交/回滚 → 关连接。
"""
# ---------------------------------------------------------------------------
# title: webui 连接工厂
# description: 读/写连接工厂（busy_timeout=5000）与应用级写锁；write_txn 单事务上下文。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from . import config

#: 应用级写锁（单机形态：串行化所有写操作，规避 SQLITE_BUSY）。
WRITE_LOCK = threading.RLock()


def connect_read(db_path: str | Path | None = None) -> sqlite3.Connection:
    """打开一个**读连接**（外键 ON、``busy_timeout=5000``）。

    不建表、不迁移；调用方负责 ``close()``。
    """
    path = Path(db_path) if db_path is not None else config.get_db_path()
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def connect_write(db_path: str | Path | None = None) -> sqlite3.Connection:
    """打开一个**写连接**（配置同读连接）。

    **注意**：本函数只创建连接，不获取 :data:`WRITE_LOCK`。若需串行化写入，
    请使用 :func:`write_txn`。
    """
    return connect_read(db_path)


@contextmanager
def write_txn(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    """写事务上下文：**加全局写锁 → 建写连接 → 提交/回滚 → 关连接**。

    用法::

        with write_txn() as conn:
            bank.edit.save_question(conn, 1, {"text": "..."})

    块内异常时回滚；无论成败都释放锁并关闭连接。
    """
    with WRITE_LOCK:
        conn = connect_write(db_path)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


@contextmanager
def read_conn(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    """读连接上下文：建连接 → 用 → 关连接（不提交）。"""
    conn = connect_read(db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_conn() -> sqlite3.Connection:
    """FastAPI 依赖：返回一个读连接（调用方需负责关闭）。"""
    return connect_read()


def get_write_conn() -> sqlite3.Connection:
    """FastAPI 依赖：返回一个写连接（调用方需负责关闭；写操作请配合 :data:`WRITE_LOCK`）。"""
    return connect_write()


__all__ = [
    "WRITE_LOCK", "connect_read", "connect_write", "write_txn", "read_conn",
    "get_conn", "get_write_conn",
]
