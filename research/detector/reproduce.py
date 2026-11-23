"""Rebuild and benchmark both models using verified data in an operator-provided directory."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('data_directory',type=Path)
ns=parser.parse_args()
data=ns.data_directory.resolve()
output=data/'rerun'
output.mkdir(exist_ok=True)
def run(*cmd,to=None):
    cmd=[str(x) for x in cmd]
    env=dict(os.environ,OPENBLAS_NUM_THREADS='1')
    if to:
        with to.open('w') as f:
            subprocess.run(cmd,cwd=HERE,stdout=f,check=True,env=env)
    else:
        subprocess.run(cmd,cwd=HERE,check=True,env=env)
run(sys.executable,'prepare.py',data)
run(sys.executable,'add_domains.py',data)
run(sys.executable,'add_arabic.py',data)
for tag,corpus,version in [('baseline','corpus','AIP-HL-1'),('challenger','challenger','AIP-HL-2'),('arabic-challenger','arabic-challenger','AIP-HL-3')]:
    dest=output/tag
    dest.mkdir(exist_ok=True)
    features=output/(tag+'-features.jsonl')
    run('node','extract.mjs',data/(corpus+'.jsonl'),to=features)
    run(sys.executable,'train.py',features,dest/'weights.mjs',version)
    for module in ['detector.mjs','features.mjs','inference.mjs']:
        shutil.copyfile(HERE/module,dest/module)
    digests=json.loads((HERE/'model-digests.json').read_text())
    expected_name={'baseline':'baseline-weights.mjs','challenger':'weights-challenger.mjs','arabic-challenger':'weights-ar3.mjs'}[tag]
    if hashlib.sha256((dest/'weights.mjs').read_bytes()).hexdigest()!=digests[expected_name]:
        raise RuntimeError('Training did not reproduce frozen coefficients byte-for-byte: '+tag)
    if tag in ('baseline','challenger'):
        run('node','audit-groups.mjs',data,'domain',dest/'detector.mjs',dest/'domain-metrics.json')
    if tag in ('baseline','arabic-challenger'):
        run('node','arabic-audit.mjs',data,dest/'detector.mjs',dest/'arabic-metrics.json')
run('node','evaluate.mjs',data/'corpus.jsonl',output/'baseline-rows.json')
run(sys.executable,'results.py',output/'baseline-rows.json',data/'corpus.jsonl',output/'metrics.json')
run('node','external.mjs',data,output/'external-metrics.json')
run('node','audit-groups.mjs',data,'baseline-ar',HERE/'baseline-detector.mjs',output/'external-ar-metrics.json')
run('node','translations.mjs',data/'roundtrip.jsonl',output/'translation-metrics.json')
strict=output/'strict'
strict.mkdir(exist_ok=True)
run('node','strict-operating-point.mjs',data,output/'arabic-challenger'/'weights.mjs',strict/'calibration.json',strict/'weights.mjs')
for module in ['detector.mjs','features.mjs','inference.mjs']:
    shutil.copyfile(HERE/module,strict/module)
run(sys.executable,'strict-holdout-prepare.py',data)
run('node','--max-old-space-size=3800','strict-assess.mjs',data,strict/'detector.mjs',output/'arabic-challenger'/'detector.mjs',strict/'holdout.json')
run('node','external.mjs',data,output/'active-english.json',HERE/'detector.mjs')
run('node','translations.mjs',data/'roundtrip.jsonl',output/'active-roundtrip.json',HERE/'detector.mjs')
run('node','evaluate.mjs',data/'corpus.jsonl',output/'active-rows.json',HERE/'detector.mjs')
run(sys.executable,'results.py',output/'active-rows.json',data/'corpus.jsonl',output/'active-group.json','AIP-HL-3')
if (HERE/'weights.mjs').read_bytes()!=(output/'arabic-challenger'/'weights.mjs').read_bytes():
    raise RuntimeError('Assessment build coefficients differ from the tested AIP-HL-3 model.')
checks={'active-english.json':'active-english-cohorts.json','active-roundtrip.json':'active-roundtrip.json','active-group.json':'active-group-metrics.json','strict/calibration.json':'strict-calibration.json','strict/holdout.json':'strict-holdout-metrics.json','metrics.json':'metrics.json','external-metrics.json':'external-metrics.json',
        'external-ar-metrics.json':'external-ar-metrics.json','translation-metrics.json':'translation-metrics.json',
        'baseline/arabic-metrics.json':'baseline-arabic-followup.json','arabic-challenger/arabic-metrics.json':'arabic-challenger-metrics.json',
        'baseline/domain-metrics.json':'baseline-domain-metrics.json','challenger/domain-metrics.json':'challenger-metrics.json'}
for actual,expected in checks.items():
    if (output/actual).read_bytes()!=(HERE/expected).read_bytes():
        raise RuntimeError('New metrics differ from the preserved record: '+actual)
print('Four research operating points, active HL-3 coefficients and thirteen metric/calibration artifacts reproduced.')
