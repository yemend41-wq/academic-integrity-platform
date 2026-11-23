// A new research calibration run. All previously examined source cohorts are
// development inputs to THIS run and cannot serve as its independent test set.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {windows,tokenize,scoredWindow} from './features.mjs';
const [dir,coefs,calibration,weightsFile]=process.argv.slice(2);
const {models}=await import(pathToFileURL(path.resolve(coefs)));
const lines=n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').map(z=>JSON.parse(z));
const array=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const groups=new Map(), excluded=[];
function include(text,lang,group) {
 const terms=tokenize(text), eligible=windows(terms).filter(w=>w.lang===lang);
 if(!eligible.length)return;
 const score=Math.max(...eligible.map(w=>scoredWindow(models[lang],terms,w)));
 if(!groups.has(group))groups.set(group,{lang,scores:new Map()});
 const id=createHash('sha256').update(terms.map(z=>z.term).join(' ')).digest('hex');
 groups.get(group).scores.set(id,score);
}
for(const r of lines('test.jsonl').filter(r=>!r.label))include(r.text,'en','MAGE-RAID / previous test');
for(const r of lines('esl.jsonl'))include(r.text,'en','Learner and native essays / previous test');
for(const f of ['CS224N_real_145','CollegeEssay_real_70','HewlettStudentEssay_real_88','TOEFL_real_91'])
 for(const r of array(f+'.json'))include(r.document,'en','Liang human / previous test');
for(const r of lines('ArabicCorpus.jsonl').filter(r=>r.label==='human'))include(r.document,'ar','Arabic collection / previous test');
for(const r of lines('academic-ar.jsonl'))include(r.original_abstract,'ar','Academic abstracts / previous test');
for(const r of array('apt-human-polished.json'))include(r.original,'ar','Ar-APT original articles / previous test');
for(const r of lines('arabic-challenger.jsonl').filter(r=>!r.label&&r.split==='validation')) include(r.text,r.lang,r.lang+' / earlier human calibration');
const summary={source:'AIP-HL-3 fixed coefficients',rule:'fixed before new holdout: maximum observed group 99.5th percentile of eligible human per-document maximum logits. Native 48-word floor unchanged; no new abstention rule.',groups:{},thresholds:{}};
for(const [id,g] of groups) {
 const arr=[...g.scores.values()].sort((a,b)=>a-b), cutoff=arr[Math.ceil((arr.length-1)*.995)];
 summary.groups[id]={lang:g.lang,eligible_unique:arr.length,quantile:cutoff};
 summary.thresholds[g.lang]=Math.max(summary.thresholds[g.lang]??-Infinity,cutoff);
}
for(const lang of ['en','ar'])models[lang].threshold=summary.thresholds[lang]+1e-8;
const source='export const version="AIP-HL-4-research";\nexport const models='+JSON.stringify(models)+';\n';
fs.writeFileSync(weightsFile,source);
summary.candidate_sha256=createHash('sha256').update(source).digest('hex');
fs.writeFileSync(calibration,JSON.stringify(summary,null,2)+'\n');
