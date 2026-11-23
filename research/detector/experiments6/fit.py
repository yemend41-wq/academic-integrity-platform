"""Fit only on frozen development rows and calibrate both predeclared scorers."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from array import array
import struct
from collections import Counter
import numpy as np
import scipy
from scipy.sparse import csr_matrix
import sklearn
from sklearn.linear_model import LogisticRegression

HERE=Path(__file__).resolve().parent
DIMS=16384;PROTOCOL="570e533467d171a78ad789bb38378779e8471e593d44226b8f6886b8b79eb3b8"
TYPE=np.dtype([('i','<u2'),('v','<f4')])

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda:file.read(1048576),b''):h.update(block)
    return h.hexdigest()
def read(path,language):
    rows=[];ids=array('i');vals=array('f');offset=array('i',[0])
    with path.open('rb') as f:
        while h:=f.readline():
            r=json.loads(h);a=len(offset)-1
            for _ in range(r['count']):
                n=struct.unpack('<I',f.read(4))[0];data=f.read(6*n)
                if len(data)!=6*n:raise ValueError('Incomplete matrix')
                if r['lang']==language:
                    vector=np.frombuffer(data,dtype=TYPE);ids.frombytes(vector['i'].astype('i4').tobytes());vals.frombytes(vector['v'].astype('f4').tobytes());offset.append(len(vals))
            if r['lang']==language and r['count']:
                r['a']=a;r['b']=len(offset)-1;rows.append(r)
    return rows,csr_matrix((vals,ids,offset),shape=(len(offset)-1,DIMS))
def q(x,p):return float(np.quantile(x,p,method='higher'))
def fit(source,language):
    rows,X=read(source,language)
    train=[r for r in rows if r['partition']=='train'];cal=[r for r in rows if r['partition']=='calibration']
    cells=Counter((r['publisher'],r['label']) for r in train);classes=Counter(y for _,y in cells)
    ids=[];labels=[];mass=[]
    for r in train:
        n=r['count'];lab=r['label'];s=r['publisher'];w=len(train)/(2*classes[lab]*cells[(s,lab)]*n)
        ids.extend(range(r['a'],r['b']));labels.extend([lab]*n);mass.extend([w]*n)
    clf=LogisticRegression(C=4,solver='liblinear',dual=True,max_iter=500,tol=1e-6,intercept_scaling=2,random_state=604)
    clf.fit(X[ids],labels,sample_weight=mass)
    scale=float(np.abs(clf.coef_[0]).max()/32767) or 1.
    packed=np.rint(clf.coef_[0]/scale).astype('<i2')
    bias=float(clf.intercept_[0]);margins=X@(packed.astype(float)*scale)+bias
    human=[r for r in cal if r['label']==0]
    if len(human)<60:raise ValueError(f'Insufficient human calibration: {language}/{len(human)}')
    new=np.concatenate([margins[r['a']:r['b']] for r in human]);old=np.concatenate([r['old'] for r in human])
    newmedian=q(new,.5);oldmedian=q(old,.5);ni=max(1e-8,q(new,.75)-q(new,.25));oi=max(1e-8,q(old,.75)-q(old,.25))
    def scores(r):
        n=(margins[r['a']:r['b']]-newmedian)/ni;o=(np.asarray(r['old'])-oldmedian)/oi
        return [n,.5*(n+o)]
    dist=[scores(r) for r in human]
    thresholds=[]
    for i in (0,1):
        ws=[a[i] for a in dist]
        local=q(np.concatenate(ws),.75)
        evidence=[.5*q(w,.5)+.5*q(w,.9) for w in ws]
        cutoff=q(evidence,.995)+1e-8;thresholds.append(dict(local=local,document=cutoff))
    weights=dict(scale=scale,bias=bias,coefficients=base64.b64encode(packed.tobytes()).decode(),
                 newMedian=newmedian,oldMedian=oldmedian,newIqr=ni,oldIqr=oi,thresholds=thresholds)
    summary=dict(fitDocCount=len(train),fitWindowCount=len(ids),calibrationEligibleHuman=len(human),calibrationTotalEligible=len(cal),
                 fitCells={f'{s}/{l}':n for (s,l),n in cells.items()},thresholds=thresholds,iterations=clf.n_iter_.tolist())
    return weights,summary
def main(d):
    manifest=json.loads((d/'manifest.json').read_text())
    if sha(HERE/'protocol.json')!=PROTOCOL or manifest['protocolSha256']!=PROTOCOL or sha(d/'development.jsonl')!=manifest['developmentSha256']:
        raise ValueError('Protocol or corpus digest changed')
    model=dict(versions=['AIP-CN-8-research','AIP-CE-8-research'],languages={});results={}
    for lang in ('ar','en'):model['languages'][lang],results[lang]=fit(d/'features.bin',lang)
    (d/'weights.json').write_text(json.dumps(model,separators=(',',':'))+'\n')
    info=dict(protocolSha256=PROTOCOL,developmentSha256=manifest['developmentSha256'],weightSha256=sha(d/'weights.json'),
              upstreamControlWeightsSha256=sha(HERE.parent/'weights.mjs'),upstreamFeatureSha256=sha(HERE.parent/'features.mjs'),
              scoringSha256=sha(HERE/'core.mjs'),versions=model['versions'],fits=results,
              libraries={'numpy':np.__version__,'scipy':scipy.__version__,'scikitLearn':sklearn.__version__})
    (d/'lock.json').write_text(json.dumps(info,indent=2)+'\n')
    print(info['weightSha256'])
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('private',type=Path); main(p.parse_args().private)
