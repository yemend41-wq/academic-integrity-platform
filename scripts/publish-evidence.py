"""Send verified results to the protected register without putting credentials in source."""
import json, getpass, pathlib, sys, httpx
path=pathlib.Path
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
def read(p):return json.loads(path(p).read_text())
mode=sys.argv[1]
if mode=='load':
 a=read('evidence/https-load-2.json');dc,pdf,load=a['batches'];ms=[d['observations'][0]['analyze_ms'] for d in [dc,pdf]];ids=load['verified_unique_reports']
 checks=[dict(name='One 3,000-word DOCX and one PDF',ar='رفع ملف Word وملف PDF من ٣ آلاف كلمة',status='passed' if dc['all_uploads_under_15s'] and pdf['all_uploads_under_15s'] else 'failed',detail=f'DOCX {ms[0]/1000:.2f} s; PDF {ms[1]/1000:.2f} s. Readback verified.',detailsAr=f'زمن Word بلغ {ms[0]/1000:.2f} ثانية وزمن PDF بلغ {ms[1]/1000:.2f} ثانية، مع قراءة التقريرين بعد الحفظ.',evidence=[dc,pdf]),dict(name='50 simultaneous HTTPS uploads from one authenticated account',ar='خمسون عملية رفع متزامنة من حساب موثق واحد',status='passed' if ids==50 else 'failed',detail=f'{ids}/50 persisted; p95 {load["p95_analyze_ms"]/1000:.2f} s.',detailsAr=f'أعيدت قراءة {ids} تقريرًا مستقلًا. بلغ المئين ٩٥ نحو {load["p95_analyze_ms"]/1000:.2f} ثانية.',evidence=load)]
 data=dict(id='https-load',title='Public HTTPS performance',titleAr='أداء الرابط العام',at=a['finished_utc'],checks=checks)
elif mode=='classes':
 a=read('evidence/https-50-students.json');n=a.get('uniqueReadbacks',0);v=a.get('under15s',0)
 data=dict(id='https-users',title='50 authenticated students',titleAr='خمسون حساب طالب مستقلًا',checks=[dict(name='50-account load with cohort indexing',ar='رفع متزامن من خمسين حسابًا مع الفهرسة',status=a['status'],detail=f'{n}/50 persisted. {v}/50 completed the upload response below 15 s.',detailsAr=f'حُفظ واستُرجع {n} من ٥٠ تقريرًا، واكتمل تحليل {v} منها في أقل من ١٥ ثانية.',evidence=a)])
else:data=read(sys.argv[1])
client=httpx.Client(base_url=origin,timeout=35);client.post('/api/login',json={'username':'registrar','password':getpass.getpass('Admin credential: ')}).raise_for_status()
r=client.post('/api/evidence',json=data);r.raise_for_status();b=client.get('/api/health/details');b.raise_for_status()
assert any(x['id']==data['id'] and x['checks']==data['checks'] for x in b.json()['runs']);print('Stored and verified:',data['id'])
