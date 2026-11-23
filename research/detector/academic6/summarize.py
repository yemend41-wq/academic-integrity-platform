"""Aggregate a sealed study without publishing individual predictions or small latent percentages."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from prepare import HERE, jsonlines, word_spans

TRIALS=2500

def hashed(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def rnd(x):return None if x is None else round(float(x),5)

def wilson(x,n):
    if not n:return dict(numerator=x,denominator=n,rate=None,wilson95=None)
    z=1.959963984540054; p=x/n; w=1+z*z/n
    mid=(p+z*z/(2*n))/w; size=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/w
    return dict(numerator=x,denominator=n,rate=rnd(p),wilson95=[rnd(max(0,mid-size)),rnd(min(1,mid+size))])

def interval(a):
    a=np.array(a,dtype=float);a=a[np.isfinite(a)]
    return [rnd(x) for x in np.quantile(a,[.025,.975])] if a.size else None

def divides(a,b):
    return np.divide(a,b,out=np.full(np.broadcast_arrays(a,b)[0].shape,np.nan,dtype=float),where=np.asarray(b)!=0)

def shared_counts(rows,decision):
    groups=defaultdict(lambda:np.zeros(4,dtype=int))
    for r in rows:
        positive=r[decision];machine=r['origin']=='machine'
        groups[r['cluster']][(0 if positive else 2) if machine else (1 if positive else 3)] += 1
    return groups

def boot_totals(items,strata=None):
    rng=np.random.default_rng(62119); by=defaultdict(list)
    for key,value in items.items():by[None if strata is None else strata[key]].append(value)
    agg=None
    for vs in by.values():
        x=np.array(vs); sample=x[rng.integers(len(x),size=(TRIALS,len(x)))].sum(axis=1)
        agg=sample if agg is None else agg+sample
    return agg

def coverage(rows):
    n=len(rows);good=[r for r in rows if r['status'] not in ('insufficient','empty')]
    return dict(submitted=n,eligible=len(good),abstentions=n-len(good),coverage=wilson(len(good),n),lowDisplayCount=sum(r.get('display')=='*%' for r in good))

def confusion(rows,decision):
    valid=[r for r in rows if r[decision] is not None]; summary=coverage(rows)
    groups=shared_counts(valid,decision); total=np.array(list(groups.values())).sum(axis=0) if groups else [0]*4
    tp,fp,fn,tn=map(int,total);n=tp+fp+fn+tn
    def clip(c):return [int(x) for x in c]
    strata={k:(bool(v[0]+v[2]),bool(v[1]+v[3])) for k,v in groups.items()}
    if groups:
        sampled=boot_totals(groups,strata);p,q,f,_=sampled.T;fci=interval(divides(2*p,2*p+q+f))
    else:fci=None
    humans=[r for r in rows if r['origin']=='human'];machine=[r for r in rows if r['origin']=='machine']
    return dict(**summary,coverageHuman=coverage(humans),coverageMachine=coverage(machine),tp=tp,fp=fp,fn=fn,tn=tn,
                precision=wilson(tp,tp+fp),recall=wilson(tp,tp+fn),fpr=wilson(fp,fp+tn),fnr=wilson(fn,tp+fn),accuracy=wilson(tp+tn,n),
                f1=dict(value=rnd(2*tp/(2*tp+fp+fn)) if 2*tp+fp+fn else None,familyBootstrap95=fci),
                allSubmittedHumanAlert=wilson(fp,len(humans)),allSubmittedMachineDetected=wilson(tp,len(machine)),
                missedOrAbstainedMachine=wilson(len(machine)-tp,len(machine)))

def alarm(rows,actions):
    c=coverage(rows)
    for name in actions:
        count=sum(r[name] is True for r in rows); c[name]={'eligible':wilson(count,c['eligible']),'allSubmitted':wilson(count,c['submitted'])}
    return c

def aggregates(rows,neural=False):
    result={};decisionNames=['modelDecision'] if neural else ['numericPositive','anyPositive']
    for lang in ('ar','en'):
        documents=[r for r in rows if r['lang']==lang]; results={}; result[lang]=results
        pure=[r for r in documents if r['origin'] in ('human','machine')]
        for name,rs in [('primary',[r for r in pure if r['cohort']=='primary']),('allBinaryDiagnostic',pure),('aratect',[r for r in pure if r['cohort']=='aratect'])]:
            if rs:results[name]={decision:confusion(rs,decision) for decision in decisionNames}
        sub=defaultdict(list); lengths=defaultdict(list);domains=defaultdict(list)
        for r in documents:
            if r['cohort']=='mixed':continue
            sub[(r['cohort'],r['source'],r['origin'])].append(r)
            if r['cohort']=='primary':
                n=r['words']; lengths[(r['source'],r['origin'],'48–95' if n<96 else '96–191' if n<192 else '192+')].append(r)
                if r.get('domain'):
                    raw_domain=r['domain']; domain='history' if raw_domain.startswith('historic') else 'Islamic studies' if raw_domain=='islamic' else raw_domain
                    if domain not in ('history','Islamic studies','geography','science'):raise ValueError('Unknown QA domain')
                    domains[(r['source'],domain,r['origin'])].append(r)
        results['bySource']=[dict(cohort=k[0],source=k[1],origin=k[2],**alarm(v,decisionNames)) for k,v in sorted(sub.items())]
        results['byPrimaryLength']=[dict(source=k[0],origin=k[1],words=k[2],**alarm(v,decisionNames)) for k,v in sorted(lengths.items())]
        results['byPrimaryQADomain']=[dict(source=k[0],domain=k[1],origin=k[2],**alarm(v,decisionNames)) for k,v in sorted(domains.items())]
        versions={}
        for r in documents:
            if r['cohort'].startswith('edited-'):
                versions.setdefault(r['cluster'],{})[r['cohort']]=r
        if versions:
            assert all(set(z)=={'edited-original','edited-result'} for z in versions.values())
            edit={'pairedDocuments':len(versions),'percentageTruthAvailable':False}
            for d in decisionNames:
                table=Counter()
                for z in versions.values():
                    label=lambda x:'abstain' if x is None else 'signal' if x else 'no_signal'
                    table[(label(z['edited-original'][d]),label(z['edited-result'][d]))]+=1
                edit[d]=[{'before':b,'after':a,'pairs':n} for (b,a),n in sorted(table.items())]
            results['genuineEditedPairs']=edit
        mixes=[r for r in documents if r['cohort']=='mixed']
        if mixes:
            results['mixtures']={str(v):mixture([r for r in mixes if v=='all' or r['truthPercentage']==v],neural) for v in [25,50,75,'all']}
    return result

def mixture(rows,neural):
    eligible=[r for r in rows if r['status'] not in ('empty','insufficient')]
    by=defaultdict(lambda:np.zeros(4))
    for r in rows:by[r['cluster']]+=np.array([r['span'][k] for k in ('tp','fp','fn','tn')]);
    arr=np.array(list(by.values())).sum(axis=0);tp,fp,fn,tn=map(int,arr); boots=boot_totals(by);a,b,c,_=boots.T
    span=dict(tpWords=tp,fpWords=fp,fnWords=fn,tnWords=tn)
    for name,k,d,kk,dd in [('precision',tp,tp+fp,a,a+b),('recall',tp,tp+fn,a,a+c),('f1',2*tp,2*tp+fp+fn,2*a,2*a+b+c),('iou',tp,tp+fp+fn,a,a+b+c)]:
        span[name]={'value':rnd(k/d) if d else None,'familyBootstrap95':interval(divides(kk,dd))}
    result=dict(documents=len(rows),families=len(by),eligible=len(eligible),abstaining=len(rows)-len(eligible),visibleTokenSpans=span)
    if neural:
        result['provenancePercentageAvailable']=False
        return result
    allbounds=[]; numerics=[]; group=defaultdict(lambda:np.zeros(3))
    for r in rows:
        t=r['truthPercentage'];v=r['estimated']; display=r['display']
        if v is not None: group[r['cluster']]+=np.array([abs(v-t),v-t,1]);
        if display is None: low,high=0,100
        elif display=='*%':low,high=0,20
        else:
            d=float(display.rstrip('%'));numerics.append(abs(d-t));low=high=d
        allbounds.append([max(low-t,t-high,0),max(abs(t-low),abs(t-high))])
    vals=np.array(list(group.values())).sum(axis=0) if group else np.zeros(3)
    if vals[2]:
        bs=boot_totals(group);result['exactLocalMAEpp']={'value':rnd(vals[0]/vals[2]),'familyBootstrap95':interval(bs[:,0]/bs[:,2])};result['biasPP']={'value':rnd(vals[1]/vals[2]),'familyBootstrap95':interval(bs[:,1]/bs[:,2])}
    result['numericDisplayOnly']={'count':len(numerics),'maePP':rnd(np.mean(numerics)) if numerics else None};result['publicDisplayMAERangeAllPP']=[rnd(v) for v in np.mean(allbounds,axis=0)];result['lowDisplayCount']=sum(r['display']=='*%' for r in rows)
    return result

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('private',type=Path);ap.add_argument('output',type=Path);ap.add_argument('--specialist',type=Path,nargs='+');a=ap.parse_args()
    freeze=json.loads((HERE/'freeze.json').read_text()); truthfile=a.private/'truth.jsonl'; assert hashed(truthfile)==freeze['inputFiles']['truth.jsonl'];truth={r['id']:r for r in jsonlines(truthfile)}
    sources=a.specialist or [a.private/'fixed-output.jsonl'];models=defaultdict(list)
    if a.specialist:
        textfile=a.private/'sealed-all.jsonl'; assert hashed(textfile)==freeze['maskedInputs']['sealed-all.jsonl'];texts={x['id']:x['text'] for x in jsonlines(textfile)}
    for source in sources:
        for p in jsonlines(source):
            t=truth[p['id']];r=dict(t,**{k:v for k,v in p.items() if k not in ('id','lang')});
            if a.specialist:
                assert t['lang']==p['lang'];name='frozen-language-specialists';r['modelDecision']=p['flagged'];spans=word_spans(texts[p['id']]);r['words']=len(spans)
                if t['cohort']=='mixed':
                    s=texts[p['id']]; cp2u=[0]
                    for ch in s:cp2u.append(cp2u[-1]+(2 if ord(ch)>0xffff else 1))
                    r['span']=Counter({k:0 for k in ('tp','fp','fn','tn')})
                    for lo,hi in spans:
                        gt=next(q['machine'] for q in t['paragraphs'] if cp2u[lo]>=q['start'] and cp2u[hi]<=q['end']);positive=any(z['flagged'] and z['start']<=lo and z['end']>=hi for z in p['segments']);r['span'][('tp' if positive else 'fn') if gt else ('fp' if positive else 'tn')]+=1
            else:
                name=p['model'];display=p['display'];r['numericPositive']=None if display is None else display not in ('0%','*%');r['anyPositive']=None if display is None else display!='0%'
            models[name].append(r)
    for name,rows in models.items():
        ids={r['id'] for r in rows};assert len(ids)==len(rows)
        if a.specialist:
            allowed={r['id'] for r in truth.values() if r['cohort']=='primary'};mi={r['id'] for r in truth.values() if r['cohort']=='mixed'};assert ids in (allowed,allowed|mi,set(truth))
        else:assert ids==set(truth)
    result={'study':freeze['protocolSHA256'],'frozenInputsSHA256':freeze['maskedInputs'],'createdUTC':datetime.now(timezone.utc).isoformat(),'predictionFilesSHA256':[hashed(f) for f in sources],
            'intervalNotes':'Rates use two-sided 95% Wilson intervals conditional on submitted source samples. English confidence pairs are grouped by paper ID; Arabic primary learners occur once each. F1 and span intervals use 2500 seed-fixed source-family bootstrap draws. Zero denominator gives null. Screened files cannot rule out undocumented author or foundation-model overlap. Sensitivity and FP rates for neural decisions at 0.5 have no *% UX.',
            'models':{m:aggregates(rows,bool(a.specialist)) for m,rows in models.items()}}
    a.output.write_text(json.dumps(result,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+'\n');print('summarized',list(models),str(a.output))

if __name__=='__main__':main()
