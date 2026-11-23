"""Verify the published committee account with non-personal fixtures. Reads its password from stdin."""
import argparse
import getpass
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pypdf import PdfReader

ORIGIN = "https://mizan-integrity-studio.yemend41.chatgpt.site"
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", required=True, type=Path)
parser.add_argument("--model", required=True)
args = parser.parse_args()
password = getpass.getpass("Committee credential: ") if sys.stdin.isatty() else sys.stdin.readline().strip()
now = lambda: datetime.now(timezone.utc).isoformat()
sha = lambda raw: hashlib.sha256(raw).hexdigest()
record = {"scope":"Authenticated public HTTPS with existing committee login. No physical device attestation.", "startedUTC":now(), "origin":ORIGIN, "checks":[]}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def check(name, fn):
    try:
        detail = fn()
        row = {"name":name, "status":"passed", "observation":detail}
    except (ValueError, KeyError, IndexError, httpx.HTTPError) as error:
        row = {"name":name, "status":"failed", "reason":str(error)[:260]}
    record["checks"].append(row)
    print(row["status"], name, flush=True)


with args.out.open("x", encoding="utf-8") as out, httpx.Client(base_url=ORIGIN, timeout=60) as client:
    def login():
        response = client.post("/api/login", json={"username":"review-panel","password":password})
        require(response.status_code==200 and client.get("/api/me").json().get("cohort")=="committee-review", "Committee sign-in failed")
        health = client.get("/api/health").json()
        require(health.get("assessment")=="zz-release-5" and health.get("model")==args.model,"Wrong deployed version")
        record["analysisFingerprint"]=health["analysisFingerprint"]
        return {"http":response.status_code,"model":health["model"],"assessment":health["assessment"]}

    def upload(raw, fmt):
        response = client.post("/api/analyze", headers={"x-index":"no","x-format":fmt,"content-type":"application/octet-stream"},content=raw)
        require(response.status_code==201, "Upload returned HTTP "+str(response.status_code))
        report = response.json()
        stored = client.get("/api/reports/"+report["id"]+"/json")
        require(stored.status_code==200 and stored.json()==report, "Saved report differs")
        return report

    def blind(fmt, filename):
        raw = (ROOT/filename).read_bytes()
        normal = upload(raw,fmt)
        before = client.get("/api/reports").json()
        response = client.post("/api/panel/score",headers={"x-format":fmt,"content-type":"application/octet-stream"},content=raw)
        require(response.status_code==200, "Blind endpoint returned HTTP "+str(response.status_code))
        score = response.json()
        require(set(score)=={"sha256","display","model","eligibleWords","status","analysisFingerprint"}, "Unexpected response fields")
        require(score["sha256"]==sha(raw) and score["analysisFingerprint"]==record["analysisFingerprint"], "Digest mismatch")
        require(all(normal["detector"][key]==score[key] for key in ("display","eligibleWords","status","model")), "Decision differs from ordinary report")
        require(before==client.get("/api/reports").json(), "Private scoring changed the saved report list")
        return {"fixtureSHA256":sha(raw),"normalWords":normal["words"],"scoreStatus":score["status"],"indexed":normal["indexed"],"extraReportSaved":False}

    def pdf_exports():
        raw=(ROOT/"research/bench/fixtures/melville-3000.docx").read_bytes()
        report=upload(raw,"docx")
        detail={}
        for language in ("ar","en"):
            res=client.get("/api/reports/"+report["id"]+"/pdf",params={"lang":language})
            res.raise_for_status()
            reader=PdfReader(io.BytesIO(res.content),strict=True)
            require(report["id"] in "".join(p.extract_text() for p in reader.pages),"Wrong report ID in PDF")
            detail[language]={"pages":len(reader.pages),"sha256":sha(res.content)}
        return {"inputSHA256":sha(raw),"words":report["words"],"pdf":detail,"jsonMatchesStored":True}

    def source():
        raw=(ROOT/"research/similarity/training/pyarabic-published.pdf").read_bytes()
        report=upload(raw,"pdf")
        matches=[m for m in report["similarity"]["matches"] if m["sourceId"]=="pyarabic"]
        require(matches and all(m["sourceEnd"]>m["sourceStart"] and m.get("sourceExcerpt") and report["text"][m["start"]:m["end"]] for m in matches), "Source or offsets missing")
        return {"inputSHA256":sha(raw),"realPaperMatches":len(matches)}

    def filter_source():
        src=(ROOT/"research/similarity/sources.mjs").read_text().partition(" = ")[2].strip().removesuffix(";")
        sources=json.loads(src)
        article=next(item for item in sources if item["id"]=="pyarabic")
        excerpt=next(s for s in article["text"].splitlines() if len(s.split())>=14 and "https" not in s)
        text=excerpt+'\n“'+excerpt+'”\nReferences\n'+excerpt
        report=upload(text.encode(),"txt")
        both=report["similarity"]
        included=client.get("/api/reports/"+report["id"]+"/similarity",params={"quotes":"include","references":"include"})
        included.raise_for_status()
        all_words=included.json()
        require(0<both["eligibleWords"]<all_words["eligibleWords"] and 0<both["matchedWords"]<all_words["matchedWords"],"Filter did not change both counts")
        return {"inputSHA256":sha(text.encode()),"filtered":[both["matchedWords"],both["eligibleWords"]],"included":[all_words["matchedWords"],all_words["eligibleWords"]]}

    def citation():
        raw=b"DOI 10.1038/nature12373. DOI 10.99999/mizan-evaluation-missing-2026. ISBN 978-0-306-40615-7. ISBN 978-0-306-40615-8."
        outcomes={c["id"]:c["status"] for c in upload(raw,"txt")["citations"]}
        require(outcomes.get("10.1038/nature12373")=="verified" and outcomes.get("10.99999/mizan-evaluation-missing-2026") in {"not_found","not_found_in_queried_registries"} and outcomes.get("9780306406157")=="verified" and outcomes.get("9780306406158")=="invalid_checksum", "Registry outcomes: "+json.dumps(outcomes))
        return outcomes

    def forensics():
        raw=(ROOT/"research/bench/fixtures/arabic-format-signals.docx").read_bytes()
        report=upload(raw,"docx")
        require(report["forensics"].get("zeroWidthCharacters",0)>0 and "█" in report["text"],"Mask or zero-width count missing")
        return {"inputSHA256":sha(raw),"zeroWidth":report["forensics"]["zeroWidthCharacters"],"maskPresent":True}

    def provenance():
        raw=(ROOT/"research/media/tests/fixtures/official-CA.jpg").read_bytes()
        report=upload(raw,"jpeg")
        result=report["provenance"]
        require(result.get("signature")=="verified_with_embedded_leaf" and result.get("assetBinding")=="match" and result.get("trust")=="not_evaluated","C2PA signature/binding/trust outcomes")
        return {"inputSHA256":sha(raw),"status":result.get("status"),"signature":result.get("signature"),"trust":result.get("trust")}

    def replay():
        draft=client.get("/api/draft").json()
        require(bool(draft.get("events")),"No existing evaluation draft to check without modification")
        expected=draft["text"]
        frame=""
        for event in draft["events"]:
            frame=frame[:event["start"]]+event["insert"]+frame[event["start"]+event["remove"]:]
        require(frame==expected and any(e["bulk"] for e in draft["events"]),"Replay differs")
        return {"revision":draft["revision"],"edits":len(draft["events"]),"activeMs":draft["activeMs"],"reconstructed":True,"draftChanged":False}

    try:
        check("Committee identity and current live version",login)
        if record["checks"][0]["status"]=="passed":
            for fmt in ("docx","pdf"):
                check("Non-indexed blind "+fmt.upper()+" score matches ordinary report",lambda fmt=fmt:blind(fmt,"research/bench/fixtures/melville-3000."+fmt))
            for name, fn in [("Bilingual PDFs and saved JSON",pdf_exports),("Source and passage in a published paper",source),("Quote and reference denominators",filter_source),("Registry outcomes",citation),("Real DOCX file and redaction",forensics),("Authentic signed JPEG",provenance),("Existing committee revision playback",replay)]:
                check(name,fn)
    finally:
        client.post("/api/logout")
        record["finishedUTC"]=now()
        out.write(json.dumps(record,ensure_ascii=False,indent=2)+"\n")
sys.exit(0 if all(row["status"]=="passed" for row in record["checks"]) else 1)
