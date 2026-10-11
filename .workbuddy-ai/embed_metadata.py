"""把元数据块嵌入交付物，并保证正文逐字不变。

嵌入位置
--------
* **Markdown**（``outputs/*.md``）：文件**最开头**插入 YAML front-matter；
* **HTML**（``physics_material_diagnostics.html``）：``<!DOCTYPE html>`` 之后插入
  ``<!-- metadata ... -->`` 注释（不影响渲染）；
* **Python**（阶段1/阶段2/测试/脚本）：模块 docstring **之后**插入文件头注释。

安全措施
--------
* 修改前把每个文件备份到 ``outputs/metadata/_backup/<相对路径>``；
* 修改后逐一校验：Markdown 正文逐字不变、HTML 原内容完整保留、Python ``compileall`` 通过；
* 还原文件的修改时间（mtime），使嵌入的 created/modified 与清单一致；
* 幂等：已含元数据标记的文件跳过。

可直接运行：``python .workbuddy-ai/embed_metadata.py``。
"""
# ---------------------------------------------------------------------------
# title: 元数据嵌入脚本
# description: 把元数据块嵌入交付物（MD front-matter / HTML 注释 / Python 文件头），并备份校验。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from __future__ import annotations

import ast
import json
import os
import py_compile
import re
import shutil
from datetime import datetime
from pathlib import Path

from build_asset_manifest import ASSETS, ROOT, OUT_DIR, make_id, _times

BACKUP_DIR = OUT_DIR / "_backup"
REPORT_PATH = OUT_DIR / "embed_report.json"

_MD_MARKER = "title:"
_HTML_MARKER = "<!-- metadata"
_PY_MARKER = "# title:"
# 行首锚定：避免把源码里形如 ``f"# title: ..."`` 的字符串误判为已嵌入。
_PY_MARKER_RE = re.compile(r"^# title: ", re.MULTILINE)


# --------------------------------------------------------------------------- #
# 元数据块构造
# --------------------------------------------------------------------------- #
def _yaml_str(value: str) -> str:
    """把字符串安全地写成 YAML 双引号标量。"""
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _yaml_list(items: list[str]) -> str:
    return "[" + ", ".join(_yaml_str(i) for i in items) + "]"


def build_md_block(asset: dict) -> str:
    """构造 Markdown 的 YAML front-matter（含结尾空行）。"""
    lines = [
        "---",
        f"title: {_yaml_str(asset['title'])}",
        f"description: {_yaml_str(asset['description'])}",
        f"keywords: {_yaml_list(asset['keywords'])}",
        f"author: {_yaml_str(asset['author'])}",
        f"created: {_yaml_str(asset['created'])}",
        f"modified: {_yaml_str(asset['modified'])}",
        f"version: {_yaml_str(asset['version'])}",
        f"category: {_yaml_list(asset['category'])}",
        "---",
        "",
        "",
    ]
    return "\n".join(lines)


def build_html_block(asset: dict) -> str:
    """构造 HTML 元数据注释块。"""
    lines = [
        "<!-- metadata",
        f"title: {asset['title']}",
        f"description: {asset['description']}",
        f"keywords: {'、'.join(asset['keywords'])}",
        f"author: {asset['author']}",
        f"created: {asset['created']}",
        f"modified: {asset['modified']}",
        f"version: {asset['version']}",
        f"category: {'、'.join(asset['category'])}",
        "-->",
    ]
    return "\n".join(lines)


def build_py_block(asset: dict) -> str:
    """构造 Python 文件头注释块（以换行结尾）。"""
    sep = "# " + "-" * 75
    lines = [
        sep,
        f"# title: {asset['title']}",
        f"# description: {asset['description']}",
        f"# author: {asset['author']}",
        f"# version: {asset['version']}",
        f"# category: {'、'.join(asset['category'])}",
        sep,
        "",
    ]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# 插入逻辑
# --------------------------------------------------------------------------- #
def insert_md(original: str, block: str) -> str:
    """在最开头插入 front-matter。"""
    return block + original


def insert_html(original: str, block: str) -> str:
    """在 ``<!DOCTYPE html>`` 之后插入注释块。

    注意：doctype **大小写不敏感**——Vite 构建产物写的是小写 ``<!doctype html>``，
    旧实现按大写字面量查找会直接抛错（曾导致 ``npm run build`` 后重嵌元数据失败）。
    """
    m = re.search(r"<!doctype html>", original, re.IGNORECASE)
    if not m:
        raise ValueError("未找到 <!DOCTYPE html>")
    pos = m.end()
    return original[:pos] + "\n" + block + original[pos:]


def _docstring_end_line(src: str) -> int:
    """返回模块 docstring 结束行号（1 基）；无 docstring 返回 0。"""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return 0
    if not tree.body:
        return 0
    first = tree.body[0]
    if isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant) \
            and isinstance(first.value.value, str):
        return int(first.end_lineno or 0)
    return 0


def insert_py(original: str, block: str) -> str:
    """在模块 docstring 之后插入文件头注释。"""
    lines = original.splitlines(keepends=True)
    after = _docstring_end_line(original)
    head = "".join(lines[:after])
    tail = "".join(lines[after:])
    # 若 docstring 后已有空行则保留，避免挤压
    return head + block + tail


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def _targets() -> tuple[list[dict], list[dict], list[dict]]:
    """按类型返回 ``(md_assets, html_assets, py_assets)``。

    **跳过 `webui/static/` 下的构建产物**：它们是 `npm run build` 每次生成的，
    往里嵌元数据既无意义（下次构建即被覆盖），又会因产物是压缩单行而污染 diff。
    """
    md, html, py = [], [], []
    for item in ASSETS:
        p = item["path"]
        if p.startswith("webui/static/"):
            continue
        if p.endswith(".md") and p.startswith("outputs/"):
            md.append(item)
        elif p.endswith(".html"):
            html.append(item)
        elif p.endswith(".py"):
            py.append(item)
    return md, html, py


def _backup(rel_path: str) -> Path:
    src = ROOT / rel_path
    dst = BACKUP_DIR / rel_path
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def _asset_dict(item: dict) -> dict:
    """把 ASSETS 条目补全成带 created/modified 的字典。"""
    abs_path = ROOT / item["path"]
    created, modified = _times(abs_path)
    return {
        "id": make_id(item["path"]), "path": item["path"], "title": item["title"],
        "description": item["description"], "keywords": list(item["keywords"]),
        "author": "待补充", "created": created, "modified": modified,
        "version": "0.1.0", "category": list(item["category"]),
        "size_bytes": abs_path.stat().st_size, "stage": item["stage"],
    }


def _process(item: dict, kind: str) -> dict:
    """处理单个文件：备份 -> 插入 -> 校验 -> 还原 mtime。返回报告条目。"""
    abs_path = ROOT / item["path"]
    asset = _asset_dict(item)
    original = abs_path.read_text(encoding="utf-8")
    st = abs_path.stat()

    # 幂等：已嵌入则跳过
    head = original[:600]
    if kind == "md" and original.startswith("---") and _MD_MARKER in head:
        return {"path": item["path"], "kind": kind, "status": "skipped(already)"}
    if kind == "html" and _HTML_MARKER in head:
        return {"path": item["path"], "kind": kind, "status": "skipped(already)"}
    if kind == "py" and _PY_MARKER_RE.search(original):
        return {"path": item["path"], "kind": kind, "status": "skipped(already)"}

    _backup(item["path"])

    if kind == "md":
        block = build_md_block(asset)
        new = insert_md(original, block)
        ok = new[len(block):] == original          # 正文逐字不变
        check = "正文逐字不变" if ok else "正文被改动!"
    elif kind == "html":
        block = build_html_block(asset)
        new = insert_html(original, block)
        # 去掉插入的注释块后应还原为原文
        doctype = "<!DOCTYPE html>"
        pos = original.find(doctype) + len(doctype)
        ok = (new[:pos] + new[pos + len("\n" + block):]) == original
        check = "原内容完整保留" if ok else "原内容被改动!"
    else:  # py
        block = build_py_block(asset)
        new = insert_py(original, block)
        # 用「前缀 + 块 + 后缀」结构还原：head 为 docstring 之前，tail 为 docstring 之后
        lines = original.splitlines(keepends=True)
        after = _docstring_end_line(original)
        head = "".join(lines[:after])
        tail = "".join(lines[after:])
        recovered = new[len(head): len(new) - len(tail)] if tail else new[len(head):]
        ok = (new.startswith(head) and new.endswith(tail)
              and recovered == block and (head + tail) == original)
        check = "逻辑未改动" if ok else "正文被改动!"

    abs_path.write_text(new, encoding="utf-8")
    os.utime(abs_path, (st.st_atime, st.st_mtime))   # 还原 mtime，保证时间一致

    extra = {}
    if kind == "py":
        try:
            py_compile.compile(str(abs_path), doraise=True)
            extra["compile"] = "OK"
        except py_compile.PyCompileError as exc:  # pragma: no cover
            extra["compile"] = f"FAIL: {exc}"

    return {"path": item["path"], "kind": kind, "status": "embedded",
            "content_check": check, "ok": bool(ok), **extra}


def embed_all() -> dict:
    """对全部目标文件执行嵌入，返回报告。"""
    md, html, py = _targets()
    report = {"generated_at": datetime.now().astimezone().isoformat(),
              "backup_dir": str(BACKUP_DIR.relative_to(ROOT)), "items": []}
    for item in md:
        report["items"].append(_process(item, "md"))
    for item in html:
        report["items"].append(_process(item, "html"))
    for item in py:
        report["items"].append(_process(item, "py"))
    report["embedded"] = sum(1 for i in report["items"] if i["status"] == "embedded")
    report["skipped"] = sum(1 for i in report["items"] if i["status"].startswith("skipped"))
    report["failed"] = sum(1 for i in report["items"] if i.get("ok") is False)
    return report


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report = embed_all()
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                           encoding="utf-8")
    print(f"嵌入完成：embedded={report['embedded']} skipped={report['skipped']} "
          f"failed={report['failed']}")
    for it in report["items"]:
        if it["status"] == "embedded":
            note = it.get("compile", it.get("content_check", ""))
            print(f"  [{it['kind']}] {it['path']}  ({note})")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
