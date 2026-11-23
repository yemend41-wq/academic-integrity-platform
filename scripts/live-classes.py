"""Public HTTPS impact test. Provision 50 separate, short-lived learners in an isolated benchmark course."""
import asyncio, httpx, hashlib, os, time, json, getpass, uuid, pathlib, datetime, collections, sys
root=pathlib.Path('research/bench')
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
kind=['docx','pdf']
files=[(root/'fixtures'/('melville-3000.'+ext)).read_bytes() for ext in kind]
words=(root/'source/melville-excerpt.txt').read_text().split()
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
async def run():
 pwd=getpass.getpass('Administrative credential: ');key=uuid.uuid4().hex[:12];clients=[]
 out={'at':utc(),'origin':origin,'testRun':key,'status':'failed','claims':'50 separate authenticated learner sessions; 25 DOCX and 25 PDF. Indexing enabled, with a pre-indexed published text. Upload response includes the report. Readback verifies persistence.','observations':[]}
 async with httpx.AsyncClient(base_url=origin,timeout=45,follow_redirects=False) as admin:
  r=await admin.post('/api/login',json={'username':'registrar','password':pwd});r.raise_for_status()
  gate=asyncio.Semaphore(6)
  async def provision(i):
   async with gate:
    name='load-'+key+'-'+str(i)
    r=await admin.post('/api/members',json={'username':name,'role':'student','testRun':key});r.raise_for_status()
    c=httpx.AsyncClient(base_url=origin,timeout=60,follow_redirects=False);clients.append(c)
    u=await c.post('/api/login',json={'username':name,'password':r.json()['password']});u.raise_for_status();p=u.json()
    assert p['cohort']=='bench-'+key and p['role']=='student'
    return (c,p['id'])
  try:
   users=await asyncio.gather(*(provision(i) for i in range(50)))
   assert len({p for _,p in users})==50
   out['distinctPrincipals']=50
   seed=await users[0][0].post('/api/analyze',headers={'x-format':'txt','x-index':'yes','content-type':'application/octet-stream'},content=' '.join(words[50:350]).encode())
   seed.raise_for_status();out['seedId']=seed.json()['id']
   clock=time.perf_counter();start=asyncio.Event()
   async def one(i,c):
    await start.wait();t=time.perf_counter();e={'index':i,'format':kind[i%2],'fileSHA256':hashlib.sha256(files[i%2]).hexdigest(),'offsetMs':round((t-clock)*1000,2)}
    try:
     r=await c.post('/api/analyze',headers={'x-format':kind[i%2],'x-index':'yes','content-type':'application/octet-stream'},content=files[i%2]);e.update(ms=round((time.perf_counter()-t)*1000,2),http=r.status_code);r.raise_for_status();d=r.json()
     assert d['words']==3000 and d['text'].split()==words and d['detector']['model']=='AIP-HL-3' and isinstance(d['similarity']['matches'],list)
     b=await c.get('/api/reports/'+d['id']);assert b.status_code==200 and b.json()==d
     assert d['indexed'] and d['similarity']['cohortCompared']>=1 and d['similarity']['matchedWords']>=250
     e.update(ok=True,id=d['id'],cohortCompared=d['similarity']['cohortCompared'],throughReadbackMs=round((time.perf_counter()-t)*1000,2))
    except Exception as ex:e.update(ok=False,failure=type(ex).__name__)
    return e
   futures=[asyncio.create_task(one(i,c)) for i,(c,_) in enumerate(users)];await asyncio.sleep(0);start.set()
   obs=await asyncio.gather(*futures);out['observations']=obs;ok=[x for x in obs if x.get('ok')];timings=sorted(x['ms'] for x in ok);out['uniqueReadbacks']=len({x['id'] for x in ok});out['under15s']=len([v for v in timings if v<15000]);out.update(p95Ms=timings[47] if len(timings)>=48 else None,maxMs=max(timings,default=None),status='passed' if out['uniqueReadbacks']==50 else 'failed')
  except Exception as e:out['setupFailure']=str(e)[:220]
  finally:await asyncio.gather(*(c.aclose() for c in clients))
 pathlib.Path(sys.argv[1]).write_text(json.dumps(out,indent=2));print({k:v for k,v in out.items() if k!='observations'})
asyncio.run(run())
