"""Verify deployed bilingual pages, aggregate register, active analyzer and authentication boundaries."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json

import httpx
from lxml import html

ORIGIN="https://mizan-integrity-studio.yemend41.chatgpt.site"
p=argparse.ArgumentParser(description=__doc__)
p.add_argument("--version",required=True,type=int);p.add_argument("--source",required=True);p.add_argument("--out",required=True,type=Path)
args=p.parse_args()
register=json.loads(Path("evidence/acceptance-release-5.json").read_text())
expected=register["checks"]
fingerprint=json.loads(Path("evidence/release5-public-load.json").read_text())["analysisFingerprint"]
paths=["/","/acceptance.json","/api/health","/api/retention","/api/me","/api/reports","/lti/config"]+[f"/{page}?lang={locale}" for page in ("health","model-card","acceptance") for locale in ("ar","en")]
def check(path):
    with httpx.Client(base_url=ORIGIN,timeout=35) as client:
        r=client.get(path)
    summary={"path":path,"http":r.status_code}
    try:
        assert r.status_code==(401 if path in ("/api/me","/api/reports") else 200),"unexpected HTTP status"
        if path=="/":assert "/studio.js" in r.text
        elif path=="/acceptance.json":
            data=r.json()
            assert data["id"]==register["id"] and data["model"]==register["model"]
            assert [(c["name"],c["status"],c["verifiedAt"]) for c in data["checks"]]==[(c["name"],c["status"],c["verifiedAt"]) for c in expected]
            assert data["independentStudies"]["confirmation"]["files"]==4400
            summary["statusCounts"]=dict(Counter(c["status"] for c in data["checks"]))
        elif path=="/api/health":
            a=r.json();assert a["analysisFingerprint"]==fingerprint and a["model"]==register["model"] and a["assessment"]==register["id"] and a["database"]=="reachable"
            summary.update(analysisFingerprint=a["analysisFingerprint"],model=a["model"])
        elif path=="/api/retention":
            a=r.json();assert a["lastSuccess"] and a["retentionDays"]==7;summary["retentionDays"]=a["retentionDays"]
        elif path=="/lti/config":
            a=r.json();assert a["initiate_login_uri"]==ORIGIN+"/lti/login" and a["target_link_uri"]==ORIGIN+"/lti/launch";summary["registeredUniversityPlatforms"]=a["registered_platforms"]
        elif "?lang=" in path:
            loc=path[-2:];doc=html.fromstring(r.content.decode("utf-8"))
            assert doc.get("lang")==loc and doc.get("dir")==("rtl" if loc=="ar" else "ltr")
            assert doc.xpath("//main//h1")
            if path.startswith("/acceptance?"):
                rows=doc.xpath("//article[contains(@class,'record')]")
                assert len(rows)==len(expected) and all(c["detailsAr" if loc=="ar" else "detail"] in row.text_content() for c,row in zip(expected,rows))
                assert {f"/model-card?lang={loc}",f"/health?lang={loc}"}.issubset(set(doc.xpath("//a/@href")))
                summary["rows"]=len(rows)
            elif path.startswith("/model-card?"):
                assert len(doc.xpath("//table"))>=5 and "AIP-HL-3" in doc.text_content()
                summary["researchTables"]=len(doc.xpath("//table"))
            else:
                assert len(doc.xpath("//dl/dt"))==4 and ("ناجح" if loc=="ar" else "Succeeded") in doc.text_content()
        summary["status"]="passed"
    except (AssertionError,KeyError,TypeError,ValueError) as exc:
        summary.update(status="failed",error=str(exc) or "unexpected contents")
    return summary
with ThreadPoolExecutor(max_workers=6) as pool:checks=list(pool.map(check,paths))
record={"checkedUTC":datetime.now(timezone.utc).isoformat(),"origin":ORIGIN,"hostingVersion":args.version,"siteSource":args.source,"checks":checks}
with args.out.open("x") as output:output.write(json.dumps(record,indent=2)+"\n")
print([(c["path"],c["status"]) for c in checks]);raise SystemExit(any(c["status"]!="passed" for c in checks))
