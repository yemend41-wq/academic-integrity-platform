"""Fetch pinned public research inputs to a path OUTSIDE the source checkout."""
import argparse
import base64
import concurrent.futures
import csv
import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EN_REPO = 'rexshijaku/chatgpt-generated-text-detection-corpus'
EN_REF = 'c0eb34cfd5c96cc02f7109a561eb753128cae9e6'

def fetch(repo, ref, file, expected):
    url = f'https://raw.githubusercontent.com/{repo}/{ref}/' + urllib.parse.quote(file)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=45) as response:
                raw = response.read(20_000_001)
            break
        except OSError:
            if attempt==2:
                raise
            time.sleep(2 ** attempt)
    actual = hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if actual!=expected:
        raise ValueError('Unexpected bytes for '+file)
    return raw

def english(pair):
    file,sha=pair
    raw=fetch(EN_REPO,EN_REF,file,sha)
    return file,base64.b64encode(raw).decode('ascii'),sha

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('data_directory',type=Path)
    args=parser.parse_args()
    out=args.data_directory.resolve()
    if out.is_relative_to(HERE.parent.parent):
        parser.error('Keep source corpora outside the software checkout.')
    out.mkdir(parents=True,exist_ok=True)
    for name,source in json.loads((HERE/'sources.json').read_text()).items():
        path=out/name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==source['sha256']:
            continue
        raw=fetch(source['repo'],source['ref'],source['file'],source['blob'])
        if hashlib.sha256(raw).hexdigest()!=source['sha256']:
            raise ValueError(name)
        path.write_bytes(raw)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        files=json.loads((HERE/'english-files.json').read_text())
        with (out/'en.jsonl').open('w') as f:
            for entry in pool.map(english,files.items()):
                print(json.dumps(entry),file=f)
    holdout_sources=json.loads((HERE/'strict-holdout-sources.json').read_text())
    for name,source in holdout_sources.items():
        def holdout_item(pair):
            file,sha=pair
            raw=fetch(source['repo'],source['ref'],file,sha)
            return file,base64.b64encode(raw).decode('ascii'),sha
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool,(out/(name+'.jsonl')).open('w') as f:
            for item in pool.map(holdout_item,source['files'].items()):
                print(json.dumps(item),file=f)
    with (out/'external-ar.csv').open(encoding='utf-8-sig') as inp,(out/'ArabicCorpus.jsonl').open('w') as converted:
        for row in csv.DictReader(inp):
            print(json.dumps({'document':row['text'],'label':row['label'].strip().lower()},ensure_ascii=False), file=converted)

if __name__=='__main__':
    main()
