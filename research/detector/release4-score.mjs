import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { models, version } from './weights.mjs';
import { createDetector } from './inference.mjs';
import { tokenize } from './features.mjs';
import { overlapChecker } from './overlap.mjs';

const data = process.argv[2];
const work = path.join(data, 'release4');
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = (file) => fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(row=>JSON.parse(row));
const digest = value => createHash('sha256').update(value).digest('hex');
const control = createDetector(models, version);
const candidate = createDetector({...models, ar:load(path.join(work,'arabic-model.json'))}, 'AIP-HL-5-research');
const checks = lines(path.join(work,'frozen.jsonl'));
const expected = load(path.join(work,'frozen-manifest.json')).manifest_sha256;
if (digest(checks.map(r=>r.sha256).join('\n'))!==expected || checks.some(r=>digest(r.text)!==r.sha256)) {
  throw new Error('Frozen sample identity changed');
}
const bins = n => n<96?'<96':n<192?'96–191':n<384?'192–383':'384+';
function count(out, key, score) {
  const group=out[key]??={total:0,eligible:0,any:0,numeric:0,abstained:0};
  group.total++;
  if(score.status==='insufficient') group.abstained++;
  else {
    group.eligible++;
    if(score.display!=='0%') {
      group.any++;
      if(score.status!=='suppressed') group.numeric++;
    }
  }
}
const experiment = {};
for(const [name,detector] of [['control',control],['candidate',candidate]]) {
  const scores={}, lengthBands={};
  const displayPolicy={checked:0,suppressed:0,numberedPositive:0,insufficient:0};
  for(const row of checks) {
    const n=tokenize(row.text).length;
    const key=row.lang==='en'?'ArguGPT OOD generation':row.label?'Arabic title-generated abstracts':'Arabic original abstracts';
    const score=detector(row.text);
    displayPolicy.checked++;
    if(score.status==='insufficient') {
      displayPolicy.insufficient++;
      if(score.display!==null||score.segments.length) throw Error('Invalid insufficient result');
    } else if(score.status==='suppressed') {
      displayPolicy.suppressed++;
      if(score.display!=='*%' || score.flaggedWords!==null || score.segments.length) throw Error('Suppression leaks results');
    } else if(score.display!=='0%') {
      displayPolicy.numberedPositive++;
      if(score.flaggedWords*5<score.eligibleWords || !score.segments.some(s=>s.flagged)) throw Error('Inconsistent numeric highlight');
      if(score.segments.some((s,i)=>s.start>=s.end || s.end>row.text.length || (i && s.start<score.segments[i-1].end))) throw Error('Invalid sentence offsets');
    }
    count(scores,key,score);
    count(lengthBands,key+' / '+bins(n),score);
  }
  experiment[name]={scores,lengthBands,displayPolicy};
}
const prior=lines(path.join(data,'arabic-challenger.jsonl')).filter(r=>r.lang==='ar');
const overlap=overlapChecker(prior);
const lengths={}, sources={}, seen=new Set();
function oldSample(text,source) {
  const fingerprint=source+digest(text);
  if(seen.has(fingerprint)||overlap(text)>=.20) return;
  seen.add(fingerprint);
  const r=control(text);
  count(lengths,source+' / '+bins(tokenize(text).length),r);
  count(sources,source,r);
}
for(const r of lines(path.join(data,'ArabicCorpus.jsonl'))) if(r.label==='human') oldSample(r.document,'Course-project collection');
for(const r of load(path.join(data,'apt-human-polished.json'))) oldSample(r.original,'Ar-APT press');
for(const r of lines(path.join(data,'academic-ar.jsonl'))) oldSample(r.original_abstract,'KFUPM abstracts');
const output={experiment,active_arabic_audit:{lengths,sources}};
fs.writeFileSync(path.join(work,'scores.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(experiment).map(([k,v])=>[k,v.scores]))));
