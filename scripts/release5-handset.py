"""Read two user-selected saved reports in their existing committee session and audit their counts."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import getpass
import io
import json
from pathlib import Path
import sys
import subprocess
import unicodedata
from uuid import UUID

import fitz
import httpx
from pypdf import PdfReader

ORIGIN = "https://mizan-integrity-studio.yemend41.chatgpt.site"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ar-report", type=UUID)
parser.add_argument("--en-report", type=UUID)
parser.add_argument("--out", required=True, type=Path)
parser.add_argument("--private-dir", type=Path)
parser.add_argument("--revised", action="store_true", help="Require corrected PDF properties and locale-specific filenames")
parser.add_argument("--reference-fixtures", action="store_true", help="Use a fresh public research PDF and a non-personal DOCX control from the repository")
args = parser.parse_args()
if args.reference_fixtures and (args.ar_report or args.en_report):parser.error("Choose saved reports or reference fixtures")
if not args.reference_fixtures and not (args.ar_report and args.en_report):parser.error("Supply both report IDs")
password = getpass.getpass("Committee credential: ") if sys.stdin.isatty() else sys.stdin.readline().strip()

def word_intervals(body):
    offsets = [0]
    for ch in body:
        offsets.append(offsets[-1] + (2 if ord(ch) > 65535 else 1))
    start = None
    for i, ch in enumerate(body + " "):
        category = unicodedata.category(ch)[0]
        if start is None:
            if category in ("L", "N"):
                start = i
        elif category not in ("L", "N", "M"):
            normalized = unicodedata.normalize("NFKD", body[start:i]).replace("ـ", "")
            if any(not unicodedata.category(c).startswith("M") for c in normalized):
                yield offsets[start], offsets[i]
            start = None

def audit(saved):
    sim, detector = saved["similarity"], saved["detector"]
    matches = sim["matches"]
    ranges = [(x["start"],x["end"]) for x in sim["exclusions"]]
    covered = [(x["start"],x["end"]) for x in matches]
    eligible = [(a,b) for a,b in word_intervals(saved["text"]) if not any(lo<=a<hi for lo,hi in ranges)]
    numerator = sum(any(lo<=a and b<=hi for lo,hi in covered) for a,b in eligible)
    denominator = len(eligible)
    percentage = ((2000*numerator+denominator)//(2*denominator))/10 if denominator else 0
    assert (numerator,denominator,percentage)==(sim["matchedWords"],sim["eligibleWords"],sim["percentage"]), "Stored ratio or word intervals differ"
    assert all(0<=m["start"]<m["end"] and 0<=m["sourceStart"]<m["sourceEnd"] and m.get("sourceExcerpt") for m in matches)
    assert detector["status"]!="suppressed" or (detector["display"]=="*%" and not detector["segments"] and detector["flaggedWords"] is None)
    return {"format":saved["format"],"extractedWords":saved["words"],"matched":numerator,"eligible":denominator,"overlapPercent":percentage,"excludeQuotes":saved["options"]["excludeQuotes"],"excludeReferences":saved["options"]["excludeReferences"],"rangesRecounted":True,
        "matches":len(matches),"sourceKinds":dict(Counter(s["kind"] for s in sim["sources"])),"distinctMatchedSources":len({x["sourceId"] for x in matches}),"matchMethods":dict(Counter(m["method"] for m in matches)),"cohortCompared":sim["cohortCompared"],"windowLimited":sim["cohortWindowLimited"],
        "detectorDisplay":detector["display"],"detectorStatus":detector["status"],"detectorEligible":detector["eligibleWords"],"model":detector["model"],"authorshipLabel":"unknown"}

def pdf_check(data, doc_id, loc, response):
    reader = PdfReader(io.BytesIO(data), strict=True)
    with fitz.open(stream=data,filetype="pdf") as doc:
        glyphs = len(doc[0].get_text().strip())
        assert glyphs>25
        mupdf_text = doc[0].get_text()
        assert all(len(set(p.get_pixmap(matrix=fitz.Matrix(.7,.7),colorspace=fitz.csGRAY).samples))>4 for p in doc)
    decoded = "\n".join(p.extract_text() for p in reader.pages)
    assert doc_id in decoded
    details = {"http":response.status_code,"pages":len(reader.pages),"opened":True,"renderedAllPages":True}
    if args.revised:
        assert ("-"+loc+".pdf") in response.headers.get("content-disposition","")
        assert str(reader.trailer["/Root"].get("/Lang","")).startswith(loc)
        title="تقرير تدقيق النزاهة الأكاديمية" if loc=="ar" else "Academic integrity audit"
        poppler=subprocess.run(["pdftotext","-f","1","-l","1","-","-"],input=data,stdout=subprocess.PIPE,check=True).stdout.decode("utf-8")
        clean=lambda t:" ".join("".join(c for c in t if unicodedata.category(c)!="Cf").split())
        checks=[title in clean(t) and doc_id in clean(t) for t in (mupdf_text,decoded,poppler)]
        assert all(checks),"Title or report identifier did not survive PDF text extraction"
        details.update(languageTag=True,distinctDownloadName=True,threeReadersAgreed=True)
    return details

result={"scope":"Physical Android upload, analysis and bilingual PDF download attested by the user with original exports and screenshots. Saved JSON, interval arithmetic and exports checked independently over committee HTTPS. Original author labels are unknown. No physical JSON opening was attested.","checkedUTC":datetime.now(timezone.utc).isoformat(),"revisedExport":args.revised,"reports":{}}
if args.reference_fixtures:result["scope"]="Two new ordinary uploads over public HTTPS using the document format control and publisher research paper. Independent JSON word counts and four regenerated PDFs opened in three readers."
if args.private_dir:args.private_dir.mkdir(parents=True,mode=0o700,exist_ok=True)
with httpx.Client(base_url=ORIGIN,timeout=45) as client:
    res=client.post("/api/login",json={"username":"review-panel","password":password});res.raise_for_status()
    try:
        for language, rid in (("ar",args.ar_report),("en",args.en_report)):
            if args.reference_fixtures:
                filename = "research/bench/fixtures/arabic-format-signals.docx" if language=="ar" else "research/similarity/training/pyarabic-published.pdf"
                raw=(Path(__file__).resolve().parents[1]/filename).read_bytes()
                upload=client.post("/api/analyze",content=raw,headers={"content-type":"application/octet-stream","x-index":"no","x-format":filename.rsplit(".",1)[-1]})
                upload.raise_for_status();rid=upload.json()["id"]
            rid=str(rid)
            url="/api/reports/"+rid
            response=client.get(url+"/json");response.raise_for_status()
            saved=response.json()
            assert saved["id"]==rid
            if args.private_dir:
                (args.private_dir/(language+".json")).write_bytes(response.content)
            item=audit(saved);item["pdf"]={}
            for loc in ("ar","en"):
                res=client.get(url+"/pdf",params={"lang":loc});res.raise_for_status()
                item["pdf"][loc]=pdf_check(res.content,rid,loc,res)
                if args.private_dir:
                    (args.private_dir/(language+"-"+loc+".pdf")).write_bytes(res.content)
            result["reports"][language]=item
    finally:
        client.post("/api/logout")
with args.out.open("x") as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
print({lang:(r["matched"],r["eligible"],r["detectorDisplay"],r["cohortCompared"]) for lang,r in result["reports"].items()})
