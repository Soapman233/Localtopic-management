"""Render the local read-only inspection results as a self-contained dashboard."""
# ---------------------------------------------------------------------------
# title: 诊断渲染脚本
# description: 把素材诊断结果渲染为 HTML 页面。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import collections
import html
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docmeta import insert_html, sync_mtime  # noqa: E402

OUT = Path("D:/Open-source project/Localtopic-management/outputs")
REL_PATH = "outputs/physics_material_diagnostics.html"
r = json.loads((OUT / "material_diagnostics_20261005.json").read_text(encoding="utf-8"))
s = r["summary"]
esc = lambda x: html.escape(str(x), quote=True)
docs = [f for f in r["files"] if "docx" in f]
pdfs = [f for f in r["files"] if "pdf" in f]
labels = {"OMML+OLE": "原生公式与旧对象混用", "OMML only": "检出原生公式，未检出公式旧对象", "OLE only": "检出公式旧对象，未检出原生公式", "Neither detected": "两类公式节点均未检出"}
colors = {"OMML+OLE": "#7c60b0", "OMML only": "#177866", "OLE only": "#b46916", "Neither detected": "#87939d"}
bars = "".join(f'<div class="barrow"><span>{labels[k]}</span><div class="track"><div style="width:{v/len(docs)*100:.2f}%;background:{colors[k]}"></div></div><b>{v} 份</b></div>' for k, v in s["docx_categories"].items())
rootrows = "".join(f'<tr><td><code>{esc(x["path"])}</code></td><td>{x["files"]}</td><td>{x["types"].get(".docx",0)}</td><td>{x["types"].get(".pdf",0)}</td><td>{x["bytes"]/1e9:.2f} GB</td></tr>' for x in r["roots"])
pdfrows = []
for f in pdfs:
    p = f["pdf"]
    pages = p.get("page_count", 0)
    empty = len(p.get("zero_text_pages", []))
    low = len(p.get("low_text_pages_under_50", []))
    category = "全部页面无可提取文本" if pages and empty == pages else ("存在无文本页／需逐页核查" if empty else ("含少量文本页／需核查" if low else "每页均可提取文本；公式仍需重建验证"))
    pdfrows.append(f'<tr><td>{esc(f["relative_path"])}</td><td>{pages}</td><td>{p.get("text_chars",0):,}</td><td>{empty}</td><td>{esc(category)}</td></tr>')
docrows = []
for f in docs:
    d = f["docx"]
    docrows.append(f'<tr><td class="path">{esc(f["path"])}</td><td>{d.get("omml_nodes",0)}</td><td>{d.get("equation_ole_nodes",0)}</td><td>{d.get("media_files",0)}</td><td>{esc(", ".join(d["ole_progids"]) or "—")}</td></tr>')
errors = "无文件级解析错误" if not r["errors"] else "；".join(esc(e["path"] + ": " + e["error"]) for e in r["errors"])
progids = " · ".join(f'{esc(k)}：{v:,}' for k,v in s["ole_progids"].items()) or "未检测到OLE对象"
zero_pdfs = sum(p["pdf"].get("page_count",0) > 0 and len(p["pdf"].get("zero_text_pages",[])) == p["pdf"].get("page_count",0) for p in pdfs)
page_count = sum(p["pdf"].get("page_count",0) for p in pdfs)
text = '''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>物理题库 · 素材诊断</title>
<style>
:root{color-scheme:light;--ink:#182e39;--muted:#5b6c77;--line:#dce5e7;--brand:#177866}*{box-sizing:border-box}body{margin:0;background:#f4f7f8;color:var(--ink);font:15px/1.75 "Microsoft YaHei",system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:40px 24px 70px}header{border-bottom:1px solid var(--line);padding-bottom:25px;margin-bottom:24px}.eyebrow{font-size:12px;letter-spacing:2px;color:var(--brand);font-weight:700}h1{font-size:34px;line-height:1.25;margin:12px 0}h2{font-size:22px;line-height:1.4;margin:0 0 18px}h3{font-size:17px;margin:0 0 8px}.muted,small{color:var(--muted)}.tags{display:flex;gap:8px;flex-wrap:wrap}.tag{font-size:12px;padding:3px 10px;background:#e4f1ed;color:#216354;border-radius:20px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0}.stat,section{background:white;border:1px solid var(--line);border-radius:14px}.stat{padding:18px}.stat b{display:block;font-size:32px;line-height:1.4}.stat span{color:var(--muted);font-size:13px}section{padding:26px;margin:18px 0}.callout{background:#fff7e9;border-left:4px solid #b46916;padding:16px 20px;border-radius:7px;margin:18px 0}.good{background:#eaf5f1;border-left-color:#177866}.barrow{display:grid;grid-template-columns:285px 1fr 70px;gap:14px;align-items:center;margin:15px 0;font-size:14px}.track{height:16px;border-radius:10px;background:#eef2f4;overflow:hidden}.track div{height:100%;min-width:2px;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;color:var(--muted);background:#f4f7f8;font-weight:600}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}code,.path{overflow-wrap:anywhere;word-break:break-word;font:12px/1.6 "Microsoft YaHei",sans-serif}.tablewrap{overflow-x:auto}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:#f6f9f9;border:1px solid var(--line);border-radius:10px;padding:18px}.card .num{color:var(--brand);font-size:12px;font-weight:bold}.flow{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.flow span{padding:10px 14px;border:1px solid #bcd8d0;background:#f0f8f5;border-radius:8px}.flow i{font-style:normal;color:var(--muted)}li{margin:8px 0}a{color:var(--brand)}summary{cursor:pointer;font-weight:700}input{width:100%;padding:12px;margin:14px 0;border:1px solid #b5c7ce;border-radius:8px;font:inherit}footer{font-size:12px;color:var(--muted);padding-top:10px}@media(max-width:750px){.stats,.cards{grid-template-columns:1fr 1fr}.barrow{grid-template-columns:1fr 65px}.barrow .track{grid-column:1 / -1;grid-row:auto}main{padding:24px 14px}section{padding:18px}h1{font-size:27px}.cards{grid-template-columns:1fr}}@media print{body{background:white}main{padding:0}section,.stat{break-inside:avoid}details,input{display:none}}
</style></head><body><main>
<header><div class="eyebrow">PHYSICS QUESTION BANK / MATERIAL AUDIT</div><h1>先打通公式，再建设题库</h1><p class="muted">真实素材的只读结构诊断 · 不是已开发的应用，也不是公式转换成功率测试</p><div class="tags"><span class="tag">约10人 · 异地访问</span><span class="tag">导出公式必须可编辑</span><span class="tag">原件未修改 · 未上传</span></div></header>
'''
text += f'<div class="stats"><div class="stat"><b>{s["docx_inspected"]}</b><span>已检查 DOCX 文件</span></div><div class="stat"><b>{len(pdfs)}</b><span>已检查 PDF · 共 {page_count} 页</span></div><div class="stat"><b>{s["files"]}</b><span>两目录文件总数 · 未去重</span></div><div class="stat"><b>{sum(x["bytes"] for x in r["roots"])/1e9:.2f} GB</b><span>全部文件大小 · 含压缩包</span></div></div>'
text += '<section><h2>01 / 检查范围与边界</h2><div class="tablewrap"><table><thead><tr><th>目录</th><th>全部文件</th><th>DOCX</th><th>PDF</th><th>大小</th></tr></thead><tbody>' + rootrows + '</tbody></table></div><p class="muted">ZIP 未展开，PPTX 未做正文或公式检查；未哈希去重；原卷、答案、解析版仍按独立文件统计。文件数不是题目数。本轮读到748个文件（567 DOCX、14 PDF），多于此前589个文件（509 DOCX、12 PDF）；目录内容发生变化，本表是本轮逐文件检查记录，并非冻结快照。</p>'
text += f'<p class="muted">检查结果：{errors}。读取前后大小与修改时间一致：{esc(s["all_size_mtime_unchanged_during_read"])}（不是完整性哈希证明）。没有执行宏、OLE对象或外部链接。</p></section>'
text += '<section><h2>02 / DOCX 公式结构分布</h2>' + bars
text += f'<p class="muted">物理 XML 节点计数：OMML {s["omml_physical_nodes"]:,}；疑似公式 OLE {s["equation_ole_physical_nodes"]:,}。这些不是去重后的公式总数，兼容分支也可能重复计数。</p><p class="muted">对象标识：{progids}</p>'
text += '<p><strong>代表样本：</strong>动态电路计算文件有63个 Equation.KSEE3 对象、无 OMML；机械效率原卷有168个 Equation.DSMT4 对象及4个 OMML；专题13匀变速运动原卷有98个 OMML、未检出公式 OLE。应据此覆盖三种导入路径，而不是只挑最好转换的文件。</p>'
text += '<div class="callout"><strong>“未检出公式节点”不等于“没有公式”。</strong><br>公式可能是普通文字、上下标、图片或其他结构。图片统计同时包括电路图、实验图、几何图和旧公式预览图，不能拿图片数当公式图片数。</div>'
text += '<div class="cards"><div class="card"><div class="num">A / 原生公式</div><h3>保留结构，再测试重组</h3>优先保留 OMML；验证复制到新试卷、编辑、保存和重开。检出 OMML 只说明有原生结构，不代表所有内容均可正确导出。</div><div class="card"><div class="num">B / 旧公式对象</div><h3>先转换，再人工核对</h3>按 Equation / MathType 来源分流到可信转换器或重建流程。保留旧对象或其预览图片，不算完成现代可编辑公式导出。</div><div class="card"><div class="num">C / 图片及 PDF</div><h3>重建公式，待审核入库</h3>文字提取与公式识别分开；可采用本地或经授权的识别服务，低置信度内容人工重建。未确认前不上传原资料。</div></div></section>'
text += '<section><h2>03 / PDF 文本层检查</h2>'
text += f'<p>{len(pdfs)} 份 PDF、{page_count} 页；其中 <strong>{zero_pdfs} 份所有页面均未提取到文本</strong>。无文本层不直接等于已经证实是扫描件，也可能涉及编码等原因，需要视觉复核。</p>'
text += '<div class="callout"><strong>注意“只有水印文字”的扫描PDF。</strong><br>《西附国庆练习卷.pdf》6页总共只能提取42个非空白字符；第一页提取文本仅为“扫描全能王 创建”，同时存在2404×3364像素的大幅页面图像，不能作为可直接拆题的文本PDF。<br>部分PDF解析时出现对象偏移异常警告，读取完成不等于文件完全无损；正式导入仍需逐页视觉复核。</div><div class="tablewrap"><table><thead><tr><th>文件（相对第二目录）</th><th>页数</th><th>非空白字符</th><th>无文本页</th><th>判断边界</th></tr></thead><tbody>' + ''.join(pdfrows) + '</tbody></table></div><p class="muted">本轮未进行 OCR，也未逐页人工校对。能提取文本不代表分式、根号、上下标的二维关系能恢复，更不代表已经可编辑导出。</p></section>'
text += '''<section><h2>04 / 面向异地访问的候选方案</h2><div class="flow"><span>教师浏览器 · 独立账号</span><i>→</i><span>HTTPS · 权限校验</span><i>→</i><span>题库数据与私有附件</span><i>→</i><span>独立导出任务</span><i>→</i><span>可编辑 DOCX</span></div><p>候选一：托管云服务承担账号、数据和附件；候选二：自管云主机 + 单实例关系数据库 + 私有文件存储。两者都必须先确认导出运行环境与公式转换依赖。此处仅评估，未创建云资源。</p><p class="muted">如果转换依赖桌面 Word/MathType，优先在入库预处理阶段完成，不能假设它能无界面地放到任意云服务器运行。生产导出不应依赖某位教师的个人电脑持续在线；搜索、附件和下载都需鉴权。</p></section>
<section><h2>05 / 首轮验证：小样本，硬门槛</h2><ol><li><strong>选30道真实物理题。</strong>覆盖电学、机械效率/浮力、高中运动学；原生公式、旧对象和PDF重建来源均纳入；包含母题子题、图片和答案解析。</li><li><strong>先做入库前预处理。</strong>保留原件与来源定位，按公式来源分流；原卷与解析版建立关联，不直接重复导入。</li><li><strong>重组两套样卷。</strong>每套输出学生版与答案解析版 DOCX，另生成打印 PDF 对照。跨学科接口可预留，但只有物理经过验证才能宣称物理可用。</li><li><strong>逐式验收。</strong>目标 Word/WPS 中能修改分子、分母、下标、根号等结构，保存重开后仍正确；不得以公式图片兜底冒充合格。</li><li><strong>阻断不合格内容。</strong>未完成校对的公式进入待处理状态；不应静默漏掉公式，也不能自动标记为“导出成功”。先记录自动成功率、人工修正量，再决定批量投入。</li></ol><div class="callout good"><strong>下一步需要确认：</strong>实际使用 Microsoft Word 还是 WPS？版本分别是什么？是否同时要求两者兼容？这决定公式编辑与排版验收的基准环境。</div></section>
'''
text += '<section><details><summary>查看全部 DOCX 的结构计数（可搜索路径）</summary><label for="q">按文件名或目录筛选</label><input id="q" type="search" placeholder="例如：动态电路、机械效率、打点计时器"><p id="count" class="muted">' + str(len(docs)) + ' 份 DOCX</p><div class="tablewrap"><table id="docs"><thead><tr><th>完整路径</th><th>OMML</th><th>公式OLE</th><th>媒体文件</th><th>OLE标识</th></tr></thead><tbody>' + ''.join(docrows) + '</tbody></table></div></details></section>'
text += '<footer>生成时间：' + esc(r['generated_at']) + '<br>方法：OOXML包内结构标签统计 + 本地PDF逐页文本提取；未进行实际公式转换、题目拆分或端到端导出。<br>官方参考：<a href="https://support.microsoft.com/zh-cn/word/editing-equations-created-using-microsoft-equation-editor" target="_blank" rel="noopener noreferrer">Microsoft：编辑使用旧公式编辑器创建的公式</a>。该说明不构成对所有MathType对象的转换保证。<br>本页面及配套JSON包含本地文件路径，请勿未经确认公开分享。</footer></main><script>document.getElementById("q").addEventListener("input",function(){const q=this.value.toLocaleLowerCase();let n=0;document.querySelectorAll("#docs tbody tr").forEach(row=>{const hit=row.cells[0].textContent.toLocaleLowerCase().includes(q);row.hidden=!hit;if(hit)n++;});document.getElementById("count").textContent=n+" 份 DOCX";});</script></body></html>'
(OUT / "physics_material_diagnostics.html").write_text(
    insert_html(REL_PATH, text, OUT / "physics_material_diagnostics.html"), encoding="utf-8")
sync_mtime(OUT / "physics_material_diagnostics.html")
print(json.dumps({"output": str(OUT / "physics_material_diagnostics.html"), "pdf_pages": page_count, "zero_text_pdfs": zero_pdfs, "doc_rows": len(docs)}, ensure_ascii=False))
