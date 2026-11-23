"""Fixed, source-balanced Arabic coefficient challenger; never read the test text."""
from array import array
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
HERE=Path(__file__).resolve().parent

def fit(root):
    manifest=json.loads((root/'frozen-manifest.json').read_text())
    fixed='45dbcdb7dff24efaf97f8d2ac9973a120b2f9d326df7202c06ffd0cf591e854e'
    if manifest['protocol_sha256']!=fixed or hashlib.sha256((HERE/'release4-protocol.json').read_bytes()).hexdigest()!=fixed:
        raise ValueError('Changed protocol; start a new research study')
    if manifest['manifest_sha256']!='31413c0b108525492b5709dac54a560983bf0bcfbd04f5b6f6b5a6ba14b19118':
        raise ValueError('Reserved corpus changed before fit')
    indices=array('i'); values=array('d'); ends=array('i',[0]); docs=[]
    for line in (root/'features.jsonl').open():
        row=json.loads(line); features=row['features']
        if not features:
            continue
        start=len(ends)-1
        for window in features:
            for idx,val in window:
                indices.append(idx); values.append(val)
            ends.append(len(values))
        docs.append((row['split'],row['source'],row['label'],start,len(ends)-1))
    matrix=csr_matrix((values,indices,ends),shape=(len(ends)-1,8192))
    cells=Counter((source,label) for split,source,label,*_ in docs if split=='train')
    labels=[]; weights=[]; rows=[]
    for split,source,label,start,end in docs:
        if split!='train':
            continue
        n=end-start
        labels.extend([label]*n); rows.extend(range(start,end))
        weights.extend([sum(cells.values())/(len(cells)*cells[source,label]*n)]*n)
    learner=LogisticRegression(C=16,max_iter=1000,solver='liblinear',random_state=113,
                               intercept_scaling=2,tol=1e-8).fit(matrix[rows],labels,sample_weight=weights)
    coef=np.round(learner.coef_[0],7); intercept=round(float(learner.intercept_[0]),7)
    doc_max=[float(np.max(matrix[s:e]@coef+intercept)) for split,src,lab,s,e in docs if split=='calibration']
    threshold=float(np.quantile(doc_max,.995,method='higher'))+1e-8
    model={'bias':intercept,'threshold':threshold,'weights':coef.tolist()}
    (root/'arabic-model.json').write_text(json.dumps(model,separators=(',',':'))+'\n')
    print('source/class fit counts',cells,'calibration',len(doc_max),'threshold',threshold)

if __name__=='__main__':
    fit(Path(sys.argv[1]))
