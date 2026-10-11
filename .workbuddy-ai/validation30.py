"""Reproducible local validation harness. Source files remain read-only.
Office content I/O goes through the documented local editor SDK bridge.
Run individual stages explicitly; no upload, macro or OLE activation.
"""
# ---------------------------------------------------------------------------
# title: 30 题验证脚本
# description: 对 30 道真实题执行三路径公式可编辑性验证。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import collections, datetime, hashlib, json, re, shutil, subprocess, sys, time, zipfile
import xml.etree.ElementTree as ET

PROJECT = Path("D:/Open-source project/Localtopic-management")
OUT = PROJECT / "outputs/validation_30"
PY = Path("C:/Users/SOAP/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe")
BRIDGE = Path("C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/tencent-local-office-edit/edsdk.py")
NS = {"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main", "m":"http://schemas.openxmlformats.org/officeDocument/2006/math", "o":"urn:schemas-microsoft-com:office:office"}

def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))

def sha(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda:f.read(1024*1024), b""): h.update(block)
    return h.hexdigest()

_schemas=set()
def sdk(tool, **args):
    if tool not in _schemas:
        p=subprocess.run([str(PY),str(BRIDGE),"schema",tool],capture_output=True,text=True,encoding="utf-8")
        if p.returncode: raise RuntimeError(p.stderr or p.stdout)
        (OUT / ("schema_"+tool+".txt")).write_text(p.stdout,encoding="utf-8")
        _schemas.add(tool)
    start=time.perf_counter()
    p=subprocess.run([str(PY),str(BRIDGE),"call",tool,"--json",json.dumps(args,ensure_ascii=False)],capture_output=True,text=True,encoding="utf-8")
    record={"at":datetime.datetime.now().astimezone().isoformat(),"tool":tool,"args":args,"seconds":round(time.perf_counter()-start,3),"exit_code":p.returncode,"stdout":p.stdout,"stderr":p.stderr}
    with (OUT/"sdk_calls.jsonl").open("a",encoding="utf-8") as f: f.write(json.dumps(record,ensure_ascii=False)+"\n")
    if p.returncode: raise RuntimeError(p.stderr or p.stdout)
    try: return json.loads(p.stdout)
    except json.JSONDecodeError: return p.stdout.strip()


def open_doc(path):
    result=sdk("open_file",file_path=str(Path(path).as_posix()),wait=True)
    pool=sdk("get_pool_status",file_path=str(Path(path).as_posix()))
    return pool["open_editors"][0]["file_id"]


def package_stats(path):
    with zipfile.ZipFile(path) as z:
        root=ET.fromstring(z.read("word/document.xml"))
        return {"omml":len(root.findall(".//m:oMath",NS)),"ole":len(root.findall(".//o:OLEObject",NS)),
                "media":len([n for n in z.namelist() if n.startswith("word/media/") and not n.endswith("/")]),
                "equations":["".join(n.itertext()) for n in root.findall(".//m:oMath",NS)],
                "text":"".join(n.text or "" for n in root.findall(".//w:t",NS)),
                "progids":dict(collections.Counter(n.get("ProgID","") for n in root.findall(".//o:OLEObject",NS)))}


def prepare():
    existing=json.loads((PROJECT/"outputs/material_diagnostics_20261005.json").read_text(encoding="utf-8"))
    targets={"A":"专题13 匀变速直线运动的基本公式——打点计时器的使用（原卷版）.docx",
             "B":"11.5 机械效率（重难点专练）（原卷版）.docx",
             "C":"西附国庆练习卷.pdf"}
    manifest={"created_at":datetime.datetime.now().astimezone().isoformat(),"sources":{}}
    for key,name in targets.items():
        matches=[f for f in existing["files"] if Path(f["path"]).name==name]
        if len(matches)!=1: raise ValueError((key,len(matches)))
        src=Path(matches[0]["path"]); target=OUT/("source_"+key+src.suffix)
        if target.exists(): raise FileExistsError(target)
        h=sha(src); shutil.copy2(src,target)
        assert h==sha(target)==sha(src)
        manifest["sources"][key]={"path":str(src),"snapshot":str(target),"sha256":h,"bytes":src.stat().st_size}
    save("source_manifest.json",manifest)
    for key in ("A","B"):
        fid=open_doc(manifest["sources"][key]["snapshot"])
        data=sdk("doc_resolve_document_structure",file_id=fid,mode="full",limit=0,text_preview_length=200)
        save("source_"+key+"_structure.json",data)
        images=sdk("doc_get_images",file_id=fid); save("source_"+key+"_images.json",images)
        manifest["sources"][key]["file_id"]=fid
        candidates=[n for n in data["nodes"] if re.match(r"^(?:【[^】]+】)?\s*\d+[．.、]|^【例", n.get("text_preview",""))]
        print(key, json.dumps(candidates,ensure_ascii=False))
    save("source_manifest.json",manifest)
    print("Source snapshots complete.")


def ranges():
    manifest=load("source_manifest.json")
    for key in ("A","B"):
        nodes=load("source_"+key+"_structure.json")["nodes"]
        print("SOURCE",key)
        for n in nodes:
            print(n.get("paragraph_index"), n["start_index"], n["end_index"],n.get("type"),n.get("text_preview",""))


def add_source():
    manifest=load("source_manifest.json")
    src=Path("C:/Users/SOAP/Desktop/物理/初中/2026学科网教案/2026年中考物理第一轮专题训练：欧姆定律与电功率的综合计算题.docx")
    target=OUT/"source_A2.docx"
    if target.exists(): raise FileExistsError(target)
    h=sha(src); shutil.copy2(src,target); assert sha(target)==h==sha(src)
    fid=open_doc(target)
    data=sdk("doc_resolve_document_structure",file_id=fid,mode="full",limit=0,text_preview_length=200)
    save("source_A2_structure.json",data)
    manifest["sources"]["A2"]={"path":str(src),"snapshot":str(target),"sha256":h,"bytes":src.stat().st_size,"file_id":fid}
    save("source_manifest.json",manifest)
    for n in data["nodes"]:
        if re.match(r"^\s*\d+[．.、]",n.get("text_preview","")): print(json.dumps(n,ensure_ascii=False))

def select_and_export():
    manifest=load("source_manifest.json")
    specs=[("A"+str(i).zfill(2),"A2",i) for i in range(1,9)]+[("A09","A",1),("A10","A",2)]+[("B"+str(i+1).zfill(2),"B",q) for i,q in enumerate([1,6,9,10,18,22,25,27,28,32])]
    selected=[]
    for qid,key,q in specs:
        nodes=load("source_"+key+"_structure.json")["nodes"]
        starts=[n for n in nodes if re.match(r"^"+str(q)+r"[．.、]",n.get("text_preview",""))]
        if not starts: raise ValueError((key,q))
        start=starts[0]
        nxt=next((n for n in nodes if n["start_index"]>start["start_index"] and re.match(r"^"+str(q+1)+r"[．.、]",n.get("text_preview",""))),None)
        record={"id":qid,"pathway":qid[0],"source_key":key,"source_question":q,"start":start["start_index"],"end":nxt["start_index"] if nxt else None,"source_preview":start.get("text_preview",""),"source_paragraph_id":start.get("paragraph_id"),"source_paragraph_index":start.get("paragraph_index"),"source_sha256":manifest["sources"][key]["sha256"],"source_path":manifest["sources"][key]["path"]}
        if key=="A2":
            record["answer_begin"]=starts[1]["start_index"] if len(starts)>1 else None
        selected.append(record)
    save("selected_questions.json",selected)
    for record in selected:
        t=time.perf_counter(); qid=record["id"]; key=record["source_key"]
        work=OUT/(qid+"_work.docx")
        if work.exists(): raise FileExistsError(work)
        shutil.copy2(manifest["sources"][key]["snapshot"],work)
        try:
            fid=open_doc(work)
            last=sdk("doc_get_last_operable_pos",file_id=fid)["position"]
            if record["end"] is not None and record["end"]<last:
                sdk("doc_replace_text",file_id=fid,ranges=[{"begin":record["end"],"end":last}],text="")
            if record["start"]:
                sdk("doc_replace_text",file_id=fid,ranges=[{"begin":0,"end":record["start"]}],text="")
            dest=OUT/(qid+"_export.docx")
            sdk("save_file",file_id=fid,file_path=str(dest.as_posix()))
            stats=package_stats(dest); save(qid+"_package.json",stats)
            record.update({"export_status":"PASS","export_path":str(dest),"export_sha256":sha(dest),"export_omml":stats["omml"],"export_ole":stats["ole"],"export_media":stats["media"]})
            sdk("close_file",file_id=fid)
        except Exception as e: record.update({"export_status":"ERROR","error":str(e)})
        record["export_seconds"]=round(time.perf_counter()-t,3)
        save("selected_questions.json",selected)
        print(qid,record["export_status"],record.get("export_omml"),record.get("export_ole"),record.get("error",""),flush=True)

def build_pdf_questions():
    from PIL import Image
    rows=load("pdf_transcription.json")
    only=sys.argv[2].split(",") if len(sys.argv)>2 else None
    if only: rows=[r for r in rows if r["id"] in only]
    prior_path=OUT/"pdf_reconstruction_results.json"
    prior=load("pdf_reconstruction_results.json") if prior_path.exists() else []
    results=[r for r in prior if r["id"] not in {x["id"] for x in rows}]
    for row in rows:
        qid=row["id"]; started=time.perf_counter(); fid=None
        try:
            result=sdk("create_doc")
            fid=re.search(r"file_id=([^,\s]+)",result).group(1)
            for part in row["parts"]:
                pos=sdk("doc_get_last_operable_pos",file_id=fid)["position"]
                if "text" in part:
                    sdk("doc_insert_paragraph_with_text",file_id=fid,idx=pos,text=part["text"],text_format={"font_family":"宋体","font_size":11})
                elif "math" in part:
                    result=sdk("doc_insert_math",file_id=fid,idx=pos,latex=part["math"])
                    pos=sdk("doc_get_last_operable_pos",file_id=fid)["position"]
                    sdk("doc_insert_paragraph",file_id=fid,idx=pos)
                elif "image_crop" in part:
                    img=OUT/(qid+"_diagram.png"); im=Image.open(img); w,h=im.size; width=min(w,400)
                    sdk("doc_insert_image",file_id=fid,idx=pos,image_path=str(img.as_posix()),w=width,h=round(h*width/w))
                    pos=sdk("doc_get_last_operable_pos",file_id=fid)["position"]
                    sdk("doc_insert_paragraph",file_id=fid,idx=pos)
            target=OUT/(qid+"_reconstructed.docx")
            sdk("save_file",file_id=fid,file_path=str(target.as_posix()))
            row.update({"build_status":"PASS","path":str(target),"sha256":sha(target),"package":package_stats(target),"method":"AI visual transcription plus explicit correction; NOT unattended OCR"})
        except Exception as e: row.update({"build_status":"ERROR","build_error":str(e)})
        finally:
            if fid:
                try: sdk("close_file",file_id=fid)
                except Exception: pass
        row["build_seconds"]=round(time.perf_counter()-started,3)
        results.append(row); save("pdf_reconstruction_results.json",results)
        print(qid,row["build_status"],row.get("build_error",""),flush=True)

def legacy_roundtrip():
    rows=load("native_extraction_results.json"); results=[]
    for row in sorted(rows,key=lambda r:r["id"]):
        if row["pathway"]!="B": continue
        qid=row["id"]; start=time.perf_counter(); fid=None
        result={"id":qid,"method":"Generic editor import/save baseline, NOT a dedicated MTEF-to-OMML converter"}
        try:
            source=Path(row["native_path"]); result["before"]=package_stats(source)
            fid=open_doc(source); target=OUT/(qid+"_sdk_roundtrip.docx")
            sdk("save_file",file_id=fid,file_path=str(target.as_posix()))
            result["after"]=package_stats(target); result["path"]=str(target)
            result["status"]="FAIL" if result["before"]["ole"]>0 and (result["after"]["ole"]>0 or result["after"]["omml"]<=result["before"]["omml"]) else "REVIEW"
            result["reason"]="Dedicated legacy equation conversion is unavailable; generic save does not prove semantic conversion."
        except Exception as e: result.update({"status":"ERROR","error":str(e)})
        finally:
            if fid:
                try: sdk("close_file",file_id=fid)
                except Exception: pass
        result["seconds"]=round(time.perf_counter()-start,3); results.append(result); save("legacy_roundtrip_results.json",results)
        print(qid,result["status"],result.get("before",{}).get("ole"),result.get("after",{}).get("ole"),result.get("after",{}).get("omml"),flush=True)

if __name__=="__main__":
    {"prepare":prepare,"ranges":ranges,"add_source":add_source,"select_and_export":select_and_export,"build_pdf_questions":build_pdf_questions,"legacy_roundtrip":legacy_roundtrip}[sys.argv[1]]()
