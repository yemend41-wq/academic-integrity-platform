"""Run the frozen language-specialist experiment offline. No remote inference calls."""
import argparse,hashlib,json,math,time,sys
from pathlib import Path
import numpy as np
from tokenizers import Tokenizer

HERE=Path(__file__).resolve().parent
CONTENT,STRIDE=254,192
BATCH=5

def normalize_scores(logits):
    logits=logits-logits.max(axis=1,keepdims=True)
    exps=np.exp(logits)
    return exps/exps.sum(axis=1,keepdims=True)

class Backend:
    def __init__(self,lang,threads):
        self.lang=lang
        base=HERE/lang
        self.tokenizer=Tokenizer.from_file(str(base/'tokenizer.json'))
        self.tokenizer.no_truncation()
        self.tokenizer.no_padding()
        if lang=='en':
            import onnxruntime as ort
            op=ort.SessionOptions()
            op.intra_op_num_threads=threads
            op.inter_op_num_threads=1
            op.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
            self.model=ort.InferenceSession(str(base/'onnx/model_quantized.onnx'),sess_options=op,providers=['CPUExecutionProvider'])
            self.input_names=[x.name for x in self.model.get_inputs()]
            self.cls,self.sep,self.pad,self.ai=0,2,1,0
        else:
            import torch
            from transformers import BertForSequenceClassification
            self.torch=torch
            torch.set_num_threads(threads)
            self.model=BertForSequenceClassification.from_pretrained(str(base),local_files_only=True,use_safetensors=True)
            self.model.eval()
            self.cls=self.tokenizer.token_to_id('[CLS]')
            self.sep=self.tokenizer.token_to_id('[SEP]')
            self.pad=self.tokenizer.token_to_id('[PAD]')
            self.ai=1
        if any(x is None for x in [self.cls,self.sep,self.pad]):
            raise RuntimeError('Special token missing')
    def apply(self,sequences):
        width=max(map(len,sequences))
        ids=np.full((len(sequences),width),self.pad,dtype=np.int64)
        mask=np.zeros_like(ids)
        for i,x in enumerate(sequences):
            ids[i,:len(x)]=x;mask[i,:len(x)]=1
        if self.lang=='en':
            inputs={'input_ids':ids,'attention_mask':mask,'token_type_ids':np.zeros_like(ids)}
            logits=self.model.run(None,{name:inputs[name] for name in self.input_names})[0]
        else:
            torch=self.torch
            with torch.inference_mode():
                logits=self.model(input_ids=torch.from_numpy(ids),attention_mask=torch.from_numpy(mask)).logits.numpy()
        return normalize_scores(logits.astype(np.float64))[:,self.ai].tolist()
    def score(self,text):
        tokens=self.tokenizer.encode(text,add_special_tokens=False)
        ids=tokens.ids;offsets=tokens.offsets;n=len(ids)
        if n==0: return {'status':'empty','score':None,'flagged':None,'segments':[],'wordpieces':0,'windows':0}
        last=max(0,n-CONTENT)
        starts=list(range(0,last+1,STRIDE))
        if starts[-1]!=last: starts.append(last)
        stops=[min(s+CONTENT,n) for s in starts]
        centers=[(a+b)/2 for a,b in zip(starts,stops)]
        bounds=[0]+[int((a+b)/2) for a,b in zip(centers,centers[1:])]+[n]
        windows=[[self.cls]+ids[a:b]+[self.sep] for a,b in zip(starts,stops)]
        scores=[]
        for i in range(0,len(windows),BATCH):scores.extend(self.apply(windows[i:i+BATCH]))
        mean=sum((b-a)*s for a,b,s in zip(bounds,bounds[1:],scores))/n
        segments=[{'start':offsets[a][0],'end':offsets[b-1][1],'flagged':s>=.5}
                  for a,b,s in zip(bounds,bounds[1:],scores)]
        return {'status':'scored','score':mean,'flagged':mean>=.5,'segments':segments,'wordpieces':n,'windows':len(windows)}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('inputs',type=Path);parser.add_argument('outputs',type=Path)
    parser.add_argument('--threads',type=int,default=3)
    parser.add_argument('--lang',choices=['en','ar','both'],default='both')
    args=parser.parse_args()
    rows=[json.loads(l) for l in args.inputs.read_text().splitlines() if l.strip()]
    if len({r['id'] for r in rows})!=len(rows): raise ValueError('Duplicate document IDs')
    with args.outputs.open('w') as out:
        for lang in ['en','ar'] if args.lang=='both' else [args.lang]:
            cohort=[r for r in rows if r['lang']==lang]
            if not cohort:continue
            t=time.perf_counter();backend=Backend(lang,args.threads);load=time.perf_counter()-t
            print('loaded',lang,round(load,3),flush=True)
            for i,r in enumerate(cohort):
                t=time.perf_counter();result=backend.score(r['text']);latency=time.perf_counter()-t
                if result['score'] is not None and not math.isfinite(result['score']):raise ValueError('Nonfinite probability')
                out.write(json.dumps({'id':r['id'],'lang':lang,**result,'seconds':latency},ensure_ascii=True)+'\n')
                out.flush()
                if (i+1)%32==0:print('processed',lang,i+1,'of',len(cohort),flush=True)
            del backend

if __name__=='__main__':main()
