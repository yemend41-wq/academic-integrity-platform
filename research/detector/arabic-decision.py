from pathlib import Path
import json
from scipy.stats import beta
root=Path(__file__).resolve().parent
read=lambda f:json.loads((root/f).read_text())
current=read('arabic-challenger-metrics.json')
baseline=read('baseline-arabic-followup.json')
def observation(r):
    n,k=r['eligible'],r['any']
    return {'eligible':n,'signals':k,'inclusive_rate':k/n,
            'one_sided_95pct_upper_binomial':float(beta.ppf(.95,k+1,n-k)) if k<n else 1}
passed=(current['ar_apt_human']['any']/current['ar_apt_human']['eligible']<.01 and
        current['academic_human']['any']/current['academic_human']['eligible']<.01 and
        current['ar_apt_machine']['any']/current['ar_apt_machine']['eligible']>=.5)
gated=passed and read('challenger-decision.json')['status']=='eligible_for_promotion'
decision={'version':'AIP-HL-3','status':'eligible_for_promotion' if gated else 'rejected',
          'arabic_gate_met':passed,'bilingual_gate_met':gated,'active_model_changed':False,
          'calibration':{'arabic_eligible_human_calibration_documents':112,'arabic_eligible_training_documents':606,
                         'wikipedia_development_passages_before_length_filter':460},
          'comparison':{k:{'baseline':observation(baseline[k]),'candidate':observation(current[k])} for k in current}}
(root/'arabic-challenger-decision.json').write_text(json.dumps(decision,indent=2)+'\n')
