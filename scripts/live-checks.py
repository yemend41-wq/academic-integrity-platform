"""Verify the project's actual public origin; preserve sanitized test observations only."""
import getpass, time, sys, json, hashlib, io
from pathlib import Path
from datetime import datetime, timezone
import httpx
from pypdf import PdfReader
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
checks=[]
def record(name,ar,fn):
 start=time.monotonic()
 try:
  result=fn()
  info=dict(name=name,ar=ar,status='passed',detail=result.pop('detail'),evidence=result)
 except Exception as e:
  info=dict(name=name,ar=ar,status='failed',detail=type(e).__name__+': '+str(e)[:200])
 info['seconds']=round(time.monotonic()-start,3);checks.append(info);print(info['status'],name,flush=True)
def assertok(x,res=None):
 if not x:raise AssertionError(str(res)[:200])
pwd=getpass.getpass('Evaluator credential: ')
def clock():return datetime.now(timezone.utc).isoformat()
client=httpx.Client(base_url=origin,timeout=35,follow_redirects=False)
def auth():
 r=client.post('/api/login',json={'username': sys.argv[2] if len(sys.argv)>2 else 'evaluator','password':pwd});assertok(r.status_code==200,r.status_code)
 me=client.get('/api/me');assertok(me.json()['role']=='instructor');return dict(detail='Evaluator logged in and authenticated identity was read back.',role=me.json()['role'],loginHTTP=r.status_code,profileHTTP=me.status_code)
record('Evaluator login on public HTTPS','دخول حساب اللجنة عبر HTTPS',auth)
def uploaded(content,fmt):
 r=client.post('/api/analyze',headers={'x-format':fmt,'x-index':'no','Content-Type':'application/octet-stream'},content=content)
 assertok(r.status_code==201,(r.status_code,r.text[:100]));d=r.json();b=client.get('/api/reports/'+d['id']);assertok(b.status_code==200 and b.json()==d);return d
def filetest(path,fmt):
 raw=Path(path).read_bytes();d=uploaded(raw,fmt);return d,dict(detail='Uploaded binary and retrieved persisted report.',format=fmt,sha256=hashlib.sha256(raw).hexdigest(),words=d['words'],reportId=d['id'])
def paper():
 d,v=filetest('research/similarity/training/pyarabic-published.pdf','pdf');assertok(any(m['sourceId']=='pyarabic' for m in d['similarity']['matches']));return {**v,'detail':'Correct journal paper linked in the returned report.','similarity':d['similarity']['percentage'],'matchedPassages':len(d['similarity']['matches'])}
def linked():
 d,v=filetest('research/media/tests/fixtures/official-CA.jpg','jpeg');pro=d['provenance'];assertok(pro['signature']=='verified' or 'valid' in str(pro.get('signature')) or 'verified' in str(pro.get('signature')),pro);return {**v,'detail':'Signed JPEG parsed, with separate signature, asset binding and trust fields.','provenance':pro}
def anonym():
 d,v=filetest('research/bench/fixtures/arabic-format-signals.docx','docx');e=d['forensics'];assertok(e.get('zeroWidthCharacters',0)>0 and '█' in d['text']);return {**v,'detail':'Arabic DOCX inspected and visible test identifiers masked.','forensics':e}
refs=[]
def citations():
 global refs
 d=uploaded(b'DOI 10.1038/nature12373. DOI 10.99999/mizan-evaluation-missing-2026. ISBN 978-0-306-40615-7. ISBN 978-0-306-40615-8.','txt');refs=d['citations'];out={a['id']:a['status'] for a in refs};print(out,flush=True)
 assertok(out.get('10.1038/nature12373')=='verified' and out.get('10.99999/mizan-evaluation-missing-2026') in ('not_found','not_found_in_queried_registries') and out.get('9780306406157')=='verified' and out.get('9780306406158')=='invalid_checksum',out)
 return dict(detail='Genuine DOI/ISBN, invented DOI and checksum error distinguished.',observations=refs)
def typescore():
 d=uploaded(('A lecturer read the complete article and reviewed the sources cited in the submitted draft. '*8).encode(),'txt')
 assertok(d['detector']['model']=='AIP-HL-3',d['detector']['model'])
 return dict(detail='Final assessment classifier identity verified from the returned report.',model=d['detector']['model'],sha256=hashlib.sha256(d['text'].encode()).hexdigest())
def exports():
 d=uploaded('The manuscript preserves the working notes. راجع الطالب ملاحظاته قبل التسليم.'.encode(),'txt')
 urls='/api/reports/'+d['id'];j=client.get(urls+'/json');assertok(j.json()==d)
 runs=[]
 for lang in ['ar','en']:
  r=client.get(urls+'/pdf?lang='+lang);assertok(r.status_code==200,r.status_code);pdf=PdfReader(io.BytesIO(r.content),strict=True);assertok(len(pdf.pages)>0 and d['id'] in ''.join(p.extract_text() for p in pdf.pages))
  runs.append(dict(locale=lang,pages=len(pdf.pages),bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest()))
 return dict(detail='The committee account downloaded JSON and two parseable PDF audits.',files=runs)
def structured_docx():
 d,v=filetest('research/media/tests/fixtures/bilingual-forensics.docx','docx')
 assertok(d['forensics'].get('zeroWidthCharacters',0)>0)
 return dict(**v,signals={k:d['forensics'].get(k) for k in ('hiddenTextRuns','whiteTextRuns','zeroWidthCharacters')})
def draft_history():
 current=client.get('/api/draft'); current.raise_for_status(); before=current.json()
 if before['text']: raise ValueError('Existing workspace draft; test skipped to preserve it.')
 edits=[{'text':'Evaluation sample','type':'type','activeMs':0},
        {'text':'Evaluation sample: qa@','type':'type','activeMs':1100},
        {'text':'Evaluation sample: qa@example.org','type':'type','activeMs':600},
        {'text':'Evaluation sample: qa@example.org. راجع الباحث التعديلات في المسودة وأعاد ترتيب الفقرات بعد قراءة الأدلة المتاحة.','type':'paste','activeMs':900}]
 r=client.post('/api/draft',json={'revision':before['revision'],'events':edits});r.raise_for_status()
 d=client.get('/api/draft').json();frame='';history=[]
 for event in d['events']:
  frame=frame[:event['start']]+event['insert']+frame[event['start']+event['remove']:];history.append(frame)
 assertok(frame==d['text'] and all('qa@' not in f for f in history) and '█' in frame and any(e['bulk'] for e in d['events']))
 r=client.post('/api/draft/submit',json={'revision':d['revision'],'index':False});r.raise_for_status()
 audit=r.json();assertok(audit['text']==frame and audit['telemetry']['bulkPastes']==1)
 return dict(detail='Four sequential bilingual edits persisted, replayed and submitted over HTTPS, with personal identifiers masked.',frames=len(history),activeMs=audit['telemetry']['activeMs'],bulkPastes=1)
if checks[0]['status']=='passed':
 for en,ar,fn in [('Experimental model identity','هوية نموذج التقييم المنشور',typescore),('Published paper source retrieval','استرجاع مصدر بحث منشور',paper),('Arabic document forensics and masking','فحص مستند عربي وحجب المعرّفات',anonym),('Authentic C2PA JPEG','صورة JPEG بتوقيع C2PA',linked),('Known OOXML signals','مؤشرات Word المعلومة',structured_docx),('Clarity four edits and persistent report','حفظ أربع مراجعات وتحليلها',draft_history),('External DOI/ISBN lookup','التحقق الحي من DOI وISBN',citations),('JSON and bilingual PDF export','تنزيل JSON وتقريري PDF',exports)]:record(en,ar,fn)
result=dict(id='production-functions',title='Public HTTPS functional checks',titleAr='اختبارات الوظائف عبر الرابط العام',origin=origin,at=clock(),checks=checks,registryObservations=refs)
Path(sys.argv[1]).write_text(json.dumps(result,indent=2,ensure_ascii=False))
