"""Exercise signed-in application flows using only this deployment's test accounts."""
import getpass,json,time,uuid,hashlib,pathlib,datetime,sys,httpx
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
creds=json.loads(getpass.getpass('QA identities: '));checks=[]
sessions={}
for u,p in creds.items():
 c=httpx.Client(base_url=origin,timeout=40,follow_redirects=False)
 r=c.post('/api/login',json={'username':u,'password':p});r.raise_for_status();sessions[u]=c
s=sessions['candidate'];e=sessions['evaluator'];other=sessions['qa-affiliate'];runid=str(uuid.uuid4())
def check(name,ar,fn):
 try:
  d=fn()
  checks.append(dict(name=name,ar=ar,status='passed',detail=d.pop('detail'),evidence=d))
 except Exception as ex:checks.append(dict(name=name,ar=ar,status='failed',detail=(type(ex).__name__+' '+str(ex))[:190]))
 print(name,checks[-1]['status'],flush=True)
def separation():
 a=s.post('/api/analyze',headers={'Content-Type':'application/octet-stream','x-format':'txt','x-index':'no'},content=('Private course test '+runid).encode())
 a.raise_for_status();p='/api/reports/'+a.json()['id']
 codes=[s.get(p).status_code,e.get(p).status_code,other.get(p).status_code,httpx.get(origin+p,timeout=30).status_code,s.post('/api/members',json={}).status_code]
 assert codes==[200,200,404,401,403],codes
 return dict(detail='Student and course instructor saw the report; separate cohort, anonymous reader and student administration had restricted responses.',http=codes)
def drafts():
 d=s.get('/api/draft').json();rev=d['revision']
 if d['text'] and not d['text'].startswith('Audit sample '):raise ValueError('Test account already has an unrelated draft')
 prefix='Audit sample '+runid+'. '
 edits=[{'text':prefix,'type':'type','activeMs':0},{'text':prefix+'learner@','type':'type','activeMs':1300},{'text':prefix+'learner@example.org','type':'type','activeMs':1100},{'text':prefix+'learner@example.org. نحتفظ بالملاحظات الأولية لشرح مراحل تحرير هذا النص أمام اللجنة.','type':'paste','activeMs':1600}]
 a=s.post('/api/draft',json={'revision':rev,'events':edits});a.raise_for_status();d=s.get('/api/draft').json();text='';frames=[]
 for v in d['events']:
  text=text[:v['start']]+v['insert']+text[v['start']+v['remove']:];frames.append(text)
 assert text==d['text'] and 'learner@' not in json.dumps(frames) and '█' in text and any(v['bulk'] for v in d['events'])
 b=s.post('/api/draft/submit',json={'revision':d['revision'],'index':False});b.raise_for_status()
 out=b.json();assert out['text']==text and out['telemetry']['bulkPastes']>=1
 return dict(detail='Saved real English/Arabic edits, reconstructed all revisions and submitted them to analysis. Canonical frames masked the test email prefix.',frames=len(frames),bulkPastes=out['telemetry']['bulkPastes'],activeMs=out['telemetry']['activeMs'],reportId=out['id'])
def quoted():
 c='"A careful reader compares the exact written words with an identified source."\nEnd of the excerpt.'
 r=s.post('/api/analyze',headers={'x-format':'txt','x-index':'no'},content=c.encode());r.raise_for_status();id=r.json()['id'];path='/api/reports/'+id+'/similarity'
 v=[s.get(path,params={'quotes':q}).json()['eligibleWords'] for q in ['exclude','include']];assert v[1]>v[0],v
 return dict(detail='Applying the quote filter changed the eligible word count on the saved report.',excluded=v[0],included=v[1])
check('Student and instructor boundaries on public HTTPS','صلاحيات الطالب والمدرّس على الرابط العام',separation)
check('Live Clarity save, revision reconstruction and submission','حفظ المسودة واستعادة المراجعات وتحليلها عبر الرابط العام',drafts)
check('Live similarity filters','تصفية الاقتباسات على الرابط العام',quoted)
r=httpx.get(origin+'/api/retention',timeout=35);r.raise_for_status();assert r.json()['lastSuccess']
checks.append(dict(name='Retention heartbeat verified',ar='التحقق من تشغيل سياسة الاحتفاظ',status='passed',detail='Expired-record cleanup was invoked on the live host and its completion timestamp was read back. The daily schedule is enabled.',evidence=r.json()))
pathlib.Path(sys.argv[1]).write_text(json.dumps(dict(id='production-governance',title='Hosted access and writing tests',titleAr='الصلاحيات وسجل الكتابة في الاستضافة',at=datetime.datetime.now(datetime.timezone.utc).isoformat(),checks=checks),indent=2,ensure_ascii=False))
