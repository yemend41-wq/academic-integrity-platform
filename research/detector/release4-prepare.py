"""Freeze a source-separated, overlap-filtered laboratory holdout before fitting HL-5."""
import csv
import hashlib
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
import re
from functools import lru_cache

HERE = Path(__file__).resolve().parent
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
@lru_cache(maxsize=8192)
def keep(char):
    return char != "ـ" and not unicodedata.category(char).startswith("M")
MAP = str.maketrans(dict.fromkeys('أإآٱ','ا') | {'ى':'ي'})

def key(text):
    return hashlib.sha256(text.encode()).hexdigest()

def tokens(text):
    normalized = ''.join(c for c in unicodedata.normalize('NFKD', text.lower()) if keep(c))
    return tuple(WORD.findall(normalized.translate(MAP)))

class Overlap:
    def __init__(self):
        self.norms = set()
        self.postings = {}
        self.size = 0

    @staticmethod
    def imprint(text):
        t = tokens(text)
        # Keys use salted in-process hashes; only comparisons within this index are made.
        # Normalized full documents are cryptographically hashed for identity.
        return key(' '.join(t)), {hash(t[i:i+7]) for i in range(len(t)-6)}

    def add(self, fp):
        norm, grams = fp
        if norm in self.norms:
            return
        self.norms.add(norm)
        self.size += 1
        for gram in grams:
            previous = self.postings.get(gram)
            if previous is None:
                self.postings[gram] = self.size
            elif isinstance(previous, int):
                self.postings[gram] = [previous, self.size]
            else:
                previous.append(self.size)

    def conflicts(self, fp):
        norm, grams = fp
        if norm in self.norms:
            return True
        counts = Counter()
        for gram in grams:
            hits = self.postings.get(gram)
            if isinstance(hits, int):
                counts[hits] += 1
            elif hits:
                counts.update(hits)
        return bool(counts) and 5*max(counts.values()) >= len(grams)

def lines(path):
    with path.open() as f:
        return [json.loads(row) for row in f if row.strip()]

def verify_blob(path, blob):
    data = path.read_bytes()
    if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() != blob:
        raise ValueError(f'Source SHA mismatch: {path.name}')

def write_jsonl(path, rows):
    with path.open('w') as f:
        for row in rows:
            print(json.dumps(row, ensure_ascii=False),file=f)

def main(root):
    out = root/'release4'
    out.mkdir(exist_ok=True)
    corpus = lines(root/'arabic-challenger.jsonl')
    oqn = lines(root/'ArabicCorpus.jsonl')
    apt_human = json.loads((root/'apt-human-polished.json').read_text())
    apt_machine = json.loads((root/'apt-ai.json').read_text())
    academic = lines(root/'academic-ar.jsonl')
    old_strict = lines(root/'strict-holdout.jsonl')
    verify_blob(root/'hl5-title.jsonl','c0b4b35f01502fd96f4a88a72206bb8dfbb8c156')
    verify_blob(root/'hl5-ood.csv','057bff1d1bc2017f4c9be01b92c658a6a57d025d')
    train = [{'text':r['text'],'label':r['label'],'lang':'ar','source':'ARCD' if r['id'].startswith('wiki-') else 'AIRABIC',
              'group':r['group'],'split':'train'} for r in corpus if r['lang']=='ar' and r['split']=='train']
    train += [{'text':r['original'],'label':label,'lang':'ar','source':'Ar-APT','group':r['domain'],'split':'train'}
              for label,rows in [(0,apt_human),(1,apt_machine)] for r in rows]
    train_index=Overlap()
    clean=[]
    # Preserve the published development split; do not import promotional or polished examples.
    for row in train:
        fp=train_index.imprint(row['text'])
        if fp[0] not in train_index.norms:
            clean.append(row)
            train_index.add(fp)
    calib=[]
    for row in oqn:
        if row['label']!='human':
            continue
        fp=train_index.imprint(row['document'])
        if not train_index.conflicts(fp):
            calib.append(dict(text=row['document'],label=0,lang='ar',source='o-qn',group='source',split='calibration'))
            train_index.add(fp)
    write_jsonl(out/'development.jsonl',clean+calib)
    frozen=[]
    counts={}
    for language in ['ar','en']:
        old=[r['text'] for r in corpus+old_strict if r['lang']==language]
        if language=='ar':
            old += [r['document'] for r in oqn] + [r['original'] for r in apt_machine]
            old += [r[k] for r in apt_human for k in ('original','Polish_text')]
            old += [r[k] for r in academic for k in ('original_abstract','generated_abstract')]
            candidates=[(r['original_abstract'],r['generated_abstract']) for r in lines(root/'hl5-title.jsonl')
                        if r.get('original_abstract') and r.get('generated_abstract')]
        else:
            old += [r['text'] for f in ['calib.jsonl','test.jsonl','esl.jsonl'] for r in lines(root/f)]
            for prefix in ('CollegeEssay_','CS224N_','HewlettStudentEssay_','TOEFL_'):
                for p in root.glob(prefix+'*.json'):
                    old += [r['document'] for r in json.loads(p.read_text())]
            with (root/'hl5-ood.csv').open() as f:
                candidates=[(r['text'],) for r in csv.DictReader(f) if r.get('text')]
        idx=Overlap()
        for text in old:
            idx.add(idx.imprint(text))
        numbers=Counter(source_records=len(candidates),screened=0,overlap_excluded=0,selected=0)
        for item in sorted(candidates,key=lambda xs:key(xs[0])):
            numbers['screened']+=1
            fps=[idx.imprint(t) for t in item]
            if any(idx.conflicts(f) for f in fps) or (len(fps)==2 and fps[0][0]==fps[1][0]):
                numbers['overlap_excluded']+=1
                continue
            for f in fps:
                idx.add(f)
            pair=key(item[0])
            for i,text in enumerate(item):
                label=i if language=='ar' else 1
                frozen.append(dict(text=text,lang=language,label=label,pair=pair,sha256=key(text)))
            numbers['selected']+=1
            if numbers['selected']==400:
                break
        counts[language]=numbers
        del idx
    write_jsonl(out/'frozen.jsonl',frozen)
    public={'protocol_sha256':hashlib.sha256((HERE/'release4-protocol.json').read_bytes()).hexdigest(),
            'source_counts':counts, 'manifest_sha256':key('\n'.join(r['sha256'] for r in frozen)),
            'groups':{f'{split}/{source}/{label}':n for (split,source,label),n in Counter((r['split'],r['source'],r['label']) for r in clean+calib).items()}}
    (out/'frozen-manifest.json').write_text(json.dumps(public,indent=2)+'\n')
    print(json.dumps(public))

if __name__=='__main__':
    main(Path(sys.argv[1]))
