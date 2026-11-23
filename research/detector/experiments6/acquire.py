"""Fetch pinned development-only original research files into a private folder."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

SOURCES={
    "ghost-train.parquet":("https://huggingface.co/datasets/polsci/ghostbuster-essay-cleaned/resolve/953b44b7b1d8278a5c955ba0649846900cab4285/data/train-00000-of-00001.parquet","sha256","38e6ca0679cd2a0641e9a7dd8407476552682019a40410442a3477adffdbb3dd"),
    "allam-title.jsonl":("https://raw.githubusercontent.com/KFUPM-JRCAI/arabic-text-detection/997da71482e77627bb0b777223628e9b23b8b7c1/generated_arabic_datasets/allam/arabic_abstracts_dataset/from_title_abstracts_generation.jsonl","git","a0be004f2bfefe42e3adab36a33b0bb2101d4198"),
    "argugpt-native-train.csv":("https://raw.githubusercontent.com/huhailinguist/ArguGPT/cfbd00e75b63db44756375cfc1ee4278f8cd2bf1/data/argugpt/machine-train.csv","git","26433db0f54a9533069c332dee2d4eb36ab65c55"),
    "argugpt-native-dev.csv":("https://raw.githubusercontent.com/huhailinguist/ArguGPT/cfbd00e75b63db44756375cfc1ee4278f8cd2bf1/data/argugpt/machine-dev.csv","git","f1d97f9526decae4a6d1a07d1693d88d4379065a")
}
def main(dest):
    dest.mkdir(parents=True,exist_ok=True)
    def get(item):
        name,(url,kind,expected)=item
        p=dest/name
        if p.exists(): data=p.read_bytes()
        else:
            with urlopen(Request(url,headers={'User-Agent':'Mizan research input verification'}),timeout=90) as f: data=f.read(20000001)
        if len(data)>20000000:raise ValueError(name)
        h=hashlib.sha256(data).hexdigest() if kind=='sha256' else hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if not expected or h!=expected:raise ValueError(f"Changed file: {name}")
        if not p.exists():p.write_bytes(data)
        return name,dict(url=url,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),checkedId=h)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:result=dict(p.map(get,SOURCES.items()))
    (dest/'raw.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('out',type=Path);main(a.parse_args().out)
