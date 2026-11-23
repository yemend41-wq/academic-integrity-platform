"""Summarize audit rows produced by the deployed JavaScript inference function."""
import json
import sys
from pathlib import Path
from collections import Counter
from scipy.stats import beta

audit = json.loads(Path(sys.argv[1]).read_text())
split = [json.loads(s) for s in Path(sys.argv[2]).read_text().splitlines()]
summary = {'version':sys.argv[4] if len(sys.argv)>4 else 'AIP-HL-1','units':'documents','threshold_selection':'validation human maximum, fixed before test',
           'laboratory_holdout':True,'independent_committee_blind':False,'by_language':{},'mixtures':{}}
for lang in ('en','ar'):
    docs=[r for r in audit['outcomes'] if r['lang']==lang]
    h=[r for r in docs if r['label']==0 and r['eligible']]
    a=[r for r in docs if r['label']==1 and r['eligible']]
    fp=sum(r['anySignal'] for r in h)
    tp=sum(r['anySignal'] for r in a)
    fs=sum(r['visibleNumeric'] for r in h)
    ts=sum(r['visibleNumeric'] for r in a)
    summary['by_language'][lang]={
        'train_documents':sum(r['lang']==lang and r['split']=='train' for r in split),
        'validation_documents':sum(r['lang']==lang and r['split']=='validation' for r in split),
        'test_documents':len(docs),'human_test_eligible':len(h),'ai_test_eligible':len(a),
        'abstentions':len(docs)-len(h)-len(a),
        'false_positives_including_suppressed':fp,'true_positives_including_suppressed':tp,
        'false_positive_rate':fp/len(h),'recall':tp/len(a),
        'human_flags_at_least_20_percent':fs,'ai_flags_at_least_20_percent':ts,
        'one_sided_95pct_binomial_fpr_upper_bound':1.0 if fp==len(h) else beta.ppf(.95,fp+1,len(h)-fp)
    }
    summary['mixtures'][lang]={}
    for frac in (.25,.5,.75):
        test=[r for r in audit['mixed'] if r['lang']==lang and r['fraction']==frac]
        # Suppressed percentages remain private: give range-compatible counts.
        n=len(test)
        above=sum(x['display'] not in ('0%','*%',None) for x in test)
        accurate=sum(x['display'] not in ('*%',None) and abs(int(x['display'][:-1])-100*frac)<=10 for x in test)
        summary['mixtures'][lang][str(frac)]={'documents':n,'visible_above_suppression':above,'within_10_percentage_points_visible':accurate,
                                             'suppressed':sum(x['display']=='*%' for x in test)}
Path(sys.argv[3]).write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary, indent=2))
