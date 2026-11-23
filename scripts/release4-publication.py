import argparse, concurrent.futures, datetime, hashlib,json
from pathlib import Path
import httpx
from lxml import html as markup
origin='https://mizan-integrity-studio.yemend41.chatgpt.site'
parser=argparse.ArgumentParser()
parser.add_argument('--version',type=int,required=True)
parser.add_argument('--site-source',required=True)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
expected_register=json.loads(Path('evidence/acceptance-release-4.json').read_text())
with httpx.Client(base_url=origin,timeout=30) as c:
 def get(path):
  res=c.get(path);return res.status_code,res
 endpoints=['/','/api/health','/acceptance?lang=ar','/acceptance?lang=en','/api/retention','/api/me','/api/reports','/lti/config']
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex: results=dict(zip(endpoints,ex.map(get,endpoints)))
 checks=[]
 for path,(status,res) in results.items():
  expected=401 if path in ('/api/reports','/api/me') else 200
  detail={}; ok=status==expected
  if path=='/api/health':
   detail=res.json();ok=ok and detail.get('assessment')=='zz-release-4' and detail.get('database')=='reachable' and detail.get('model')=='AIP-HL-3'
  elif path.startswith('/acceptance'):
   html=markup.fromstring(res.content.decode('utf-8'));locale=path[-2:];rows=html.xpath('//main//article')
   detail={'lang':html.get('lang'),'heading':html.xpath('//h1')[0].text_content(),'acceptanceRows':len(rows),'cohortRows':len(html.xpath('(//section[contains(@class,"study-panel")]//table)[1]/tbody/tr')),'hasEvaluationLogin':bool(html.xpath('//a[@href="/#acceptance"]'))}
   for node,check in zip(rows,expected_register['checks']):
    label=check['ar'] if locale=='ar' else check['name']
    detail_text=check['detailsAr'] if locale=='ar' else check['detail']
    ok=ok and label in node.text_content() and detail_text in node.text_content()
   ok=ok and locale==detail['lang'] and len(rows)==len(expected_register['checks']) and detail['cohortRows']==35 and detail['hasEvaluationLogin']
  elif path=='/api/retention':
   detail=res.json();ok=ok and detail.get('retentionDays')==7 and bool(detail.get('lastSuccess'))
  elif path=='/lti/config':
   detail={'format':res.headers.get('content-type'),'fields':list(res.json())[:15]};ok=ok and bool(detail['fields'])
  elif path=='/':
   ok=ok and '/studio.js' in res.text
  checks.append(dict(path=path,http=status,status='passed' if ok else 'failed',responseSHA256=hashlib.sha256(res.content).hexdigest(),detail=detail))
print([(x['path'],x['http'],x['status']) for x in checks])
d=dict(checkedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),origin=origin,siteSource=args.site_source,version=args.version,scope='Public endpoints and bilingual register contents. Separate records document the authenticated load and committee tests.',checks=checks)
with args.out.open('x',encoding='utf-8') as f: f.write(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
assert all(x['status']=='passed' for x in checks)
