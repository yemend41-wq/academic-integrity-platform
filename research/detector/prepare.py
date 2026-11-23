"""Prepare privately supplied copies of the two cited corpora; no text is shipped."""
import base64
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
import openpyxl

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def normalized(text):
    text = unicodedata.normalize('NFKD', text.lower())
    return ' '.join(re.findall(r'[^\W\d_]+', ''.join(c for c in text if not unicodedata.combining(c) and c != 'ـ')))

def main(root):
    examples = []
    for file_index, label in [(0, 1), (1, 0)]:
        rows = openpyxl.load_workbook(root / f'ar{file_index}.xlsx', read_only=True, data_only=True).active.values
        group = ''
        for row in rows:
            if not isinstance(row[0], int) or not 1 <= row[0] <= 500:
                continue
            if label == 1 and row[7] == 'unique':
                group = 'ar-topic-' + digest(normalized(row[1]))[:16]
            if label == 0:
                group = 'ar-source-' + digest(normalized(row[2]))[:16]
            if row[3 if label else 6] is not None:  # duplicate vocalization of same passage
                continue
            text = row[2 if label else 3]
            examples.append({'id':f'ar-{label}-{row[0]}','lang':'ar','label':label,'group':group,'text':text})
    for line in (root / 'en.jsonl').read_text().splitlines():
        file, encoded, expected_sha = json.loads(line)
        raw = base64.b64decode(encoded,validate=True)
        if hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() != expected_sha:
            raise ValueError(file)
        text = raw.decode('utf-8-sig')
        label = int('/chatgpt/' in file)
        topic = Path(file).stem
        examples.append({'id':f'en-{label}-{topic}','lang':'en','label':label,'group':'en-topic-'+topic,'text':text})
    seen = set()
    cleaned = []
    for row in sorted(examples,key=lambda r:r['id']):
        normalized_digest = digest(normalized(row['text']))
        if normalized_digest in seen:
            continue
        seen.add(normalized_digest)
        bucket = int(digest('integrity-2026-group-split-v1:'+row['group'])[:8],16) % 100
        row['split'] = 'train' if bucket < 65 else 'validation' if bucket < 80 else 'test'
        row['sha256'] = digest(row['text'])
        cleaned.append(row)
    with (root/'corpus.jsonl').open('w') as out:
        for row in cleaned:
            print(json.dumps(row,ensure_ascii=False),file=out)
    print('Deduplicated corpus documents:',len(cleaned))

if __name__ == '__main__':
    main(Path(sys.argv[1]))
