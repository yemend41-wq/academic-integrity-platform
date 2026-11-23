"""Re-run the reserved research study using fetch_data.py + reproduce.py input directory."""
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
data=Path(sys.argv[1]).resolve()
out=data/'release4'
active=HERE/'detector.mjs'
def run(cmd, destination=None):
    env={**os.environ,'OPENBLAS_NUM_THREADS':'1'}
    if destination:
        with destination.open('w') as log:
            subprocess.run(cmd,cwd=HERE,check=True,stdout=log,env=env)
    else:
        subprocess.run(cmd,cwd=HERE,check=True,env=env)
run([sys.executable,'release4-prepare.py',data])
run(['node','extract.mjs',out/'development.jsonl'],out/'features.jsonl')
run([sys.executable,'release4-fit.py',out])
run(['node','release4-score.mjs',data])
run(['node','external.mjs',data,out/'liang.json',active])
run(['node','audit-groups.mjs',data,'domain',active,out/'domains.json'])
run(['node','arabic-audit.mjs',data,active,out/'arabic.json'])
run(['node','--max-old-space-size=3700','strict-assess.mjs',data,data/'rerun/strict/detector.mjs',active,out/'prior-strict.json'])
run(['node','evaluate.mjs',data/'arabic-challenger.jsonl',out/'mixed.json',active])
run(['node','translations.mjs',data/'roundtrip.jsonl',out/'roundtrip.json',active])
run([sys.executable,'release4-report.py',out,out/'study.json'])
if json.loads((out/'study.json').read_text())!=json.loads((HERE/'release4-study.json').read_text()):
    raise RuntimeError('Compared metrics or sample identities differ from the original release-4 run')
print('Frozen corpus selection, experimental coefficient hash and all release-4 audit results reproduced.')
