"""Create a shareable measurement record, retaining aggregates and source fingerprints only."""
import argparse
import hashlib
import json
from pathlib import Path
from collections import Counter,defaultdict

def subset(value, keys):
    return {k:value[k] for k in keys.split() if k in value}

def aggregate(data):
    if "publicEvidenceFormat" in data: return data
    if "loadSummary" in data or "provisionerRole" in data:
        report=subset(data,"startedUTC finishedUTC status reason requiredModel workload client localWorkerSha256 distinctAuthenticatedStudents indexSeed indexBeforeLoad clientStartSpreadMs singlesSummary loadSummary crossStudentReadbackHttp concurrentBatchThroughFinalReadbackMs")
        report["environment"]="public HTTPS" if not data["origin"].startswith("https://127.") else "isolated local HTTPS"
        report["analysisFingerprint"]=data.get("health",{}).get("service",{}).get("analysisFingerprint")
        report["singles"]=[subset(r,"format inputSha256 uploadToCompleteReportMs verified") for r in data.get("singles",[])]
        if data.get("observations"):
            report["inputsByFormat"]={r["format"]:r["inputSha256"] for r in data["observations"]}
            report["uploadStatusCounts"]=dict(Counter(str(r.get("uploadHttp")) for r in data["observations"]))
        if "distinctWorkload" in data:
            varied=data["distinctWorkload"]
            report["distinctWorkload"]=subset(varied,"startedUTC finishedUTC sourceSHA256 uniqueVerified verifiedUnder15s failed peerReadHTTP p95Ms maxMs status")
            cases=varied["observations"]
            index_sizes=[r["indexObserved"] for r in cases if r.get("verified")]
            report["distinctWorkload"].update(uniqueInputTexts=len({r["textSHA256"] for r in cases}),formats=dict(Counter(r["format"] for r in cases)),
                sourceRangeCompared=[min(index_sizes),max(index_sizes)] if index_sizes else None,
                selectedIndexWindowLimited=sum(bool(r.get("indexWindowLimited")) for r in cases),
                fixtureDigest=hashlib.sha256("\n".join(r["inputSHA256"] for r in cases).encode()).hexdigest())
    elif "raw" in data and "builtBundleSha256" in data:
        report=subset(data,"scope runtime started finished builtBundleSha256")
        report["checks"]=[subset(c,"name status ms") for c in data["checks"]]
    elif "selectionSHA256" in data:
        report=subset(data,"rule lockedAt selectionSHA256 origin files model analysisFingerprint finishedUTC passed strata")
        groups=defaultdict(Counter)
        for c in data["checks"]: groups[c["stratum"]][c["status"]]+=1
        report["groups"]={g:dict(count) for g,count in groups.items()}
    else:
        raise ValueError("Unsupported evidence schema")
    report["publicEvidenceFormat"]=1
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("input",type=Path);p.add_argument("out",type=Path)
    args=p.parse_args()
    with args.out.open("x") as out:
        out.write(json.dumps(aggregate(json.loads(args.input.read_text())),ensure_ascii=False,indent=2)+"\n")
