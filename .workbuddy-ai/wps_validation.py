"""Native WPS-only verification of generated test copies.
Never opens originals for writing, never activates OLE or macros, never closes user documents.
"""
# ---------------------------------------------------------------------------
# title: WPS 验证脚本
# description: 在 WPS 中验证公式可编辑性的脚本。
# author: 待补充
# version: 0.1.0
# category: 工具脚本
# ---------------------------------------------------------------------------

from pathlib import Path
import datetime, hashlib, json, re, sys, time, traceback, winreg
import pythoncom
import win32com.client

OUT=Path("D:/Open-source project/Localtopic-management/outputs/validation_30")

def dump(name,obj):
    (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8")

def prop(obj,name):
    try: return str(getattr(obj,name))
    except Exception as e: return "UNAVAILABLE: "+str(e)

def connect():
    pythoncom.CoInitialize()
    app=win32com.client.DispatchEx("KWPS.Application")
    return app

def probe():
    r={"at":datetime.datetime.now().astimezone().isoformat(),"client":"KWPS.Application"}
    app=None; doc=None
    try:
        app=connect(); existing=app.Documents.Count
        r.update({"version":prop(app,"Version"),"build":prop(app,"Build"),"name":prop(app,"Name"),"path":prop(app,"Path"),"preexisting_document_count":existing})
        try:
            app.AutomationSecurity=3; r["automation_security"]=3
        except Exception as e:
            r["automation_security_error"]=str(e)
        path=OUT/"source_A.docx"
        if path.exists():
            doc=app.Documents.Open(str(path),ReadOnly=True,AddToRecentFiles=False)
            r["source_A"]={"maths":doc.OMaths.Count,"inline_shapes":doc.InlineShapes.Count,"paragraphs":doc.Paragraphs.Count,"pages":doc.ComputeStatistics(2)}
            if doc.OMaths.Count:
                eq=doc.OMaths.Item(1)
                r["source_A"]["first_math_text"]=eq.Range.Text
                r["source_A"]["first_math_functions"]=eq.Functions.Count
            doc.Close(False); doc=None
        r["status"]="PASS"
    except Exception as e:
        r.update({"status":"ERROR","error":str(e),"traceback":traceback.format_exc()})
    finally:
        if doc is not None:
            try: doc.Close(False)
            except Exception: pass
        # Do not quit WPS; a singleton may be shared with the user's session.
        dump("wps_environment.json",r)
        print(json.dumps(r,ensure_ascii=False,indent=2))
        pythoncom.CoUninitialize()


def render_sources():
    app=connect(); results=[]
    for key in ("A","B"):
        path=OUT/("source_"+key+".docx"); doc=None; row={"key":key}
        try:
            doc=app.Documents.Open(str(path),ReadOnly=True,AddToRecentFiles=False)
            dest=OUT/("source_"+key+"_wps.pdf")
            doc.ExportAsFixedFormat(str(dest),17)
            row.update({"status":"PASS","pdf":str(dest),"pages":doc.ComputeStatistics(2),"maths":doc.OMaths.Count})
        except Exception as e: row.update({"status":"ERROR","error":str(e)})
        finally:
            if doc is not None: doc.Close(False)
        results.append(row)
    dump("source_render_results.json",results); print(json.dumps(results,ensure_ascii=False,indent=2))
    pythoncom.CoUninitialize()

def extract_native():
    app=connect(); app.AutomationSecurity=3
    manifest=json.loads((OUT/"source_manifest.json").read_text(encoding="utf-8"))
    specs=json.loads((OUT/"selected_questions.json").read_text(encoding="utf-8"))
    # Pilot q1/q6/q8 in A2 contain no OMML in the stem; replace them with formula-bearing questions.
    for rec in specs:
        replacements={"A01":12,"A06":15,"A08":17}
        if rec["id"] in replacements:
            rec["source_question"]=replacements[rec["id"]]
            rec["selection_adjustment"]="Pilot stem contained no OMML; replaced with a genuine formula-bearing source question."
    existing_path=OUT/"native_extraction_results.json"
    prior=json.loads(existing_path.read_text(encoding="utf-8")) if existing_path.exists() else []
    results=[r for r in prior if r["id"] not in ("A01","A06","A08")] if prior else []
    if prior: specs=[r for r in specs if r["id"] in ("A01","A06","A08")]
    docs={}
    try:
        for key in ("A","A2","B"):
            docs[key]=app.Documents.Open(manifest["sources"][key]["snapshot"],ReadOnly=True,AddToRecentFiles=False)
        for rec in specs:
            t=time.perf_counter(); row=dict(rec); key=rec["source_key"]; q=rec["source_question"]; doc=docs[key]; target=None
            try:
                paragraphs=[doc.Paragraphs.Item(i).Range for i in range(1,doc.Paragraphs.Count+1)]
                matches=[p for p in paragraphs if re.match(r"^"+str(q)+r"．",p.Text.strip())]
                start=matches[0].Start
                after=next((p.Start for p in paragraphs if p.Start>start and re.match(r"^"+str(q+1)+r"．",p.Text.strip())),doc.Content.End-1)
                source=doc.Range(start,after)
                source_text=source.Text; source_math=source.OMaths.Count; source_shapes=source.InlineShapes.Count
                source_eq=[source.OMaths.Item(i).Range.Text for i in range(1,source_math+1)]
                target=app.Documents.Add(); target.Content.FormattedText=source.FormattedText
                path=OUT/(rec["id"]+"_native.docx"); target.SaveAs2(str(path),12)
                target.ExportAsFixedFormat(str(OUT/(rec["id"]+"_native.pdf")),17)
                row.update({"native_status":"PASS","native_path":str(path),"native_range":{"start":start,"end":after},"native_source_text":source_text,"native_source_math":source_math,"native_source_shapes":source_shapes,"native_source_equations":source_eq,"native_math":target.OMaths.Count,"native_shapes":target.InlineShapes.Count,"native_text_match":target.Content.Text.strip()==source_text.strip(),"native_math_match":source_eq==[target.OMaths.Item(i).Range.Text for i in range(1,target.OMaths.Count+1)],"source_page":int(source.Information(3)),"native_pages":target.ComputeStatistics(2)})
                if key=="A2" and len(matches)>1:
                    ast=matches[1].Start
                    aend=next((p.Start for p in paragraphs if p.Start>ast and re.match(r"^"+str(q+1)+r"．",p.Text.strip())),doc.Content.End-1)
                    ans=doc.Range(ast,aend)
                    row["answer_text"]=ans.Text; row["answer_math"]=ans.OMaths.Count
            except Exception as e: row.update({"native_status":"ERROR","native_error":str(e),"native_trace":traceback.format_exc()})
            finally:
                if target is not None: target.Close(False)
            row["native_seconds"]=round(time.perf_counter()-t,3); results.append(row); dump("native_extraction_results.json",results)
            print(rec["id"],row["native_status"],row.get("native_math"),row.get("native_shapes"),row.get("native_text_match"),row.get("native_error",""),flush=True)
    finally:
        for d in docs.values(): d.Close(False)
        pythoncom.CoUninitialize()

def verify_equation_editing():
    app=connect(); app.AutomationSecurity=3
    native=json.loads((OUT/"native_extraction_results.json").read_text(encoding="utf-8"))
    pdf_file=OUT/"pdf_reconstruction_results.json"
    pdf=json.loads(pdf_file.read_text(encoding="utf-8")) if pdf_file.exists() else []
    mode=sys.argv[2] if len(sys.argv)>2 else "A"
    rows=[{"id":r["id"],"path":r["native_path"],"group":r["pathway"]} for r in native if r["pathway"]==mode]
    if mode=="C": rows=[{"id":r["id"],"path":r["path"],"group":"C"} for r in pdf if r.get("build_status")=="PASS"]
    results=[]
    for row in sorted(rows,key=lambda r:r["id"]):
        started=time.perf_counter(); doc=None; result=dict(row)
        try:
            doc=app.Documents.Open(row["path"],ReadOnly=True,AddToRecentFiles=False)
            result["wps_open"]="PASS"; result["initial_math_count"]=doc.OMaths.Count; result["initial_shapes"]=doc.InlineShapes.Count
            result["initial_text"]=doc.Content.Text
            result["pages"]=doc.ComputeStatistics(2)
            dest=OUT/(row["id"]+"_wps_saved.docx")
            doc.SaveAs2(str(dest),12)
            doc.ExportAsFixedFormat(str(OUT/(row["id"]+"_wps.pdf")),17)
            edits=[]
            # Edit one leaf in every equation; descending order avoids positional drift.
            for i in range(doc.OMaths.Count,0,-1):
                eq=doc.OMaths.Item(i); er=eq.Range; before=er.Text; item={"equation_index":i,"before":before,"functions_before":eq.Functions.Count}
                char=None
                for j in range(er.Characters.Count,0,-1):
                    c=er.Characters.Item(j)
                    if len(c.Text)==1 and (c.Text.isalnum() or c.Text in ["η","θ","α","β"]):
                        char=c; break
                if char is None:
                    item["status"]="NO_EDITABLE_LEAF_SELECTED"
                else:
                    old=char.Text; replacement="8" if old!="8" else "7"; char.Text=replacement
                    item.update({"status":"EDITED","old":old,"replacement":replacement,"after":doc.OMaths.Item(i).Range.Text,"functions_after":doc.OMaths.Item(i).Functions.Count})
                edits.append(item)
            edited=OUT/(row["id"]+"_wps_edited.docx"); doc.SaveAs2(str(edited),12); expected=[doc.OMaths.Item(i).Range.Text for i in range(1,doc.OMaths.Count+1)]
            doc.Close(False); doc=None
            doc=app.Documents.Open(str(edited),ReadOnly=True,AddToRecentFiles=False)
            actual=[doc.OMaths.Item(i).Range.Text for i in range(1,doc.OMaths.Count+1)]
            result.update({"edits":edits,"saved_path":str(dest),"edited_path":str(edited),"reopened_math_count":doc.OMaths.Count,"edit_persistence":expected==actual,"all_equations_edit_tested":all(e["status"]=="EDITED" for e in edits),"status":"PASS" if expected==actual and edits and all(e["status"]=="EDITED" for e in edits) else ("NOT_APPLICABLE" if not edits else "PARTIAL")})
            if row["group"]=="B": result["status"]="FAIL_LEGACY_REMAINS"
        except Exception as e: result.update({"status":"ERROR","error":str(e),"traceback":traceback.format_exc()})
        finally:
            if doc is not None: doc.Close(False)
        result["seconds"]=round(time.perf_counter()-started,3); results.append(result); dump("wps_edit_results_"+mode+".json",results)
        print(row["id"],result["status"],result.get("initial_math_count"),result.get("error",""),flush=True)
    pythoncom.CoUninitialize()

if __name__=="__main__":
    {"probe":probe,"render_sources":render_sources,"extract_native":extract_native,"verify_equation_editing":verify_equation_editing}[sys.argv[1]]()
