"""Fit document-weighted language-specific models on the frozen group split."""
import json
import sys
from pathlib import Path
from collections import Counter
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

def sparse(features):
    entries, indices, ends = [], [], [0]
    for row in features:
        for idx, val in row:
            indices.append(idx)
            entries.append(val)
        ends.append(len(entries))
    return csr_matrix((entries, indices, ends), shape=(len(ends)-1,8192))

def main(data, output, version):
    docs = [json.loads(line) for line in open(data)]
    models = {}
    for lang in ['ar','en']:
        training = [r for r in docs if r['lang']==lang and r['split']=='train' and r['features']]
        validation = [r for r in docs if r['lang']==lang and r['split']=='validation' and r['label']==0 and r['features']]
        labels_count = Counter(r['label'] for r in training)
        features, labels, weights = [], [], []
        for r in training:
            n = len(r['features'])
            weight = len(training)/(2*labels_count[r['label']]*n)
            features.extend(r['features'])
            labels.extend([r['label']]*n)
            weights.extend([weight]*n)
        clf=LogisticRegression(C=16.0,max_iter=1000,solver='liblinear',random_state=113,
                               intercept_scaling=2,tol=1e-8).fit(sparse(features),labels,sample_weight=weights)
        coef = np.round(clf.coef_[0],7)
        bias = round(float(clf.intercept_[0]),7)
        val_max = [max(sparse(r['features'])@coef+bias) for r in validation]
        # Use ONLY validation human documents for the threshold. Strict comparison also
        # applies when the result equals a validation maximum. A target is not a guarantee.
        target=0.998 if version=='AIP-HL-3' or (version=='AIP-HL-2' and lang=='en') else 0.99
        threshold = float(np.quantile(val_max,target,method='higher'))+1e-8
        models[lang]={'bias':bias,'threshold':threshold,'weights':coef.tolist()}
        print(lang,len(training),'training documents;',len(validation),'human calibration documents')
    output.write_text('export const version='+json.dumps(version)+';\nexport const models='+
                      json.dumps(models,separators=(',',':'))+';\n')

if __name__=='__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]),sys.argv[3] if len(sys.argv)>3 else 'AIP-HL-1')
