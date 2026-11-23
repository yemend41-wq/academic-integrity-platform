"""Prepare the registered development groups after exact and near-overlap exclusion."""
import argparse
import csv
import hashlib
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path
import re
import duckdb

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('overlap_study',HERE.parent/'release4-prepare.py')
old=importlib.util.module_from_spec(s);s.loader.exec_module(old)
PROTOCOL="570e533467d171a78ad789bb38378779e8471e593d44226b8f6886b8b79eb3b8"

def sha(b):return hashlib.sha256(b).hexdigest()
def lines(p):
    with p.open(encoding='utf-8') as f:
        for x in f:
            if x.strip():yield json.loads(x)
def write(p,rows):
    with p.open('w',encoding='utf-8') as f:
        for r in rows:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
def lang(text):
    ar=len(re.findall(r'[\u0620-\u064a]',text));en=len(re.findall('[A-Za-z]',text))
    return 'ar' if ar>en else 'en'

def archived(raw,author,mixed,confirm):
    for name in ('corpus.jsonl','arabic-challenger.jsonl'):
        for r in lines(raw/name):
            if r['split']=='test':yield r['lang'],r['text']
    for r in lines(raw/'release4/frozen.jsonl'):yield r['lang'],r['text']
    for r in lines(raw/'strict-holdout.jsonl'):yield r['lang'],r['text']
    for r in lines(raw/'academic-ar.jsonl'):
        for k in ('original_abstract','generated_abstract'):
            if r.get(k):yield 'ar',r[k]
    for r in lines(raw/'ArabicCorpus.jsonl'):yield 'ar',r['document']
    for name in ('apt-human-polished.json','apt-ai.json'):
        for r in json.loads((raw/name).read_text()):
            for k in ('original','Polish_text'):
                if r.get(k):yield 'ar',r[k]
    for name in ('test.jsonl','esl.jsonl'):
        for r in lines(raw/name):yield 'en',r['text']
    for name in sorted(raw.glob('*.json')):
        if name.name.startswith(('CS224N_','TOEFL_','HewlettStudentEssay_','CollegeEssay_')):
            for r in json.loads(name.read_text()):yield 'en',r['document']
    for r in lines(author):yield lang(r['text']),r['text']
    for r in lines(mixed):
        for k in ['human','machine','original','qwen','gemma']:
            if r.get(k):yield r['language'],r[k]
    for r in lines(confirm):yield r['language'],r['text']
    for r in lines(raw/'roundtrip.jsonl'):
        yield lang(r['text']),r['text']

def main(args):
    raw=args.raw;out=args.work
    if sha((HERE/'protocol.json').read_bytes())!=PROTOCOL:raise ValueError("Changed protocol")
    d=defaultdict(dict)
    def put(language,source,partition,group,label,text):
        if not isinstance(text,str) or not text.strip():return
        entry=dict(text=text.strip(),label=label,lang=language,publisher=source,partition=partition,group=group)
        d[(language,source,partition,str(group))][(label,sha(entry['text'].encode()))]=entry
    for r in lines(raw/'corpus.jsonl'):
        if r['split'] in ('train','validation'):
            put(r['lang'],'AIRABIC' if r['lang']=='ar' else 'Shijaku','calibration',r['group'],r['label'],r['text'])
    for r in lines(raw/'arabic-challenger.jsonl'):
        if r['lang']=='ar' and r['id'].startswith('wiki-') and r['split']=='train':
            put('ar','ARCD','train',r['group'],r['label'],r['text'])
    for file in (raw/'hl5-title.jsonl',out/'allam-title.jsonl'):
        for r in lines(file):
            if r.get('original_abstract') and r.get('generated_abstract'):
                group=sha(' '.join(old.tokens(r['original_abstract'])).encode())
                for label,k in enumerate(['original_abstract','generated_abstract']):
                    put('ar','KFUPM','train',group,label,r[k])
    for r in lines(raw/'calib.jsonl'):
        source='RAID' if r['source']=='raid' else 'MAGE' if r['source'].startswith('mage') else None
        if source:put('en',source,'train',r.get('group') or sha(r['text'].encode()),r['label'],r['text'])
    prompts=set()
    for file in (raw/'hl5-ood.csv',raw/'argugpt-ai.csv',out/'argugpt-native-dev.csv'):
        with file.open(encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                prompts.update([r['prompt_id'],' '.join(old.tokens(r['prompt']))])
    with (out/'argugpt-native-train.csv').open(encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            if r['prompt_id'] in prompts or ' '.join(old.tokens(r['prompt'])) in prompts:continue
            put('en','ArguGPT','train',r['prompt_id'],1,r['text'])
    con=duckdb.connect()
    for text,label,filename in con.execute("SELECT text,label,filename FROM read_parquet(?) WHERE label IN (0,1,6)",[str(out/'ghost-train.parquet')]).fetchall():
        put('en','Ghostbuster','train',filename,int(label!=6),text)
    selected=[]; exclusions=Counter();checked={}
    hist={k:[] for k in ('ar','en')}
    for l,t in archived(raw,args.author,args.mixed,args.confirm):hist[l].append(t)
    for language in ('ar','en'):
        hist_idx=old.Overlap();cal_idx=old.Overlap();seen=set()
        for t in hist[language]:
            hist_idx.add(hist_idx.imprint(t))
        checked[language]=hist_idx.size
        for (l,source,split,group),records in sorted(d.items(),key=lambda x:(x[0][2]!='calibration',x[0])):
            if l!=language:continue
            rows=list(records.values())
            # Pair/topic memberships are indivisible. Shared authors across entire publishers
            # are generally unknown; a group is not assumed to identify a person.
            fingerprints=[hist_idx.imprint(x['text']) for x in rows]
            if any(hist_idx.conflicts(fp) for fp in fingerprints):
                exclusions[f'{l}/{source}/archivedOverlap']+=len(rows);continue
            if split=='train' and any(cal_idx.conflicts(fp) for fp in fingerprints):
                exclusions[f'{l}/{source}/calibrationOverlap']+=len(rows);continue
            for entry,fp in zip(rows,fingerprints):
                if fp[0] in seen:
                    exclusions[f'{l}/{source}/duplicate']+=1;continue
                if split=='calibration':cal_idx.add(fp)
                selected.append(entry);seen.add(fp[0])
    if len({r["publisher"] for r in selected if r['partition']=='train'}&{r["publisher"] for r in selected if r['partition']=='calibration'}):raise RuntimeError("cross-source overlap")
    write(out/'development.jsonl',selected)
    meta=dict(protocolSha256=PROTOCOL,developmentSha256=sha((out/'development.jsonl').read_bytes()),
              heldOutInputsSha256={p.name:sha(p.read_bytes()) for p in (args.author,args.mixed,args.confirm)},
              archivedUniqueNormalized=checked,excludedBeforeFitting=dict(exclusions),
              freshInputMetadata=json.loads((out/'raw.json').read_text()),
              counts=dict(sorted(Counter(f'{r["partition"]}/{r["lang"]}/{r["publisher"]}/{r["label"]}' for r in selected).items())))
    (out/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({k:meta[k] for k in ('counts','excludedBeforeFitting','developmentSha256')}))

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for k in ['raw','work','author','mixed','confirm']:a.add_argument(k,type=Path)
    main(a.parse_args())
