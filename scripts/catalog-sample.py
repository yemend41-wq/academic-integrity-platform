"""Check exact alternate ISBN editions while retaining the earlier unresolved hardcover."""
import getpass,httpx,json,pathlib,datetime
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
c=httpx.Client(base_url=origin,timeout=45);login=c.post('/api/login',json={'username':'qa-affiliate','password':getpass.getpass('QA credential: ')});login.raise_for_status()
text='ISBN 978-0-306-40615-7.\nISBN 978-1-4899-2174-1.\nISBN 978-1-4899-2176-5.\nISBN 0-306-40615-2.'
r=c.post('/api/analyze',headers={'x-format':'txt','x-index':'no','content-type':'application/octet-stream'},content=text.encode());r.raise_for_status();data=r.json()['citations']
for v in data:print(v['id'],v['status'],v.get('registry'),v.get('title'))
pathlib.Path('evidence/https-isbn-editions.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'id':'https-isbn-editions','title':'Additional ISBN edition probes','titleAr':'اختبارات إضافية لطبعات محددة', 'checks':[{'name':v['id'],'ar':v['id'],'status':'passed' if v['status']=='verified' else 'unverified','detail':v.get('title') or v['status'],'evidence':v} for v in data]},indent=2,ensure_ascii=False))
