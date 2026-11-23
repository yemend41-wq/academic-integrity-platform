"""Recover logical fields from a legacy Mizan audit PDF and re-typeset its Arabic export offline."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from pypdf import PdfReader

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
args=parser.parse_args()
if args.output.exists(): sys.exit("Choose a new output filename.")
reader=PdfReader(args.source,strict=True)
sections=[]
current=None
row=None
report_id=created_at=None
for page in reader.pages:
    stream=page.get_contents().get_data()
    for span in re.finditer(rb"/ActualText\s*<FEFF([a-f0-9]+)>\s*>>\s*BDC\s*BT /F ([\d.]+) Tf",stream,re.I):
        value=bytes.fromhex(span[1].decode()).decode("utf-16-be")
        size=float(span[2])
        if size==10 and value.startswith("معرّف المراجعة · "):report_id=value.split(" · ",1)[1]
        if size==10 and value.startswith("وقت التحليل · "):created_at=value.split(" · ",1)[1]
        if size==14:
            current={"title":value,"rows":[]}
            sections.append(current);row=None
        elif current is not None and size==9.5:
            # The legacy exporter wraps longer field labels before writing their first value.
            if row is not None and not row["values"]:row["label"]+=" "+value
            else:
                row={"label":value,"values":[]};current["rows"].append(row)
        elif row is not None and size==11:
            row["values"].append(value)
if not report_id or not created_at or len(sections)<6:
    raise ValueError("Not an original Arabic Mizan audit export")
for section in sections:
    for line in section["rows"]:
        line["value"]="\n".join(line.pop("values"))
original=[(s["title"],r["label"],r["value"]) for s in sections for r in s["rows"]]
assert any(value==report_id for _,_,value in original)
writing=next(s for s in sections if "مؤشرات الكتابة" in s["title"])
display=next(r["value"] for r in writing["rows"] if r["label"]=="المؤشر")
data={"locale":"ar","id":report_id,"createdAt":created_at,"sections":sections,"display":display}
# Only unchanged, user-supplied local fields cross this in-process pipe.
js="""import {readFileSync,writeFileSync} from 'node:fs';
import {createAuditPdf} from './research/export/audit.mjs';
import {writingExplanation} from './ui/report-interpretation.mjs';
const data=JSON.parse(readFileSync(0,'utf8'));
const row=data.sections.find(s=>s.title.includes('مؤشرات الكتابة'));
row.rows.push({label:'تفسير المؤشر',value:writingExplanation({status:data.display==='*%'?'suppressed':'analyzed',display:data.display},true)});
writeFileSync(process.argv[1],createAuditPdf(data),{flag:'wx',mode:0o600});"""
subprocess.run(["node","--input-type=module","-e",js,str(args.output.resolve())],cwd=Path(__file__).resolve().parents[1],input=json.dumps(data),text=True,check=True)
new=PdfReader(args.output,strict=True)
tree=new.trailer['/Root']['/StructTreeRoot']
logical=[str(node.get_object().get('/ActualText') or node.get_object().get('/Alt') or '') for part in tree['/K'] for node in part.get_object()['/K']]
assert new.trailer['/Root'].get('/Lang')=="ar"
assert report_id in "\n".join(p.extract_text() for p in new.pages)
def content_line(line):
    if line in ("ميزان","تقرير تدقيق النزاهة الأكاديمية"):return False
    return not re.fullmatch(r"صفحة [0-9]+ من [0-9]+",line)
# Rewrapping can divide a field across page footers or a long identifier across lines.
# Compare content characters in the reconstructed logical reading order.
normalize=lambda t:"".join(t.split())
joined=normalize("".join(line for line in logical if content_line(line)))
position=0
for _,label,value in original:
    for field in (label,value):
        token=normalize(field)
        if not token:continue
        position=joined.find(token,position)
        if position<0:raise ValueError("Reflow changed a logical field of length "+str(len(token)))
        position+=len(token)
print(json.dumps({"originalFields":len(original),"pages":len(new.pages),"originalFieldsPreserved":True,"maskedIndicatorPreserved":display=="*%"}))
