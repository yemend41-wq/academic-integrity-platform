"""A second load batch with 50 nonoverlapping public-domain 3,000-word passages."""
import asyncio
import hashlib
import io
import json
import math
import re
import time
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from docx import Document
from pypdf import PdfReader
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate
from reportlab.lib.pagesizes import A4
from reportlab import rl_config

SOURCE = "baf9b04fcf6e0008f30eaaa6697277751448c1070b20175e0082f28cbb161fd3"
def digest(data):
    return hashlib.sha256(data).hexdigest()


def fixtures(path):
    raw = path.read_bytes()
    if digest(raw) != SOURCE: raise ValueError("The public-domain source does not match its pinned revision")
    book=raw.decode("utf-8-sig").split("Call me Ishmael. Some years",1)[1]
    text=unicodedata.normalize("NFKD",book).encode("ascii","ignore").decode()
    words=[word+punct for word,punct in re.findall(r"([A-Za-z]+)([.!?]*)",text)]
    rl_config.invariant=1
    cases=[]
    for i in range(50):
        # Leave the original single-document benchmark excerpt outside this batch.
        tokens=words[(i+2)*3000:(i+3)*3000]
        if len(tokens)!=3000: raise ValueError("Insufficient source text")
        lines=[" ".join(tokens[k:k+90]) for k in range(0,3000,90)]
        buf=io.BytesIO()
        if i%2==0:
            fmt="docx"
            doc=Document()
            for line in lines: doc.add_paragraph(line)
            doc.save(buf)
            # Repack with deterministic ZIP timestamps.
            out=io.BytesIO()
            with zipfile.ZipFile(buf) as zin, zipfile.ZipFile(out,"w") as zout:
                for name in zin.namelist():
                    entry=zipfile.ZipInfo(name,(2000,1,1,0,0,0))
                    zout.writestr(entry,zin.read(name),compress_type=zipfile.ZIP_DEFLATED)
            raw=out.getvalue()
            parsed=" ".join(p.text for p in Document(io.BytesIO(raw)).paragraphs)
        else:
            fmt="pdf"
            style=ParagraphStyle("text",fontName="Helvetica",fontSize=11,leading=15,splitLongWords=0,spaceAfter=6)
            SimpleDocTemplate(buf,pagesize=A4,invariant=1).build([Paragraph(escape(line),style) for line in lines])
            raw=buf.getvalue()
            parsed=" ".join(p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages)
        if parsed.split()!=tokens: raise ValueError(f"Extraction mismatch in input {i+1}")
        cases.append((fmt,raw,digest(" ".join(tokens).encode())))
    if len({r[2] for r in cases})!=50: raise ValueError("Duplicate text")
    return cases


async def run(clients, cases, model):
    started=datetime.now(timezone.utc).isoformat()
    gate=asyncio.Event()
    launch=time.perf_counter()
    async def upload(i,client,case):
        await gate.wait()
        start=time.perf_counter()
        fmt,raw,text_hash=case
        result={"position":i+1,"format":fmt,"inputSHA256":digest(raw),"textSHA256":text_hash,"startOffsetMs":round(1000*(start-launch),2),"verified":False}
        try:
            response=await client.post("/api/analyze",headers={"content-type":"application/octet-stream","x-format":fmt,"x-index":"yes"},content=raw)
            result.update(http=response.status_code,ms=round(1000*(time.perf_counter()-start),2))
            response.raise_for_status()
            r=response.json()
            saved=await client.get("/api/reports/"+r["id"])
            ok=(response.status_code==201 and r["words"]==3000 and r["indexed"] and r["detector"]["model"]==model and
                digest(" ".join(r["text"].split()).encode())==text_hash and saved.status_code==200 and saved.json()==r)
            result.update(verified=ok,id=r["id"],indexObserved=r["similarity"]["cohortCompared"],indexWindowLimited=r["similarity"]["cohortWindowLimited"],readbackHttp=saved.status_code)
        except Exception as error:
            result["reason"]=type(error).__name__
        return result
    tasks=[asyncio.create_task(upload(i,c,case)) for i,(c,case) in enumerate(zip(clients,cases,strict=True))]
    await asyncio.sleep(0)
    launch=time.perf_counter(); gate.set()
    observations=await asyncio.gather(*tasks)
    async def peer(i,c):
        other=observations[(i+1)%len(observations)]
        if not other["verified"]: return "not_run"
        try: return str((await c.get("/api/reports/"+other["id"])).status_code)
        except Exception as error: return type(error).__name__
    peers=Counter(await asyncio.gather(*(peer(i,c) for i,c in enumerate(clients))))
    ms=sorted(r["ms"] for r in observations if r["verified"])
    verified=len({r["id"] for r in observations if r["verified"]})
    fast=sum(v<15000 for v in ms)
    return {"startedUTC":started,"finishedUTC":datetime.now(timezone.utc).isoformat(),"sourceSHA256":SOURCE,
        "uniqueVerified":verified,"verifiedUnder15s":fast,"failed":50-verified,"peerReadHTTP":dict(peers),
        "p95Ms":ms[math.ceil(len(ms)*0.95)-1] if ms else None,"maxMs":max(ms,default=None),
        "status":"passed" if verified==fast==peers["404"]==50 else "failed","observations":observations}
