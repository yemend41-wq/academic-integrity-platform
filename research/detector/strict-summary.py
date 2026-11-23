import json,sys
from pathlib import Path
from scipy.stats import beta
root=Path(__file__).resolve().parent
result=json.loads((root/'strict-holdout-metrics.json').read_text())
def table(rows):
    compact=[]
    for name,r in rows.items():
        n,k=r['eligible'],r['any']
        upper=1 if k==n else float(beta.ppf(.95,k+1,n-k))
        lower=0 if k==0 else float(beta.ppf(.05,k,n-k+1))
        compact.append({'cohort':name,'language':r['lang'],'origin':'machine' if r['label'] else 'human',
                        'total':r['total'],'eligible':n,'excluded_overlap':r['overlap'],'abstained':r['abstained'],
                        'inclusive_signals':k,'numerically_visible':r['visible'],'point_rate':k/n,'upper_one_sided_95':upper,'lower_one_sided_95':lower})
    return compact
strict=table(result['strict'])
flags=[r for r in strict if r['origin']=='human']
recall=[r for r in strict if r['origin']=='machine']
fpr_pass=all(r['point_rate']<.01 for r in flags)
bounds_pass=all(r['upper_one_sided_95']<.01 for r in flags)
recall_pass=all(r['point_rate']>=.5 for r in recall)
summary={'version':'AIP-HL-4-research','active_model_changed':False,'strict':strict,'same_data_AIP_HL_3':table(result['control']),
 'both_human_cohorts_below_one_percent_observed':fpr_pass,'both_fpr_upper_bounds_below_one_percent':bounds_pass,
 'both_machine_cohorts_recall_at_least_half':recall_pass,'production_release':False,
 'scope':'New sources after locked calibration. Domestic news and machine-translated instruction pairs are not representative of Arabic student essays. The English human and machine essays come from different collections. Arabic repeated publishers and English essay sources limit independence.'}
(root/'strict-holdout-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps([(r['cohort'],r['inclusive_signals'],r['eligible'],r['upper_one_sided_95']) for r in strict]))
