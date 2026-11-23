from pathlib import Path
import json
from scipy.stats import beta
p=Path(__file__).resolve().parent
r=json.loads((p/'challenger-metrics.json').read_text())
def group(keys):
    eligible=sum(r[k]['eligible'] for k in keys)
    any_signal=sum(r[k]['any'] for k in keys)
    return {'eligible':eligible,'alerts':any_signal,'rate':any_signal/eligible,
            'one_sided_95pct_upper_binomial':float(beta.ppf(.95,any_signal+1,eligible-any_signal))}
human=group([k for k in r if k.split('__')[0].startswith(('mage','raid')) and k.endswith('__0')])
ai=group([k for k in r if k.split('__')[0].startswith(('mage','raid')) and k.endswith('__1')])
learners=group(['esl_ellipse__0','esl_icnale__0'])
passed=human['rate']<.01 and ai['rate']>=.50 and learners['rate']<.01
decision={'version':'AIP-HL-2','status':'eligible_for_promotion' if passed else 'rejected',
          'pooled_general_domain_human':human,'pooled_general_domain_machine':ai,'learner_essays':learners,
          'rule_file':'challenger-protocol.json','changed_active_model':False}
(p/'challenger-decision.json').write_text(json.dumps(decision,indent=2)+'\n')
print(decision)
