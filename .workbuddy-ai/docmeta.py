"""为交付文档生成元数据块，供生成脚本**自行产出**（重新生成不再丢元数据）。

问题
----
早期三个生成脚本（``build_report.py`` / ``build_verification_report.py`` /
``render_diagnostics.py``）产出文档时**不产出元数据块**，元数据是事后用
``embed_metadata.py`` 补的。谁重新生成一次，元数据就被静默抹掉。

本模块让生成脚本**自己**在产出时写好元数据块，取值与 ``asset_manifest.json`` 一致：

* Markdown：文件**最前面**写 YAML front-matter；
* HTML：``<!DOCTYPE html>`` 之后写 ``<!-- metadata ... -->`` 注释块。

字段
----
``title / description / keywords / author / created / modified / version / category``，
与 :data:`build_asset_manifest.ASSETS` 中对应条目一致。

* ``author`` 统一 ``待补充``，``version`` 统一 ``0.1.0``；
* ``created``：目标文件已存在则**沿用其当前元数据块里的 created**（保持稳定），
  否则用当前时间；
* ``modified``：本次生成时刻。

输出格式与 ``embed_metadata.py`` 完全一致，因此 ``embed_metadata`` 会把已含元数据块的
文件判为「已嵌入」并跳过——生成与嵌入两套机制不再互相打架。
"""
# ---------------------------------------------------------------------------
# title: 文档元数据块生成
# description: 生成脚本自用的元数据块（MD front-matter / HTML 注释），created 沿用已有值。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from pathlib import Path

# 允许脚本以 ``python .workbuddy-ai/xxx.py`` 直接运行时导入同目录模块。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_asset_manifest import ASSETS  # noqa: E402

#: 路径 -> 资产定义（title/description/keywords/category）。
ASSET_BY_PATH: dict[str, dict] = {a["path"]: a for a in ASSETS}

AUTHOR_DEFAULT = "待补充"
VERSION_DEFAULT = "0.1.0"

#: 从已有 Markdown front-matter 中提取 created（双引号标量）。
_MD_CREATED_RE = re.compile(r'^created:\s*"([^"]*)"', re.MULTILINE)
#: 从已有 HTML 注释块中提取 created（无引号）。
_HTML_CREATED_RE = re.compile(r'^created:\s*(\S+)\s*$', re.MULTILINE)
#: 提取 modified（两种形态）。
_MD_MODIFIED_RE = re.compile(r'^modified:\s*"([^"]*)"', re.MULTILINE)
_HTML_MODIFIED_RE = re.compile(r'^modified:\s*(\S+)\s*$', re.MULTILINE)


def now_iso() -> str:
    """当前本地时间（ISO 8601，带时区）。"""
    return datetime.now().astimezone().isoformat()


def existing_created(text: str | None) -> str | None:
    """从已有文档文本里提取元数据块的 ``created``；没有则返回 None。"""
    if not text:
        return None
    m = _MD_CREATED_RE.search(text)
    if m:
        return m.group(1)
    m = _HTML_CREATED_RE.search(text)
    if m:
        return m.group(1)
    return None


def _yaml_str(value: str) -> str:
    """把字符串安全地写成 YAML 双引号标量（与 embed_metadata 一致）。"""
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _yaml_list(items: list[str]) -> str:
    return "[" + ", ".join(_yaml_str(i) for i in items) + "]"


def _asset_fields(rel_path: str, existing_text: str | None, now: str | None) -> dict:
    """组装元数据字段（created 优先沿用已有值）。"""
    asset = ASSET_BY_PATH.get(rel_path)
    if asset is None:
        raise KeyError(f"asset_manifest 中未登记该路径：{rel_path}")
    stamp = now or now_iso()
    return {
        "title": asset["title"],
        "description": asset["description"],
        "keywords": list(asset["keywords"]),
        "author": AUTHOR_DEFAULT,
        "created": existing_created(existing_text) or stamp,
        "modified": stamp,
        "version": VERSION_DEFAULT,
        "category": list(asset["category"]),
    }


def build_md_front_matter(rel_path: str, existing_text: str | None = None,
                          now: str | None = None) -> str:
    """构造 Markdown 的 YAML front-matter 块（含结尾空行），格式与 embed_metadata 一致。"""
    f = _asset_fields(rel_path, existing_text, now)
    lines = [
        "---",
        f"title: {_yaml_str(f['title'])}",
        f"description: {_yaml_str(f['description'])}",
        f"keywords: {_yaml_list(f['keywords'])}",
        f"author: {_yaml_str(f['author'])}",
        f"created: {_yaml_str(f['created'])}",
        f"modified: {_yaml_str(f['modified'])}",
        f"version: {_yaml_str(f['version'])}",
        f"category: {_yaml_list(f['category'])}",
        "---",
        "",
        "",
    ]
    return "\n".join(lines)


def build_html_comment(rel_path: str, existing_text: str | None = None,
                       now: str | None = None) -> str:
    """构造 HTML 的 ``<!-- metadata ... -->`` 注释块，格式与 embed_metadata 一致。"""
    f = _asset_fields(rel_path, existing_text, now)
    lines = [
        "<!-- metadata",
        f"title: {f['title']}",
        f"description: {f['description']}",
        f"keywords: {'、'.join(f['keywords'])}",
        f"author: {f['author']}",
        f"created: {f['created']}",
        f"modified: {f['modified']}",
        f"version: {f['version']}",
        f"category: {'、'.join(f['category'])}",
        "-->",
    ]
    return "\n".join(lines)


def read_existing(path: str | Path) -> str | None:
    """读取已存在的目标文件文本（用于沿用 created）；不存在返回 None。"""
    p = Path(path)
    return p.read_text(encoding="utf-8") if p.is_file() else None


def prepend_md(rel_path: str, body: str, target: str | Path) -> str:
    """给 Markdown 正文前置 front-matter（若正文已含则原样返回，保证幂等）。"""
    if body.lstrip().startswith("---") and "title:" in body[:600]:
        return body
    return build_md_front_matter(rel_path, read_existing(target)) + body


def insert_html(rel_path: str, body: str, target: str | Path) -> str:
    """在 HTML ``<!DOCTYPE html>`` 之后插入元数据注释（若已含则原样返回）。"""
    if "<!-- metadata" in body[:600]:
        return body
    doctype = "<!DOCTYPE html>"
    idx = body.find(doctype)
    if idx < 0:
        raise ValueError(f"HTML 中未找到 {doctype!r}：{target}")
    pos = idx + len(doctype)
    block = build_html_comment(rel_path, read_existing(target))
    return body[:pos] + "\n" + block + body[pos:]


def sync_mtime(target: str | Path) -> bool:
    """把目标文件 mtime 设为元数据块里的 ``modified``，使清单与内嵌元数据完全一致。

    只读取文件**开头**的元数据块（前 800 字符），避免误命中正文里的同名字样。
    成功返回 True；未找到 modified 字段返回 False。
    """
    p = Path(target)
    head = p.read_text(encoding="utf-8")[:800]
    m = _MD_MODIFIED_RE.search(head) or _HTML_MODIFIED_RE.search(head)
    if not m:
        return False
    ts = datetime.fromisoformat(m.group(1)).timestamp()
    os.utime(p, (ts, ts))
    return True


__all__ = [
    "ASSET_BY_PATH", "AUTHOR_DEFAULT", "VERSION_DEFAULT",
    "now_iso", "existing_created", "build_md_front_matter", "build_html_comment",
    "read_existing", "prepend_md", "insert_html", "sync_mtime",
]
