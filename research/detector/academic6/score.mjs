// Prior to execution, the private input, protocol, public detector and candidate bytes must match the committed locks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tokenize} from '../features.mjs';
import {models,version} from '../weights.mjs';

const [privateFolder,candidateFolder]=process.argv.slice(2);
const dirs={current:fileURLToPath(new URL('../',import.meta.url)),candidate:path.resolve(candidateFolder)};
const freeze=JSON.parse(fs.readFileSync(new URL('./freeze.json',import.meta.url)));
const sha=data=>createHash('sha256').update(data).digest('hex');
function verified(filename,digest){
  const b=fs.readFileSync(filename);assert.equal(sha(b),digest,filename);return b;
}
const cnLock={weights:'013cb1a52a29c5bc3af2e59e628bef8fb58568ac0c9739e06343dedfcb5e8cb6',core:'895f6fba41f78b768d4ddbd08cf51c5d35de052ba3497a12ac211d6285bfedcf'};
const cnWeights=JSON.parse(verified(path.join(dirs.candidate,'weights.json'),cnLock.weights));
verified(path.join(dirs.current,'weights.mjs'),'956864e902eff441336432abbdf2bc4a9cc18af6027eed01e63d630ed836adef');
verified(path.join(dirs.current,'features.mjs'),'e54462c8828a2369e6a428a56a280e032ec4df64f13ac740aae61a6abb39d6f6');
const {scoreAll}=await import(pathToFileURL(path.join(dirs.candidate,'detector.mjs')));
async function aggregateAudit(file,checksum,mark,replacement){
  const src=verified(file,checksum).toString('utf8');
  assert.equal(src.split(mark).length,2);
  const code=src.replace(mark,replacement).replace(/from '([^']+)'/g,(_s,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),p)).href));
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const baseAudit=await aggregateAudit(path.join(dirs.current,'inference.mjs'),'205b09e0d06c2a5ec4947773be5cc487d9e68b921e3c69fc1c430d0b6c35d8b6','flaggedWords:suppressed?null:flaggedWords','flaggedWords');
const cnAudit=await aggregateAudit(path.join(dirs.candidate,'core.mjs'),cnLock.core,'flaggedWords:hidden?null:flagged[i]','flaggedWords:flagged[i]');
const privateBase=baseAudit.createDetector(models,version), privateCandidates=cnAudit.createPair(cnWeights);
const load=(name,sum)=>verified(path.join(privateFolder,name),sum).toString('utf8').trimEnd().split('\n').map(JSON.parse);
const truths=new Map(load('truth.jsonl',freeze.inputFiles['truth.jsonl']).map(r=>[r.id,r]));
const rows=load('sealed-all.jsonl',freeze.maskedInputs['sealed-all.jsonl']);
const out=fs.openSync(path.join(privateFolder,'fixed-output.jsonl'),'w');
let total=0;
for(const r of rows){
  const ground=truths.get(r.id);
  const words=tokenize(r.text);
  const results=scoreAll(r.text);
  assert.deepEqual(results.map(z=>z.model),[version,...cnWeights.versions]);
  for(const [i,p] of results.entries()){
    let actual=p.flaggedWords;
    if(p.status==='suppressed'){
      assert.equal(p.display,'*%');assert.equal(actual,null);assert.deepEqual(p.segments,[]);
      // Compare the unmodified interface and an otherwise identical private in-memory return, only for aggregate mixed MAE.
      if(ground.cohort==='mixed'){
        const audited=i===0?privateBase(r.text):privateCandidates(r.text)[i-1];
        actual=audited.flaggedWords;
        assert.deepEqual({...audited,flaggedWords:null},p);
        assert.ok(actual>0 && 5*actual<p.eligibleWords);
      }
    } else if(p.status==='analyzed'){
      assert.equal(p.display,(actual?Math.max(1,Math.round(100*actual/p.eligibleWords)):0)+'%');
    } else {
      assert.equal(p.status,'insufficient');assert.equal(p.eligibleWords,0);assert.equal(p.display,null);
    }
    const result={id:r.id,model:p.model,display:p.display,status:p.status,eligible:p.eligibleWords,words:words.length};
    if(ground.cohort==='mixed'){
      result.estimated=actual===null?null:100*actual/p.eligibleWords;
      const visible=p.segments.filter(q=>q.flagged);
      result.span={tp:0,fp:0,fn:0,tn:0};
      for(const w of words){
        const truth=ground.paragraphs.find(b=>w.start>=b.start&&w.end<=b.end);
        assert.ok(truth);
        const shown=visible.some(s=>w.start>=s.start&&w.end<=s.end);
        result.span[truth.machine?(shown?'tp':'fn'):(shown?'fp':'tn')]++;
      }
      assert.equal(result.span.tp+result.span.fn,ground.truthPercentage*.8);
    }
    fs.writeSync(out,JSON.stringify(result)+'\n');total++;
  }
}
fs.closeSync(out);console.log('fixed cases',rows.length,'scores',total);
