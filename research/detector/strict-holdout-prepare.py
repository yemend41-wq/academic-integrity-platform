import base64,csv,hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1])
out=[]
for input_file,lang,cohort in [('ukp-holdout.jsonl','en','UKP persuasive essays'),('anad-holdout.jsonl','ar','ANAD 2021 news')]:
    for line in (root/input_file).read_text().splitlines():
        file,encoded,blob=json.loads(line)
        raw=base64.b64decode(encoded)
        assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==blob
        value=raw.decode('utf-8-sig')
        if lang=='en' and '\n\n' in value:
            value=value.split('\n\n',1)[1]  # remove repeated writing prompt
        out.append(dict(text=value,lang=lang,cohort=cohort,label=0,subset=file.split('/')[0],id=file))
for n,r in enumerate(csv.DictReader((root/'argugpt-ai.csv').open())):
    out.append(dict(text=r['text'],lang='en',cohort='ArguGPT generated test essays',label=1,subset=r['exam_type']+'/'+r['model'],id=str(n)))
for file in ['alpaca-recipe.txt','alpaca-trans.txt']:
    for n,value in enumerate((root/file).read_text().split('\n*********\n')):
        out.append(dict(text=value,lang='ar',cohort='AlpaGasus Arabic machine-translated instruction and output',label=1,subset=file,id=file+str(n)))
with (root/'strict-holdout.jsonl').open('w') as target:
    for x in out:
        print(json.dumps(x,ensure_ascii=False),file=target)
