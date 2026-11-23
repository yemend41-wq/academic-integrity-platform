"""Summarize fixed evaluator outputs. Probabilities use [0,1]; mixture errors use percentage points."""
import hashlib
import json
import math
from pathlib import Path
import sys
from statistics import mean, NormalDist

HERE=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())

def wilson(k,n):
    if not n:
        return None
    z=NormalDist().inv_cdf(.975)
    p=k/n
    d=1+z*z/n
    center=(p+z*z/(2*n))/d
    margin=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [0. if k==0 else round(center-margin,6),1. if k==n else round(center+margin,6)]

def cohort(label,lang,origin,r):
    n=r['eligible']
    any_signals=r.get('any',r.get('flagged_including_suppressed'))
    numeric=r.get('numeric',r.get('visible',r.get('flagged_at_least_20_percent')))
    excluded=r.get('overlap',r.get('excluded',r.get('excluded_as_duplicates_or_overlap',0)))
    abstained=r.get('abstained',r.get('insufficient',0))
    total=r['total']
    assert n+excluded+abstained==total and 0<=numeric<=any_signals<=n, (label,r)
    return dict(label=label,lang=lang,origin=origin,total=total,eligible=n,abstained=abstained,excluded=excluded,any=any_signals,numeric=numeric,
                any_rate=round(any_signals/n,6) if n else None,numeric_rate=round(numeric/n,6) if n else None,
                coverage=round(n/(n+abstained),6) if n+abstained else None,any_ci95=wilson(any_signals,n),numeric_ci95=wilson(numeric,n))

def output(root):
    study=read(root/'scores.json')
    ar=read(root/'arabic.json'); english=read(root/'liang.json')
    dom=read(root/'domains.json'); previous=read(root/'prior-strict.json')['control']
    back=read(root/'roundtrip.json'); new=study['experiment']
    cohorts=[]
    for lang,records in [('ar',{'Arabic original abstracts':0,'Arabic title-generated abstracts':1}),
                              ('en',{'ArguGPT OOD generation':1})]:
        for label,kind in records.items():
            cohorts.append(cohort(label,lang,'machine' if kind else 'human',new['control']['scores'][label]))
    for code,label,kind in [('oqn_human','Course-project collection','human'),('oqn_ai','Course-project collection, generated','machine'),
                           ('ar_apt_human','Ar-APT press','human'),('ar_apt_machine','Ar-APT generated press','machine'),
                           ('academic_human','KFUPM earlier abstracts','human'),('academic_assisted','KFUPM abstracts polished by Claude','assisted'),
                           ('ar_apt_assisted','Ar-APT polished press','assisted')]:
        cohorts.append(cohort(label,'ar',kind,ar[code]))
    for label,row in previous.items():
        cohorts.append(cohort(label,row['lang'],'machine' if row['label'] else 'human',row))
    # Overlapping learner or native subgroups are returned once; no pooled population claim.
    for code,row in dom.items():
        if code.startswith(('esl_toefl','native_hewlett')):
            continue
        source,kind=code.rsplit('__',1)
        cohorts.append(cohort(source,'en','machine' if kind=='1' else 'human',row))
    for code,row in english.items():
        cohorts.append(cohort(row['description'],'en',row['origin'],row))
    cohorts.append(cohort('OPUS English–German–English round-trip spans','en','translated',dict(
        total=back['distinct_roundtrip_spans'],eligible=back['eligible_spans'],abstained=back['insufficient'],
        any=back['any_signal'],numeric=back['numeric_signal'])))
    mixed_rows=read(root/'mixed.json')['mixed']
    mixed=[]
    for lang in ('ar','en'):
        for share in (.25,.5,.75):
            pool=[r for r in mixed_rows if r['lang']==lang and r['fraction']==share]
            errors=[];lower=[];upper=[];suppressed=0;abstained=0
            for r in pool:
                truth=100*r['aiWords']/r['total']
                if r['display'] is None:
                    abstained+=1
                elif r['display']=='*%':
                    suppressed+=1
                    lower.append(max(0,truth-20,-truth)); upper.append(max(abs(truth),abs(20-truth)))
                else:
                    absolute=abs(float(r['display'].strip('%'))-truth)
                    errors.append(absolute); lower.append(absolute); upper.append(absolute)
            mixed.append(dict(lang=lang,expected_percent=int(100*share),documents=len(pool),numeric=len(errors),suppressed=suppressed,
                              abstained=abstained,mae_pp=round(mean(errors),2) if errors else None,
                              mae_bounds_all_scored_pp=[round(mean(lower),2),round(mean(upper),2)] if lower else None))
    frozen=read(root/'frozen-manifest.json')
    experiment={name:[cohort(k,'en' if 'ArguGPT' in k else 'ar','human' if k=='Arabic original abstracts' else 'machine',r)
                      for k,r in v['scores'].items()] for name,v in new.items()}
    challenger=experiment['candidate']; control=experiment['control']
    passed=all(r['any_rate'] is not None and r['numeric_rate'] is not None and
               (max(r['any_rate'],r['numeric_rate'])<.01 if r['origin']=='human' else min(r['any_rate'],r['numeric_rate'])>=.5)
               for r in challenger) and all(c['abstained']<=b['abstained'] for b,c in zip(control,challenger))
    experiment.update(candidate_model='AIP-HL-5-research', active_model='AIP-HL-3', passed=passed, decision='rejected' if not passed else 'requires external committee validation',
                      weights_sha256=hashlib.sha256((root/'arabic-model.json').read_bytes()).hexdigest(),**frozen)
    assert not passed, 'Research gate changed; review before modifying the active model'
    length_rows=[cohort(k,'ar','human',r) for k,r in sorted(study['active_arabic_audit']['lengths'].items())]
    result={'experiment':experiment,'cohorts':cohorts,'mixed':mixed,'arabic_length_groups':length_rows,
            'metric_notes':{'confidence':'Two-sided 95% Wilson interval per eligible document. Author/topic dependence can widen uncertainty. Zero eligible returns null.',
                            'coverage':'Eligible divided by eligible plus abstained. New test row totals start after screening and the 400-record cap; experiment.source_counts reports earlier exclusions. Origins other than machine or human are descriptive signal rates.',
                            'mixtures':'Word proportions from real paired contiguous blocks; same pair at three ratios. Numeric MAE includes 0% and uses actual word count. A suppressed score contributes only possible [0,20] bounds to the all-scored interval.',
                            'scope':'New corpus and topic-screened evaluation; corpus labels as published. Individual author disjointness, independent committee data and cross-group fairness are unverified.',
                            'translation':'English round-trip observations are descriptive on translated human prose. Arabic back-translation of long-form generated prose has not been validated.'}}
    result['display_policy']=study['experiment']['control']['displayPolicy']
    return result

if __name__=='__main__':
    result=output(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
