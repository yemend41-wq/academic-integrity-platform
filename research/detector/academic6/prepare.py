"""Construct a text-blind evidence panel. No detector is loaded by this program."""
import argparse
from collections import Counter, defaultdict
import csv
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata as ud
from urllib.request import urlopen
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
POLICY = json.loads((HERE / 'protocol.json').read_text())
FILES = json.loads((HERE / 'sources.json').read_text())

def digest(value):
    return sha256(value).hexdigest()

def rank(*keys):
    return digest('|'.join([POLICY['salt'], *map(str, keys)]).encode())

def normalize(text):
    s = ''.join(c for c in ud.normalize('NFKD', text.casefold()) if ud.category(c)[0] != 'M' and c != 'ـ')
    return ' '.join(re.findall(r'[^\W_]+', s))

def word_spans(text):
    result = []
    index = 0
    while index < len(text):
        if not ud.category(text[index]).startswith('L'):
            index += 1
            continue
        start = index
        index += 1
        while index < len(text):
            if ud.category(text[index])[0] in 'LM':
                index += 1
            elif text[index] in "'’" and index + 1 < len(text) and ud.category(text[index + 1])[0] == 'L':
                index += 2
            else:
                break
        if text[start:index].strip('ـ'):
            result.append((start, index))
    return result

def jsonlines(path):
    with path.open() as f:
        for line in f:
            yield json.loads(line)

def dump_lines(path, rows):
    with path.open('w') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True, separators=(',', ':')) + '\n')

def verified_inputs(path):
    path.mkdir(parents=True, exist_ok=True)
    for name,(url,expected) in FILES.items():
        target = path / name
        if not target.exists():
            temp = target.with_suffix('.part')
            with urlopen(url, timeout=100) as download, temp.open('wb') as out:
                while chunk := download.read(1 << 20):
                    out.write(chunk)
            temp.replace(target)
        if digest(target.read_bytes()) != expected:
            raise ValueError(f'Unexpected bytes for {name}')

def anchors(words):
    end = len(words)-16
    return {tuple(words[x:x+16]) for x in [0,end//4,end//2,end*3//4,end]} if end >= 0 else set()

def hits(words, index):
    counts, found = Counter(), set()
    for i in range(len(words)-15):
        phrase = tuple(words[i:i+16])
        if phrase in index and phrase not in found:
            counts.update(index[phrase]); found.add(phrase)
    return {key for key,n in counts.items() if n >= 2}

def load_candidates(folder):
    candidates = {}
    def add(source, identity, lang, texts, *, group=None, extra=None):
        candidates[source,str(identity)] = dict(source=source, identity=str(identity), lang=lang, texts=texts, group=group or str(identity), extra=extra or {})
    za = json.loads((folder / 'za-ar.json').read_text())
    assert all(r['title'].endswith('.original.txt') for r in za)
    for r in za:
        writer = r['title'].split('-')[-1].split('.')[0]
        add('za-ar',r['title'],'ar',{'human':r['text']},group=writer)
    for r in jsonlines(folder/'ar-qa.jsonl'):
        assert r['generator_model'] == 'QCRI/Fanar-1-9B-Instruct'
        if r['truncated'] or r['needs_human_review']:
            continue
        add('fanar',r['id'],'ar',{'machine':r['generated_answer']},extra={'domain':re.split('hallucination',r['id'],flags=re.I)[0].lower(),'generator':r['generator_model']})
    with (folder/'ar.csv').open() as f:
        src = list(csv.DictReader(f))
    for label in ('human','machine'):
        for r in sorted((r for r in src if r['Class']==label), key=lambda r:rank('aratect',r['ID']))[:420]:
            add('aratect',r['ID'],'ar',{label:r['content']},extra={'generator':'unspecified' if label=='machine' else 'human'})
    root = ElementTree.parse(folder/'za.xml').getroot()
    for doc in root:
        if doc.attrib['language'] != 'English': continue
        text = '\n'.join(' '.join(w.findtext('text') or '' for w in sentence.findall('word')) for sentence in doc.findall('sent'))
        add('za-en',doc.attrib['idx'],'en',{'human':text},group=doc.attrib['writer_id'])
    d = {k:json.loads((folder/f'gpa-{k}.json').read_text()) for k in ('human','ai','original-polished','polished')}
    for key in sorted(set.intersection(*(set(v) for v in d.values())), key=lambda i:rank('gpa',i))[:540]:
        add('gpa',key,'en',{k:d[k][key] for k in d})
    for r in jsonlines(folder/'qa-validated.jsonl'):
        old, new = r['original_open_answer'], r['open_answer']
        if not r['was_postedited'] or r['dialect'] in ('english','msa') or not old or not new or normalize(old)==normalize(new):continue
        add('qcri-edit',r['id'],'ar',{'original':old,'revised':new},group=r['id'].split('_')[0],extra={'dialect':r['dialect']})
    return candidates

def screen(candidates, archives):
    exact, index, counted = defaultdict(set), defaultdict(set), {}
    for key, r in candidates.items():
        for field, text in r['texts'].items():
            norm = normalize(text)
            marker = key+(field,)
            exact[digest(norm.encode())].add(marker)
            for phr in anchors(norm.split()):index[phr].add(marker)
    rejected, seen = set(), set()
    for spec in archives:
        filename = Path(spec['path']); checksum = digest(filename.read_bytes())
        if checksum != spec['sha256']:raise ValueError('Historical source changed: '+spec['name'])
        records = 0
        for r in jsonlines(filename):
            text = r['text']; norm = normalize(text); key = digest(norm.encode())
            if key in seen: continue
            seen.add(key); records += 1
            rejected.update(exact.get(key,()))
            rejected.update(hits(norm.split(),index))
        counted[spec['name']] = dict(sha256=checksum,uniqueFurtherDocuments=records)
    return rejected, counted

def select(candidates, excluded, return_taken=False):
    rows, seen, prior, taken = [], set(), defaultdict(set), set()
    exclusions = Counter()
    def admissible(r, fields, low=48, high=None):
        if (r['source'],r['group']) in taken: return False
        ns = []
        for field in fields:
            text=r['texts'][field]; spans=word_spans(text); n=len(spans)
            if (r['source'],r['identity'],field) in excluded:
                exclusions['overlap_encountered_during_selection']+=1; return False
            if not n or n<low or (high is not None and n>high):return False
            script = 'ARABIC' if r['lang']=='ar' else 'LATIN'
            if sum(any(script in ud.name(c,'') for c in text[a:b]) for a,b in spans)/n < .70: return False
            s=normalize(text); terms=s.split()
            if s in seen or hits(terms,prior):return False
            ns.append(s)
        return len(set(ns))==len(ns)
    def keep(r, fields):
        taken.add((r['source'],r['group']))
        for f in fields:
            n=normalize(r['texts'][f]);seen.add(n)
            marker=(r['source'],r['identity'],f)
            for phrase in anchors(n.split()): prior[phrase].add(marker)
    def pool(source):
        return sorted((r for (s,_),r in candidates.items() if s==source),key=lambda r:rank(source,r['identity']))
    def select_pool(source, fields, target, low=48, high=None):
        picked=[]
        for r in pool(source):
            if all(f in r['texts'] for f in fields) and admissible(r,fields,low,high):
                keep(r,fields);picked.append(r)
                if len(picked)==target:break
        return picked
    def emit(row, field, cohort, label, cluster=None):
        src=row['source']; pm=row['group']; txt=row['texts'][field]
        k=rank('case',cohort,src,pm,field)
        rows.append(dict(id=k[:24],lang=row['lang'],text=txt,cohort=cohort,source=src,cluster=cluster or rank(src,pm)[:24],origin=label,**row['extra']))
    for source,f,label in [('za-ar','human','human'),('fanar','machine','machine')]:
        for r in select_pool(source,[f],128): emit(r,f,'primary',label)
    for r in select_pool('gpa',['human','ai'],128):
        emit(r,'human','primary','human');emit(r,'ai','primary','machine')
    for field in ('human','machine'):
        for r in select_pool('aratect',[field],64):emit(r,field,'aratect',field)
    for r in select_pool('za-en',['human'],76):emit(r,'human','learner-en','human')
    for r in select_pool('fanar',['machine'],24,12,47):emit(r,'machine','short-ar','machine')
    def block(text, index):
        words=word_spans(text); a=words[20*index][0];last=20*(index+1)-1
        b=words[last+1][0] if last+1<len(words) else len(text)
        return text[a:b].strip()
    def make_mixtures(lang, donors):
        for i,(h,m,fm) in enumerate(donors):
            cl=rank('mixture',lang,h['group'],m['group'])[:24]
            for qty in (1,2,3):
                order=[int((j-i)%4<qty) for j in range(4)];selected=Counter();bounds=[];text=''
                for lab in order:
                    parent,field=(m,fm) if lab else (h,'human')
                    part=block(parent['texts'][field],selected[lab]); selected[lab]+=1
                    if text:text+='\n\n'
                    utf16=lambda s:len(s.encode('utf-16-le'))//2
                    a=utf16(text);text+=part;bounds.append(dict(start=a,end=utf16(text),machine=bool(lab)))
                assert len(word_spans(text))==80
                rows.append(dict(id=rank('case',cl,qty)[:24],lang=lang,text=text,cohort='mixed',source='paired-gpa' if lang=='en' else 'za-fanar',cluster=cl,origin='mixed',truthPercentage=qty*25,paragraphs=bounds))
    ar_h=select_pool('za-ar',['human'],20,60);ar_m=select_pool('fanar',['machine'],20,60)
    make_mixtures('ar',[(h,m,'machine') for h,m in zip(ar_h,ar_m)])
    make_mixtures('en',[(r,r,'ai') for r in select_pool('gpa',['human','ai'],20,60)])
    for r in select_pool('gpa',['original-polished','polished'],32):
        emit(r,'original-polished','edited-original','human');emit(r,'polished','edited-result','machine-polished-human')
    for r in select_pool('qcri-edit',['original','revised'],32,1):
        emit(r,'original','edited-original','prior-version');emit(r,'revised','edited-result','native-reviewer-edited')
    used_za={s:{g for src,g in taken if src==s} for s in ('za-ar','za-en')}
    out=(sorted(rows,key=lambda r:r['id']),exclusions,len(used_za['za-ar']&used_za['za-en']))
    return (*out,taken) if return_taken else out

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('private',type=Path);p.add_argument('archives',type=Path);p.add_argument('manifest',type=Path);a=p.parse_args()
    verified_inputs(a.private/'inputs'); c=load_candidates(a.private/'inputs'); rejected,archives=screen(c,json.loads(a.archives.read_text())); rows,exclusions,bilingual=select(c,rejected)
    assert len(rows)==len({r['id'] for r in rows})
    data=[{k:r[k] for k in ('id','lang','text')} for r in rows]; primary=[v for v,r in zip(data,rows) if r['cohort']=='primary']
    truth=[{k:v for k,v in r.items() if k!='text'} for r in rows]
    # Private raw text is never part of the release artifact.
    for name, rs in [('all-input.jsonl',data),('primary-input.jsonl',primary),('truth.jsonl',truth)]:dump_lines(a.private/name,rs)
    res=dict(protocolSHA256=digest((HERE/'protocol.json').read_bytes()),sourceRegistrySHA256=digest((HERE/'sources.json').read_bytes()),archives=archives,selected=len(rows),primary=len(primary),inputFiles={n:digest((a.private/n).read_bytes()) for n in ['all-input.jsonl','primary-input.jsonl','truth.jsonl']},sources={k:v[1] for k,v in FILES.items()},archivedOverlappingDonorVariants=len(rejected),selectionExclusions=exclusions,zaebucBilingualWritersUsed=bilingual,cohorts={str(k):n for k,n in sorted(Counter((r['lang'],r['cohort'],r['origin']) for r in rows).items())})
    a.manifest.write_text(json.dumps(res,indent=2,sort_keys=True)+'\n');print(json.dumps({'selected':len(rows),'primary':len(primary),'out':str(a.manifest)}))

if __name__=='__main__':main()
