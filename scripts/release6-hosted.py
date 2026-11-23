"""Test hosted reading, meaning of a missing score and bilingual exports with public-safe QA fixtures."""
import argparse
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pypdf import PdfReader

BASE = "https://mizan-integrity-studio.yemend41.chatgpt.site"
FIXTURES = Path(__file__).resolve().parents[1]/"research/media/tests/fixtures/writing-intake"
CASES = ["bilingual.docx","bilingual.pdf","bilingual-alt-label.pdf","alternate.docx","textbox.docx","hybrid.pdf","scan.pdf"]
def verify(v,msg):
    if not v: raise ValueError(msg)
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    stamp=lambda: datetime.now(timezone.utc).isoformat()
    audit={"startedUTC":stamp(),"cases":[],"source":"Author-created public QA files; no student/authorship data.","exports":{}}
    truth=json.loads((FIXTURES/"truth.json").read_text())
    expected=json.loads((FIXTURES/"release5-hashes.json").read_text())
    records={}
    with args.out.open("x",encoding="utf8") as f, httpx.Client(base_url=BASE,timeout=60) as client:
        try:
            health=client.get("/api/health").json()
            verify(health["assessment"]=="zz-release-6","Wrong version")
            audit["analysisFingerprint"]=health["analysisFingerprint"]
            auth=client.post("/api/login",json={"username":"review-panel","password":sys.stdin.readline().strip()})
            verify(auth.status_code==200,"Committee access failed")
            for file in CASES:
                data=(FIXTURES/file).read_bytes()
                res=client.post("/api/analyze",headers={"x-format":file.split(".")[-1],"x-index":"no","content-type":"application/octet-stream"},content=data)
                verify(res.status_code==201,"Upload status "+str(res.status_code))
                r=res.json();saved=client.get("/api/reports/"+r["id"]+"/json")
                verify(saved.status_code==200 and saved.json()==r,"Stored report mismatch")
                verify(digest(r["text"])==expected[file]["legacyText"],"Legacy intake changed")
                view=r.get("writingText",r["text"])
                if file in ("alternate.docx","textbox.docx"):
                    verify([s.strip() for s in view.splitlines()]==truth[file.split(".")[0]],"Word logical order")
                if file=="bilingual.pdf": verify(len(view.strip().split("\n\n"))==6 and "AIP-203" in view,"Tagged PDF sections")
                if file=="bilingual-alt-label.pdf": verify(view==records["bilingual.pdf"][1],"Alternate labels affected writing")
                if file=="hybrid.pdf":verify(r["forensics"]["pagesWithLetters"]==1 and r["forensics"]["pageCount"]==2,"Hybrid coverage")
                det=r["detector"]
                if file=="scan.pdf":verify(det["display"] is None and det["status"]=="unavailable" and det["reason"]=="no_text_layer","Scan incorrectly scored")
                verify(det["review"]["confidence"]=="not_calibrated","Missing confidence qualification")
                audit["cases"].append({"fixture":file,"http":201,"storedJSON":True,"preservedSimilarityInput":True,"status":det["status"],"pagesWithLetters":r["forensics"].get("pagesWithLetters")})
                records[file]=(r["id"],view)
            for lang in ("ar","en"):
                res=client.get("/api/reports/"+records["scan.pdf"][0]+"/pdf",params={"lang":lang})
                res.raise_for_status();doc=PdfReader(io.BytesIO(res.content),strict=True)
                verify(len(doc.pages)>0 and doc.trailer["/Root"]["/Lang"].startswith(lang),"PDF language")
                text=" ".join(p.extract_text() for p in doc.pages)
                verify(records["scan.pdf"][0] in text,"Wrong PDF")
                audit["exports"][lang]={"pages":len(doc.pages),"pdfOpened":True,"bytes":len(res.content)}
            audit["status"]="passed"
        except Exception as error:
            audit.update(status="failed",reason=str(error)[:130])
        finally:
            client.post("/api/logout");audit["finishedUTC"]=stamp()
            json.dump(audit,f,indent=2);f.write("\n")
    print(audit["status"],len(audit["cases"]),audit.get("reason",""))
    return audit["status"]!="passed"
if __name__=="__main__":sys.exit(main())
