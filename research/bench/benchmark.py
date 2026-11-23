"""HTTP integration benchmark for this project. No retries or automatic credential forwarding."""
import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx

ROOT = Path(__file__).resolve().parent
PRODUCTION = 'https://mizan-integrity-studio.yemend41.chatgpt.site'
FIXTURES = json.loads((ROOT/'fixtures'/'manifest.json').read_text())['files']
INPUTS = [item for item in FIXTURES if item.get('words') == 3000]
WORD_SOURCE = (ROOT/'source'/'melville-excerpt.txt').read_text().split()
SHA = lambda data: hashlib.sha256(data).hexdigest()


def origin_allowed(origin):
    url = urlsplit(origin)
    return (origin == PRODUCTION or
            (url.scheme in {'http','https'} and url.hostname in {'localhost','127.0.0.1','::1'}
             and not (url.username or url.password or url.query or url.fragment or url.path)
             and url.port is not None))


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def elapsed(start):
    return round((time.perf_counter()-start)*1000, 2)


def report_valid(data, expected, report_id=None):
    if not isinstance(data, dict):
        return False
    if not isinstance(data.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', data['id']):
        return False
    if report_id is not None and data['id'] != report_id:
        return False
    if data.get('words') != expected['words']:
        return False
    if not isinstance(data.get('detector'), dict) or not isinstance(data.get('similarity'),dict):
        return False
    if 'text' in data and (not isinstance(data['text'],str) or data['text'].split() != WORD_SOURCE):
        return False
    return True


async def one_upload(client, origin, index, item, raw, event, epoch):
    await event.wait()
    start = time.perf_counter()
    record = {'sequence':index,'file':item['file'],'sha256':item['sha256'],
              'start_offset_ms':round((start-epoch)*1000,2),'started_utc':now(),'verified':False}
    try:
        response = await client.post('/api/analyze',content=raw,headers={
            'Origin':origin,'Content-Type':'application/octet-stream','x-index':'no','x-format':item['format']})
        record.update(analyze_ms=elapsed(start),analyze_http=response.status_code,
                      response_bytes=len(response.content),response_sha256=SHA(response.content))
        if not response.is_success:
            record['failure']='upload_http'
            return record
        body=response.json()
        valid=report_valid(body,item)
        record.update(words=body.get('words') if isinstance(body,dict) else None,analyze_verified=valid)
        if not valid:
            record['failure']='analysis_shape_word_count_or_extracted_text'
            return record
        rid=body['id']
        record['report_id']=rid
        get=await client.get('/api/reports/'+quote(rid,safe=''))
        record.update(readback_http=get.status_code,readback_sha256=SHA(get.content))
        if not get.is_success:
            record['failure']='readback_http'
            return record
        persisted=get.json()
        record['verified']=report_valid(persisted,item,rid) and persisted['similarity']==body['similarity'] and persisted['detector']==body['detector']
        if not record['verified']:
            record['failure']='readback_content_mismatch'
        return record
    except (ValueError, KeyError, TypeError, httpx.HTTPError) as exc:
        record['failure']=type(exc).__name__
        return record
    finally:
        record['through_readback_ms']=elapsed(start)
        record['finished_utc']=now()


async def batch(client, origin, n, files, label):
    event=asyncio.Event()
    epoch=time.perf_counter()
    jobs=[asyncio.create_task(one_upload(client,origin,i+1,INPUTS[i%len(INPUTS)],files[i%len(files)],event,epoch))
          for i in range(n)]
    await asyncio.sleep(0)
    event.set()
    records=await asyncio.gather(*jobs)
    latencies=sorted(r['analyze_ms'] for r in records if r['verified'])
    ids=[r['report_id'] for r in records if r['verified']]
    passed=len(ids)==n and len(set(ids))==n
    summary={'name':label,'concurrent_uploads_requested':n,'authenticated_accounts':1,
             'verified_unique_reports':len(set(ids)),'all_unique_and_readable':passed,
             'wall_ms':elapsed(epoch),
             'max_submission_start_spread_ms':max(r['start_offset_ms'] for r in records)-min(r['start_offset_ms'] for r in records)}
    if latencies:
        summary.update(min_analyze_ms=latencies[0],p50_analyze_ms=latencies[math.ceil(.5*len(latencies))-1],
                       p95_analyze_ms=latencies[math.ceil(.95*len(latencies))-1],max_analyze_ms=latencies[-1])
    summary['all_uploads_under_15s']=passed and all(r['analyze_ms']<15000 for r in records)
    summary['observations']=records
    return summary


async def run(origin, mode, password, local_ca=None):
    files=[(ROOT/'fixtures'/f['file']).read_bytes() for f in INPUTS]
    if not all(SHA(raw)==item['sha256'] for item,raw in zip(INPUTS,files)):
        raise ValueError('Fixture digest mismatch')
    data={'version':1,'origin':origin,'started_utc':now(),'requested_mode':mode,'header_index':'no','batches':[],
          'scope':'One authenticated committee account; concurrent HTTP requests, direct API, body bytes plus durable readback; no browser timing, distinct-user load or blind accuracy claim.'}
    import ssl
    tls=ssl.create_default_context(cafile=str(local_ca)) if local_ca else True
    async with httpx.AsyncClient(base_url=origin,follow_redirects=False,verify=tls,
                                 limits=httpx.Limits(max_connections=55,max_keepalive_connections=55),
                                 timeout=httpx.Timeout(90,connect=15),trust_env=(origin==PRODUCTION)) as client:
        try:
            login=await client.post('/api/login',headers={'Origin':origin},json={
                'username':os.environ.get('MIZAN_USER','evaluator'),'password':password})
            data['login_http']=login.status_code
            if not login.is_success or not client.cookies:
                data['failure']='no_authenticated_session'
                return data
            # One request per format proves health before issuing the specified 50-upload cohort.
            for item,raw in zip(INPUTS,files):
                event=asyncio.Event()
                event.set()
                observation=await one_upload(client,origin,1,item,raw,event,time.perf_counter())
                data['batches'].append({'name':'single_'+item['format'],'observations':[observation],
                                        'all_uploads_under_15s':observation['verified'] and observation['analyze_ms']<15000})
                if not observation['verified']:
                    data['failure']='initial_single_upload_failed'
                    return data
            if mode=='load':
                data['batches'].append(await batch(client,origin,50,files,'mixed_docx_pdf_50'))
            return data
        except (httpx.HTTPError,ValueError) as exc:
            data['failure']=type(exc).__name__
            return data
        finally:
            data['finished_utc']=now()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin',required=True)
    parser.add_argument('--local-ca',type=Path,help='Trust a local QA CA for a loopback HTTPS run')
    parser.add_argument('--mode',choices=['smoke','load'],default='smoke')
    parser.add_argument('--out',required=True,type=Path)
    opt=parser.parse_args()
    if not origin_allowed(opt.origin):
        parser.error('Allowed origins are this project’s exact production origin or an explicitly ported loopback service')
    if opt.local_ca and not (urlsplit(opt.origin).hostname in {'localhost','127.0.0.1','::1'} and opt.origin.startswith('https:')):
        parser.error('--local-ca is valid only for local HTTPS runs')
    password=os.environ.get('MIZAN_PASSWORD')
    if not password:
        parser.error('Supply MIZAN_PASSWORD privately in the environment')
    # Exclusive creation keeps every prior measured run intact.
    with opt.out.open('x',encoding='utf-8') as out:
        result=asyncio.run(run(opt.origin,opt.mode,password,opt.local_ca))
        json.dump(result,out,indent=2,ensure_ascii=False)
        out.write('\n')
    print(json.dumps({'observations_file':str(opt.out),'batches':[{k:v for k,v in row.items() if k!='observations'} for row in result['batches']],'failure':result.get('failure')}))
    return 0 if result['batches'] and not result.get('failure') and all(r['all_uploads_under_15s'] for r in result['batches']) else 1


if __name__=='__main__':
    sys.exit(main())
