"""Add genuine, native Arabic Wikipedia passages to development by article title."""
import json
import sys
from pathlib import Path
from prepare import normalized, digest
root=Path(sys.argv[1])
rows=[json.loads(l) for l in (root/'challenger.jsonl').read_text().splitlines()]
seen={digest(normalized(r['text'])) for r in rows}
for i,article in enumerate(json.loads((root/'arcd.json').read_text())['data']):
    title=normalized(article['title'])
    group='ar-wikipedia-'+digest(title)[:18]
    split='train' if int(digest('arabic-domains-2026:'+group)[:8],16)%100<72 else 'validation'
    for j,para in enumerate(article['paragraphs']):
        text=para['context'].strip()
        key=digest(normalized(text))
        if key in seen: continue
        seen.add(key)
        rows.append({'id':f'wiki-{i}-{j}','lang':'ar','label':0,'split':split,'group':group,
                     'sha256':digest(text),'text':text})
with (root/'arabic-challenger.jsonl').open('w') as output:
    for r in rows: print(json.dumps(r,ensure_ascii=False),file=output)
from collections import Counter
print(Counter(r['split'] for r in rows if r['id'].startswith('wiki-')))
