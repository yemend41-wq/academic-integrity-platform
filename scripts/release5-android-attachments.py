"""Inspect the four original camera-user PDF exports locally. Never publish identifiers or text."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata

import fitz

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("folder",type=Path)
parser.add_argument("--out",type=Path,required=True)
args=parser.parse_args()
groups={}
for path in sorted(args.folder.iterdir()):
    if path.suffix.lower()!=".pdf":continue
    with fitz.open(path) as doc:
        first=doc[0].get_text()
        if "MIZAN\nAcademic integrity audit" not in first and "ةهازنلا" not in first:continue
        docid=re.search(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",first)
        if not docid:continue
        language="en" if first.startswith("MIZAN") else "ar"
        pages=[page.get_text().splitlines() for page in doc]
        # Remove only the page header and final footer, never the document body.
        lines=[line for page in pages for line in page[1:-1]]
        groups.setdefault(docid.group(),{})[language]=(lines,len(doc))
records=[]
for langs in groups.values():
    if set(langs)!={"en","ar"}:continue
    lines,pages=langs["en"]
    def after(label):return lines[lines.index(label)+1]
    eligible,matched=int(after("Eligible words")),int(after("Matched words"))
    shown=float(after("Coverage").removesuffix("%"))
    assert round(100*matched/eligible,1)==shown
    names=[];passages=[];methods=[]
    for i,line in enumerate(lines):
        if re.fullmatch(r"\d+ / source",line):names.append(lines[i+1])
        if re.fullmatch(r"\d+ / method",line):methods.append(lines[i+1])
        if match:=re.fullmatch(r"(\d+) / Submission passage",line):
            end=lines.index(match[1]+" / Source passage",i+1)
            excerpt=" ".join(lines[i+1:end]);inside=False;count=0
            for ch in excerpt:
                family=unicodedata.category(ch)[0]
                if family in ("N","L"):
                    if not inside:count+=1
                    inside=True
                elif family!="M":inside=False
            passages.append(count)
    assert sum(passages)==matched
    split=lines.index("AI writing signals")
    record={"format":after("Format"),"physicalPublicAndroidByOwner":True,"pdfExportsOpened":{"ar":langs["ar"][1],"en":pages},
        "totalWords":int(after("Words")),"eligibleSimilarityWords":eligible,"matchedWords":matched,"overlapPercent":shown,"matchedSourceCount":len(set(names)),
        "matchedCohortSources":len({n for n in names if n.startswith("Submission ")}),"methods":dict(Counter(methods)),"submissionPassageWordCounts":passages,"excludeQuotes":after("Exclude quotes")=="true","excludeReferences":after("Exclude references")=="true",
        "detectorDisplay":lines[lines.index("Display",split)+1],"detectorEligible":int(lines[lines.index("Eligible words",split)+1]),"authorshipLabel":"unknown"}
    records.append(record)
assert len(records)==2 and len({r['totalWords'] for r in records})==2
physical={"verifiedUTC":datetime.now(timezone.utc).isoformat(),"scope":"Two Android uploads and analyses attested by the owner with screenshots and two authentic bilingual PDF export pairs. PDF arithmetic independently recounted. Physical JSON opening and ground-truth authorship were not reported. No identifiers or text retained here.","reports":sorted(records,key=lambda x:x['totalWords'])}
with args.out.open("x",encoding="utf-8") as f:f.write(json.dumps(physical,indent=2)+"\n")
print([(r["matchedWords"],r["eligibleSimilarityWords"],r["submissionPassageWordCounts"]) for r in records])
