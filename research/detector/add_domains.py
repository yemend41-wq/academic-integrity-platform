"""Use the published MAGE/RAID development slice; keep its test set locked."""
import collections
import hashlib
import json
import sys
from pathlib import Path
from prepare import digest, normalized

root=Path(sys.argv[1])
base=[json.loads(s) for s in (root/'corpus.jsonl').read_text().splitlines()]
originals={digest(normalized(row['text'])) for row in base}
for index,line in enumerate((root/'calib.jsonl').read_text().splitlines()):
    item=json.loads(line)
    text=item['text']
    key=digest(normalized(text))
    if key in originals:
        continue
    originals.add(key)
    group=item['source']+':'+str(item.get('group') or key)
    bucket=int(digest('integrity-domain-development-v1:'+group)[:8],16)%100
    row={'id':'domain-'+str(index),'group':group,'text':text,'label':item['label'],'lang':'en',
         'sha256':digest(text),'split':'train' if bucket<72 else 'validation'}
    base.append(row)
out=root/'challenger.jsonl'
with out.open('w') as f:
    for row in base: print(json.dumps(row,ensure_ascii=False),file=f)
print(collections.Counter((r['lang'],r['split'],r['label']) for r in base))
