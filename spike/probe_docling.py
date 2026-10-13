# -*- coding: utf-8 -*-
"""探针：docling 能否用于「识别试卷」？（**对照实验，不做结论性承诺**）

背景
----
用户提出「识别试卷存在问题，能否使用 docling 的技术路线」。
本项目当前的识别链路是自研的：`pipeline/docx_scan.py`（扫描 OLE/OMML/图片）
→ `pipeline/mtef_conv.py`（MathType MTEF → LaTeX）→ `pipeline/segment.py`（题目切分）。

docling 是 IBM 的文档解析库（PDF/DOCX → 结构化 DoclingDocument）。
它解决的是**另一层问题**（文档 → 结构化内容），而不是「中文试卷切题」。
**本探针要回答的是可测的三件事**：

1. **公式能不能保住**——这是本项目的命门。实测题库里 `mathtype`(旧式 OLE) 11863 条、
   `omml` 5908 条，**2/3 是 MathType OLE**。若 docling 把 OLE 丢掉，整条路线不成立。
2. **切题能力**——docling 输出的是「文档结构」（标题/段落/表格/图片），
   不含「第 1 题…第 2 题…」这种业务切分。要确认它是否提供可用的锚点。
3. **代价**——耗时与依赖体积（docling 带 ML 模型）。

用法::

    <docling 环境>/python.exe spike/probe_docling.py "<样本.docx>"
"""
from __future__ import annotations

import json
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

DEFAULT_SAMPLE = (
    r"C:\Users\SOAP\Desktop\物理\初中\2026学科网教案"
    r"\第九章 压强和浮力（计算题30道）-【刷好题】2025-2026学年八年级物理下册热点题型专练（2024苏科版）"
    r"\第九章 压强和浮力（计算题30道）（原卷版）.docx"
)


def zip_facts(path: Path) -> dict:
    """DOCX 内部事实（作为对照基线：源文件里到底有什么）。"""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        # ⚠️ `z.read()` 必须在 `with` 块**内**调用——出了块 zip 已关闭
        #    （本探针第一版就把 read 写在了 dict 字面量里，直接 ValueError）。
        doc_xml = len(z.read("word/document.xml")) if "word/document.xml" in names else 0
    return {
        "oleObjects": len([n for n in names if "oleObject" in n]),
        "wmfEmf": len([n for n in names if n.lower().endswith((".wmf", ".emf"))]),
        "media": len([n for n in names if n.startswith("word/media/")]),
        "document_xml_bytes": doc_xml,
    }


def main() -> int:
    sample = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_SAMPLE)
    if not sample.is_file():
        print(f"[SKIP] 样本不存在：{sample}")
        return 0

    print("=== docling 探针（对照实验）===")
    print(f"样本：{sample.name}")
    print()

    facts = zip_facts(sample)
    print("[源文件事实]")
    for k, v in facts.items():
        print(f"  {k:20} {v}")
    print()

    # ① 导入耗时
    t0 = time.perf_counter()
    try:
        from docling.document_converter import DocumentConverter
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 无法导入 docling：{type(exc).__name__}: {exc}")
        return 1
    print(f"[①] 导入 docling 耗时 {time.perf_counter() - t0:.1f}s")

    # ② 转换
    t1 = time.perf_counter()
    try:
        conv = DocumentConverter()
        res = conv.convert(str(sample))
        doc = res.document
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 转换失败：{type(exc).__name__}: {exc}")
        return 1
    dt = time.perf_counter() - t1
    print(f"[②] 转换耗时 {dt:.1f}s")

    # ③ 文档结构统计
    kinds = Counter()
    for item, _ in doc.iterate_items():
        kinds[type(item).__name__] += 1
    print()
    print("[③] DoclingDocument 里的条目类型")
    for k, v in kinds.most_common():
        print(f"  {k:26} {v}")

    # ④ 公式是否保住（docling 用 `formula` 标签或 FormulaItem）
    try:
        formulas = list(doc.iterate_items())  # 占位，下面按 label 统计
        label_counts = Counter()
        for item, _ in doc.iterate_items():
            lab = getattr(item, "label", None)
            if lab is not None:
                label_counts[str(lab)] += 1
        print()
        print("[④] 按 label 统计（docling 的语义标签）")
        for k, v in label_counts.most_common():
            print(f"  {k:26} {v}")
    except Exception as exc:  # noqa: BLE001
        print(f"  （label 统计失败：{exc}）")

    # ⑤ 导出 markdown，看公式/图片在文本里长什么样
    try:
        md = doc.export_to_markdown()
    except Exception as exc:  # noqa: BLE001
        md = ""
        print(f"  （markdown 导出失败：{exc}）")
    out = Path(__file__).resolve().parent / "_probe_docling.md"
    out.write_text(md, encoding="utf-8")
    print()
    print(f"[⑤] markdown 长度 {len(md)} 字符 → {out}")

    # ⑥ 关键判据：源文件里的 49 个 OLE 公式，在 docling 输出里还剩多少线索？
    print()
    print("[⑥] 关键判据：公式线索")
    print(f"  源文件 OLE 公式数        : {facts['oleObjects']}")
    print(f"  markdown 里 '$' 出现次数 : {md.count('$')}")
    print(f"  markdown 里 '![' 图片引用 : {md.count('![')}")
    print(f"  markdown 里 'formula' 字样: {md.lower().count('formula')}")
    head = "\n".join(md.splitlines()[:12])
    print("  --- markdown 开头 12 行 ---")
    for line in head.splitlines():
        print(f"    {line[:100]}")

    summary = {
        "sample": sample.name,
        "source": facts,
        "convert_seconds": round(dt, 1),
        "item_kinds": dict(kinds),
        "markdown_chars": len(md),
        "markdown_dollar": md.count("$"),
        "markdown_images": md.count("!["),
    }
    (Path(__file__).resolve().parent / "_probe_docling.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
